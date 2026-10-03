// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

use super::detect::run_cmd;
use super::types::{ExposureRisk, OpenPort};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudProvider {
    Aws,
    Azure,
    Gcp,
    Unknown,
}

impl CloudProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Aws => "aws",
            Self::Azure => "azure",
            Self::Gcp => "gcp",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSecurityGroupRule {
    pub provider: CloudProvider,
    pub group_id: String,
    pub group_name: String,
    pub direction: String,
    pub protocol: String,
    pub port_range: String,
    pub source: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudFirewallInventory {
    pub provider: CloudProvider,
    pub reachable: bool,
    pub summary: String,
    pub security_groups: Vec<CloudSecurityGroupRule>,
    pub open_ports: Vec<OpenPort>,
}

pub fn gather_cloud_inventory() -> CloudFirewallInventory {
    if let Some(inv) = read_aws_security_groups() {
        return inv;
    }
    if let Some(inv) = read_azure_nsg() {
        return inv;
    }
    if let Some(inv) = read_gcp_firewall_rules() {
        return inv;
    }
    CloudFirewallInventory {
        provider: CloudProvider::Unknown,
        reachable: false,
        summary:
            "No cloud CLI credentials detected — configure AWS/Azure/GCP CLI on controller host"
                .into(),
        security_groups: vec![],
        open_ports: vec![],
    }
}

fn read_aws_security_groups() -> Option<CloudFirewallInventory> {
    let out = run_cmd(
        "aws",
        &[
            "ec2",
            "describe-security-groups",
            "--output",
            "json",
            "--query",
            "SecurityGroups[*].{GroupId:GroupId,GroupName:GroupName,IpPermissions:IpPermissions}",
        ],
    )
    .ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&out).ok()?;
    let groups = parsed.as_array()?;
    let mut rules = Vec::new();
    let mut open_ports = Vec::new();
    for g in groups {
        // A malformed/unexpected group entry is skipped, not treated as a
        // reason to abort the whole scan (and thus discard every other
        // already-collected finding).
        let Some(gid) = g.get("GroupId").and_then(|v| v.as_str()) else {
            continue;
        };
        let gid = gid.to_string();
        let gname = g
            .get("GroupName")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let Some(perms) = g.get("IpPermissions").and_then(|v| v.as_array()) else {
            continue;
        };
        for perm in perms {
            let proto = perm
                .get("IpProtocol")
                .and_then(|p| p.as_str())
                .unwrap_or("tcp")
                .to_string();
            let from = perm
                .get("FromPort")
                .and_then(|p| p.as_u64())
                .map(|p| p as u16)
                .unwrap_or(0);
            let to = perm
                .get("ToPort")
                .and_then(|p| p.as_u64())
                .map(|p| p as u16)
                .unwrap_or(from);
            let port_range = if from == to {
                from.to_string()
            } else {
                format!("{from}-{to}")
            };

            // AWS permission entries carry their source(s) in one or more of
            // these optional fields depending on rule type. A rule missing
            // IpRanges (e.g. one that only uses UserIdGroupPairs, Ipv6Ranges,
            // or PrefixListIds) must not abort the scan of every other group —
            // each shape is handled independently and any entry with no
            // recognized shape is still recorded (with an "unknown" source)
            // instead of being silently dropped.
            let mut had_source = false;

            if let Some(ip_ranges) = perm.get("IpRanges").and_then(|v| v.as_array()) {
                for ip in ip_ranges {
                    let cidr = ip
                        .get("CidrIp")
                        .and_then(|c| c.as_str())
                        .unwrap_or("0.0.0.0/0");
                    had_source = true;
                    rules.push(CloudSecurityGroupRule {
                        provider: CloudProvider::Aws,
                        group_id: gid.clone(),
                        group_name: gname.clone(),
                        direction: "inbound".into(),
                        protocol: proto.clone(),
                        port_range: port_range.clone(),
                        source: cidr.into(),
                        description: ip
                            .get("Description")
                            .and_then(|d| d.as_str())
                            .map(str::to_string),
                    });
                    if cidr == "0.0.0.0/0" && from > 0 {
                        open_ports.push(OpenPort {
                            port: from,
                            protocol: proto.clone(),
                            service_name: gname.clone(),
                            bind_address: "cloud".into(),
                            process: None,
                            allowed_from: vec![cidr.into()],
                            risk: if from == 22 || from == 5432 || from == 3306 {
                                ExposureRisk::Critical
                            } else {
                                ExposureRisk::Warning
                            },
                            evidence: vec!["aws:security-group".into()],
                        });
                    }
                }
            }

            if let Some(ipv6_ranges) = perm.get("Ipv6Ranges").and_then(|v| v.as_array()) {
                for ip in ipv6_ranges {
                    let cidr = ip
                        .get("CidrIpv6")
                        .and_then(|c| c.as_str())
                        .unwrap_or("::/0");
                    had_source = true;
                    rules.push(CloudSecurityGroupRule {
                        provider: CloudProvider::Aws,
                        group_id: gid.clone(),
                        group_name: gname.clone(),
                        direction: "inbound".into(),
                        protocol: proto.clone(),
                        port_range: port_range.clone(),
                        source: cidr.into(),
                        description: ip
                            .get("Description")
                            .and_then(|d| d.as_str())
                            .map(str::to_string),
                    });
                    if cidr == "::/0" && from > 0 {
                        open_ports.push(OpenPort {
                            port: from,
                            protocol: proto.clone(),
                            service_name: gname.clone(),
                            bind_address: "cloud".into(),
                            process: None,
                            allowed_from: vec![cidr.into()],
                            risk: if from == 22 || from == 5432 || from == 3306 {
                                ExposureRisk::Critical
                            } else {
                                ExposureRisk::Warning
                            },
                            evidence: vec!["aws:security-group".into()],
                        });
                    }
                }
            }

            if let Some(group_pairs) = perm.get("UserIdGroupPairs").and_then(|v| v.as_array()) {
                for pair in group_pairs {
                    had_source = true;
                    let source = pair
                        .get("GroupId")
                        .and_then(|v| v.as_str())
                        .map(|s| format!("sg:{s}"))
                        .unwrap_or_else(|| "sg:unknown".into());
                    rules.push(CloudSecurityGroupRule {
                        provider: CloudProvider::Aws,
                        group_id: gid.clone(),
                        group_name: gname.clone(),
                        direction: "inbound".into(),
                        protocol: proto.clone(),
                        port_range: port_range.clone(),
                        source,
                        description: pair
                            .get("Description")
                            .and_then(|d| d.as_str())
                            .map(str::to_string),
                    });
                }
            }

            if let Some(prefix_ids) = perm.get("PrefixListIds").and_then(|v| v.as_array()) {
                for pl in prefix_ids {
                    had_source = true;
                    let source = pl
                        .get("PrefixListId")
                        .and_then(|v| v.as_str())
                        .map(|s| format!("prefix-list:{s}"))
                        .unwrap_or_else(|| "prefix-list:unknown".into());
                    rules.push(CloudSecurityGroupRule {
                        provider: CloudProvider::Aws,
                        group_id: gid.clone(),
                        group_name: gname.clone(),
                        direction: "inbound".into(),
                        protocol: proto.clone(),
                        port_range: port_range.clone(),
                        source,
                        description: pl
                            .get("Description")
                            .and_then(|d| d.as_str())
                            .map(str::to_string),
                    });
                }
            }

            if !had_source {
                rules.push(CloudSecurityGroupRule {
                    provider: CloudProvider::Aws,
                    group_id: gid.clone(),
                    group_name: gname.clone(),
                    direction: "inbound".into(),
                    protocol: proto.clone(),
                    port_range: port_range.clone(),
                    source: "unknown".into(),
                    description: Some(
                        "permission entry had no IpRanges/Ipv6Ranges/UserIdGroupPairs/PrefixListIds"
                            .into(),
                    ),
                });
            }
        }
    }
    Some(CloudFirewallInventory {
        provider: CloudProvider::Aws,
        reachable: true,
        summary: format!("{} AWS security group rules", rules.len()),
        security_groups: rules,
        open_ports,
    })
}

fn read_azure_nsg() -> Option<CloudFirewallInventory> {
    let out = run_cmd("az", &["network", "nsg", "list", "--output", "json"]).ok()?;
    let groups: serde_json::Value = serde_json::from_str(&out).ok()?;
    let arr = groups.as_array()?;
    let mut rules = Vec::new();
    for g in arr {
        let id = g.get("id")?.as_str()?.to_string();
        let name = g.get("name")?.as_str()?.to_string();
        rules.push(CloudSecurityGroupRule {
            provider: CloudProvider::Azure,
            group_id: id,
            group_name: name,
            direction: "inbound".into(),
            protocol: "mixed".into(),
            port_range: "*".into(),
            source: "azure-nsg".into(),
            description: Some("Use az network nsg rule list for detail".into()),
        });
    }
    Some(CloudFirewallInventory {
        provider: CloudProvider::Azure,
        reachable: !rules.is_empty(),
        summary: format!("{} Azure NSGs discovered", rules.len()),
        security_groups: rules,
        open_ports: vec![],
    })
}

fn read_gcp_firewall_rules() -> Option<CloudFirewallInventory> {
    let out = run_cmd(
        "gcloud",
        &["compute", "firewall-rules", "list", "--format=json"],
    )
    .ok()?;
    let arr: serde_json::Value = serde_json::from_str(&out).ok()?;
    let rules_json = arr.as_array()?;
    let mut rules = Vec::new();
    for r in rules_json {
        let name = r.get("name")?.as_str()?.to_string();
        let direction = r
            .get("direction")
            .and_then(|d| d.as_str())
            .unwrap_or("INGRESS")
            .to_ascii_lowercase();
        rules.push(CloudSecurityGroupRule {
            provider: CloudProvider::Gcp,
            group_id: name.clone(),
            group_name: name,
            direction,
            protocol: "mixed".into(),
            port_range: "*".into(),
            source: "gcp-firewall".into(),
            description: r
                .get("description")
                .and_then(|d| d.as_str())
                .map(str::to_string),
        });
    }
    Some(CloudFirewallInventory {
        provider: CloudProvider::Gcp,
        reachable: !rules.is_empty(),
        summary: format!("{} GCP firewall rules", rules.len()),
        security_groups: rules,
        open_ports: vec![],
    })
}

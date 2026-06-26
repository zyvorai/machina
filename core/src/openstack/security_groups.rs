// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Neutron security groups (read-only).

use osauth::services::NETWORK;
use serde::Deserialize;

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_json_err, map_osauth_err};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackSecurityGroupRule {
    pub id: String,
    pub direction: String,
    pub protocol: Option<String>,
    pub port_range_min: Option<u16>,
    pub port_range_max: Option<u16>,
    pub remote_ip_prefix: Option<String>,
    pub remote_group_id: Option<String>,
    pub ethertype: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackSecurityGroup {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub rules: Vec<OpenStackSecurityGroupRule>,
}

#[derive(Deserialize)]
struct SgListResponse {
    security_groups: Vec<SgJson>,
}

#[derive(Deserialize)]
struct SgResponse {
    security_group: SgJson,
}

#[derive(Deserialize)]
struct SgJson {
    id: String,
    name: String,
    description: Option<String>,
    #[serde(default)]
    security_group_rules: Vec<SgRuleJson>,
}

#[derive(Deserialize)]
struct SgRuleJson {
    id: String,
    direction: String,
    protocol: Option<String>,
    #[serde(default)]
    port_range_min: Option<u16>,
    #[serde(default)]
    port_range_max: Option<u16>,
    remote_ip_prefix: Option<String>,
    remote_group_id: Option<String>,
    ethertype: Option<String>,
    description: Option<String>,
}

fn map_sg(sg: SgJson) -> OpenStackSecurityGroup {
    let rules = sg
        .security_group_rules
        .into_iter()
        .map(|r| OpenStackSecurityGroupRule {
            id: r.id,
            direction: r.direction,
            protocol: r.protocol,
            port_range_min: r.port_range_min,
            port_range_max: r.port_range_max,
            remote_ip_prefix: r.remote_ip_prefix,
            remote_group_id: r.remote_group_id,
            ethertype: r.ethertype,
            description: r.description,
        })
        .collect();
    OpenStackSecurityGroup {
        id: sg.id,
        name: sg.name,
        description: sg.description,
        rules,
    }
}

pub async fn list_security_groups(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackSecurityGroup>, LibvirtError> {
    let session = connect_session(cfg).await?;
    let resp = session
        .get(NETWORK, &["security-groups"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: SgListResponse = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body.security_groups.into_iter().map(map_sg).collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn get_security_group(
    cfg: &OpenStackConfig,
    id: &str,
) -> Result<OpenStackSecurityGroup, LibvirtError> {
    let sg_id = id.trim();
    if sg_id.is_empty() {
        return Err(LibvirtError::Invalid(
            "security group id is required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let resp = session
        .get(NETWORK, &["security-groups", sg_id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: SgResponse = resp.json().await.map_err(map_json_err)?;
    Ok(map_sg(body.security_group))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CreateSecurityGroupRequest {
    pub name: String,
    pub description: Option<String>,
}

pub async fn create_security_group(
    cfg: &OpenStackConfig,
    req: &CreateSecurityGroupRequest,
) -> Result<OpenStackSecurityGroup, LibvirtError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(LibvirtError::Invalid(
            "security group name is required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({
        "security_group": {
            "name": name,
            "description": req.description.as_deref().unwrap_or("")
        }
    });
    let resp = session
        .post(NETWORK, &["security-groups"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: SgResponse = resp.json().await.map_err(map_json_err)?;
    Ok(map_sg(parsed.security_group))
}

pub async fn delete_security_group(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    let sg_id = id.trim();
    if sg_id.is_empty() {
        return Err(LibvirtError::Invalid(
            "security group id is required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(NETWORK, &["security-groups", sg_id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CreateSecurityGroupRuleRequest {
    pub direction: String,
    pub protocol: Option<String>,
    pub port_range_min: Option<u16>,
    pub port_range_max: Option<u16>,
    pub remote_ip_prefix: Option<String>,
    pub remote_group_id: Option<String>,
    pub ethertype: Option<String>,
}

pub async fn create_security_group_rule(
    cfg: &OpenStackConfig,
    group_id: &str,
    req: &CreateSecurityGroupRuleRequest,
) -> Result<OpenStackSecurityGroupRule, LibvirtError> {
    let dir = req.direction.trim();
    if dir.is_empty() {
        return Err(LibvirtError::Invalid("direction is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut rule = serde_json::json!({
        "security_group_id": group_id.trim(),
        "direction": dir,
    });
    if let Some(ref p) = req.protocol {
        let pr = p.trim();
        if !pr.is_empty() {
            rule["protocol"] = serde_json::json!(pr);
        }
    }
    if let Some(min) = req.port_range_min {
        rule["port_range_min"] = serde_json::json!(min);
    }
    if let Some(max) = req.port_range_max {
        rule["port_range_max"] = serde_json::json!(max);
    }
    if let Some(ref rip) = req.remote_ip_prefix {
        let r = rip.trim();
        if !r.is_empty() {
            rule["remote_ip_prefix"] = serde_json::json!(r);
        }
    }
    if let Some(ref rg) = req.remote_group_id {
        let r = rg.trim();
        if !r.is_empty() {
            rule["remote_group_id"] = serde_json::json!(r);
        }
    }
    if let Some(ref eth) = req.ethertype {
        let e = eth.trim();
        if !e.is_empty() {
            rule["ethertype"] = serde_json::json!(e);
        }
    }
    #[derive(Deserialize)]
    struct RuleResp {
        security_group_rule: SgRuleJson,
    }
    let resp = session
        .post(NETWORK, &["security-group-rules"])
        .json(&serde_json::json!({ "security_group_rule": rule }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: RuleResp = resp.json().await.map_err(map_json_err)?;
    let r = body.security_group_rule;
    Ok(OpenStackSecurityGroupRule {
        id: r.id,
        direction: r.direction,
        protocol: r.protocol,
        port_range_min: r.port_range_min,
        port_range_max: r.port_range_max,
        remote_ip_prefix: r.remote_ip_prefix,
        remote_group_id: r.remote_group_id,
        ethertype: r.ethertype,
        description: r.description,
    })
}

pub async fn delete_security_group_rule(
    cfg: &OpenStackConfig,
    rule_id: &str,
) -> Result<(), LibvirtError> {
    let id = rule_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("rule id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(NETWORK, &["security-group-rules", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Neutron topology graph for SVG visualization.

use serde::{Deserialize, Serialize};

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::networking::list_floating_ips;
use super::resources::list_networks;
use super::topology::{list_ports, list_routers, list_subnets};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyNode {
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyEdge {
    pub from: String,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkTopologyGraph {
    pub nodes: Vec<TopologyNode>,
    pub edges: Vec<TopologyEdge>,
}

pub async fn build_network_topology(
    cfg: &OpenStackConfig,
) -> Result<NetworkTopologyGraph, LibvirtError> {
    let (networks, subnets, routers, ports, fips) = tokio::try_join!(
        list_networks(cfg),
        list_subnets(cfg),
        list_routers(cfg),
        list_ports(cfg, None),
        list_floating_ips(cfg),
    )?;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for net in &networks {
        nodes.push(TopologyNode {
            id: format!("net-{}", net.id),
            label: if net.name.is_empty() {
                net.id.clone()
            } else {
                net.name.clone()
            },
            kind: if net.external {
                "external-network".into()
            } else {
                "network".into()
            },
            status: Some(net.status.clone()),
            extra: None,
        });
    }

    for sub in &subnets {
        nodes.push(TopologyNode {
            id: format!("subnet-{}", sub.id),
            label: if sub.name.is_empty() {
                sub.cidr.clone()
            } else {
                format!("{} ({})", sub.name, sub.cidr)
            },
            kind: "subnet".into(),
            status: None,
            extra: sub.gateway_ip.clone(),
        });
        edges.push(TopologyEdge {
            from: format!("subnet-{}", sub.id),
            to: format!("net-{}", sub.network_id),
            label: Some("member".into()),
        });
    }

    for r in &routers {
        nodes.push(TopologyNode {
            id: format!("router-{}", r.id),
            label: if r.name.is_empty() {
                r.id.clone()
            } else {
                r.name.clone()
            },
            kind: "router".into(),
            status: Some(r.status.clone()),
            extra: if r.external_gateway {
                Some("external gateway".into())
            } else {
                None
            },
        });
    }

    for p in &ports {
        if p.device_id.as_deref().unwrap_or("").is_empty() && p.fixed_ips.is_empty() {
            continue;
        }
        let label = if p.name.is_empty() {
            p.id.chars().take(8).collect::<String>()
        } else {
            p.name.clone()
        };
        let device_kind = if p
            .device_id
            .as_ref()
            .map(|d| routers.iter().any(|r| r.id == *d))
            .unwrap_or(false)
        {
            "router-port"
        } else if p.device_id.is_some() {
            "device-port"
        } else {
            "port"
        };
        nodes.push(TopologyNode {
            id: format!("port-{}", p.id),
            label,
            kind: device_kind.into(),
            status: Some(p.status.clone()),
            extra: if p.fixed_ips.is_empty() {
                None
            } else {
                Some(p.fixed_ips.join(", "))
            },
        });
        edges.push(TopologyEdge {
            from: format!("port-{}", p.id),
            to: format!("net-{}", p.network_id),
            label: Some("attached".into()),
        });
        if let Some(ref dev) = p.device_id {
            if routers.iter().any(|r| r.id == *dev) {
                edges.push(TopologyEdge {
                    from: format!("router-{}", dev),
                    to: format!("port-{}", p.id),
                    label: Some("interface".into()),
                });
            }
        }
    }

    for fip in &fips {
        nodes.push(TopologyNode {
            id: format!("fip-{}", fip.id),
            label: fip.address.clone(),
            kind: "floating-ip".into(),
            status: Some(fip.status.clone()),
            extra: fip.fixed_address.clone(),
        });
        if let Some(ref net_id) = fip.network_id {
            edges.push(TopologyEdge {
                from: format!("fip-{}", fip.id),
                to: format!("net-{}", net_id),
                label: Some("pool".into()),
            });
        }
        if let Some(ref inst) = fip.instance_id {
            nodes.push(TopologyNode {
                id: format!("instance-{}", inst),
                label: inst.chars().take(8).collect(),
                kind: "instance".into(),
                status: None,
                extra: fip.fixed_address.clone(),
            });
            edges.push(TopologyEdge {
                from: format!("fip-{}", fip.id),
                to: format!("instance-{}", inst),
                label: Some("bound".into()),
            });
        }
    }

    Ok(NetworkTopologyGraph { nodes, edges })
}

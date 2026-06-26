// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Octavia load balancers (list, get, create, delete).

use osauth::services::{GenericService, VersionSelector};
use serde::{Deserialize, Serialize};

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_json_err, map_osauth_err};

const LOAD_BALANCER: GenericService = GenericService::new("load-balancer", VersionSelector::Any);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackLoadBalancer {
    pub id: String,
    pub name: String,
    pub provisioning_status: String,
    pub operating_status: String,
    pub vip_address: Option<String>,
    pub vip_subnet_id: Option<String>,
    pub description: Option<String>,
}

pub async fn probe_octavia_reachable(cfg: &OpenStackConfig) -> bool {
    let Ok(session) = connect_session(cfg).await else {
        return false;
    };
    session
        .get(LOAD_BALANCER, &["lbaas", "loadbalancers"])
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub async fn list_load_balancers(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackLoadBalancer>, LibvirtError> {
    if !probe_octavia_reachable(cfg).await {
        return Ok(Vec::new());
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        loadbalancers: Vec<LbJson>,
    }
    #[derive(Deserialize)]
    struct LbJson {
        id: String,
        name: String,
        provisioning_status: String,
        operating_status: String,
        #[serde(default)]
        vip_address: Option<String>,
        #[serde(default)]
        vip_subnet_id: Option<String>,
        #[serde(default)]
        description: Option<String>,
    }
    let resp = session
        .get(LOAD_BALANCER, &["lbaas", "loadbalancers"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .loadbalancers
        .into_iter()
        .map(|lb| OpenStackLoadBalancer {
            id: lb.id,
            name: lb.name,
            provisioning_status: lb.provisioning_status,
            operating_status: lb.operating_status,
            vip_address: lb.vip_address,
            vip_subnet_id: lb.vip_subnet_id,
            description: lb.description,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn get_load_balancer(
    cfg: &OpenStackConfig,
    id: &str,
) -> Result<OpenStackLoadBalancer, LibvirtError> {
    let lb_id = id.trim();
    if lb_id.is_empty() {
        return Err(LibvirtError::Invalid("load balancer id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        loadbalancer: LbJson,
    }
    #[derive(Deserialize)]
    struct LbJson {
        id: String,
        name: String,
        provisioning_status: String,
        operating_status: String,
        #[serde(default)]
        vip_address: Option<String>,
        #[serde(default)]
        vip_subnet_id: Option<String>,
        #[serde(default)]
        description: Option<String>,
    }
    let resp = session
        .get(LOAD_BALANCER, &["lbaas", "loadbalancers", lb_id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackLoadBalancer {
        id: body.loadbalancer.id,
        name: body.loadbalancer.name,
        provisioning_status: body.loadbalancer.provisioning_status,
        operating_status: body.loadbalancer.operating_status,
        vip_address: body.loadbalancer.vip_address,
        vip_subnet_id: body.loadbalancer.vip_subnet_id,
        description: body.loadbalancer.description,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLoadBalancerRequest {
    pub name: String,
    pub vip_subnet_id: String,
    #[serde(default)]
    pub description: Option<String>,
}

pub async fn create_load_balancer(
    cfg: &OpenStackConfig,
    req: &CreateLoadBalancerRequest,
) -> Result<OpenStackLoadBalancer, LibvirtError> {
    let name = req.name.trim();
    let subnet = req.vip_subnet_id.trim();
    if name.is_empty() || subnet.is_empty() {
        return Err(LibvirtError::Invalid(
            "name and vip_subnet_id are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let mut lb = serde_json::json!({
        "name": name,
        "vip_subnet_id": subnet,
    });
    if let Some(ref d) = req.description {
        let t = d.trim();
        if !t.is_empty() {
            lb["description"] = t.into();
        }
    }
    let resp = session
        .post(LOAD_BALANCER, &["lbaas", "loadbalancers"])
        .json(&serde_json::json!({ "loadbalancer": lb }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    #[derive(Deserialize)]
    struct Resp {
        loadbalancer: LbJson,
    }
    #[derive(Deserialize)]
    struct LbJson {
        id: String,
        name: String,
        provisioning_status: String,
        operating_status: String,
        #[serde(default)]
        vip_address: Option<String>,
        #[serde(default)]
        vip_subnet_id: Option<String>,
        #[serde(default)]
        description: Option<String>,
    }
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackLoadBalancer {
        id: body.loadbalancer.id,
        name: body.loadbalancer.name,
        provisioning_status: body.loadbalancer.provisioning_status,
        operating_status: body.loadbalancer.operating_status,
        vip_address: body.loadbalancer.vip_address,
        vip_subnet_id: body.loadbalancer.vip_subnet_id,
        description: body.loadbalancer.description,
    })
}

pub async fn delete_load_balancer(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    let lb_id = id.trim();
    if lb_id.is_empty() {
        return Err(LibvirtError::Invalid("load balancer id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(LOAD_BALANCER, &["lbaas", "loadbalancers", lb_id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

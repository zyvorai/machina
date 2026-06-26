// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Octavia listeners, pools, members, and health monitors.

use osauth::services::{GenericService, VersionSelector};
use serde::{Deserialize, Serialize};

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_json_err, map_osauth_err};

const LOAD_BALANCER: GenericService = GenericService::new("load-balancer", VersionSelector::Any);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackLbListener {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub protocol_port: u16,
    pub provisioning_status: String,
    pub operating_status: String,
    pub loadbalancer_id: Option<String>,
    pub default_pool_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackLbPool {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub lb_algorithm: String,
    pub provisioning_status: String,
    pub operating_status: String,
    pub loadbalancer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackLbMember {
    pub id: String,
    pub address: String,
    pub protocol_port: u16,
    pub subnet_id: Option<String>,
    pub provisioning_status: String,
    pub operating_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackLbHealthMonitor {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub delay: u32,
    pub timeout: u32,
    pub max_retries: u32,
    pub provisioning_status: String,
    pub operating_status: String,
    pub pool_id: Option<String>,
}

pub async fn list_lb_listeners(
    cfg: &OpenStackConfig,
    loadbalancer_id: &str,
) -> Result<Vec<OpenStackLbListener>, LibvirtError> {
    let lb_id = loadbalancer_id.trim();
    if lb_id.is_empty() {
        return Err(LibvirtError::Invalid("load balancer id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        listeners: Vec<ListenerJson>,
    }
    #[derive(Deserialize)]
    struct ListenerJson {
        id: String,
        name: String,
        protocol: String,
        protocol_port: u16,
        provisioning_status: String,
        operating_status: String,
        #[serde(default)]
        loadbalancer_id: Option<String>,
        #[serde(default)]
        default_pool_id: Option<String>,
    }
    let resp = session
        .get(LOAD_BALANCER, &["lbaas", "listeners"])
        .query(&[("loadbalancer_id", lb_id)])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .listeners
        .into_iter()
        .map(|l| OpenStackLbListener {
            id: l.id,
            name: l.name,
            protocol: l.protocol,
            protocol_port: l.protocol_port,
            provisioning_status: l.provisioning_status,
            operating_status: l.operating_status,
            loadbalancer_id: l.loadbalancer_id,
            default_pool_id: l.default_pool_id,
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLbListenerRequest {
    pub loadbalancer_id: String,
    pub name: String,
    pub protocol: String,
    pub protocol_port: u16,
}

pub async fn create_lb_listener(
    cfg: &OpenStackConfig,
    req: &CreateLbListenerRequest,
) -> Result<OpenStackLbListener, LibvirtError> {
    let lb_id = req.loadbalancer_id.trim();
    let name = req.name.trim();
    if lb_id.is_empty() || name.is_empty() {
        return Err(LibvirtError::Invalid(
            "loadbalancer_id and name are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let listener = serde_json::json!({
        "loadbalancer_id": lb_id,
        "name": name,
        "protocol": req.protocol.trim().to_uppercase(),
        "protocol_port": req.protocol_port,
    });
    let resp = session
        .post(LOAD_BALANCER, &["lbaas", "listeners"])
        .json(&serde_json::json!({ "listener": listener }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    parse_listener(resp.json().await.map_err(map_json_err)?)
}

pub async fn delete_lb_listener(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    let listener_id = id.trim();
    if listener_id.is_empty() {
        return Err(LibvirtError::Invalid("listener id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(LOAD_BALANCER, &["lbaas", "listeners", listener_id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn list_lb_pools(
    cfg: &OpenStackConfig,
    loadbalancer_id: &str,
) -> Result<Vec<OpenStackLbPool>, LibvirtError> {
    let lb_id = loadbalancer_id.trim();
    if lb_id.is_empty() {
        return Err(LibvirtError::Invalid("load balancer id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        pools: Vec<PoolJson>,
    }
    #[derive(Deserialize)]
    struct PoolJson {
        id: String,
        name: String,
        protocol: String,
        lb_algorithm: String,
        provisioning_status: String,
        operating_status: String,
        #[serde(default)]
        loadbalancer_id: Option<String>,
    }
    let resp = session
        .get(LOAD_BALANCER, &["lbaas", "pools"])
        .query(&[("loadbalancer_id", lb_id)])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .pools
        .into_iter()
        .map(|p| OpenStackLbPool {
            id: p.id,
            name: p.name,
            protocol: p.protocol,
            lb_algorithm: p.lb_algorithm,
            provisioning_status: p.provisioning_status,
            operating_status: p.operating_status,
            loadbalancer_id: p.loadbalancer_id,
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLbPoolRequest {
    pub name: String,
    pub protocol: String,
    pub lb_algorithm: String,
    pub listener_id: String,
}

pub async fn create_lb_pool(
    cfg: &OpenStackConfig,
    req: &CreateLbPoolRequest,
) -> Result<OpenStackLbPool, LibvirtError> {
    let name = req.name.trim();
    let listener_id = req.listener_id.trim();
    if name.is_empty() || listener_id.is_empty() {
        return Err(LibvirtError::Invalid(
            "name and listener_id are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let pool = serde_json::json!({
        "name": name,
        "protocol": req.protocol.trim().to_uppercase(),
        "lb_algorithm": req.lb_algorithm.trim().to_uppercase(),
        "listener_id": listener_id,
    });
    let resp = session
        .post(LOAD_BALANCER, &["lbaas", "pools"])
        .json(&serde_json::json!({ "pool": pool }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    parse_pool(resp.json().await.map_err(map_json_err)?)
}

pub async fn delete_lb_pool(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    let pool_id = id.trim();
    if pool_id.is_empty() {
        return Err(LibvirtError::Invalid("pool id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(LOAD_BALANCER, &["lbaas", "pools", pool_id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn list_lb_members(
    cfg: &OpenStackConfig,
    pool_id: &str,
) -> Result<Vec<OpenStackLbMember>, LibvirtError> {
    let pid = pool_id.trim();
    if pid.is_empty() {
        return Err(LibvirtError::Invalid("pool id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        members: Vec<MemberJson>,
    }
    #[derive(Deserialize)]
    struct MemberJson {
        id: String,
        address: String,
        protocol_port: u16,
        #[serde(default)]
        subnet_id: Option<String>,
        provisioning_status: String,
        operating_status: String,
    }
    let resp = session
        .get(LOAD_BALANCER, &["lbaas", "pools", pid, "members"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .members
        .into_iter()
        .map(|m| OpenStackLbMember {
            id: m.id,
            address: m.address,
            protocol_port: m.protocol_port,
            subnet_id: m.subnet_id,
            provisioning_status: m.provisioning_status,
            operating_status: m.operating_status,
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLbMemberRequest {
    pub address: String,
    pub protocol_port: u16,
    #[serde(default)]
    pub subnet_id: Option<String>,
}

pub async fn create_lb_member(
    cfg: &OpenStackConfig,
    pool_id: &str,
    req: &CreateLbMemberRequest,
) -> Result<OpenStackLbMember, LibvirtError> {
    let pid = pool_id.trim();
    let address = req.address.trim();
    if pid.is_empty() || address.is_empty() {
        return Err(LibvirtError::Invalid(
            "pool id and member address are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let mut member = serde_json::json!({
        "address": address,
        "protocol_port": req.protocol_port,
    });
    if let Some(ref sid) = req.subnet_id {
        let t = sid.trim();
        if !t.is_empty() {
            member["subnet_id"] = t.into();
        }
    }
    let resp = session
        .post(LOAD_BALANCER, &["lbaas", "pools", pid, "members"])
        .json(&serde_json::json!({ "member": member }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    parse_member(resp.json().await.map_err(map_json_err)?)
}

pub async fn delete_lb_member(
    cfg: &OpenStackConfig,
    pool_id: &str,
    member_id: &str,
) -> Result<(), LibvirtError> {
    let pid = pool_id.trim();
    let mid = member_id.trim();
    if pid.is_empty() || mid.is_empty() {
        return Err(LibvirtError::Invalid(
            "pool id and member id are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(LOAD_BALANCER, &["lbaas", "pools", pid, "members", mid])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn list_lb_health_monitors(
    cfg: &OpenStackConfig,
    pool_id: &str,
) -> Result<Vec<OpenStackLbHealthMonitor>, LibvirtError> {
    let pid = pool_id.trim();
    if pid.is_empty() {
        return Err(LibvirtError::Invalid("pool id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        healthmonitors: Vec<MonitorJson>,
    }
    #[derive(Deserialize)]
    struct MonitorJson {
        id: String,
        name: String,
        #[serde(rename = "type")]
        monitor_type: String,
        delay: u32,
        timeout: u32,
        max_retries: u32,
        provisioning_status: String,
        operating_status: String,
        #[serde(default)]
        pool_id: Option<String>,
    }
    let resp = session
        .get(LOAD_BALANCER, &["lbaas", "healthmonitors"])
        .query(&[("pool_id", pid)])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .healthmonitors
        .into_iter()
        .map(|m| OpenStackLbHealthMonitor {
            id: m.id,
            name: m.name,
            r#type: m.monitor_type,
            delay: m.delay,
            timeout: m.timeout,
            max_retries: m.max_retries,
            provisioning_status: m.provisioning_status,
            operating_status: m.operating_status,
            pool_id: m.pool_id,
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLbHealthMonitorRequest {
    pub pool_id: String,
    pub name: String,
    pub r#type: String,
    pub delay: u32,
    pub timeout: u32,
    pub max_retries: u32,
}

pub async fn create_lb_health_monitor(
    cfg: &OpenStackConfig,
    req: &CreateLbHealthMonitorRequest,
) -> Result<OpenStackLbHealthMonitor, LibvirtError> {
    let pool_id = req.pool_id.trim();
    let name = req.name.trim();
    if pool_id.is_empty() || name.is_empty() {
        return Err(LibvirtError::Invalid(
            "pool_id and name are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let monitor = serde_json::json!({
        "pool_id": pool_id,
        "name": name,
        "type": req.r#type.trim().to_uppercase(),
        "delay": req.delay,
        "timeout": req.timeout,
        "max_retries": req.max_retries,
    });
    let resp = session
        .post(LOAD_BALANCER, &["lbaas", "healthmonitors"])
        .json(&serde_json::json!({ "healthmonitor": monitor }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    parse_monitor(resp.json().await.map_err(map_json_err)?)
}

pub async fn delete_lb_health_monitor(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    let monitor_id = id.trim();
    if monitor_id.is_empty() {
        return Err(LibvirtError::Invalid(
            "health monitor id is required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(LOAD_BALANCER, &["lbaas", "healthmonitors", monitor_id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

fn parse_listener(v: serde_json::Value) -> Result<OpenStackLbListener, LibvirtError> {
    let l = v.get("listener").unwrap_or(&v);
    Ok(OpenStackLbListener {
        id: l
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        name: l
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        protocol: l
            .get("protocol")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        protocol_port: l.get("protocol_port").and_then(|x| x.as_u64()).unwrap_or(0) as u16,
        provisioning_status: l
            .get("provisioning_status")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        operating_status: l
            .get("operating_status")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        loadbalancer_id: l
            .get("loadbalancer_id")
            .and_then(|x| x.as_str())
            .map(String::from),
        default_pool_id: l
            .get("default_pool_id")
            .and_then(|x| x.as_str())
            .map(String::from),
    })
}

fn parse_pool(v: serde_json::Value) -> Result<OpenStackLbPool, LibvirtError> {
    let p = v.get("pool").unwrap_or(&v);
    Ok(OpenStackLbPool {
        id: p
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        name: p
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        protocol: p
            .get("protocol")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        lb_algorithm: p
            .get("lb_algorithm")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        provisioning_status: p
            .get("provisioning_status")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        operating_status: p
            .get("operating_status")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        loadbalancer_id: p
            .get("loadbalancer_id")
            .and_then(|x| x.as_str())
            .map(String::from),
    })
}

fn parse_member(v: serde_json::Value) -> Result<OpenStackLbMember, LibvirtError> {
    let m = v.get("member").unwrap_or(&v);
    Ok(OpenStackLbMember {
        id: m
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        address: m
            .get("address")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        protocol_port: m.get("protocol_port").and_then(|x| x.as_u64()).unwrap_or(0) as u16,
        subnet_id: m
            .get("subnet_id")
            .and_then(|x| x.as_str())
            .map(String::from),
        provisioning_status: m
            .get("provisioning_status")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        operating_status: m
            .get("operating_status")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

fn parse_monitor(v: serde_json::Value) -> Result<OpenStackLbHealthMonitor, LibvirtError> {
    let m = v.get("healthmonitor").unwrap_or(&v);
    Ok(OpenStackLbHealthMonitor {
        id: m
            .get("id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        name: m
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        r#type: m
            .get("type")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        delay: m.get("delay").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
        timeout: m.get("timeout").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
        max_retries: m.get("max_retries").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
        provisioning_status: m
            .get("provisioning_status")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        operating_status: m
            .get("operating_status")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        pool_id: m.get("pool_id").and_then(|x| x.as_str()).map(String::from),
    })
}

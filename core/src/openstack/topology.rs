// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Neutron subnets, routers, ports (read); network/subnet create for lab clouds.

use osauth::services::NETWORK;
use serde::{Deserialize, Serialize};

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_json_err, map_osauth_err};

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackSubnet {
    pub id: String,
    pub name: String,
    pub network_id: String,
    pub cidr: String,
    pub ip_version: u8,
    pub gateway_ip: Option<String>,
    #[serde(default = "default_true")]
    pub enable_dhcp: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackRouter {
    pub id: String,
    pub name: String,
    pub status: String,
    pub external_gateway: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackPort {
    pub id: String,
    pub name: String,
    pub network_id: String,
    pub status: String,
    pub device_id: Option<String>,
    pub fixed_ips: Vec<String>,
    #[serde(default = "default_true")]
    pub admin_state_up: bool,
}

pub async fn list_subnets(cfg: &OpenStackConfig) -> Result<Vec<OpenStackSubnet>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        subnets: Vec<SubnetJson>,
    }
    #[derive(Deserialize)]
    struct SubnetJson {
        id: String,
        name: String,
        network_id: String,
        cidr: String,
        ip_version: u8,
        gateway_ip: Option<String>,
        #[serde(default = "default_true")]
        enable_dhcp: bool,
    }
    let resp = session
        .get(NETWORK, &["subnets"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .subnets
        .into_iter()
        .map(|s| OpenStackSubnet {
            id: s.id,
            name: s.name,
            network_id: s.network_id,
            cidr: s.cidr,
            ip_version: s.ip_version,
            gateway_ip: s.gateway_ip,
            enable_dhcp: s.enable_dhcp,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn get_subnet(
    cfg: &OpenStackConfig,
    subnet_id: &str,
) -> Result<OpenStackSubnet, LibvirtError> {
    let id = subnet_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("subnet id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        subnet: SubnetJson,
    }
    #[derive(Deserialize)]
    struct SubnetJson {
        id: String,
        name: String,
        network_id: String,
        cidr: String,
        ip_version: u8,
        gateway_ip: Option<String>,
        #[serde(default = "default_true")]
        enable_dhcp: bool,
    }
    let resp = session
        .get(NETWORK, &["subnets", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackSubnet {
        id: body.subnet.id,
        name: body.subnet.name,
        network_id: body.subnet.network_id,
        cidr: body.subnet.cidr,
        ip_version: body.subnet.ip_version,
        gateway_ip: body.subnet.gateway_ip,
        enable_dhcp: body.subnet.enable_dhcp,
    })
}

pub async fn list_routers(cfg: &OpenStackConfig) -> Result<Vec<OpenStackRouter>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        routers: Vec<RouterJson>,
    }
    #[derive(Deserialize)]
    struct RouterJson {
        id: String,
        name: String,
        status: String,
        #[serde(default)]
        external_gateway_info: Option<serde_json::Value>,
    }
    let resp = session
        .get(NETWORK, &["routers"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .routers
        .into_iter()
        .map(|r| OpenStackRouter {
            id: r.id,
            name: r.name,
            status: r.status,
            external_gateway: r.external_gateway_info.is_some(),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn get_router(
    cfg: &OpenStackConfig,
    router_id: &str,
) -> Result<OpenStackRouter, LibvirtError> {
    let id = router_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("router id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        router: RouterJson,
    }
    #[derive(Deserialize)]
    struct RouterJson {
        id: String,
        name: String,
        status: String,
        external_gateway_info: Option<serde_json::Value>,
    }
    let resp = session
        .get(NETWORK, &["routers", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackRouter {
        id: body.router.id,
        name: body.router.name,
        status: body.router.status,
        external_gateway: body.router.external_gateway_info.is_some(),
    })
}

pub async fn list_ports(
    cfg: &OpenStackConfig,
    device_id: Option<&str>,
) -> Result<Vec<OpenStackPort>, LibvirtError> {
    let session = connect_session(cfg).await?;
    let mut req = session.get(NETWORK, &["ports"]);
    if let Some(dev) = device_id {
        let d = dev.trim();
        if !d.is_empty() {
            req = req.query(&[("device_id", d)]);
        }
    }
    #[derive(Deserialize)]
    struct Resp {
        ports: Vec<PortJson>,
    }
    #[derive(Deserialize)]
    struct PortJson {
        id: String,
        name: String,
        network_id: String,
        status: String,
        device_id: Option<String>,
        #[serde(default)]
        fixed_ips: Vec<FixedIp>,
        #[serde(default = "default_true")]
        admin_state_up: bool,
    }
    #[derive(Deserialize)]
    struct FixedIp {
        ip_address: String,
    }
    let resp = req.send().await.map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .ports
        .into_iter()
        .map(|p| OpenStackPort {
            id: p.id,
            name: p.name,
            network_id: p.network_id,
            status: p.status,
            device_id: p.device_id,
            fixed_ips: p.fixed_ips.into_iter().map(|f| f.ip_address).collect(),
            admin_state_up: p.admin_state_up,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn get_port(cfg: &OpenStackConfig, port_id: &str) -> Result<OpenStackPort, LibvirtError> {
    let id = port_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("port id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        port: PortJson,
    }
    #[derive(Deserialize)]
    struct PortJson {
        id: String,
        name: String,
        network_id: String,
        status: String,
        device_id: Option<String>,
        #[serde(default)]
        fixed_ips: Vec<FixedIp>,
        #[serde(default = "default_true")]
        admin_state_up: bool,
    }
    #[derive(Deserialize)]
    struct FixedIp {
        ip_address: String,
    }
    let resp = session
        .get(NETWORK, &["ports", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackPort {
        id: body.port.id,
        name: body.port.name,
        network_id: body.port.network_id,
        status: body.port.status,
        device_id: body.port.device_id,
        fixed_ips: body
            .port
            .fixed_ips
            .into_iter()
            .map(|f| f.ip_address)
            .collect(),
        admin_state_up: body.port.admin_state_up,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNetworkRequest {
    pub name: String,
    /// When true, marks the network as external (provider network). Default false.
    #[serde(default)]
    pub external: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSubnetRequest {
    pub network_id: String,
    pub cidr: String,
    pub name: Option<String>,
    pub gateway_ip: Option<String>,
    #[serde(default = "default_ip_version")]
    pub ip_version: u8,
}

fn default_ip_version() -> u8 {
    4
}

pub async fn create_network(
    cfg: &OpenStackConfig,
    req: &CreateNetworkRequest,
) -> Result<super::resources::OpenStackNetwork, LibvirtError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(LibvirtError::Invalid("network name is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut body = serde_json::json!({ "network": { "name": name } });
    if req.external {
        body["network"]["router:external"] = serde_json::json!(true);
    }
    #[derive(Deserialize)]
    struct Resp {
        network: NetJson,
    }
    #[derive(Deserialize)]
    struct NetJson {
        id: String,
        name: String,
        status: String,
        #[serde(default)]
        shared: bool,
        #[serde(default)]
        router_external: Option<bool>,
    }
    let resp = session
        .post(NETWORK, &["networks"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(super::resources::OpenStackNetwork {
        id: parsed.network.id,
        name: parsed.network.name,
        status: parsed.network.status,
        shared: parsed.network.shared,
        external: parsed.network.router_external.unwrap_or(req.external),
    })
}

pub async fn create_subnet(
    cfg: &OpenStackConfig,
    req: &CreateSubnetRequest,
) -> Result<OpenStackSubnet, LibvirtError> {
    let network_id = req.network_id.trim();
    let cidr = req.cidr.trim();
    if network_id.is_empty() || cidr.is_empty() {
        return Err(LibvirtError::Invalid(
            "network_id and cidr are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let mut subnet = serde_json::json!({
        "network_id": network_id,
        "cidr": cidr,
        "ip_version": req.ip_version,
    });
    if let Some(ref n) = req.name {
        let t = n.trim();
        if !t.is_empty() {
            subnet["name"] = serde_json::json!(t);
        }
    }
    if let Some(ref g) = req.gateway_ip {
        let t = g.trim();
        if !t.is_empty() {
            subnet["gateway_ip"] = serde_json::json!(t);
        }
    }
    let body = serde_json::json!({ "subnet": subnet });
    #[derive(Deserialize)]
    struct Resp {
        subnet: SubnetOut,
    }
    #[derive(Deserialize)]
    struct SubnetOut {
        id: String,
        name: String,
        network_id: String,
        cidr: String,
        ip_version: u8,
        gateway_ip: Option<String>,
        #[serde(default = "default_true")]
        enable_dhcp: bool,
    }
    let resp = session
        .post(NETWORK, &["subnets"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    let s = parsed.subnet;
    Ok(OpenStackSubnet {
        id: s.id,
        name: s.name,
        network_id: s.network_id,
        cidr: s.cidr,
        ip_version: s.ip_version,
        gateway_ip: s.gateway_ip,
        enable_dhcp: s.enable_dhcp,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRouterRequest {
    pub name: String,
    /// External/provider network for default gateway (optional).
    pub external_network_id: Option<String>,
}

pub async fn create_router(
    cfg: &OpenStackConfig,
    req: &CreateRouterRequest,
) -> Result<OpenStackRouter, LibvirtError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(LibvirtError::Invalid("router name is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut router = serde_json::json!({ "name": name });
    if let Some(ref net) = req.external_network_id {
        let n = net.trim();
        if !n.is_empty() {
            router["external_gateway_info"] = serde_json::json!({ "network_id": n });
        }
    }
    let body = serde_json::json!({ "router": router });
    #[derive(Deserialize)]
    struct Resp {
        router: RouterOut,
    }
    #[derive(Deserialize)]
    struct RouterOut {
        id: String,
        name: String,
        status: String,
        #[serde(default)]
        external_gateway_info: Option<serde_json::Value>,
    }
    let resp = session
        .post(NETWORK, &["routers"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    let r = parsed.router;
    Ok(OpenStackRouter {
        id: r.id,
        name: r.name,
        status: r.status,
        external_gateway: r.external_gateway_info.is_some(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddRouterInterfaceRequest {
    pub router_id: String,
    pub subnet_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePortRequest {
    pub network_id: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackPortCreated {
    pub id: String,
    pub name: String,
    pub network_id: String,
    pub status: String,
}

pub async fn create_port(
    cfg: &OpenStackConfig,
    req: &CreatePortRequest,
) -> Result<OpenStackPortCreated, LibvirtError> {
    let network_id = req.network_id.trim();
    if network_id.is_empty() {
        return Err(LibvirtError::Invalid("network_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut port = serde_json::json!({ "network_id": network_id });
    if let Some(ref n) = req.name {
        let t = n.trim();
        if !t.is_empty() {
            port["name"] = serde_json::json!(t);
        }
    }
    let body = serde_json::json!({ "port": port });
    #[derive(Deserialize)]
    struct Resp {
        port: PortOut,
    }
    #[derive(Deserialize)]
    struct PortOut {
        id: String,
        name: String,
        network_id: String,
        status: String,
    }
    let resp = session
        .post(NETWORK, &["ports"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackPortCreated {
        id: parsed.port.id,
        name: parsed.port.name,
        network_id: parsed.port.network_id,
        status: parsed.port.status,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveRouterInterfaceRequest {
    pub router_id: String,
    pub subnet_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNetworkRequest {
    pub name: Option<String>,
}

pub async fn update_network(
    cfg: &OpenStackConfig,
    network_id: &str,
    req: &UpdateNetworkRequest,
) -> Result<super::resources::OpenStackNetwork, LibvirtError> {
    let id = network_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("network_id is required".into()));
    }
    let name = req
        .name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    if name.is_none() {
        return Err(LibvirtError::Invalid("name is required".into()));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({ "network": { "name": name } });
    #[derive(Deserialize)]
    struct Resp {
        network: NetJson,
    }
    #[derive(Deserialize)]
    struct NetJson {
        id: String,
        name: String,
        status: String,
        #[serde(default)]
        shared: bool,
        #[serde(default)]
        router_external: Option<bool>,
    }
    let resp = session
        .put(NETWORK, &["networks", id])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(super::resources::OpenStackNetwork {
        id: parsed.network.id,
        name: parsed.network.name,
        status: parsed.network.status,
        shared: parsed.network.shared,
        external: parsed.network.router_external.unwrap_or(false),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSubnetRequest {
    pub name: Option<String>,
    pub gateway_ip: Option<String>,
    pub enable_dhcp: Option<bool>,
}

pub async fn update_subnet(
    cfg: &OpenStackConfig,
    subnet_id: &str,
    req: &UpdateSubnetRequest,
) -> Result<OpenStackSubnet, LibvirtError> {
    let id = subnet_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("subnet_id is required".into()));
    }
    let mut subnet = serde_json::Map::new();
    if let Some(ref n) = req.name {
        let t = n.trim();
        if !t.is_empty() {
            subnet.insert("name".into(), serde_json::json!(t));
        }
    }
    if let Some(ref g) = req.gateway_ip {
        let t = g.trim();
        if !t.is_empty() {
            subnet.insert("gateway_ip".into(), serde_json::json!(t));
        }
    }
    if let Some(dhcp) = req.enable_dhcp {
        subnet.insert("enable_dhcp".into(), serde_json::json!(dhcp));
    }
    if subnet.is_empty() {
        return Err(LibvirtError::Invalid(
            "at least one of name, gateway_ip, or enable_dhcp is required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({ "subnet": subnet });
    #[derive(Deserialize)]
    struct Resp {
        subnet: SubnetOut,
    }
    #[derive(Deserialize)]
    struct SubnetOut {
        id: String,
        name: String,
        network_id: String,
        cidr: String,
        ip_version: u8,
        gateway_ip: Option<String>,
        #[serde(default = "default_true")]
        enable_dhcp: bool,
    }
    let resp = session
        .put(NETWORK, &["subnets", id])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    let s = parsed.subnet;
    Ok(OpenStackSubnet {
        id: s.id,
        name: s.name,
        network_id: s.network_id,
        cidr: s.cidr,
        ip_version: s.ip_version,
        gateway_ip: s.gateway_ip,
        enable_dhcp: s.enable_dhcp,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRouterRequest {
    pub name: Option<String>,
    pub external_network_id: Option<String>,
    #[serde(default)]
    pub clear_external_gateway: bool,
}

pub async fn update_router(
    cfg: &OpenStackConfig,
    router_id: &str,
    req: &UpdateRouterRequest,
) -> Result<OpenStackRouter, LibvirtError> {
    let id = router_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("router_id is required".into()));
    }
    let name = req
        .name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let ext_net = req
        .external_network_id
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    if name.is_none() && ext_net.is_none() && !req.clear_external_gateway {
        return Err(LibvirtError::Invalid(
            "name, external_network_id, or clear_external_gateway is required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let mut router = serde_json::Map::new();
    if let Some(n) = name {
        router.insert("name".into(), serde_json::json!(n));
    }
    if req.clear_external_gateway {
        router.insert("external_gateway_info".into(), serde_json::Value::Null);
    } else if let Some(net) = ext_net {
        router.insert(
            "external_gateway_info".into(),
            serde_json::json!({ "network_id": net }),
        );
    }
    let body = serde_json::json!({ "router": router });
    #[derive(Deserialize)]
    struct Resp {
        router: RouterJson,
    }
    #[derive(Deserialize)]
    struct RouterJson {
        id: String,
        name: String,
        status: String,
        external_gateway_info: Option<serde_json::Value>,
    }
    let resp = session
        .put(NETWORK, &["routers", id])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackRouter {
        id: parsed.router.id,
        name: parsed.router.name,
        status: parsed.router.status,
        external_gateway: parsed.router.external_gateway_info.is_some(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePortRequest {
    pub name: Option<String>,
    pub admin_state_up: Option<bool>,
}

pub async fn update_port(
    cfg: &OpenStackConfig,
    port_id: &str,
    req: &UpdatePortRequest,
) -> Result<OpenStackPortCreated, LibvirtError> {
    let id = port_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("port_id is required".into()));
    }
    let mut port = serde_json::Map::new();
    if let Some(ref n) = req.name {
        let t = n.trim();
        if !t.is_empty() {
            port.insert("name".into(), serde_json::json!(t));
        }
    }
    if let Some(up) = req.admin_state_up {
        port.insert("admin_state_up".into(), serde_json::json!(up));
    }
    if port.is_empty() {
        return Err(LibvirtError::Invalid(
            "name or admin_state_up required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let resp = session
        .put(NETWORK, &["ports", id])
        .json(&serde_json::json!({ "port": port }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    #[derive(Deserialize)]
    struct Resp {
        port: PortOut,
    }
    #[derive(Deserialize)]
    struct PortOut {
        id: String,
        name: String,
        network_id: String,
        status: String,
    }
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackPortCreated {
        id: parsed.port.id,
        name: parsed.port.name,
        network_id: parsed.port.network_id,
        status: parsed.port.status,
    })
}

pub async fn delete_network(cfg: &OpenStackConfig, network_id: &str) -> Result<(), LibvirtError> {
    let id = network_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("network_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(NETWORK, &["networks", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn delete_subnet(cfg: &OpenStackConfig, subnet_id: &str) -> Result<(), LibvirtError> {
    let id = subnet_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("subnet_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(NETWORK, &["subnets", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn delete_router(cfg: &OpenStackConfig, router_id: &str) -> Result<(), LibvirtError> {
    let id = router_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("router_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(NETWORK, &["routers", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn delete_port(cfg: &OpenStackConfig, port_id: &str) -> Result<(), LibvirtError> {
    let id = port_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("port_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(NETWORK, &["ports", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn remove_router_interface(
    cfg: &OpenStackConfig,
    req: &RemoveRouterInterfaceRequest,
) -> Result<(), LibvirtError> {
    let router_id = req.router_id.trim();
    let subnet_id = req.subnet_id.trim();
    if router_id.is_empty() || subnet_id.is_empty() {
        return Err(LibvirtError::Invalid(
            "router_id and subnet_id are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({ "subnet_id": subnet_id });
    session
        .put(NETWORK, &["routers", router_id, "remove_router_interface"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn add_router_interface(
    cfg: &OpenStackConfig,
    req: &AddRouterInterfaceRequest,
) -> Result<serde_json::Value, LibvirtError> {
    let router_id = req.router_id.trim();
    let subnet_id = req.subnet_id.trim();
    if router_id.is_empty() || subnet_id.is_empty() {
        return Err(LibvirtError::Invalid(
            "router_id and subnet_id are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({ "subnet_id": subnet_id });
    let resp = session
        .put(NETWORK, &["routers", router_id, "add_router_interface"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    resp.json().await.map_err(map_json_err)
}

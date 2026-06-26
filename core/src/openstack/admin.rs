// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Read-only Nova/Neutron admin catalog (hypervisors, AZs, agents).

use osauth::services::{COMPUTE, NETWORK};
use serde::Deserialize;

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_json_err, map_osauth_err};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackAvailabilityZone {
    pub name: String,
    pub state: String,
    pub hosts: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackHypervisor {
    pub id: String,
    pub hostname: String,
    pub state: String,
    pub status: String,
    pub vcpus: u32,
    pub vcpus_used: u32,
    pub memory_mb: u64,
    pub memory_mb_used: u64,
    pub running_vms: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackComputeService {
    pub id: String,
    pub binary: String,
    pub host: String,
    pub zone: String,
    pub state: String,
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackNeutronAgent {
    pub id: String,
    pub agent_type: String,
    pub host: String,
    pub alive: bool,
    pub admin_state_up: bool,
}

pub async fn list_availability_zones(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackAvailabilityZone>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        availabilityZoneInfo: Vec<AzJson>,
    }
    #[derive(Deserialize)]
    struct AzJson {
        zoneName: String,
        zoneState: ZoneState,
        #[serde(default)]
        hosts: serde_json::Value,
    }
    #[derive(Deserialize)]
    struct ZoneState {
        available: bool,
    }
    let resp = session
        .get(COMPUTE, &["os-availability-zone"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out = Vec::new();
    for az in body.availabilityZoneInfo {
        let hosts = match az.hosts {
            serde_json::Value::Object(map) => map.keys().cloned().collect(),
            _ => Vec::new(),
        };
        out.push(OpenStackAvailabilityZone {
            name: az.zoneName,
            state: if az.zoneState.available {
                "available".into()
            } else {
                "unavailable".into()
            },
            hosts,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn list_hypervisors(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackHypervisor>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        hypervisors: Vec<HvJson>,
    }
    #[derive(Deserialize)]
    struct HvJson {
        id: u64,
        hypervisor_hostname: String,
        state: String,
        status: String,
        vcpus: u32,
        vcpus_used: u32,
        memory_mb: u64,
        memory_mb_used: u64,
        running_vms: u32,
    }
    let resp = session
        .get(COMPUTE, &["os-hypervisors", "detail"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .hypervisors
        .into_iter()
        .map(|h| OpenStackHypervisor {
            id: h.id.to_string(),
            hostname: h.hypervisor_hostname,
            state: h.state,
            status: h.status,
            vcpus: h.vcpus,
            vcpus_used: h.vcpus_used,
            memory_mb: h.memory_mb,
            memory_mb_used: h.memory_mb_used,
            running_vms: h.running_vms,
        })
        .collect();
    out.sort_by(|a, b| a.hostname.cmp(&b.hostname));
    Ok(out)
}

pub async fn get_hypervisor(
    cfg: &OpenStackConfig,
    hypervisor_id: &str,
) -> Result<OpenStackHypervisor, LibvirtError> {
    let id = hypervisor_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("hypervisor id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        hypervisor: HvJson,
    }
    #[derive(Deserialize)]
    struct HvJson {
        id: u64,
        hypervisor_hostname: String,
        state: String,
        status: String,
        vcpus: u32,
        vcpus_used: u32,
        memory_mb: u64,
        memory_mb_used: u64,
        running_vms: u32,
    }
    let resp = session
        .get(COMPUTE, &["os-hypervisors", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackHypervisor {
        id: body.hypervisor.id.to_string(),
        hostname: body.hypervisor.hypervisor_hostname,
        state: body.hypervisor.state,
        status: body.hypervisor.status,
        vcpus: body.hypervisor.vcpus,
        vcpus_used: body.hypervisor.vcpus_used,
        memory_mb: body.hypervisor.memory_mb,
        memory_mb_used: body.hypervisor.memory_mb_used,
        running_vms: body.hypervisor.running_vms,
    })
}

pub async fn list_compute_services(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackComputeService>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        services: Vec<SvcJson>,
    }
    #[derive(Deserialize)]
    struct SvcJson {
        id: u64,
        binary: String,
        host: String,
        zone: String,
        state: String,
        status: String,
    }
    let resp = session
        .get(COMPUTE, &["os-services"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .services
        .into_iter()
        .map(|s| OpenStackComputeService {
            id: s.id.to_string(),
            binary: s.binary,
            host: s.host,
            zone: s.zone,
            state: s.state,
            status: s.status,
        })
        .collect();
    out.sort_by(|a, b| a.binary.cmp(&b.binary).then(a.host.cmp(&b.host)));
    Ok(out)
}

pub async fn list_neutron_agents(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackNeutronAgent>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        agents: Vec<AgentJson>,
    }
    #[derive(Deserialize)]
    struct AgentJson {
        id: String,
        agent_type: String,
        host: String,
        alive: bool,
        admin_state_up: bool,
    }
    let resp = session
        .get(NETWORK, &["agents"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .agents
        .into_iter()
        .map(|a| OpenStackNeutronAgent {
            id: a.id,
            agent_type: a.agent_type,
            host: a.host,
            alive: a.alive,
            admin_state_up: a.admin_state_up,
        })
        .collect();
    out.sort_by(|a, b| a.agent_type.cmp(&b.agent_type).then(a.host.cmp(&b.host)));
    Ok(out)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackHostAggregate {
    pub id: String,
    pub name: String,
    pub availability_zone: Option<String>,
    pub hosts: Vec<String>,
}

pub async fn list_host_aggregates(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackHostAggregate>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        aggregates: Vec<AggJson>,
    }
    #[derive(Deserialize)]
    struct AggJson {
        id: u64,
        name: String,
        #[serde(default)]
        availability_zone: Option<String>,
        #[serde(default)]
        hosts: Vec<String>,
    }
    let resp = session
        .get(COMPUTE, &["os-aggregates"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .aggregates
        .into_iter()
        .map(|a| OpenStackHostAggregate {
            id: a.id.to_string(),
            name: a.name,
            availability_zone: a.availability_zone,
            hosts: a.hosts,
        })
        .collect())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SetComputeServiceRequest {
    pub binary: String,
    pub host: String,
    #[serde(default)]
    pub disabled: bool,
}

pub async fn set_compute_service_state(
    cfg: &OpenStackConfig,
    req: &SetComputeServiceRequest,
) -> Result<(), LibvirtError> {
    let binary = req.binary.trim();
    let host = req.host.trim();
    if binary.is_empty() || host.is_empty() {
        return Err(LibvirtError::Invalid("binary and host are required".into()));
    }
    let session = connect_session(cfg).await?;
    let action = if req.disabled { "disable" } else { "enable" };
    session
        .post(COMPUTE, &["os-services", action])
        .json(&serde_json::json!({ "binary": binary, "host": host }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn set_neutron_agent_admin(
    cfg: &OpenStackConfig,
    agent_id: &str,
    admin_state_up: bool,
) -> Result<(), LibvirtError> {
    let id = agent_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("agent id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .put(NETWORK, &["agents", id])
        .json(&serde_json::json!({ "agent": { "admin_state_up": admin_state_up } }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn set_hypervisor_maintenance(
    cfg: &OpenStackConfig,
    hypervisor_id: &str,
    maintenance: bool,
) -> Result<(), LibvirtError> {
    let id = hypervisor_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("hypervisor id is required".into()));
    }
    let session = connect_session(cfg).await?;
    let target = if id.chars().all(|c| c.is_ascii_digit()) {
        get_hypervisor(cfg, id)
            .await
            .map(|h| h.hostname)
            .unwrap_or_else(|_| id.to_string())
    } else {
        id.to_string()
    };
    let status = if maintenance { "disabled" } else { "enabled" };
    session
        .put(COMPUTE, &["os-hypervisors", &target])
        .json(&serde_json::json!({ "status": status }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CreateAggregateRequest {
    pub name: String,
    pub availability_zone: Option<String>,
}

pub async fn create_host_aggregate(
    cfg: &OpenStackConfig,
    req: &CreateAggregateRequest,
) -> Result<OpenStackHostAggregate, LibvirtError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(LibvirtError::Invalid("aggregate name is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut aggregate = serde_json::json!({ "name": name });
    if let Some(ref az) = req.availability_zone {
        let t = az.trim();
        if !t.is_empty() {
            aggregate["availability_zone"] = serde_json::json!(t);
        }
    }
    #[derive(Deserialize)]
    struct Resp {
        aggregate: AggOut,
    }
    #[derive(Deserialize)]
    struct AggOut {
        id: u64,
        name: String,
        #[serde(default)]
        availability_zone: Option<String>,
        #[serde(default)]
        hosts: Vec<String>,
    }
    let resp = session
        .post(COMPUTE, &["os-aggregates"])
        .json(&serde_json::json!({ "aggregate": aggregate }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackHostAggregate {
        id: body.aggregate.id.to_string(),
        name: body.aggregate.name,
        availability_zone: body.aggregate.availability_zone,
        hosts: body.aggregate.hosts,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpdateAggregateRequest {
    pub name: Option<String>,
    pub availability_zone: Option<String>,
}

pub async fn update_host_aggregate(
    cfg: &OpenStackConfig,
    aggregate_id: &str,
    req: &UpdateAggregateRequest,
) -> Result<OpenStackHostAggregate, LibvirtError> {
    let id = aggregate_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("aggregate id is required".into()));
    }
    let mut aggregate = serde_json::Map::new();
    if let Some(ref n) = req.name {
        let t = n.trim();
        if !t.is_empty() {
            aggregate.insert("name".into(), serde_json::json!(t));
        }
    }
    if let Some(ref az) = req.availability_zone {
        let t = az.trim();
        aggregate.insert("availability_zone".into(), serde_json::json!(t));
    }
    if aggregate.is_empty() {
        return Err(LibvirtError::Invalid(
            "name or availability_zone required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        aggregate: AggOut,
    }
    #[derive(Deserialize)]
    struct AggOut {
        id: u64,
        name: String,
        #[serde(default)]
        availability_zone: Option<String>,
        #[serde(default)]
        hosts: Vec<String>,
    }
    let resp = session
        .put(COMPUTE, &["os-aggregates", id])
        .json(&serde_json::json!({ "aggregate": aggregate }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackHostAggregate {
        id: body.aggregate.id.to_string(),
        name: body.aggregate.name,
        availability_zone: body.aggregate.availability_zone,
        hosts: body.aggregate.hosts,
    })
}

async fn aggregate_action(
    session: &osauth::Session,
    aggregate_id: &str,
    action: &str,
    host: &str,
) -> Result<OpenStackHostAggregate, LibvirtError> {
    #[derive(Deserialize)]
    struct Resp {
        aggregate: AggOut,
    }
    #[derive(Deserialize)]
    struct AggOut {
        id: u64,
        name: String,
        #[serde(default)]
        availability_zone: Option<String>,
        #[serde(default)]
        hosts: Vec<String>,
    }
    let body = serde_json::json!({ action: { "host": host } });
    let resp = session
        .post(COMPUTE, &["os-aggregates", aggregate_id, "action"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackHostAggregate {
        id: parsed.aggregate.id.to_string(),
        name: parsed.aggregate.name,
        availability_zone: parsed.aggregate.availability_zone,
        hosts: parsed.aggregate.hosts,
    })
}

pub async fn add_aggregate_host(
    cfg: &OpenStackConfig,
    aggregate_id: &str,
    host: &str,
) -> Result<OpenStackHostAggregate, LibvirtError> {
    let id = aggregate_id.trim();
    let h = host.trim();
    if id.is_empty() || h.is_empty() {
        return Err(LibvirtError::Invalid(
            "aggregate id and host are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    aggregate_action(&session, id, "add_host", h).await
}

pub async fn remove_aggregate_host(
    cfg: &OpenStackConfig,
    aggregate_id: &str,
    host: &str,
) -> Result<OpenStackHostAggregate, LibvirtError> {
    let id = aggregate_id.trim();
    let h = host.trim();
    if id.is_empty() || h.is_empty() {
        return Err(LibvirtError::Invalid(
            "aggregate id and host are required".into(),
        ));
    }
    let session = connect_session(cfg).await?;
    aggregate_action(&session, id, "remove_host", h).await
}

// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Cinder volume types and Nova server groups.

use osauth::services::{BLOCK_STORAGE, COMPUTE};
use serde::Deserialize;

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_json_err, map_osauth_err};
use super::quotas::probe_cinder_reachable;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackVolumeType {
    pub id: String,
    pub name: String,
    pub is_public: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackServerGroup {
    pub id: String,
    pub name: String,
    pub policy: String,
    pub members: Vec<String>,
}

pub async fn list_volume_types(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackVolumeType>, LibvirtError> {
    if !probe_cinder_reachable(cfg).await {
        return Ok(Vec::new());
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        volume_types: Vec<VtJson>,
    }
    #[derive(Deserialize)]
    struct VtJson {
        id: String,
        name: String,
        #[serde(default)]
        is_public: bool,
    }
    let resp = session
        .get(BLOCK_STORAGE, &["types"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .volume_types
        .into_iter()
        .map(|v| OpenStackVolumeType {
            id: v.id,
            name: v.name,
            is_public: v.is_public,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn list_server_groups(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackServerGroup>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        server_groups: Vec<SgJson>,
    }
    #[derive(Deserialize)]
    struct SgJson {
        id: String,
        name: String,
        #[serde(default)]
        policy: Option<String>,
        #[serde(default)]
        policies: Vec<String>,
        #[serde(default)]
        members: Vec<String>,
    }
    let resp = session
        .get(COMPUTE, &["os-server-groups"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .server_groups
        .into_iter()
        .map(|g| {
            let policy = g
                .policy
                .or_else(|| g.policies.into_iter().next())
                .unwrap_or_default();
            OpenStackServerGroup {
                id: g.id,
                name: g.name,
                policy,
                members: g.members,
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn get_server_group(
    cfg: &OpenStackConfig,
    id: &str,
) -> Result<OpenStackServerGroup, LibvirtError> {
    let sg_id = id.trim();
    if sg_id.is_empty() {
        return Err(LibvirtError::Invalid("server group id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        server_group: SgJson,
    }
    #[derive(Deserialize)]
    struct SgJson {
        id: String,
        name: String,
        #[serde(default)]
        policy: Option<String>,
        #[serde(default)]
        policies: Vec<String>,
        #[serde(default)]
        members: Vec<String>,
    }
    let resp = session
        .get(COMPUTE, &["os-server-groups", sg_id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let policy = body
        .server_group
        .policy
        .or_else(|| body.server_group.policies.into_iter().next())
        .unwrap_or_default();
    Ok(OpenStackServerGroup {
        id: body.server_group.id,
        name: body.server_group.name,
        policy,
        members: body.server_group.members,
    })
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct CreateServerGroupRequest {
    pub name: String,
    pub policy: String,
}

pub async fn create_server_group(
    cfg: &OpenStackConfig,
    req: &CreateServerGroupRequest,
) -> Result<OpenStackServerGroup, LibvirtError> {
    let name = req.name.trim();
    let policy = req.policy.trim();
    if name.is_empty() || policy.is_empty() {
        return Err(LibvirtError::Invalid("name and policy are required".into()));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({
        "server_group": { "name": name, "policies": [policy] }
    });
    #[derive(Deserialize)]
    struct Resp {
        server_group: SgJson,
    }
    #[derive(Deserialize)]
    struct SgJson {
        id: String,
        name: String,
        #[serde(default)]
        policy: Option<String>,
        #[serde(default)]
        policies: Vec<String>,
        #[serde(default)]
        members: Vec<String>,
    }
    let resp = session
        .post(COMPUTE, &["os-server-groups"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    let policy = parsed
        .server_group
        .policy
        .or_else(|| parsed.server_group.policies.into_iter().next())
        .unwrap_or_else(|| policy.to_string());
    Ok(OpenStackServerGroup {
        id: parsed.server_group.id,
        name: parsed.server_group.name,
        policy,
        members: parsed.server_group.members,
    })
}

pub async fn delete_server_group(cfg: &OpenStackConfig, id: &str) -> Result<(), LibvirtError> {
    let sg_id = id.trim();
    if sg_id.is_empty() {
        return Err(LibvirtError::Invalid("server group id is required".into()));
    }
    let session = connect_session(cfg).await?;
    session
        .delete(COMPUTE, &["os-server-groups", sg_id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn get_flavor(
    cfg: &OpenStackConfig,
    flavor_id: &str,
) -> Result<super::resources::OpenStackFlavor, LibvirtError> {
    let id = flavor_id.trim();
    if id.is_empty() {
        return Err(LibvirtError::Invalid("flavor id is required".into()));
    }
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        flavor: FlavorJson,
    }
    #[derive(Deserialize)]
    struct FlavorJson {
        id: String,
        name: String,
        vcpus: u32,
        ram: u64,
        disk: u64,
    }
    let resp = session
        .get(COMPUTE, &["flavors", id])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(super::resources::OpenStackFlavor {
        id: parsed.flavor.id,
        name: parsed.flavor.name,
        vcpus: parsed.flavor.vcpus,
        ram_mb: parsed.flavor.ram,
        disk_gb: parsed.flavor.disk,
    })
}

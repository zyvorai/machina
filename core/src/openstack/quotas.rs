// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Nova/Cinder/Neutron limits and quota usage (read-only).

use osauth::services::{GenericService, VersionSelector, BLOCK_STORAGE, COMPUTE, NETWORK};
use serde::{Deserialize, Serialize};

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{
    connect_identity_session, connect_session, effective_cloud_name, map_json_err, map_osauth_err,
    resolve_clouds_yaml_path,
};

const IDENTITY: GenericService = GenericService::new("identity", VersionSelector::Any);

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackQuotaSummary {
    pub compute: serde_json::Value,
    pub cinder: Option<serde_json::Value>,
    pub neutron: Option<serde_json::Value>,
}

fn resolve_project_id_from_env() -> Option<String> {
    for key in ["OS_PROJECT_ID", "OS_TENANT_ID"] {
        if let Ok(id) = std::env::var(key) {
            let t = id.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn resolve_project_name(cfg: &OpenStackConfig) -> Option<String> {
    for key in ["OS_PROJECT_NAME", "OS_TENANT_NAME"] {
        if let Ok(name) = std::env::var(key) {
            let t = name.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    if !cfg.project_name.trim().is_empty() {
        return Some(cfg.project_name.trim().to_string());
    }
    project_name_from_clouds_yaml(cfg)
}

fn project_name_from_clouds_yaml(cfg: &OpenStackConfig) -> Option<String> {
    let path = resolve_clouds_yaml_path(cfg)?;
    let cloud = effective_cloud_name(cfg)?;
    let content = std::fs::read_to_string(path).ok()?;
    let mut in_cloud = false;
    let mut in_auth = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        if trimmed == "clouds:" {
            continue;
        }
        if line.starts_with("  ") && !line.starts_with("    ") {
            in_cloud = trimmed == format!("{cloud}:");
            in_auth = false;
            continue;
        }
        if !in_cloud {
            continue;
        }
        if trimmed == "auth:" {
            in_auth = true;
            continue;
        }
        if in_auth && line.starts_with("      ") {
            if let Some(val) = trimmed.strip_prefix("project_name:") {
                let name = val.trim().trim_matches('"');
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        } else if in_auth && line.starts_with("    ") && !line.starts_with("      ") {
            in_auth = false;
        }
    }
    None
}

async fn resolve_project_id_by_name(cfg: &OpenStackConfig, name: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct ProjectsResp {
        projects: Vec<ProjectRow>,
    }
    #[derive(Deserialize)]
    struct ProjectRow {
        id: String,
        name: String,
    }
    let session = connect_identity_session(cfg).await.ok()?;
    if let Ok(resp) = session
        .get(IDENTITY, &["projects"])
        .query(&[("name", name.trim())])
        .send()
        .await
    {
        if let Ok(body) = resp.json::<ProjectsResp>().await {
            if let Some(id) = body
                .projects
                .into_iter()
                .find(|p| p.name == name.trim())
                .map(|p| p.id)
            {
                return Some(id);
            }
        }
    }
    None
}

async fn resolve_project_id_from_nova(session: &osauth::Session) -> Option<String> {
    #[derive(Deserialize)]
    struct ListResp {
        servers: Vec<ServerRow>,
    }
    #[derive(Deserialize)]
    struct ServerRow {
        #[serde(default)]
        tenant_id: Option<String>,
        #[serde(default)]
        project_id: Option<String>,
    }
    let resp = session
        .get(COMPUTE, &["servers", "detail"])
        .query(&[("limit", "1")])
        .send()
        .await
        .ok()?;
    let body: ListResp = resp.json().await.ok()?;
    body.servers.into_iter().find_map(|s| {
        s.tenant_id
            .or(s.project_id)
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
    })
}

async fn resolve_project_id(cfg: &OpenStackConfig, session: &osauth::Session) -> Option<String> {
    if let Some(id) = resolve_project_id_from_env() {
        return Some(id);
    }
    if let Some(name) = resolve_project_name(cfg) {
        if let Some(id) = resolve_project_id_by_name(cfg, &name).await {
            return Some(id);
        }
    }
    resolve_project_id_from_nova(session).await
}

async fn fetch_neutron_quotas(
    cfg: &OpenStackConfig,
    session: &osauth::Session,
) -> Option<serde_json::Value> {
    let project_id = resolve_project_id(cfg, session).await?;
    session
        .get(NETWORK, &["quotas", &project_id, "details"])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()
}

/// Error when Cinder is absent from the service catalog.
pub fn cinder_unavailable_error() -> LibvirtError {
    LibvirtError::Invalid("Cinder block-storage is not registered in the service catalog".into())
}

/// True when Cinder block-storage is registered in the service catalog.
pub async fn probe_cinder_reachable(cfg: &OpenStackConfig) -> bool {
    let Ok(session) = connect_session(cfg).await else {
        return false;
    };
    session.get(BLOCK_STORAGE, &["limits"]).send().await.is_ok()
}

/// Fail fast when Cinder APIs are unavailable.
pub async fn ensure_cinder_reachable(cfg: &OpenStackConfig) -> Result<(), LibvirtError> {
    if probe_cinder_reachable(cfg).await {
        Ok(())
    } else {
        Err(cinder_unavailable_error())
    }
}

pub async fn get_quota_summary(
    cfg: &OpenStackConfig,
) -> Result<OpenStackQuotaSummary, LibvirtError> {
    let session = connect_session(cfg).await?;
    let compute_resp = session
        .get(COMPUTE, &["limits"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    #[derive(Deserialize)]
    struct LimitsResp {
        limits: serde_json::Value,
    }
    let compute: LimitsResp = compute_resp.json().await.map_err(map_json_err)?;

    let cinder = match session.get(BLOCK_STORAGE, &["limits"]).send().await {
        Ok(r) => r.json().await.ok(),
        Err(_) => None,
    };

    let neutron = fetch_neutron_quotas(cfg, &session).await;

    Ok(OpenStackQuotaSummary {
        compute: compute.limits,
        cinder,
        neutron,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateQuotasRequest {
    /// `compute`, `cinder`, or `neutron`
    pub service: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub quotas: serde_json::Map<String, serde_json::Value>,
}

pub async fn update_quotas(
    cfg: &OpenStackConfig,
    req: &UpdateQuotasRequest,
) -> Result<serde_json::Value, LibvirtError> {
    if req.quotas.is_empty() {
        return Err(LibvirtError::Invalid("quotas map is required".into()));
    }
    let session = connect_session(cfg).await?;
    let mut project_id = req
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| resolve_project_id_from_env());
    if project_id.is_none() {
        project_id = resolve_project_id(cfg, &session).await;
    }
    let project_id = project_id
        .ok_or_else(|| LibvirtError::Invalid("project_id is required for quota updates".into()))?;

    let service = req.service.trim().to_lowercase();
    let resp = match service.as_str() {
        "compute" | "nova" => session
            .put(COMPUTE, &["os-quota-sets", &project_id])
            .json(&serde_json::json!({ "quota_set": req.quotas }))
            .send()
            .await
            .map_err(map_osauth_err)?,
        "cinder" | "block-storage" => session
            .put(BLOCK_STORAGE, &["os-quota-sets", &project_id])
            .json(&serde_json::json!({ "quota_set": req.quotas }))
            .send()
            .await
            .map_err(map_osauth_err)?,
        "neutron" | "network" => session
            .put(NETWORK, &["quotas", &project_id])
            .json(&serde_json::json!({ "quota": req.quotas }))
            .send()
            .await
            .map_err(map_osauth_err)?,
        _ => {
            return Err(LibvirtError::Invalid(
                "service must be compute, cinder, or neutron".into(),
            ));
        }
    };
    resp.json().await.map_err(map_json_err)
}

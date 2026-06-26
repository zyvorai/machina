// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, Query, State};
use axum::Extension;
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::api::ApiError;
use crate::auth::{require_admin, require_operator, AuthUser};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CockpitSectionQuery {
    pub section: Option<String>,
}

async fn host_cockpit_query(
    state: &AppState,
    host_id: Uuid,
    action: &str,
) -> Result<serde_json::Value, ApiError> {
    let (_, agent_addr) =
        crate::engine::host_os::resolve_agent_addr(&state.pool, &state.config, host_id)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut client = crate::agent_client::connect(&agent_addr)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    crate::agent_client::host_libvirt_query(&mut client, action, &serde_json::json!({}))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn host_cockpit_inventory(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<CockpitSectionQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let section = q.section.as_deref().unwrap_or("all");
    let storage = if section == "all" || section == "storage" {
        Some(host_cockpit_query(&state, id, "cockpit.storage").await?)
    } else {
        None
    };
    let network = if section == "all" || section == "network" {
        Some(host_cockpit_query(&state, id, "cockpit.network").await?)
    } else {
        None
    };
    let system = if section == "all" || section == "system" {
        Some(host_cockpit_query(&state, id, "cockpit.system").await?)
    } else {
        None
    };
    Ok(Json(serde_json::json!({
        "host_id": id.to_string(),
        "storage": storage,
        "network": network,
        "system": system,
    })))
}

#[derive(Debug, Deserialize)]
pub struct CockpitActionBody {
    pub action: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

pub async fn host_cockpit_action(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<CockpitActionBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let (_, agent_addr) =
        crate::engine::host_os::resolve_agent_addr(&state.pool, &state.config, id)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut client = crate::agent_client::connect(&agent_addr)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let result = crate::agent_client::host_libvirt_invoke(&mut client, &body.action, &body.payload)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(result))
}

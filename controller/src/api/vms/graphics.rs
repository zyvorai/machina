// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use axum::Extension;

use crate::api::ApiError;
use crate::auth::{require_operator, AuthUser};
use crate::state::AppState;

pub async fn convert_vm_spice_to_vnc(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let (name, host_id) = crate::api::vm_row::vm_agent_row_libvirt(&state, id).await?;
    let (_, agent_addr) = crate::engine::host_os::resolve_agent_addr(&state.pool, &state.config, host_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut client = crate::agent_client::connect(&agent_addr)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let result = crate::agent_client::vm_libvirt_invoke(
        &mut client,
        &name,
        "graphics.spice_to_vnc",
        &serde_json::json!({}),
    )
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;
    state.emit_event("vm.graphics", format!("SPICE→VNC conversion for VM {name}"));
    Ok(Json(result))
}

#[derive(Debug, Deserialize)]
pub struct VmGraphicsBody {
    pub graphics_type: String,
    #[serde(default)]
    pub listen: Option<String>,
}

pub async fn add_vm_graphics(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<VmGraphicsBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let (name, host_id) = crate::api::vm_row::vm_agent_row_libvirt(&state, id).await?;
    let listen = body
        .listen
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("127.0.0.1");
    let (_, agent_addr) = crate::engine::host_os::resolve_agent_addr(&state.pool, &state.config, host_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut client = crate::agent_client::connect(&agent_addr)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let result = crate::agent_client::vm_libvirt_invoke(
        &mut client,
        &name,
        "graphics.add",
        &serde_json::json!({
            "graphics_type": body.graphics_type.trim(),
            "listen": listen,
        }),
    )
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;
    state.emit_event(
        "vm.graphics",
        format!("Added {} graphics for VM {name} (listen={listen})", body.graphics_type.trim()),
    );
    Ok(Json(result))
}

pub async fn remove_vm_graphics(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<VmGraphicsBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let (name, host_id) = crate::api::vm_row::vm_agent_row_libvirt(&state, id).await?;
    let (_, agent_addr) = crate::engine::host_os::resolve_agent_addr(&state.pool, &state.config, host_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let mut client = crate::agent_client::connect(&agent_addr)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let result = crate::agent_client::vm_libvirt_invoke(
        &mut client,
        &name,
        "graphics.remove",
        &serde_json::json!({ "graphics_type": body.graphics_type.trim() }),
    )
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;
    state.emit_event(
        "vm.graphics",
        format!("Removed {} graphics from VM {name}", body.graphics_type.trim()),
    );
    Ok(Json(result))
}

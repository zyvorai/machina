// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
use serde::Deserialize;

use crate::api::ApiError;
use crate::auth::{require_admin, require_operator, AuthUser};
use crate::engine::baremetal;
use crate::state::AppState;

pub async fn list_servers(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<baremetal::BaremetalServer>>, ApiError> {
    require_operator(&actor)?;
    baremetal::list_servers(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn register_server(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<baremetal::RegisterBaremetalBody>,
) -> Result<Json<baremetal::BaremetalServer>, ApiError> {
    require_admin(&actor)?;
    if body.hostname.trim().is_empty() {
        return Err(ApiError::bad_request("hostname required"));
    }
    baremetal::register(&state.pool, &body)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct CapacityPlanBody {
    pub query: String,
}

pub async fn capacity_plan(
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CapacityPlanBody>,
) -> Result<Json<baremetal::BaremetalCapacityPlan>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(baremetal::plan_capacity(&body.query)))
}

pub async fn server_power(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<uuid::Uuid>,
    Json(body): Json<baremetal::BmcPowerBody>,
) -> Result<Json<baremetal::BmcPowerResult>, ApiError> {
    require_admin(&actor)?;
    baremetal::set_power(&state.pool, id, &body)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))
        .map(Json)
}

pub async fn server_provision(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<baremetal::BaremetalProvisionPlan>, ApiError> {
    require_admin(&actor)?;
    baremetal::provision_preview(&state.pool, id)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))
        .map(Json)
}

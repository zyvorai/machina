// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

use crate::state::AppState;

pub async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let db_ok = crate::db::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .is_ok();
    Json(json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "component": "machina-controller",
        "version": env!("CARGO_PKG_VERSION"),
        "controller_id": state.config.controller_id,
        "leader": state.leader.is_leader(),
        "database": if db_ok { "ok" } else { "unavailable" },
        // which backend this controller was built for, and its connection pool (so an operator can see the choice they made)
        "database_backend": crate::db::BACKEND,
        "database_pool": { "size": state.pool.size(), "idle": state.pool.num_idle() },
    }))
}

pub async fn ready(State(state): State<AppState>) -> Result<Json<serde_json::Value>, StatusCode> {
    crate::db::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(json!({ "ready": true })))
}

const OPENAPI_JSON: &str = include_str!("../../../docs/openapi-controller.json");

pub async fn openapi() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/json")], OPENAPI_JSON)
}

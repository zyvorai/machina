// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::tasks::TaskResponse;
use crate::api::ApiError;
use crate::auth::{require_admin, AuthUser};
use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

#[derive(Debug, Serialize)]
pub struct AgentUpgradeMatrix {
    pub controller_version: String,
    pub recommended_agent: String,
    pub min_agent: String,
    pub notes: String,
}

pub async fn upgrade_matrix(
    State(_state): State<AppState>,
) -> Result<Json<AgentUpgradeMatrix>, ApiError> {
    Ok(Json(AgentUpgradeMatrix {
        controller_version: env!("CARGO_PKG_VERSION").into(),
        recommended_agent: env!("CARGO_PKG_VERSION").into(),
        min_agent: "0.1.0".into(),
        notes: "Rolling upgrade: enter host maintenance, run host.agent.upgrade task, verify heartbeat."
            .into(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpgradeHostBody {
    #[serde(default = "default_version")]
    pub target_version: String,
}

fn default_version() -> String {
    env!("CARGO_PKG_VERSION").into()
}

pub async fn upgrade_host_agent(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpgradeHostBody>,
) -> Result<Json<TaskResponse>, ApiError> {
    require_admin(&actor)?;
    let task_id = enqueue_task(
        &state,
        "host.agent.upgrade",
        serde_json::json!({
            "host_id": id.to_string(),
            "target_version": body.target_version,
        }),
        Some("host"),
        Some(id),
        Some(id),
    )
    .await?;
    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "host.agent.upgrade".into(),
    }))
}

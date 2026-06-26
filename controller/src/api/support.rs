// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::State;
use axum::response::IntoResponse;
use axum::Extension;
use axum::Json;
use serde::Serialize;

use crate::api::ApiError;
use crate::auth::{require_admin, AuthUser};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct SupportBundleMeta {
    pub controller_id: String,
    pub generated_at: String,
    pub task_count: i64,
    pub host_count: i64,
    pub vm_count: i64,
    pub recent_failures: serde_json::Value,
    pub audit_tail: serde_json::Value,
    pub version_matrix: serde_json::Value,
}

pub async fn support_bundle(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&actor)?;
    let task_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks")
        .fetch_one(&state.pool)
        .await?;
    let host_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hosts")
        .fetch_one(&state.pool)
        .await?;
    let vm_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vms")
        .fetch_one(&state.pool)
        .await?;

    let recent_failures: serde_json::Value = sqlx::query_scalar(
        "SELECT COALESCE(json_group_array(json_object('id',id,'operation',operation,'status',status,'message',message,'created_at',created_at)), '[]')
         FROM (SELECT id, operation, status, message, created_at FROM tasks WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20)",
    )
    .fetch_one(&state.pool)
    .await
    .unwrap_or(serde_json::json!([]));

    let audit_tail: serde_json::Value = sqlx::query_scalar(
        "SELECT COALESCE(json_group_array(json_object('actor',actor,'action',action,'resource_type',resource_type,'resource_id',resource_id,'created_at',created_at)), '[]')
         FROM (SELECT actor, action, resource_type, resource_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 50)",
    )
    .fetch_one(&state.pool)
    .await
    .unwrap_or(serde_json::json!([]));

    let version_matrix: serde_json::Value = sqlx::query_scalar(
        "SELECT COALESCE(json_group_array(json_object('hostname',hostname,'agent_version',agent_version,'libvirt_version',libvirt_version,'qemu_version',qemu_version,'cpu_model',cpu_model,'state',state)), '[]')
         FROM (SELECT hostname, agent_version, libvirt_version, qemu_version, cpu_model, state FROM hosts ORDER BY hostname)",
    )
    .fetch_one(&state.pool)
    .await
    .unwrap_or(serde_json::json!([]));

    let bundle = SupportBundleMeta {
        controller_id: state.config.controller_id.clone(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        task_count,
        host_count,
        vm_count,
        recent_failures,
        audit_tail,
        version_matrix,
    };

    Ok(Json(bundle))
}

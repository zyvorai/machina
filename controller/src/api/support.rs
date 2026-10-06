// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

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

/// A JSON array with one object per row of `from` (object keys are the column names), as text: SQLite builds it with
/// `json_group_array(json_object(..))`, PostgreSQL with `json_agg(json_build_object(..))`.
fn json_rows(columns: &[&str], from: &str) -> String {
    let pairs = columns.iter().map(|c| format!("'{c}', {c}")).collect::<Vec<_>>().join(", ");
    if cfg!(feature = "postgres") {
        format!("SELECT COALESCE(json_agg(json_build_object({pairs}))::text, '[]') FROM ({from}) AS rows")
    } else {
        format!("SELECT COALESCE(json_group_array(json_object({pairs})), '[]') FROM ({from})")
    }
}

pub async fn support_bundle(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<impl IntoResponse, ApiError> {
    require_admin(&actor)?;
    let task_count: i64 = crate::db::query_scalar("SELECT COUNT(*) FROM tasks")
        .fetch_one(&state.pool)
        .await?;
    let host_count: i64 = crate::db::query_scalar("SELECT COUNT(*) FROM hosts")
        .fetch_one(&state.pool)
        .await?;
    let vm_count: i64 = crate::db::query_scalar("SELECT COUNT(*) FROM vms")
        .fetch_one(&state.pool)
        .await?;

    let recent_failures: serde_json::Value = crate::db::query_scalar(&json_rows(
        &["id", "operation", "status", "message", "created_at"],
        "SELECT id, operation, status, message, created_at FROM tasks WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20",
    ))
    .fetch_one(&state.pool)
    .await
    .unwrap_or(serde_json::json!([]));

    let audit_tail: serde_json::Value = crate::db::query_scalar(&json_rows(
        &["actor", "action", "resource_type", "resource_id", "created_at"],
        "SELECT actor, action, resource_type, resource_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 50",
    ))
    .fetch_one(&state.pool)
    .await
    .unwrap_or(serde_json::json!([]));

    let version_matrix: serde_json::Value = crate::db::query_scalar(&json_rows(
        &["hostname", "agent_version", "libvirt_version", "qemu_version", "cpu_model", "state"],
        "SELECT hostname, agent_version, libvirt_version, qemu_version, cpu_model, state FROM hosts ORDER BY hostname",
    ))
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

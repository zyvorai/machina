// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::tasks::TaskResponse;
use crate::api::ApiError;
use crate::auth::{require_operator, AuthUser};
use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BackupRow {
    pub id: Uuid,
    pub vm_id: Uuid,
    pub backup_type: String,
    pub status: String,
    pub message: Option<String>,
    pub backup_path: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateBackupBody {
    #[serde(default = "default_type")]
    pub backup_type: String,
    #[serde(default)]
    pub target_id: Option<Uuid>,
}

fn default_type() -> String {
    "full".into()
}

pub async fn list_vm_backups(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(vm_id): Path<Uuid>,
) -> Result<Json<Vec<BackupRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, BackupRow>(
        "SELECT id, vm_id, backup_type, status, message, COALESCE(backup_path, '') AS backup_path,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM backup_records WHERE vm_id = ? ORDER BY created_at DESC LIMIT 200",
    )
    .bind(vm_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn create_vm_backup(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(vm_id): Path<Uuid>,
    Json(body): Json<CreateBackupBody>,
) -> Result<Json<TaskResponse>, ApiError> {
    require_operator(&actor)?;
    let host_id: Option<Uuid> = sqlx::query_scalar("SELECT host_id FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_one(&state.pool)
        .await?;

    let id = Uuid::new_v4();
    let task_id = enqueue_task(
        &state,
        "vm.backup",
        serde_json::json!({
            "vm_id": vm_id.to_string(),
            "backup_id": id.to_string(),
            "target_id": body.target_id.map(|t| t.to_string()),
        }),
        Some("vm"),
        Some(vm_id),
        host_id,
    )
    .await?;

    sqlx::query(
        "INSERT INTO backup_records (id, vm_id, backup_type, status) VALUES (?, ?, ?, 'pending')",
    )
    .bind(id)
    .bind(vm_id)
    .bind(&body.backup_type)
    .execute(&state.pool)
    .await?;

    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "vm.backup".into(),
    }))
}

pub async fn restore_vm_backup(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path((vm_id, backup_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<TaskResponse>, ApiError> {
    require_operator(&actor)?;
    let host_id: Option<Uuid> = sqlx::query_scalar("SELECT host_id FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_one(&state.pool)
        .await?;

    let task_id = enqueue_task(
        &state,
        "vm.backup.restore",
        serde_json::json!({
            "vm_id": vm_id.to_string(),
            "backup_id": backup_id.to_string(),
        }),
        Some("vm"),
        Some(vm_id),
        host_id,
    )
    .await?;

    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "vm.backup.restore".into(),
    }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct BackupTimelineRow {
    pub kind: String,
    pub id: Uuid,
    pub vm_id: Uuid,
    pub vm_name: String,
    pub label: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_backup_timeline(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<BackupTimelineRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, BackupTimelineRow>(
        r#"
        SELECT * FROM (
            SELECT 'backup' AS kind, b.id, b.vm_id, v.name AS vm_name,
                   CASE WHEN b.status = 'completed' THEN 'Backup successful'
                        ELSE 'Backup ' || b.status END AS label,
                   b.status, b.created_at
            FROM backup_records b
            JOIN vms v ON v.id = b.vm_id
            UNION ALL
            SELECT 'snapshot' AS kind, s.id, s.vm_id, v.name AS vm_name,
                   'Snapshot: ' || s.name AS label,
                   s.status, s.created_at
            FROM snapshot_records s
            JOIN vms v ON v.id = s.vm_id
        ) t
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

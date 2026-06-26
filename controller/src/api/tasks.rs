// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, Query, State};
use axum::Extension;
use axum::Json;
use serde::Serialize;
use uuid::Uuid;

use crate::auth::{require_operator, AuthUser};

use crate::api::ApiError;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    pub task_id: String,
    pub status: String,
    pub operation: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TaskRow {
    pub id: Uuid,
    pub operation: String,
    pub status: String,
    pub progress: i16,
    pub message: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, serde::Deserialize)]
pub struct TaskQuery {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub operation: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    200
}

pub async fn list_tasks(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Query(q): Query<TaskQuery>,
) -> Result<Json<Vec<TaskRow>>, ApiError> {
    require_operator(&actor)?;
    let limit = q.limit.clamp(1, 500);
    let rows = match (&q.status, &q.operation) {
        (Some(status), Some(op)) if !status.is_empty() && !op.is_empty() => {
            sqlx::query_as::<_, TaskRow>(
                "SELECT id, operation, status, progress, message,
                        strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
                 FROM tasks WHERE status = ? AND operation LIKE ? ORDER BY created_at DESC LIMIT ?",
            )
            .bind(status)
            .bind(format!("%{op}%"))
            .bind(limit)
            .fetch_all(&state.pool)
            .await?
        }
        (Some(status), _) if !status.is_empty() => {
            sqlx::query_as::<_, TaskRow>(
                "SELECT id, operation, status, progress, message,
                        strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
                 FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            )
            .bind(status)
            .bind(limit)
            .fetch_all(&state.pool)
            .await?
        }
        (_, Some(op)) if !op.is_empty() => {
            sqlx::query_as::<_, TaskRow>(
                "SELECT id, operation, status, progress, message,
                        strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
                 FROM tasks WHERE operation LIKE ? ORDER BY created_at DESC LIMIT ?",
            )
            .bind(format!("%{op}%"))
            .bind(limit)
            .fetch_all(&state.pool)
            .await?
        }
        _ => {
            sqlx::query_as::<_, TaskRow>(
                "SELECT id, operation, status, progress, message,
                        strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
                 FROM tasks ORDER BY created_at DESC LIMIT ?",
            )
            .bind(limit)
            .fetch_all(&state.pool)
            .await?
        }
    };
    Ok(Json(rows))
}

pub async fn get_task(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskRow>, ApiError> {
    require_operator(&actor)?;
    let row = sqlx::query_as::<_, TaskRow>(
        "SELECT id, operation, status, progress, message,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM tasks WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

pub async fn cancel_task(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskRow>, ApiError> {
    require_operator(&actor)?;
    let updated = sqlx::query(
        "UPDATE tasks SET status = 'cancelled', message = 'cancelled by operator', updated_at = datetime('now')
         WHERE id = ? AND status = 'pending'",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::bad_request("task not pending or not found"));
    }
    get_task(State(state), Extension(actor), Path(id)).await
}

pub async fn retry_task(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskResponse>, ApiError> {
    require_operator(&actor)?;
    let row: (
        String,
        serde_json::Value,
        Option<String>,
        Option<Uuid>,
        Option<Uuid>,
    ) = sqlx::query_as(
        "SELECT operation, payload, resource_type, resource_id, host_id FROM tasks WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    let new_id =
        crate::tasks::enqueue::enqueue_task(&state, &row.0, row.1, row.2.as_deref(), row.3, row.4)
            .await?;

    Ok(Json(TaskResponse {
        task_id: new_id.to_string(),
        status: "pending".into(),
        operation: row.0,
    }))
}

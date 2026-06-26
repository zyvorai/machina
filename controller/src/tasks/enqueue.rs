// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use uuid::Uuid;

use crate::api::ApiError;
use crate::state::AppState;
use crate::tasks::TaskMessage;

pub async fn enqueue_task(
    state: &AppState,
    operation: &str,
    payload: serde_json::Value,
    resource_type: Option<&str>,
    resource_id: Option<Uuid>,
    host_id: Option<Uuid>,
) -> Result<Uuid, ApiError> {
    let task_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO tasks (id, operation, status, resource_type, resource_id, host_id, payload)
         VALUES (?, ?, 'pending', ?, ?, ?, ?)",
    )
    .bind(task_id)
    .bind(operation)
    .bind(resource_type)
    .bind(resource_id)
    .bind(host_id)
    .bind(&payload)
    .execute(&state.pool)
    .await?;

    let msg = TaskMessage {
        task_id,
        operation: operation.to_string(),
        payload,
    };
    state
        .task_bus
        .publish("machina.tasks", &msg)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(task_id)
}

pub async fn write_audit(
    state: &AppState,
    actor: &str,
    action: &str,
    resource_type: &str,
    resource_id: Option<Uuid>,
    detail: serde_json::Value,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO audit_logs (id, actor, action, resource_type, resource_id, detail)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(actor)
    .bind(action)
    .bind(resource_type)
    .bind(resource_id)
    .bind(detail)
    .execute(&state.pool)
    .await?;
    state.emit_event("audit", format!("{actor} {action}"));
    Ok(())
}

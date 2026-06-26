// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct ZeusActionRow {
    pub id: Uuid,
    pub source: String,
    pub action_type: String,
    pub label: String,
    pub review: String,
    pub risk: String,
    pub object_ref: serde_json::Value,
    pub status: String,
    pub requested_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateActionBody {
    pub action_type: String,
    pub label: String,
    #[serde(default)]
    pub review: String,
    #[serde(default)]
    pub risk: String,
    #[serde(default)]
    pub object_ref: serde_json::Value,
    #[serde(default)]
    pub source: String,
}

pub async fn list_pending(pool: &SqlitePool) -> anyhow::Result<Vec<ZeusActionRow>> {
    list_by_status(pool, "pending").await
}

pub async fn list_by_status(pool: &SqlitePool, status: &str) -> anyhow::Result<Vec<ZeusActionRow>> {
    let rows: Vec<(Uuid, String, String, String, String, String, serde_json::Value, String, String, DateTime<Utc>)> =
        sqlx::query_as(
            "SELECT id, source, action_type, label, review, risk, object_ref, status, requested_by,
                    strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
             FROM ai_actions WHERE status = ? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(status)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(map_row).collect())
}

fn map_row(
    (id, source, action_type, label, review, risk, object_ref, status, requested_by, created_at): (
        Uuid,
        String,
        String,
        String,
        String,
        String,
        serde_json::Value,
        String,
        String,
        DateTime<Utc>,
    ),
) -> ZeusActionRow {
    ZeusActionRow {
        id,
        source,
        action_type,
        label,
        review,
        risk,
        object_ref,
        status,
        requested_by,
        created_at,
    }
}

pub async fn create_action(
    pool: &SqlitePool,
    body: &CreateActionBody,
    requested_by: &str,
) -> anyhow::Result<ZeusActionRow> {
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO ai_actions (id, source, action_type, label, review, risk, object_ref, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(if body.source.is_empty() { "zeus" } else { &body.source })
    .bind(&body.action_type)
    .bind(&body.label)
    .bind(&body.review)
    .bind(if body.risk.is_empty() {
        "Review required"
    } else {
        &body.risk
    })
    .bind(&body.object_ref)
    .bind(requested_by)
    .fetch_one(pool)
    .await?;
    get_action(pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("action missing"))
}

pub async fn get_action(pool: &SqlitePool, id: Uuid) -> anyhow::Result<Option<ZeusActionRow>> {
    let row: Option<(Uuid, String, String, String, String, String, serde_json::Value, String, String, DateTime<Utc>)> =
        sqlx::query_as(
            "SELECT id, source, action_type, label, review, risk, object_ref, status, requested_by,
                    strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
             FROM ai_actions WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(map_row))
}

pub async fn approve_and_execute(
    state: &crate::state::AppState,
    id: Uuid,
    actor: &crate::auth::AuthUser,
) -> anyhow::Result<serde_json::Value> {
    let action = get_action(&state.pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Action not found"))?;
    if action.status != "pending" {
        return Err(anyhow::anyhow!("Action already {}", action.status));
    }
    let updated = sqlx::query(
        "UPDATE ai_actions SET status = 'approved', approved_by = ? WHERE id = ? AND status = 'pending'",
    )
    .bind(&actor.username)
    .bind(id)
    .execute(&state.pool)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(anyhow::anyhow!("Action already approved or executed by another request"));
    }

    let result = match action.action_type.as_str() {
        t if matches!(
            t,
            "start_vm"
                | "create_backup"
                | "enable_ha"
                | "install_guest_tools"
                | "adopt_vm"
                | "bulk_backup"
                | "bulk_ha"
                | "sync_hosts"
        ) =>
        {
            let body = super::autopilot::ExecuteBody {
                action_type: action.action_type.clone(),
                object_ref: action.object_ref.clone(),
            };
            super::autopilot::execute(state, actor, &body)
                .await
                .map(|r| serde_json::json!({"message": r.message, "task_ids": r.task_ids}))
                .map_err(|e| anyhow::anyhow!(e.message))
        }
        "firewall_change" => Ok(serde_json::json!({
            "message": "Firewall approval delegated to Zeus Firewall workflow"
        })),
        "guest.sync_time" | "guest.fstrim" => {
            let vm_id = action
                .object_ref
                .get("vm_id")
                .and_then(|v| v.as_str())
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or_else(|| anyhow::anyhow!("vm_id missing in object_ref"))?;
            let op = if action.action_type == "guest.sync_time" {
                "sync_time"
            } else {
                "fstrim"
            };
            let out = crate::engine::host_os::vm_guest_agent_action(
                &state.pool,
                &state.config,
                vm_id,
                op,
            )
            .await?;
            Ok(serde_json::json!({ "message": action.label, "result": out }))
        }
        "vm.shutdown_agent" => {
            let vm_id = action
                .object_ref
                .get("vm_id")
                .and_then(|v| v.as_str())
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
            let host_id: Option<Uuid> = sqlx::query_scalar("SELECT host_id FROM vms WHERE id = ?")
                .bind(vm_id)
                .fetch_optional(&state.pool)
                .await?;
            if host_id.is_none() {
                return Err(anyhow::anyhow!("VM not found or has no assigned host"));
            }
            let task_id = crate::tasks::enqueue::enqueue_task(
                state,
                "vm.power",
                serde_json::json!({
                    "vm_id": vm_id.to_string(),
                    "action": "shutdown",
                    "mode": "agent",
                }),
                Some("vm"),
                Some(vm_id),
                host_id,
            )
            .await
            .map_err(|e| anyhow::anyhow!(e.message))?;
            Ok(serde_json::json!({
                "message": "Graceful shutdown queued",
                "task_id": task_id.to_string()
            }))
        }
        _ => Ok(serde_json::json!({"message": format!("Recorded approval for {}", action.label)})),
    };

    match &result {
        Ok(msg) => {
            let mut tx = state.pool.begin().await?;
            sqlx::query(
                "UPDATE ai_actions SET status = 'executed', executed_at = datetime('now') WHERE id = ?",
            )
            .bind(id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO audit_logs (id, actor, action, resource_type, resource_id, detail) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4())
            .bind(&actor.username)
            .bind("zeus.action.execute")
            .bind("zeus")
            .bind(id)
            .bind(serde_json::json!({
                "action_type": action.action_type,
                "result": msg
            }))
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            state.emit_event("audit", format!("{} zeus.action.execute", actor.username));
        }
        Err(_) => {
            sqlx::query("UPDATE ai_actions SET status = 'failed' WHERE id = ?")
                .bind(id)
                .execute(&state.pool)
                .await?;
        }
    }
    result
}

pub async fn reject(pool: &SqlitePool, id: Uuid, actor: &str) -> anyhow::Result<bool> {
    let r = sqlx::query(
        "UPDATE ai_actions SET status = 'rejected', approved_by = ? WHERE id = ? AND status = 'pending'",
    )
    .bind(actor)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn approval_hub(pool: &SqlitePool) -> anyhow::Result<serde_json::Value> {
    let zeus = list_pending(pool).await?;
    let firewall_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM firewall_approvals WHERE status = 'pending'")
            .fetch_one(pool)
            .await
            .unwrap_or(0);
    let autopilot = super::autopilot::propose(pool, None).await?;
    Ok(serde_json::json!({
        "zeus_actions": zeus,
        "firewall_pending": firewall_count,
        "autopilot_proposals": autopilot.actions,
        "total_pending": zeus.len() as i64 + firewall_count + autopilot.actions.len() as i64
    }))
}

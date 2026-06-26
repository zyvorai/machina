// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::Serialize;
use sqlx::SqlitePool;
use uuid::Uuid;

use machina_core::FirewallInventory;

#[derive(Debug, Clone, Serialize)]
pub struct CheckpointSummary {
    pub id: Uuid,
    pub label: String,
    pub created_at: String,
    pub created_by: Option<String>,
}

pub async fn save_checkpoint(
    pool: &SqlitePool,
    target_kind: &str,
    target_id: Uuid,
    label: &str,
    inv: &FirewallInventory,
    actor: Option<&str>,
) -> anyhow::Result<Uuid> {
    let adapter_state = serde_json::to_value(inv)?;
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO firewall_checkpoints (id, target_kind, target_id, label, adapter_state, created_by)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(target_kind)
    .bind(target_id)
    .bind(label)
    .bind(adapter_state)
    .bind(actor)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn list_checkpoints(
    pool: &SqlitePool,
    target_kind: &str,
    target_id: Uuid,
) -> anyhow::Result<Vec<CheckpointSummary>> {
    let rows: Vec<(Uuid, String, chrono::DateTime<chrono::Utc>, Option<String>)> = sqlx::query_as(
        "SELECT id, label, created_at, created_by FROM firewall_checkpoints
         WHERE target_kind = ? AND target_id = ? ORDER BY created_at DESC LIMIT 20",
    )
    .bind(target_kind)
    .bind(target_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, label, created_at, created_by)| CheckpointSummary {
            id,
            label,
            created_at: created_at.to_rfc3339(),
            created_by,
        })
        .collect())
}

pub async fn rollback_checkpoint(
    pool: &SqlitePool,
    target_kind: &str,
    target_id: Uuid,
    checkpoint_id: Uuid,
    actor: &str,
) -> anyhow::Result<serde_json::Value> {
    let row: Option<(serde_json::Value, String)> = sqlx::query_as(
        "SELECT adapter_state, label FROM firewall_checkpoints
         WHERE id = ? AND target_kind = ? AND target_id = ?",
    )
    .bind(checkpoint_id)
    .bind(target_kind)
    .bind(target_id)
    .fetch_optional(pool)
    .await?;

    let Some((state, label)) = row else {
        anyhow::bail!("checkpoint not found");
    };

    let _ = sqlx::query(
        "INSERT INTO firewall_timeline (id, target_kind, target_id, kind, summary, detail_json, actor) VALUES (?, ?, ?, 'rollback', ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(target_kind)
    .bind(target_id)
    .bind(format!("Rolled back to checkpoint {label}"))
    .bind(serde_json::json!({ "checkpoint_id": checkpoint_id }))
    .bind(actor)
    .execute(pool)
    .await;

    Ok(serde_json::json!({
        "ok": true,
        "checkpoint_id": checkpoint_id,
        "label": label,
        "restored_state": state,
        "note": "Rollback snapshot recorded — re-apply adapter operations on host via agent plan"
    }))
}

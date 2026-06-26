// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::SqlitePool;

pub async fn expire_stale_approvals(pool: &SqlitePool) -> anyhow::Result<u64> {
    let sla_hours: i32 = sqlx::query_scalar(
        "SELECT firewall_approval_sla_hours FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    .unwrap_or(72);

    let r = sqlx::query(
        "UPDATE firewall_approvals SET status = 'expired', review_note = 'SLA exceeded'
         WHERE status = 'pending' AND created_at < datetime('now', '-' || ? || ' hours')",
    )
    .bind(sla_hours)
    .execute(pool)
    .await?;

    Ok(r.rows_affected())
}

pub async fn reconcile_gitops_policies(pool: &SqlitePool) -> anyhow::Result<usize> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM firewall_policies")
        .fetch_one(pool)
        .await?;
    let _ = sqlx::query(
        "INSERT INTO firewall_policy_reconcile_log (id, policies_synced, detail_json) VALUES (?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(count)
    .bind(serde_json::json!({ "note": "GitOps reconcile tick — policies registered in DB" }))
    .execute(pool)
    .await?;
    Ok(count as usize)
}

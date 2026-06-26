// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Auto-sync firewall posture during host.inventory.

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::agent_client;
use crate::config::ControllerConfig;

use super::drift;

pub async fn sync_host_posture(
    pool: &SqlitePool,
    _cfg: &ControllerConfig,
    host_id: Uuid,
    agent_addr: &str,
) -> anyhow::Result<()> {
    let inv = match agent_client::get_firewall_inventory(agent_addr).await {
        Ok(inv) => inv,
        Err(e) => {
            tracing::debug!(%host_id, "firewall inventory sync skipped: {e:#}");
            return Ok(());
        }
    };

    let report = drift::detect_drift(pool, "host", host_id, &inv).await?;
    if report.drift_detected {
        let _ = sqlx::query(
            "INSERT INTO firewall_timeline (id, target_kind, target_id, kind, summary, detail_json, actor) VALUES (?, 'host', ?, 'drift', ?, ?, 'system')",
        )
        .bind(uuid::Uuid::new_v4())
        .bind(host_id)
        .bind(&report.summary)
        .bind(serde_json::json!({
            "expected": report.expected,
            "actual": report.actual,
        }))
        .execute(pool)
        .await;

        let hostname: String = sqlx::query_scalar("SELECT hostname FROM hosts WHERE id = ?")
            .bind(host_id)
            .fetch_one(pool)
            .await
            .unwrap_or_else(|_| host_id.to_string());
        let _ = sqlx::query(
            "INSERT INTO events (id, kind, message, resource_type, resource_id, payload) VALUES (?, 'firewall.drift', ?, 'host', ?, '{\"severity\":\"warning\"}')",
        )
        .bind(uuid::Uuid::new_v4())
        .bind(format!("Firewall drift on {hostname}: {}", report.summary))
        .bind(host_id)
        .execute(pool)
        .await;
    }

    drift::save_snapshot(pool, "host", host_id, &inv).await?;
    Ok(())
}

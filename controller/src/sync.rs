// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::time::Duration;

use uuid::Uuid;

use crate::engine::drs;
use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

pub fn spawn_periodic(state: AppState) {
    tokio::spawn(async move {
        loop {
            if !state.leader.is_leader() {
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }

            let interval_secs = drs::get_inventory_sync_interval_secs(&state.pool)
                .await
                .unwrap_or(30);

            if interval_secs > 0 {
                if let Err(e) = sync_all_hosts(&state).await {
                    tracing::warn!("periodic host sync: {e:#}");
                }
                if let Err(e) = sync_kubevirt_inventory(&state).await {
                    tracing::warn!("periodic kubevirt inventory: {e:#}");
                }
                tokio::time::sleep(Duration::from_secs(interval_secs as u64)).await;
            } else {
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        }
    });
}

async fn sync_all_hosts(state: &AppState) -> anyhow::Result<()> {
    let host_ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM hosts LIMIT 200")
        .fetch_all(&state.pool)
        .await?;

    for host_id in host_ids {
        if let Err(e) = enqueue_task(
            state,
            "host.inventory",
            serde_json::json!({ "host_id": host_id.to_string() }),
            Some("host"),
            Some(host_id),
            Some(host_id),
        )
        .await
        {
            tracing::warn!(host_id = %host_id, "host.inventory enqueue failed in sync: {}", e.message);
        }
    }
    Ok(())
}

async fn sync_kubevirt_inventory(state: &AppState) -> anyhow::Result<()> {
    let cluster_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM clusters ORDER BY created_at LIMIT 1")
            .fetch_optional(&state.pool)
            .await?;
    let Some(cluster_id) = cluster_id else {
        return Ok(());
    };
    if let Err(e) = enqueue_task(
        state,
        "kubevirt.inventory",
        serde_json::json!({ "cluster_id": cluster_id.to_string() }),
        Some("cluster"),
        Some(cluster_id),
        None,
    )
    .await
    {
        tracing::warn!(cluster_id = %cluster_id, "kubevirt.inventory enqueue failed in sync: {}", e.message);
    }
    Ok(())
}

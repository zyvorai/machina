// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::agent_client;

/// Import libvirt storage pools from a host into the platform `storage_pools` table.
pub async fn sync_host_storage(
    pool: &SqlitePool,
    host_id: Uuid,
    agent_addr: &str,
) -> anyhow::Result<usize> {
    let cluster_id: Uuid = sqlx::query_scalar("SELECT cluster_id FROM hosts WHERE id = ?")
        .bind(host_id)
        .fetch_one(pool)
        .await?;

    let mut client = agent_client::connect(agent_addr).await?;
    let list = agent_client::list_storage_pools(&mut client).await?;
    let mut imported = 0usize;

    for sp in list.pools {
        if sp.name.is_empty() {
            continue;
        }
        let path = if sp.path.is_empty() {
            None
        } else {
            Some(sp.path)
        };
        let capacity_gib = sp.capacity_gib.round() as i64;
        let used_gib = sp.used_gib.round() as i64;
        let backend = if sp.backend.is_empty() {
            "directory"
        } else {
            sp.backend.as_str()
        };
        let result = sqlx::query(
            "INSERT INTO storage_pools (id, cluster_id, name, storage_class, backend, path, capacity_gib, used_gib)
             VALUES (?, ?, ?, 'silver', ?, ?, ?, ?)
             ON CONFLICT (cluster_id, name) DO UPDATE SET
               backend = EXCLUDED.backend,
               path = COALESCE(EXCLUDED.path, storage_pools.path),
               capacity_gib = CASE WHEN EXCLUDED.capacity_gib > 0 THEN EXCLUDED.capacity_gib ELSE storage_pools.capacity_gib END,
               used_gib = CASE WHEN EXCLUDED.used_gib > 0 THEN EXCLUDED.used_gib ELSE storage_pools.used_gib END",
        )
        .bind(Uuid::new_v4())
        .bind(cluster_id)
        .bind(&sp.name)
        .bind(backend)
        .bind(&path)
        .bind(capacity_gib)
        .bind(used_gib)
        .execute(pool)
        .await?;
        if result.rows_affected() > 0 {
            imported += 1;
        }
    }
    Ok(imported)
}

pub async fn discover_all_online(pool: &SqlitePool) -> anyhow::Result<usize> {
    let hosts: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, agent_grpc_addr FROM hosts WHERE state = 'online' ORDER BY hostname LIMIT 200",
    )
    .fetch_all(pool)
    .await?;

    let mut total = 0usize;
    for (host_id, addr) in hosts {
        match sync_host_storage(pool, host_id, &addr).await {
            Ok(n) => total += n,
            Err(e) => tracing::warn!(%host_id, "storage discover failed: {e:#}"),
        }
    }
    Ok(total)
}

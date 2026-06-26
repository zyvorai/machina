// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::agent_client;

/// Import libvirt networks from a host into the platform `networks` table.
pub async fn sync_host_networks(
    pool: &SqlitePool,
    host_id: Uuid,
    agent_addr: &str,
) -> anyhow::Result<usize> {
    let cluster_id: Uuid = sqlx::query_scalar("SELECT cluster_id FROM hosts WHERE id = ?")
        .bind(host_id)
        .fetch_one(pool)
        .await?;

    let mut client = agent_client::connect(agent_addr).await?;
    let list = agent_client::list_networks(&mut client).await?;
    let mut imported = 0usize;

    for net in list.networks {
        if net.name.is_empty() {
            continue;
        }
        let bridge = if net.bridge.is_empty() {
            None
        } else {
            Some(net.bridge)
        };
        let result = sqlx::query(
            "INSERT INTO networks (id, cluster_id, name, backend, bridge)
             VALUES (?, ?, ?, 'linux-bridge', ?)
             ON CONFLICT (cluster_id, name) DO UPDATE SET
               bridge = COALESCE(EXCLUDED.bridge, networks.bridge)",
        )
        .bind(Uuid::new_v4())
        .bind(cluster_id)
        .bind(&net.name)
        .bind(&bridge)
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
        match sync_host_networks(pool, host_id, &addr).await {
            Ok(n) => total += n,
            Err(e) => tracing::warn!(%host_id, "network discover failed: {e:#}"),
        }
    }
    Ok(total)
}

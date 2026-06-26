// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::time::Duration;

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

#[allow(dead_code)]
const HEARTBEAT_STALE_SECS: i64 = 90;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(45));
        loop {
            interval.tick().await;
            if !state.leader.is_leader() {
                continue;
            }
            if let Err(e) = scan(&state).await {
                tracing::warn!("HA scan: {e:#}");
            }
        }
    });
}

pub async fn scan(state: &AppState) -> anyhow::Result<()> {
    mark_stale_hosts(state).await?;
    recover_vms(state).await?;
    Ok(())
}

async fn mark_stale_hosts(state: &AppState) -> anyhow::Result<()> {
    let pool = &state.pool;
    let stale: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, hostname FROM hosts
         WHERE state = 'online'
           AND last_heartbeat_at IS NOT NULL
           AND last_heartbeat_at < datetime('now', '-90 seconds')
         LIMIT 50",
    )
    .fetch_all(pool)
    .await?;

    for (id, hostname) in stale {
        let mut tx = pool.begin().await?;
        sqlx::query("UPDATE hosts SET state = 'offline' WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO ha_events (id, vm_id, host_id, action, message) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(Option::<Uuid>::None)
        .bind(Some(id))
        .bind("host.offline")
        .bind(format!("Host {hostname} marked offline"))
        .execute(&mut *tx)
        .await?;
        let needs_fence: bool = sqlx::query_scalar(
            "SELECT EXISTS(
               SELECT 1 FROM ha_policies hp
               JOIN vms v ON v.id = hp.vm_id
               WHERE v.host_id = ? AND hp.enabled = TRUE AND hp.fence_on_failure = TRUE
             )",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;

        if needs_fence {
            if let Err(e) = crate::engine::drs::fence_host(state, id).await {
                tracing::error!(host_id = %id, "HA: fence_host failed — split-brain risk if host is still running VMs: {e:#}");
            }
        }

        tracing::warn!("HA: host {hostname} ({id}) marked offline");
    }
    Ok(())
}

async fn recover_vms(state: &AppState) -> anyhow::Result<()> {
    let Some(ha_enabled): Option<bool> =
        sqlx::query_scalar("SELECT ha_enabled FROM clusters ORDER BY created_at LIMIT 1")
            .fetch_optional(&state.pool)
            .await?
    else {
        return Ok(());
    };
    if !ha_enabled {
        return Ok(());
    }

    let victims: Vec<(Uuid, String, Uuid, i32, i32, String)> = sqlx::query_as(
        "SELECT v.id, v.name, v.host_id, v.ha_recovery_count, hp.restart_attempts, v.desired_state
         FROM vms v
         JOIN ha_policies hp ON hp.vm_id = v.id AND hp.enabled = TRUE
         JOIN hosts h ON h.id = v.host_id
         WHERE h.state = 'offline'
         LIMIT 100",
    )
    .fetch_all(&state.pool)
    .await?;

    for (vm_id, vm_name, failed_host, recovery_count, max_attempts, desired) in victims {
        if recovery_count >= max_attempts {
            record_ha_event(
                &state.pool,
                Some(vm_id),
                Some(failed_host),
                "ha.exhausted",
                &format!("VM {vm_name} exceeded restart attempts"),
            )
            .await?;
            continue;
        }

        let dest: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM hosts
             WHERE id != ? AND state = 'online' AND maintenance_mode = FALSE
             ORDER BY vm_count, memory_used_mib LIMIT 1",
        )
        .bind(failed_host)
        .fetch_optional(&state.pool)
        .await?;

        let Some(dest_host) = dest else {
            record_ha_event(
                &state.pool,
                Some(vm_id),
                Some(failed_host),
                "ha.no_capacity",
                &format!("No online host to recover VM {vm_name}"),
            )
            .await?;
            continue;
        };

        let mut tx = state.pool.begin().await?;
        sqlx::query(
            "UPDATE vms SET host_id = ?, ha_recovery_count = ha_recovery_count + 1, updated_at = datetime('now')
             WHERE id = ?",
        )
        .bind(dest_host)
        .bind(vm_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO ha_events (id, vm_id, host_id, action, message) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(Some(vm_id))
        .bind(Some(failed_host))
        .bind("ha.recover")
        .bind(format!("Recovering VM {vm_name} onto host {dest_host}"))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        if let Err(e) = enqueue_task(
            state,
            "ha.recover",
            serde_json::json!({
                "vm_id": vm_id.to_string(),
                "host_id": dest_host.to_string(),
                "desired_state": desired,
            }),
            Some("vm"),
            Some(vm_id),
            Some(dest_host),
        )
        .await
        {
            tracing::error!(vm_id = %vm_id, dest_host = %dest_host, "HA: failed to enqueue ha.recover task: {e:?} — resetting host_id and recovery_count so HA can retry");
            if let Err(undo_err) = sqlx::query(
                "UPDATE vms SET host_id = ?, ha_recovery_count = ha_recovery_count - 1 WHERE id = ?",
            )
            .bind(failed_host)
            .bind(vm_id)
            .execute(&state.pool)
            .await
            {
                tracing::error!(vm_id = %vm_id, "HA: compensation update also failed: {undo_err:?} — VM may be stuck on wrong host");
            }
            continue;
        }
        state.emit_event(
            "ha.recover",
            format!("Recovering {vm_name} after host failure"),
        );
    }
    Ok(())
}

async fn record_ha_event(
    pool: &SqlitePool,
    vm_id: Option<Uuid>,
    host_id: Option<Uuid>,
    action: &str,
    message: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO ha_events (id, vm_id, host_id, action, message) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(vm_id)
    .bind(host_id)
    .bind(action)
    .bind(message)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct HaStatusRow {
    pub enabled_vms: i64,
    pub offline_hosts: i64,
    pub recent_events: i64,
}

pub async fn ha_status(pool: &SqlitePool) -> anyhow::Result<(HaStatusRow, Vec<HaEventRow>)> {
    let status: HaStatusRow = sqlx::query_as(
        "SELECT
           (SELECT COUNT(*) FROM ha_policies WHERE enabled = TRUE) AS enabled_vms,
           (SELECT COUNT(*) FROM hosts WHERE state = 'offline') AS offline_hosts,
           (SELECT COUNT(*) FROM ha_events WHERE created_at > datetime('now', '-24 hours')) AS recent_events",
    )
    .fetch_one(pool)
    .await?;

    let events = sqlx::query_as::<_, HaEventRow>(
        "SELECT id, vm_id, host_id, action, message,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
         FROM ha_events ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(pool)
    .await?;

    Ok((status, events))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct HaEventRow {
    pub id: Uuid,
    pub vm_id: Option<Uuid>,
    pub host_id: Option<Uuid>,
    pub action: String,
    pub message: String,
    pub created_at: DateTime<Utc>,
}

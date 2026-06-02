// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::time::Duration;

use uuid::Uuid;

use crate::engine::vm_lifecycle;
use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        loop {
            if !state.leader.is_leader() {
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }
            if let Err(e) = reconcile_once(&state).await {
                tracing::warn!("vm reconcile loop: {e:#}");
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

async fn reconcile_once(state: &AppState) -> anyhow::Result<()> {
    let rows: Vec<(Uuid, String, String, String)> = sqlx::query_as(
        "SELECT id, name, desired_state, observed_state FROM vms
         WHERE desired_state != observed_state
           AND observed_state NOT IN ('missing', 'unknown')
           AND inventory_source = 'libvirt'
           AND lifecycle_phase NOT IN ('creating', 'migrating', 'deleting', 'snapshotting', 'backing_up')
         LIMIT 20",
    )
    .fetch_all(&state.pool)
    .await?;

    for (vm_id, name, desired, observed) in rows {
        tracing::info!("reconcile VM {name}: desired={desired} observed={observed}");
        let host_id: Option<Uuid> =
            sqlx::query_scalar("SELECT host_id FROM vms WHERE id = $1")
                .bind(vm_id)
                .fetch_optional(&state.pool)
                .await?;

        let Some(host_id) = host_id else {
            continue;
        };

        let action = if desired == "running" && !matches!(observed.as_str(), "running" | "blocked") {
            "start"
        } else if desired == "stopped" && matches!(observed.as_str(), "running" | "blocked" | "paused") {
            "stop"
        } else {
            continue;
        };

        let _ = enqueue_task(
            &state,
            "vm.power",
            serde_json::json!({
                "vm_id": vm_id.to_string(),
                "action": action,
                "reconcile": true,
            }),
            Some("vm"),
            Some(vm_id),
            Some(host_id),
        )
        .await;

        let _ = vm_lifecycle::sync_phase_from_observed(&state.pool, vm_id).await;
    }
    Ok(())
}

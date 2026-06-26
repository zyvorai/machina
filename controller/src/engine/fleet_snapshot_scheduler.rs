// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            if let Err(e) = tick(&state).await {
                tracing::warn!("fleet snapshot scheduler: {e:#}");
            }
        }
    });
}

async fn tick(state: &AppState) -> anyhow::Result<()> {
    let rows: Vec<(Uuid, String, String, String, bool, bool, i32)> = sqlx::query_as(
        "SELECT id, name, project, tag_filter, disk_only, quiesce, retain_count
         FROM fleet_snapshot_schedules
         WHERE enabled = TRUE
           AND (last_run_at IS NULL OR last_run_at < datetime('now', '-23 hours'))",
    )
    .fetch_all(&state.pool)
    .await?;

    for (sched_id, _name, project, tag_filter, disk_only, quiesce, _retain) in rows {
        enqueue_snapshots_for_schedule(
            &state.pool,
            state,
            sched_id,
            &project,
            &tag_filter,
            disk_only,
            quiesce,
        )
        .await?;
        sqlx::query("UPDATE fleet_snapshot_schedules SET last_run_at = datetime('now') WHERE id = ?")
            .bind(sched_id)
            .execute(&state.pool)
            .await?;
    }
    Ok(())
}

async fn enqueue_snapshots_for_schedule(
    pool: &SqlitePool,
    app: &AppState,
    _sched_id: Uuid,
    project: &str,
    tag_filter: &str,
    disk_only: bool,
    quiesce: bool,
) -> anyhow::Result<()> {
    let vms: Vec<(Uuid, String, Option<Uuid>)> = if !project.is_empty() && !tag_filter.is_empty() {
        sqlx::query_as(
            "SELECT id, name, host_id FROM vms
             WHERE managed = TRUE AND COALESCE(inventory_source, 'libvirt') = 'libvirt'
               AND lifecycle_phase NOT IN ('retired', 'deleting')
               AND project = ? AND EXISTS (SELECT 1 FROM json_each(COALESCE(tags,'[]')) WHERE value = ?)",
        )
        .bind(project)
        .bind(tag_filter)
        .fetch_all(pool)
        .await?
    } else if !project.is_empty() {
        sqlx::query_as(
            "SELECT id, name, host_id FROM vms
             WHERE managed = TRUE AND COALESCE(inventory_source, 'libvirt') = 'libvirt'
               AND lifecycle_phase NOT IN ('retired', 'deleting')
               AND project = ?",
        )
        .bind(project)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id, name, host_id FROM vms
             WHERE managed = TRUE AND COALESCE(inventory_source, 'libvirt') = 'libvirt'
               AND lifecycle_phase NOT IN ('retired', 'deleting')",
        )
        .fetch_all(pool)
        .await?
    };

    let stamp = chrono::Utc::now().format("%Y%m%d");
    for (vm_id, vm_name, host_id) in vms {
        let snap_name = format!("fleet-{stamp}");
        let record_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO snapshot_records (id, vm_id, name, status) VALUES (?, ?, ?, 'pending')",
        )
        .bind(record_id)
        .bind(vm_id)
        .bind(&snap_name)
        .execute(pool)
        .await?;
        if let Err(e) = enqueue_task(
            app,
            "vm.snapshot",
            serde_json::json!({
                "vm_id": vm_id.to_string(),
                "snapshot_id": record_id.to_string(),
                "name": snap_name,
                "description": format!("Fleet scheduled snapshot for {vm_name}"),
                "disk_only": disk_only,
                "quiesce": quiesce,
                "storage_mode": "",
            }),
            Some("vm"),
            Some(vm_id),
            host_id,
        )
        .await
        {
            let _ = sqlx::query("DELETE FROM snapshot_records WHERE id = ?")
                .bind(record_id)
                .execute(pool)
                .await;
            return Err(anyhow::anyhow!("enqueue vm.snapshot: {}", e.message));
        }
    }
    Ok(())
}

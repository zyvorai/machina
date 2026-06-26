// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::SqlitePool;
use uuid::Uuid;

pub const PHASE_IDLE: &str = "idle";
pub const PHASE_CREATING: &str = "creating";
pub const PHASE_STARTING: &str = "starting";
pub const PHASE_RUNNING: &str = "running";
pub const PHASE_STOPPING: &str = "stopping";
pub const PHASE_STOPPED: &str = "stopped";
pub const PHASE_MIGRATING: &str = "migrating";
pub const PHASE_SNAPSHOTTING: &str = "snapshotting";
pub const PHASE_BACKING_UP: &str = "backing_up";
pub const PHASE_DELETING: &str = "deleting";
pub const PHASE_ERROR: &str = "error";
pub const PHASE_RETIRED: &str = "retired";

pub fn phase_for_operation(op: &str) -> &'static str {
    match op {
        "vm.apply" => PHASE_CREATING,
        "vm.power" => PHASE_STARTING,
        "vm.migrate" => PHASE_MIGRATING,
        "vm.snapshot" | "vm.snapshot.revert" | "vm.snapshot.clone" => PHASE_SNAPSHOTTING,
        "vm.backup" | "vm.backup.restore" => PHASE_BACKING_UP,
        "vm.delete" => PHASE_DELETING,
        _ => PHASE_IDLE,
    }
}

pub async fn set_vm_phase(pool: &SqlitePool, vm_id: Uuid, phase: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE vms SET lifecycle_phase = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(phase)
        .bind(vm_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_vm_phase_clear_error(
    pool: &SqlitePool,
    vm_id: Uuid,
    phase: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE vms SET lifecycle_phase = ?, last_error = '', updated_at = datetime('now') WHERE id = ?",
    )
    .bind(phase)
    .bind(vm_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_vm_error(pool: &SqlitePool, vm_id: Uuid, message: &str) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE vms SET lifecycle_phase = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(PHASE_ERROR)
    .bind(message)
    .bind(vm_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn sync_phase_from_observed(pool: &SqlitePool, vm_id: Uuid) -> anyhow::Result<()> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT desired_state, observed_state FROM vms WHERE id = ?")
            .bind(vm_id)
            .fetch_optional(pool)
            .await?;
    let Some((desired, observed)) = row else {
        return Ok(());
    };
    let phase = match (desired.as_str(), observed.as_str()) {
        ("running", "running") | ("running", "blocked") => PHASE_RUNNING,
        ("running", _) if !matches!(observed.as_str(), "running" | "blocked") => PHASE_STARTING,
        ("stopped", "shutoff") | ("stopped", "stopped") => PHASE_STOPPED,
        ("stopped", _) => PHASE_STOPPING,
        (_, "running") | (_, "blocked") => PHASE_RUNNING,
        _ => PHASE_IDLE,
    };
    set_vm_phase(pool, vm_id, phase).await
}

// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::collections::HashSet;

use machina_spec::VirtualMachine;
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::agent_client;
use crate::config::ControllerConfig;
use crate::engine::vm_lifecycle;
use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;
use crate::tasks::TaskMessage;

pub fn spawn(state: AppState, mut rx: mpsc::UnboundedReceiver<TaskMessage>) {
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Err(e) = process_one(&state, &msg).await {
                tracing::error!(task_id = %msg.task_id, op = %msg.operation, "task failed: {e:#}");
                on_task_failure(&state, &msg, &e.to_string()).await;
            }
        }
    });
}

async fn process_one(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    if !claim_task(&state.pool, msg.task_id).await? {
        tracing::debug!(task_id = %msg.task_id, "task already claimed; skipping");
        return Ok(());
    }
    match msg.operation.as_str() {
        "vm.apply" => vm_apply(state, msg).await?,
        "vm.power" => vm_power(state, msg).await?,
        "vm.delete" => vm_delete(state, msg).await?,
        "vm.migrate" => vm_migrate(state, msg).await?,
        "vm.clone" => vm_clone(state, msg).await?,
        "host.inventory" => host_inventory(state, msg).await?,
        "kubevirt.inventory" => kubevirt_inventory_task(state, msg).await?,
        "host.maintenance" => host_maintenance(state, msg).await?,
        "host.validate" => host_validate_task(state, msg).await?,
        "host.tetragon.install" => host_tetragon_install(state, msg).await?,
        "k8s.tetragon.install" => k8s_tetragon_install(state, msg).await?,
        "host.enforcement.apply" => host_enforcement_apply(state, msg).await?,
        "host.linux.package_upgrade" => host_linux_package_upgrade(state, msg).await?,
        "host.linux.reboot" => host_linux_reboot(state, msg).await?,
        "host.agent.upgrade" => host_agent_upgrade(state, msg).await?,
        "storage.pool.provision" => storage_pool_provision(state, msg).await?,
        "network.provision" => network_provision(state, msg).await?,
        "ha.recover" => ha_recover(state, msg).await?,
        "vm.snapshot" => vm_snapshot(state, msg).await?,
        "vm.snapshot.delete" => vm_snapshot_delete(state, msg).await?,
        "vm.snapshot.revert" => vm_snapshot_revert(state, msg).await?,
        "vm.snapshot.clone" => vm_snapshot_clone(state, msg).await?,
        "vm.backup" => vm_backup(state, msg).await?,
        "vm.backup.restore" => vm_backup_restore(state, msg).await?,
        "vm.disk.attach" => vm_disk_attach(state, msg).await?,
        "vm.disk.detach" => vm_disk_detach(state, msg).await?,
        "vm.disk.resize" => vm_disk_resize(state, msg).await?,
        "vm.nic.attach" => vm_nic_attach(state, msg).await?,
        "vm.nic.detach" => vm_nic_detach(state, msg).await?,
        "vm.autostart" => vm_autostart(state, msg).await?,
        "vm.resize" => vm_resize(state, msg).await?,
        "vm.guest_tools.install" => vm_guest_tools_install(state, msg).await?,
        "vm.install" => vm_install(state, msg).await?,
        "templates.prefetch_missing" => templates_prefetch_missing(state, msg).await?,
        other => anyhow::bail!("unknown operation: {other}"),
    }
    if let Some(vm_id) = vm_id_from_payload(msg) {
        let _ = vm_lifecycle::sync_phase_from_observed(&state.pool, vm_id).await;
    }
    mark_task_completed(&state.pool, msg.task_id).await?;
    Ok(())
}

async fn vm_apply(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    vm_lifecycle::set_vm_phase_clear_error(&state.pool, vm_id, vm_lifecycle::PHASE_CREATING)
        .await?;
    let host_id: Uuid = msg.payload["host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;

    let row: (String, serde_json::Value) =
        sqlx::query_as("SELECT name, spec_json FROM vms WHERE id = ?")
            .bind(vm_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let vm: VirtualMachine = serde_json::from_value(row.1)?;
    let disk_path = disk_path_for(&state.config, &row.0);

    let template_source = if let Some(ref tr) = vm.spec.template_ref {
        let disk = crate::engine::template::resolve_template_disk(&state.pool, tr).await?;
        let (tname, tver) = crate::engine::template::parse_template_ref(tr);
        update_task_progress(
            &state.pool,
            msg.task_id,
            10,
            "Checking golden image on host",
        )
        .await?;
        if crate::engine::template_image_fetch::ensure_template_disk(
            &state.pool,
            host_id,
            &disk,
            &tname,
            &tver,
        )
        .await?
        {
            update_task_progress(&state.pool, msg.task_id, 35, "Downloaded golden image").await?;
        }
        Some(disk)
    } else {
        None
    };

    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    let spec_json = serde_json::to_string(&vm)?;
    let resp = agent_client::apply_vm(
        &mut client,
        &spec_json,
        &disk_path,
        template_source.as_deref(),
        "",
        "",
        "",
    )
    .await?;

    let desired_state: String = sqlx::query_scalar("SELECT desired_state FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("vm {} not found after apply", vm_id))?;

    let needs_start = desired_state == "running";
    if needs_start {
        vm_lifecycle::set_vm_phase(&state.pool, vm_id, vm_lifecycle::PHASE_STARTING).await?;
        agent_client::vm_power(&mut client, &row.0, "start", None).await?;
    }

    {
        let mut tx = state.pool.begin().await?;
        sqlx::query(
            "UPDATE vms SET uuid = ?, observed_state = 'defined', updated_at = datetime('now') WHERE id = ?",
        )
        .bind(&resp.uuid)
        .bind(vm_id)
        .execute(&mut *tx)
        .await?;
        if needs_start {
            sqlx::query(
                "UPDATE vms SET observed_state = 'running', updated_at = datetime('now') WHERE id = ?",
            )
            .bind(vm_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
    }

    vm_lifecycle::sync_phase_from_observed(&state.pool, vm_id).await?;

    state.emit_event("vm.apply", format!("VM {} applied on host", row.0));

    if let Err(e) = enqueue_task(
        state,
        "vm.guest_tools.install",
        serde_json::json!({ "vm_id": vm_id.to_string() }),
        Some("vm"),
        Some(vm_id),
        Some(host_id),
    )
    .await
    {
        tracing::warn!(vm_id = %vm_id, "guest_tools.install enqueue failed: {e:?}");
    }

    update_task_progress(&state.pool, msg.task_id, 100, "VM defined").await?;
    Ok(())
}

async fn vm_power(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let action = msg.payload["action"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("action missing"))?
        .to_string();
    let power_mode = msg.payload["mode"].as_str().filter(|s| !s.is_empty());

    let phase = match action.as_str() {
        "start" | "reboot" => vm_lifecycle::PHASE_STARTING,
        "stop" => vm_lifecycle::PHASE_STOPPING,
        _ => vm_lifecycle::PHASE_IDLE,
    };
    vm_lifecycle::set_vm_phase_clear_error(&state.pool, vm_id, phase).await?;

    let row: (String, Option<Uuid>) =
        sqlx::query_as("SELECT name, host_id FROM vms WHERE id = ?")
            .bind(vm_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    let resp = agent_client::vm_power(&mut client, &row.0, &action, power_mode).await?;

    let desired = match action.as_str() {
        "start" | "resume" | "reboot" | "reset" => "running",
        "stop" | "shutdown" => "stopped",
        "pause" => "paused",
        _ => "running",
    };
    sqlx::query(
        "UPDATE vms SET desired_state = ?, observed_state = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(desired)
    .bind(&resp.state)
    .bind(vm_id)
    .execute(&state.pool)
    .await?;

    // Derive lifecycle_phase from the new desired/observed states so the VM
    // doesn't stay stuck in "starting" or "stopping" after the action completes.
    vm_lifecycle::sync_phase_from_observed(&state.pool, vm_id).await?;

    state.emit_event("vm.power", format!("VM {} -> {}", row.0, resp.state));
    update_task_progress(&state.pool, msg.task_id, 100, &resp.state).await?;
    Ok(())
}

async fn vm_install(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    vm_lifecycle::set_vm_phase_clear_error(&state.pool, vm_id, vm_lifecycle::PHASE_STARTING)
        .await?;

    let row: (String, String, Option<Uuid>) =
        sqlx::query_as("SELECT name, spec_json, host_id FROM vms WHERE id = ?")
            .bind(vm_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.2.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;
    let vm: machina_spec::VirtualMachine = serde_json::from_str(&row.1)?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::vm_libvirt_invoke(
        &mut client,
        &row.0,
        "domain.install",
        &serde_json::json!({ "spec": vm }),
    )
    .await?;

    sqlx::query(
        "UPDATE vms SET desired_state = 'running', observed_state = 'defined', updated_at = datetime('now') WHERE id = ?",
    )
    .bind(vm_id)
    .execute(&state.pool)
    .await?;

    state.emit_event("vm.install", format!("VM {} install started", row.0));
    update_task_progress(&state.pool, msg.task_id, 100, "install started").await?;
    Ok(())
}

async fn vm_delete(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    vm_lifecycle::set_vm_phase(&state.pool, vm_id, vm_lifecycle::PHASE_DELETING).await?;

    let row: (String, Option<Uuid>, String, Option<String>, String) = sqlx::query_as(
        "SELECT name, host_id, COALESCE(inventory_source, 'libvirt'), k8s_namespace, observed_state FROM vms WHERE id = ?",
    )
    .bind(vm_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;

    if row.4 == "missing" {
        // Domain already absent from hypervisor inventory — drop the stale DB row only.
    } else if row.2 == "kubevirt" {
        let ns = row.3.unwrap_or_else(|| "default".into());
        crate::engine::kubevirt_inventory::delete_kubevirt_vm(
            &state.config.daemon_base_url,
            &ns,
            &row.0,
        )
        .await?;
    } else if let Some(host_id) = row.1 {
        let agent_addr = host_agent_addr(&state.pool, host_id).await?;
        let mut client = agent_client::connect(&agent_addr).await?;
        agent_client::delete_vm(&mut client, &row.0).await?;
    } else {
        // No host assigned — inventory row only.
    }

    sqlx::query("DELETE FROM vms WHERE id = ?")
        .bind(vm_id)
        .execute(&state.pool)
        .await?;
    state.emit_event("vm.delete", format!("VM {} deleted", row.0));
    update_task_progress(&state.pool, msg.task_id, 100, "deleted").await?;
    Ok(())
}

async fn host_inventory(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let host_id: Uuid = msg.payload["host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;

    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    let hb = agent_client::heartbeat(&mut client, &host_id.to_string()).await?;
    let list = agent_client::list_vms(&mut client).await?;
    let info = agent_client::get_host_info(&mut client).await.ok();

    sqlx::query(
        "UPDATE hosts SET vm_count = ?, state = ?, last_heartbeat_at = datetime('now'),
         cpu_percent = ?, memory_used_mib = ?, memory_total_mib = ?,
         cpu_model = COALESCE(?, cpu_model),
         libvirt_version = COALESCE(?, libvirt_version),
         qemu_version = COALESCE(?, qemu_version)
         WHERE id = ?",
    )
    .bind(list.vms.len() as i32)
    .bind(&hb.state)
    .bind(hb.cpu_percent)
    .bind(hb.memory_used_mib as i64)
    .bind(hb.memory_total_mib as i64)
    .bind(
        info.as_ref()
            .map(|i| i.cpu_model.as_str())
            .filter(|s| !s.is_empty()),
    )
    .bind(
        info.as_ref()
            .map(|i| i.libvirt_version.as_str())
            .filter(|s| !s.is_empty()),
    )
    .bind(
        info.as_ref()
            .map(|i| i.qemu_version.as_str())
            .filter(|s| !s.is_empty()),
    )
    .bind(host_id)
    .execute(&state.pool)
    .await?;

    let cluster_id: Uuid = sqlx::query_scalar("SELECT cluster_id FROM hosts WHERE id = ?")
        .bind(host_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("host {} not found or has no cluster", host_id))?;

    let mut seen_names: HashSet<String> = HashSet::new();

    for vm in list.vms {
        seen_names.insert(vm.name.clone());
        let existing: Option<(Uuid, bool)> = sqlx::query_as(
            "SELECT id, managed FROM vms
             WHERE cluster_id = ? AND name = ? AND inventory_source = 'libvirt'",
        )
        .bind(cluster_id)
        .bind(&vm.name)
        .fetch_optional(&state.pool)
        .await?;

        if let Some((id, _managed)) = existing {
            sqlx::query(
                "UPDATE vms SET host_id = ?, observed_state = ?, uuid = COALESCE(NULLIF(?, ''), uuid),
                 vcpus = ?, memory_mib = ?, guest_ip = CASE WHEN ? != '' THEN ? ELSE guest_ip END,
                 last_seen_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
            )
            .bind(host_id)
            .bind(&vm.state)
            .bind(&vm.uuid)
            .bind(vm.vcpus as i32)
            .bind(vm.memory_mb as i64)
            .bind(&vm.guest_ip)
            .bind(&vm.guest_ip)
            .bind(id)
            .execute(&state.pool)
            .await?;

            let metrics_result = sqlx::query(
                "INSERT INTO vm_metrics (vm_id, cpu_percent, memory_used_mib, disk_read_iops, disk_write_iops, updated_at)
                 VALUES (?, ?, ?, ?, ?, datetime('now'))
                 ON CONFLICT (vm_id) DO UPDATE SET
                   cpu_percent = EXCLUDED.cpu_percent,
                   memory_used_mib = EXCLUDED.memory_used_mib,
                   disk_read_iops = EXCLUDED.disk_read_iops,
                   disk_write_iops = EXCLUDED.disk_write_iops,
                   updated_at = datetime('now')",
            )
            .bind(id)
            .bind(vm.cpu_percent)
            .bind(vm.memory_used_mib as i64)
            .bind(vm.disk_read_iops as i64)
            .bind(vm.disk_write_iops as i64)
            .execute(&state.pool)
            .await;
            if let Err(e) = metrics_result {
                tracing::warn!(vm_id = %id, "vm_metrics upsert failed: {e:#}");
            }

            if vm.state == "running" {
                crate::engine::vm_health::sync_guest_tools(&state.pool, id, &vm.name, host_id)
                    .await;
            }
        } else {
            let new_id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO vms (id, cluster_id, host_id, name, spec_json, desired_state, observed_state,
                 uuid, vcpus, memory_mib, managed, lifecycle_phase)
                 VALUES (?, ?, ?, ?, '{}', 'unknown', ?, ?, ?, ?, FALSE, 'idle')",
            )
            .bind(new_id)
            .bind(cluster_id)
            .bind(host_id)
            .bind(&vm.name)
            .bind(&vm.state)
            .bind(&vm.uuid)
            .bind(vm.vcpus as i32)
            .bind(vm.memory_mb as i64)
            .execute(&state.pool)
            .await?;
            state.emit_event(
                "vm.discovered",
                format!("Discovered unmanaged VM '{}' on host", vm.name),
            );
        }
    }

    crate::engine::vm_inventory::reconcile_libvirt_host(state, host_id, cluster_id, &seen_names)
        .await?;

    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    if let Err(e) =
        crate::engine::network_sync::sync_host_networks(&state.pool, host_id, &agent_addr).await
    {
        tracing::warn!(%host_id, "network sync during inventory: {e:#}");
    }
    if let Err(e) =
        crate::engine::storage_sync::sync_host_storage(&state.pool, host_id, &agent_addr).await
    {
        tracing::warn!(%host_id, "storage sync during inventory: {e:#}");
    }
    if let Err(e) = crate::engine::zeus_firewall::sync::sync_host_posture(
        &state.pool,
        &state.config,
        host_id,
        &agent_addr,
    )
    .await
    {
        tracing::warn!(%host_id, "firewall posture sync during inventory: {e:#}");
    }
    if let Err(e) = crate::engine::packetwolf_sync::sync_host_security_bundle(
        &state.config,
        &state.pool,
        host_id,
        &agent_addr,
    )
    .await
    {
        tracing::warn!(%host_id, "security bundle sync during inventory: {e:#}");
    }

    update_task_progress(&state.pool, msg.task_id, 100, "inventory synced").await?;
    Ok(())
}

async fn vm_migrate(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let dest_host_id: Uuid = msg.payload["dest_host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("dest_host_id missing"))?;
    let live = msg.payload["live"].as_bool().unwrap_or(true);
    let bandwidth_mib = msg.payload["bandwidth_mib"].as_u64().unwrap_or(0);
    let postcopy = msg.payload["postcopy"].as_bool().unwrap_or(false);
    let undefine_source = msg.payload["undefine_source"].as_bool().unwrap_or(false);
    let tunnelled = msg.payload["tunnelled"].as_bool().unwrap_or(false);
    let migrate_disks: Vec<String> = msg.payload["migrate_disks"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let disks_uri = msg.payload["disks_uri"].as_str().map(str::to_string);
    let copy_storage = msg.payload["copy_storage"].as_bool().unwrap_or(false);

    vm_lifecycle::set_vm_phase(&state.pool, vm_id, vm_lifecycle::PHASE_MIGRATING).await?;

    let pre = crate::engine::migrate_precheck::run_migrate_precheck(
        &state.pool,
        vm_id,
        dest_host_id,
        live,
    )
    .await?;
    if !pre.ok {
        let msg = pre
            .checks
            .iter()
            .filter(|c| !c.passed)
            .map(|c| format!("{}: {}", c.name, c.message))
            .collect::<Vec<_>>()
            .join("; ");
        anyhow::bail!("migration pre-check failed: {msg}");
    }

    let row: (String, Option<Uuid>) =
        sqlx::query_as("SELECT name, host_id FROM vms WHERE id = ?")
            .bind(vm_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let source_host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;

    let dest_uri: String =
        sqlx::query_scalar("SELECT COALESCE(NULLIF(libvirt_uri, ''), ?) FROM hosts WHERE id = ?")
            .bind(&state.config.default_libvirt_uri)
            .bind(dest_host_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("destination host {} not found", dest_host_id))?;

    let agent_addr = host_agent_addr(&state.pool, source_host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::migrate_vm(
        &mut client,
        &row.0,
        &dest_uri,
        live,
        bandwidth_mib,
        postcopy,
        undefine_source,
        tunnelled,
        migrate_disks,
        disks_uri,
        copy_storage,
    )
    .await?;

    {
        let mut tx = state.pool.begin().await?;
        sqlx::query("UPDATE vms SET host_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(dest_host_id)
            .bind(vm_id)
            .execute(&mut *tx)
            .await?;
        let job_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO migration_jobs (id, vm_id, source_host_id, dest_host_id, live, status, progress, precheck)
             VALUES (?, ?, ?, ?, ?, 'completed', 100, ?)",
        )
        .bind(job_id)
        .bind(vm_id)
        .bind(source_host_id)
        .bind(dest_host_id)
        .bind(live)
        .bind(serde_json::to_value(&pre)?)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }

    vm_lifecycle::sync_phase_from_observed(&state.pool, vm_id).await?;

    state.emit_event("vm.migrate", format!("VM {} migrated", row.0));
    update_task_progress(&state.pool, msg.task_id, 100, "migrated").await?;
    Ok(())
}

async fn vm_clone(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let new_name = msg.payload["new_name"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("new_name missing"))?
        .to_string();
    let clone_mode = msg.payload["clone_mode"]
        .as_str()
        .unwrap_or("linked")
        .to_string();

    let row: (String, Option<Uuid>, Uuid, serde_json::Value, i32, i64) = sqlx::query_as(
        "SELECT name, host_id, cluster_id, spec_json, vcpus, memory_mib FROM vms WHERE id = ?",
    )
    .bind(vm_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;

    // Insert the DB record first so a hypervisor clone success always has a matching row.
    // The row starts with a placeholder uuid that is updated once the hypervisor responds.
    let new_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO vms (id, cluster_id, host_id, name, spec_json, desired_state, observed_state, vcpus, memory_mib)
         VALUES (?, ?, ?, ?, ?, 'stopped', 'creating', ?, ?)",
    )
    .bind(new_id)
    .bind(row.2)
    .bind(host_id)
    .bind(&new_name)
    .bind(&row.3)
    .bind(row.4)
    .bind(row.5)
    .execute(&state.pool)
    .await?;

    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    let resp = agent_client::clone_vm(&mut client, &row.0, &new_name, &clone_mode).await?;

    sqlx::query("UPDATE vms SET uuid = ?, observed_state = 'defined' WHERE id = ?")
        .bind(&resp.uuid)
        .bind(new_id)
        .execute(&state.pool)
        .await?;

    state.emit_event("vm.clone", format!("Cloned {} -> {}", row.0, new_name));
    update_task_progress(&state.pool, msg.task_id, 100, "cloned").await?;
    Ok(())
}

async fn host_maintenance(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let host_id: Uuid = msg.payload["host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;
    let action = msg.payload["action"]
        .as_str()
        .unwrap_or("enter")
        .to_string();
    let evacuate = msg.payload["evacuate"].as_bool().unwrap_or(true);

    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::maintenance(&mut client, &action, evacuate).await?;

    if action == "enter" {
        sqlx::query("UPDATE hosts SET maintenance_mode = TRUE WHERE id = ?")
            .bind(host_id)
            .execute(&state.pool)
            .await?;

        if evacuate {
            let vm_ids: Vec<(Uuid, String)> = sqlx::query_as(
                "SELECT id, name FROM vms WHERE host_id = ? AND desired_state = 'running'",
            )
            .bind(host_id)
            .fetch_all(&state.pool)
            .await?;

            let dest: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM hosts WHERE id != ? AND maintenance_mode = FALSE ORDER BY vm_count LIMIT 1",
            )
            .bind(host_id)
            .fetch_optional(&state.pool)
            .await?;

            if let Some(dest_id) = dest {
                for (vm_id, _name) in vm_ids {
                    if let Err(e) = enqueue_task(
                        state,
                        "vm.migrate",
                        serde_json::json!({
                            "vm_id": vm_id.to_string(),
                            "dest_host_id": dest_id.to_string(),
                            "live": true,
                        }),
                        Some("vm"),
                        Some(vm_id),
                        Some(host_id),
                    )
                    .await
                    {
                        tracing::warn!(vm_id = %vm_id, host_id = %host_id, "vm.migrate enqueue failed during maintenance evacuation: {e:?}");
                    }
                }
            }
        }
    } else {
        sqlx::query("UPDATE hosts SET maintenance_mode = FALSE WHERE id = ?")
            .bind(host_id)
            .execute(&state.pool)
            .await?;
    }

    update_task_progress(&state.pool, msg.task_id, 100, &action).await?;
    Ok(())
}

async fn ha_recover(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let host_id: Uuid = msg.payload["host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;
    let desired = msg.payload["desired_state"].as_str().unwrap_or("running");

    let row: (String, serde_json::Value) =
        sqlx::query_as("SELECT name, spec_json FROM vms WHERE id = ?")
            .bind(vm_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let vm: VirtualMachine = serde_json::from_value(row.1)?;
    let disk_path = disk_path_for(&state.config, &row.0);
    let template_source = if let Some(ref tr) = vm.spec.template_ref {
        let disk = crate::engine::template::resolve_template_disk(&state.pool, tr).await?;
        let (tname, tver) = crate::engine::template::parse_template_ref(tr);
        crate::engine::template_image_fetch::ensure_template_disk(
            &state.pool,
            host_id,
            &disk,
            &tname,
            &tver,
        )
        .await?;
        Some(disk)
    } else {
        None
    };

    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    let spec_json = serde_json::to_string(&vm)?;
    let resp = agent_client::apply_vm(
        &mut client,
        &spec_json,
        &disk_path,
        template_source.as_deref(),
        "",
        "",
        "",
    )
    .await?;

    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "UPDATE vms SET uuid = ?, host_id = ?, observed_state = 'defined', updated_at = datetime('now') WHERE id = ?",
    )
    .bind(&resp.uuid)
    .bind(host_id)
    .bind(vm_id)
    .execute(&mut *tx)
    .await?;

    if desired == "running" {
        agent_client::vm_power(&mut client, &row.0, "start", None).await?;
        if let Err(e) = sqlx::query("UPDATE vms SET observed_state = 'running' WHERE id = ?")
            .bind(vm_id)
            .execute(&mut *tx)
            .await
        {
            tracing::warn!(vm_id = %vm_id, "ha_recover: failed to set observed_state=running after power-on: {e:#}");
        }
    }
    tx.commit().await?;

    state.emit_event("ha.recover", format!("VM {} recovered on new host", row.0));
    update_task_progress(&state.pool, msg.task_id, 100, "recovered").await?;
    Ok(())
}

async fn host_agent_addr(pool: &SqlitePool, host_id: Uuid) -> anyhow::Result<String> {
    let addr: String = sqlx::query_scalar("SELECT agent_grpc_addr FROM hosts WHERE id = ?")
        .bind(host_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("host {} not found", host_id))?;
    Ok(addr)
}

fn disk_path_for(cfg: &ControllerConfig, name: &str) -> String {
    cfg.disk_image_dir
        .join(format!("{name}.qcow2"))
        .to_string_lossy()
        .into_owned()
}

async fn claim_task(pool: &SqlitePool, id: Uuid) -> anyhow::Result<bool> {
    let claimed: Option<Uuid> = sqlx::query_scalar(
        "UPDATE tasks SET status = 'running', updated_at = datetime('now')
         WHERE id = ? AND status = 'pending'
         RETURNING id",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(claimed.is_some())
}

async fn mark_task_completed(pool: &SqlitePool, id: Uuid) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE tasks SET status = 'completed', progress = 100, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn mark_task_failed(pool: &SqlitePool, id: Uuid, message: &str) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE tasks SET status = 'failed', message = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(message)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn update_task_progress(
    pool: &SqlitePool,
    id: Uuid,
    progress: i16,
    message: &str,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE tasks SET progress = ?, message = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(progress)
        .bind(message)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

async fn vm_snapshot(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let record_id: Uuid = msg.payload["snapshot_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("snapshot_id missing"))?;
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    vm_lifecycle::set_vm_phase(&state.pool, vm_id, vm_lifecycle::PHASE_SNAPSHOTTING).await?;

    let row: (String, Option<Uuid>, String) = sqlx::query_as(
        "SELECT v.name, v.host_id, s.name FROM vms v JOIN snapshot_records s ON s.id = ? AND s.vm_id = v.id",
    )
    .bind(record_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("snapshot record {} not found or vm mismatch", record_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm has no host"))?;

    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    let snap_name = msg.payload["name"].as_str().unwrap_or(&row.2).to_string();
    let description = msg.payload["description"]
        .as_str()
        .unwrap_or("machina platform snapshot")
        .to_string();
    let disk_only = msg.payload["disk_only"].as_bool().unwrap_or(false);
    let quiesce = msg.payload["quiesce"].as_bool().unwrap_or(false);
    let storage_mode = msg.payload["storage_mode"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let resp = agent_client::create_snapshot(
        &mut client,
        &row.0,
        &snap_name,
        &description,
        disk_only,
        quiesce,
        &storage_mode,
    )
    .await?;

    if resp.ok {
        sqlx::query(
            "UPDATE snapshot_records SET status = 'completed', message = ?, snapshot_path = ? WHERE id = ?",
        )
        .bind(&resp.message)
        .bind(&resp.disk_path)
        .bind(record_id)
            .execute(&state.pool)
            .await?;
        state.emit_event("vm.snapshot", format!("Snapshot {} on {}", row.2, row.0));
    } else {
        sqlx::query("UPDATE snapshot_records SET status = 'failed', message = ? WHERE id = ?")
            .bind(&resp.message)
            .bind(record_id)
            .execute(&state.pool)
            .await?;
        anyhow::bail!("snapshot failed: {}", resp.message);
    }
    update_task_progress(&state.pool, msg.task_id, 100, "snapshot created").await?;
    Ok(())
}

async fn vm_snapshot_delete(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let snap_name = msg.payload["snapshot_name"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("snapshot_name missing"))?
        .to_string();

    let row: (String, Option<Uuid>) = sqlx::query_as("SELECT name, host_id FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    match agent_client::delete_snapshot(&mut client, &row.0, &snap_name).await {
        Ok(_) => {}
        Err(e) => {
            let msg_str = e.to_string().to_lowercase();
            // If libvirt already deleted the snapshot (e.g. after a revert that restructured the
            // snapshot chain), treat "not found" as success and just clean up the controller record.
            if !msg_str.contains("not found") && !msg_str.contains("notfound") {
                return Err(e);
            }
            tracing::warn!(snap = %snap_name, "snapshot not found in libvirt during delete — cleaning up controller record only");
        }
    }
    sqlx::query("DELETE FROM snapshot_records WHERE vm_id = ? AND name = ?")
        .bind(vm_id)
        .bind(&snap_name)
        .execute(&state.pool)
        .await?;
    update_task_progress(&state.pool, msg.task_id, 100, "snapshot deleted").await?;
    Ok(())
}

async fn vm_backup(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let record_id: Uuid = msg.payload["backup_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("backup_id missing"))?;
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;

    let row: (String, Option<Uuid>) = sqlx::query_as("SELECT name, host_id FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;
    let backup_type: String =
        sqlx::query_scalar("SELECT backup_type FROM backup_records WHERE id = ?")
            .bind(record_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("backup record {} not found", record_id))?;
    let dest = state
        .config
        .backup_dir
        .join(format!(
            "{}-{}.qcow2",
            row.0,
            chrono::Utc::now().format("%Y%m%d%H%M%S")
        ))
        .to_string_lossy()
        .into_owned();

    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    let resp = if backup_type == "incremental" {
        run_incremental_backup(&state.pool, vm_id, &row.0, &dest, &agent_addr).await?
    } else {
        agent_client::backup_vm(&mut client, &row.0, &dest).await?
    };
    if resp.ok && msg.payload["export"].as_bool() == Some(true) {
        let check_path = resp.path.clone();
        let _ = tokio::task::spawn_blocking(move || {
            std::process::Command::new("qemu-img")
                .args(["check", &check_path])
                .output()
        })
        .await;
    }

    if resp.ok {
        sqlx::query("UPDATE backup_records SET status = 'completed', backup_path = ?, message = ? WHERE id = ?")
            .bind(&resp.path)
            .bind(&resp.message)
            .bind(record_id)
            .execute(&state.pool)
            .await?;

        if let Some(tid) = msg.payload["target_id"]
            .as_str()
            .and_then(|s| Uuid::parse_str(s).ok())
        {
            if let Ok(Some((kind, cfg))) = sqlx::query_as::<_, (String, serde_json::Value)>(
                "SELECT kind, config_json FROM backup_targets WHERE id = ?",
            )
            .bind(tid)
            .fetch_optional(&state.pool)
            .await
            {
                if kind == "s3" {
                    let bucket = cfg["bucket"].as_str().unwrap_or("");
                    // Strip leading dashes from prefix so it cannot become an AWS CLI flag
                    // (e.g. "--no-sign-request" in the prefix field of a malicious config).
                    let raw_prefix = cfg["prefix"].as_str().unwrap_or("machina");
                    let prefix = raw_prefix.trim_start_matches('-');
                    let prefix = if prefix.is_empty() { "machina" } else { prefix };
                    if !bucket.is_empty() {
                        let key = format!(
                            "{prefix}/{}",
                            std::path::Path::new(&resp.path)
                                .file_name()
                                .and_then(|s| s.to_str())
                                .unwrap_or("backup.qcow2")
                        );
                        let dest = format!("s3://{bucket}/{key}");
                        let endpoint = cfg["endpoint_url"].as_str().unwrap_or("").to_string();
                        let src_path = resp.path.clone();
                        let dest_clone = dest.clone();
                        let aws_result = tokio::task::spawn_blocking(move || {
                            let mut aws_args =
                                vec!["s3".to_string(), "cp".to_string(), src_path, dest_clone];
                            if !endpoint.is_empty() {
                                aws_args.push("--endpoint-url".to_string());
                                aws_args.push(endpoint);
                            }
                            std::process::Command::new("aws").args(&aws_args).output()
                        })
                        .await;
                        match aws_result {
                            Ok(Ok(out)) if out.status.success() => {
                                sqlx::query("UPDATE backup_records SET message = ? WHERE id = ?")
                                    .bind(format!("{}; uploaded to {dest}", resp.message))
                                    .bind(record_id)
                                    .execute(&state.pool)
                                    .await?;
                            }
                            Ok(Ok(out)) => {
                                tracing::warn!(
                                    "S3 upload failed: {}",
                                    String::from_utf8_lossy(&out.stderr)
                                );
                            }
                            Ok(Err(e)) => tracing::warn!("aws cli not available for S3 upload: {e}"),
                            Err(e) => tracing::warn!("S3 upload task panicked: {e}"),
                        }
                    }
                }
            }
        }

        state.emit_event("vm.backup", format!("Backup {} -> {}", row.0, resp.path));
    } else {
        sqlx::query("UPDATE backup_records SET status = 'failed', message = ? WHERE id = ?")
            .bind(&resp.message)
            .bind(record_id)
            .execute(&state.pool)
            .await?;
        anyhow::bail!("backup failed: {}", resp.message);
    }
    update_task_progress(&state.pool, msg.task_id, 100, "backup complete").await?;
    Ok(())
}

async fn vm_snapshot_revert(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let snap_name = msg.payload["snapshot_name"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("snapshot_name missing"))?
        .to_string();

    let row: (String, Option<Uuid>) = sqlx::query_as("SELECT name, host_id FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    let resp = agent_client::revert_snapshot(&mut client, &row.0, &snap_name).await?;
    if !resp.ok {
        anyhow::bail!("revert failed: {}", resp.message);
    }
    state.emit_event(
        "vm.snapshot.revert",
        format!("Reverted {} to {}", row.0, snap_name),
    );
    update_task_progress(&state.pool, msg.task_id, 100, "snapshot reverted").await?;
    Ok(())
}

async fn vm_snapshot_clone(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let snap_name = msg.payload["snapshot_name"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("snapshot_name missing"))?
        .to_string();
    let new_name = msg.payload["new_name"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("new_name missing"))?
        .to_string();
    let revert_source = msg.payload["revert_source"].as_bool().unwrap_or(false);
    let dest_host_id = msg.payload["dest_host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok());

    let row: (String, Option<Uuid>, Uuid, serde_json::Value, i32, i64) = sqlx::query_as(
        "SELECT name, host_id, cluster_id, spec_json, vcpus, memory_mib FROM vms WHERE id = ?",
    )
    .bind(vm_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;
    let new_disk_path = disk_path_for(&state.config, &new_name);
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;

    let label = if revert_source {
        "revert + clone"
    } else {
        "clone at snapshot point"
    };
    update_task_progress(&state.pool, msg.task_id, 30, label).await?;
    let resp = agent_client::clone_from_snapshot(
        &mut client,
        &row.0,
        &snap_name,
        &new_name,
        &new_disk_path,
        revert_source,
    )
    .await?;
    if !resp.ok {
        anyhow::bail!("clone from snapshot failed: {}", resp.message);
    }

    let new_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO vms (id, cluster_id, host_id, name, spec_json, desired_state, observed_state, uuid, vcpus, memory_mib)
         VALUES (?, ?, ?, ?, ?, 'stopped', 'defined', ?, ?, ?)",
    )
    .bind(new_id)
    .bind(row.2)
    .bind(host_id)
    .bind(&new_name)
    .bind(&row.3)
    .bind(&resp.uuid)
    .bind(row.4)
    .bind(row.5)
    .execute(&state.pool)
    .await?;

    if let Some(dest) = dest_host_id {
        if dest != host_id {
            update_task_progress(
                &state.pool,
                msg.task_id,
                80,
                "queueing migration to dest host",
            )
            .await?;
            let live_migrate = msg.payload["live"].as_bool().unwrap_or(true);
            let source_running: String =
                sqlx::query_scalar("SELECT observed_state FROM vms WHERE id = ?")
                    .bind(vm_id)
                    .fetch_optional(&state.pool)
                    .await?
                    .ok_or_else(|| anyhow::anyhow!("vm {} disappeared before migration could start", vm_id))?;
            let use_live = live_migrate && source_running == "running";
            if use_live {
                vm_lifecycle::set_vm_phase(&state.pool, new_id, vm_lifecycle::PHASE_STARTING)
                    .await?;
                agent_client::vm_power(&mut client, &new_name, "start", None).await?;
                sqlx::query("UPDATE vms SET desired_state = 'running', observed_state = 'running' WHERE id = ?")
                    .bind(new_id)
                    .execute(&state.pool)
                    .await?;
            }
            if let Err(e) = enqueue_task(
                state,
                "vm.migrate",
                serde_json::json!({
                    "vm_id": new_id.to_string(),
                    "dest_host_id": dest.to_string(),
                    "live": use_live,
                }),
                Some("vm"),
                Some(new_id),
                Some(host_id),
            )
            .await
            {
                tracing::warn!(vm_id = %new_id, dest = %dest, "vm.migrate enqueue failed after snapshot clone: {}; resetting desired_state to stopped", e.message);
                let _ = sqlx::query("UPDATE vms SET desired_state = 'stopped' WHERE id = ?")
                    .bind(new_id)
                    .execute(&state.pool)
                    .await;
            }
        }
    }

    state.emit_event(
        "vm.snapshot.clone",
        format!(
            "Cloned {} from snapshot {} as {}",
            row.0, snap_name, new_name
        ),
    );
    update_task_progress(
        &state.pool,
        msg.task_id,
        100,
        "clone from snapshot complete",
    )
    .await?;
    Ok(())
}

async fn vm_backup_restore(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let record_id: Uuid = msg.payload["backup_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("backup_id missing"))?;
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;

    let backup_path: String =
        sqlx::query_scalar("SELECT backup_path FROM backup_records WHERE id = ?")
            .bind(record_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("backup record {} not found", record_id))?;
    let row: (String, Option<Uuid>) = sqlx::query_as("SELECT name, host_id FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;

    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    sqlx::query("UPDATE backup_records SET restore_status = 'running' WHERE id = ?")
        .bind(record_id)
        .execute(&state.pool)
        .await?;
    let resp = agent_client::restore_vm_backup(&mut client, &row.0, &backup_path).await?;
    if resp.ok {
        sqlx::query("UPDATE backup_records SET restore_status = 'completed' WHERE id = ?")
            .bind(record_id)
            .execute(&state.pool)
            .await?;
        state.emit_event(
            "vm.backup.restore",
            format!("Restored {} from backup", row.0),
        );
    } else {
        sqlx::query("UPDATE backup_records SET restore_status = 'failed' WHERE id = ?")
            .bind(record_id)
            .execute(&state.pool)
            .await?;
        anyhow::bail!("restore failed: {}", resp.message);
    }
    update_task_progress(&state.pool, msg.task_id, 100, "backup restored").await?;
    Ok(())
}

async fn templates_prefetch_missing(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let host_id: Uuid = if let Some(s) = msg.payload["host_id"].as_str() {
        Uuid::parse_str(s)?
    } else {
        sqlx::query_scalar("SELECT id FROM hosts WHERE state = 'online' ORDER BY hostname LIMIT 1")
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("no online hosts"))?
    };
    update_task_progress(
        &state.pool,
        msg.task_id,
        5,
        "Listing missing marketplace golden images",
    )
    .await?;
    let missing =
        crate::engine::template_readiness::list_missing_marketplace_images(&state.pool).await?;
    let targets: Vec<_> = missing.into_iter().filter(|m| m.auto_fetch).collect();
    if targets.is_empty() {
        update_task_progress(
            &state.pool,
            msg.task_id,
            100,
            "All auto-fetch images present",
        )
        .await?;
        return Ok(());
    }
    let total = targets.len();
    let mut errors = Vec::new();
    for (i, item) in targets.iter().enumerate() {
        let pct = 10 + ((i + 1) * 85 / total) as i16;
        update_task_progress(
            &state.pool,
            msg.task_id,
            pct,
            &format!("Fetching {}@{}", item.name, item.version),
        )
        .await?;
        if let Err(e) = crate::engine::template_image_fetch::ensure_template_disk(
            &state.pool,
            host_id,
            &item.source_disk,
            &item.name,
            &item.version,
        )
        .await
        {
            errors.push(format!("{}@{}: {e:#}", item.name, item.version));
        }
    }
    if !errors.is_empty() {
        anyhow::bail!(
            "{} of {} download(s) failed: {}",
            errors.len(),
            total,
            errors.join("; ")
        );
    }
    update_task_progress(
        &state.pool,
        msg.task_id,
        100,
        &format!("Downloaded {total} golden image(s)"),
    )
    .await?;
    state.emit_event(
        "templates.prefetch",
        format!("Prefetched {total} marketplace golden image(s)"),
    );
    Ok(())
}

fn vm_id_from_payload(msg: &TaskMessage) -> Option<Uuid> {
    msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
}

async fn on_task_failure(state: &AppState, msg: &TaskMessage, err: &str) {
    let _ = mark_task_failed(&state.pool, msg.task_id, err).await;
    if let Some(vm_id) = vm_id_from_payload(msg) {
        let _ = vm_lifecycle::set_vm_error(&state.pool, vm_id, err).await;
    }
    crate::engine::webhooks::dispatch_webhooks(
        &state.pool,
        "alert.task_failed",
        serde_json::json!({
            "severity": "error",
            "task_id": msg.task_id.to_string(),
            "operation": msg.operation,
            "error": err,
            "vm_id": msg.payload.get("vm_id"),
        }),
    )
    .await;
}

async fn host_validate_task(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let host_id: Uuid = msg.payload["host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;
    update_task_progress(&state.pool, msg.task_id, 10, "running validation checklist").await?;
    let report = crate::engine::host_validate::validate_host(&state.pool, host_id).await?;
    crate::engine::host_validate::persist_validation(&state.pool, host_id, &report).await?;
    if report.ok {
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
            tracing::warn!(host_id = %host_id, "host.inventory enqueue failed after validation: {}", e.message);
        }
    }
    let summary = if report.ok {
        "validation passed"
    } else {
        "validation failed — see host detail"
    };
    update_task_progress(&state.pool, msg.task_id, 100, summary).await?;
    Ok(())
}

async fn kubevirt_inventory_task(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let cluster_id: Uuid = msg.payload["cluster_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .or_else(|| {
            msg.payload["host_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
        })
        .unwrap_or_else(|| {
            // fallback: first cluster
            Uuid::nil()
        });

    let cluster_id = if cluster_id.is_nil() {
        sqlx::query_scalar("SELECT id FROM clusters ORDER BY created_at LIMIT 1")
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("no cluster configured"))?
    } else {
        cluster_id
    };

    crate::engine::kubevirt_inventory::sync_cluster(state, cluster_id).await?;
    update_task_progress(&state.pool, msg.task_id, 100, "kubevirt inventory synced").await?;
    Ok(())
}

async fn host_tetragon_install(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let host_id_str = msg
        .payload
        .get("host_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let host_id =
        Uuid::parse_str(host_id_str).map_err(|_| anyhow::anyhow!("host_id missing or invalid"))?;
    update_task_progress(
        &state.pool,
        msg.task_id,
        20,
        "registering PacketWolf sensor",
    )
    .await?;
    if let Ok(agent_addr) = host_agent_addr(&state.pool, host_id).await {
        if let Err(e) = crate::engine::packetwolf_sync::sync_host_tetragon_install(
            &state.pool,
            &state.config,
            host_id,
            &agent_addr,
        )
        .await
        {
            anyhow::bail!("Tetragon enrollment failed: {e:#}");
        }
    } else {
        anyhow::bail!("host agent address not found");
    }
    update_task_progress(
        &state.pool,
        msg.task_id,
        100,
        "Tetragon enrollment complete",
    )
    .await?;
    Ok(())
}

async fn k8s_tetragon_install(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let cluster_id = msg
        .payload
        .get("cluster_id")
        .and_then(|v| v.as_str())
        .unwrap_or("default");
    let cluster_name = msg
        .payload
        .get("cluster_name")
        .and_then(|v| v.as_str())
        .unwrap_or(cluster_id);
    let namespace_raw = msg
        .payload
        .get("namespace")
        .and_then(|v| v.as_str())
        .unwrap_or("kube-system");
    let namespace = namespace_raw.trim();
    if namespace.is_empty() {
        anyhow::bail!("namespace must not be empty");
    }
    update_task_progress(
        &state.pool,
        msg.task_id,
        20,
        &format!("planning Tetragon Helm release for {cluster_name}"),
    )
    .await?;
    let cfg_clone = state.config.clone();
    let cluster_id_owned = cluster_id.to_string();
    let namespace_owned = namespace.to_string();
    let cluster_name_owned = cluster_name.to_string();
    let helm = tokio::task::spawn_blocking(move || {
        crate::engine::packetwolf_k8s::install_tetragon_helm(
            &cfg_clone,
            &cluster_id_owned,
            &namespace_owned,
            &cluster_name_owned,
        )
    })
    .await
    .map_err(|e| anyhow::anyhow!("tetragon install task panicked: {e}"))?;
    update_task_progress(
        &state.pool,
        msg.task_id,
        55,
        if helm.helm_output.is_empty() {
            "Tetragon Helm release applied"
        } else {
            "Tetragon Helm release applied — deploying PacketWolf export forwarder"
        },
    )
    .await?;
    update_task_progress(
        &state.pool,
        msg.task_id,
        85,
        if helm.forwarder_applied {
            "PacketWolf export forwarder deployed"
        } else {
            "PacketWolf export forwarder pending (kubectl required)"
        },
    )
    .await?;
    let _ = crate::engine::packetwolf_bridge::register_sensor(
        &state.config,
        &format!("k8s-{cluster_id}"),
    )
    .await;
    if !helm.ok {
        anyhow::bail!(helm.message);
    }
    update_task_progress(&state.pool, msg.task_id, 100, &helm.message).await?;
    Ok(())
}

async fn host_linux_package_upgrade(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let host_id = msg
        .payload
        .get("host_id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;
    update_task_progress(
        &state.pool,
        msg.task_id,
        20,
        "applying distro package upgrades on hypervisor",
    )
    .await?;
    let result = crate::engine::host_os::apply_linux_package_upgrade(
        &state.pool,
        &state.config,
        host_id,
        false,
    )
    .await?;
    let summary = result
        .get("stdout")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| "Package upgrade completed".into());
    update_task_progress(&state.pool, msg.task_id, 100, &summary).await?;
    Ok(())
}

async fn host_linux_reboot(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let host_id = msg
        .payload
        .get("host_id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;
    update_task_progress(&state.pool, msg.task_id, 30, "initiating hypervisor reboot").await?;
    crate::engine::host_os::reboot_linux_host(&state.pool, &state.config, host_id).await?;
    update_task_progress(
        &state.pool,
        msg.task_id,
        100,
        "Reboot command sent — host may go offline briefly",
    )
    .await?;
    Ok(())
}

async fn host_enforcement_apply(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let host_id = msg
        .payload
        .get("host_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("host_id missing or empty"))?;
    let policy_id = msg
        .payload
        .get("policy_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("policy_id missing or empty"))?;
    update_task_progress(
        &state.pool,
        msg.task_id,
        30,
        &format!("rendering Tetragon TracingPolicy for {policy_id}"),
    )
    .await?;
    let _result = crate::engine::packetwolf_bridge::apply_enforcement_policy(
        &state.config,
        policy_id,
        &[host_id.to_string()],
    )
    .await;
    update_task_progress(
        &state.pool,
        msg.task_id,
        60,
        "pushing TracingPolicy bundle to machina-agent",
    )
    .await?;
    if let Ok(host_uuid) = Uuid::parse_str(host_id) {
        if let Ok(agent_addr) = host_agent_addr(&state.pool, host_uuid).await {
            if let Err(e) = crate::engine::packetwolf_sync::sync_host_security_bundle(
                &state.config,
                &state.pool,
                host_uuid,
                &agent_addr,
            )
            .await
            {
                tracing::warn!(host_id = %host_id, "sync_host_security_bundle failed: {e:#}");
            }
        }
    }
    update_task_progress(
        &state.pool,
        msg.task_id,
        100,
        &format!("Runtime enforcement active for {host_id}"),
    )
    .await?;
    Ok(())
}

async fn host_agent_upgrade(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let host_id: Uuid = msg.payload["host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;
    let target = msg.payload["target_version"]
        .as_str()
        .unwrap_or(env!("CARGO_PKG_VERSION"));
    update_task_progress(&state.pool, msg.task_id, 20, "upgrade queued").await?;
    sqlx::query("UPDATE hosts SET agent_version = ? WHERE id = ?")
        .bind(target)
        .bind(host_id)
        .execute(&state.pool)
        .await?;
    update_task_progress(
        &state.pool,
        msg.task_id,
        100,
        &format!("agent upgrade recorded to {target} — restart machina-agent on host"),
    )
    .await?;
    Ok(())
}

async fn storage_pool_provision(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let pool_id: Uuid = msg.payload["pool_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("pool_id missing"))?;
    let host_id: Uuid = msg.payload["host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;

    let row: (String, String, Option<String>) =
        sqlx::query_as("SELECT name, backend, path FROM storage_pools WHERE id = ?")
            .bind(pool_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("storage pool {} not found", pool_id))?;
    let path = row
        .2
        .ok_or_else(|| anyhow::anyhow!("storage pool path required"))?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::provision_storage_pool(&mut client, &row.0, &row.1, &path).await?;
    sqlx::query("UPDATE storage_pools SET path = COALESCE(path, ?) WHERE id = ?")
        .bind(&path)
        .bind(pool_id)
        .execute(&state.pool)
        .await?;
    update_task_progress(
        &state.pool,
        msg.task_id,
        100,
        "storage pool provisioned on host",
    )
    .await?;
    state.emit_event(
        "storage.pool.provision",
        format!("Pool {} ({}) provisioned", row.0, row.1),
    );
    Ok(())
}

async fn network_provision(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let network_id: Uuid = msg.payload["network_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("network_id missing"))?;
    let host_id: Uuid = msg.payload["host_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("host_id missing"))?;

    let row: (String, String, Option<i32>, Option<String>) =
        sqlx::query_as("SELECT name, backend, vlan_id, bridge FROM networks WHERE id = ?")
            .bind(network_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("network {} not found", network_id))?;
    let bridge = row.3.unwrap_or_else(|| "virbr0".into());
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::provision_network(&mut client, &row.0, &row.1, row.2.unwrap_or(0), &bridge)
        .await?;
    update_task_progress(&state.pool, msg.task_id, 100, "network provisioned").await?;
    Ok(())
}

async fn vm_disk_attach(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let disk_path = msg.payload["disk_path"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("disk_path missing"))?
        .to_string();
    let target_dev = msg.payload["target_dev"]
        .as_str()
        .unwrap_or("vdb")
        .to_string();

    let row: (String, Option<Uuid>) = sqlx::query_as("SELECT name, host_id FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::attach_disk(&mut client, &row.0, &disk_path, &target_dev).await?;
    state.emit_event("vm.disk.attach", format!("Attached disk to {}", row.0));
    update_task_progress(&state.pool, msg.task_id, 100, "disk attached").await?;
    Ok(())
}

async fn vm_host_row(pool: &SqlitePool, vm_id: Uuid) -> anyhow::Result<(String, Uuid)> {
    let row: Option<(String, Option<Uuid>)> =
        sqlx::query_as("SELECT name, host_id FROM vms WHERE id = ?")
            .bind(vm_id)
            .fetch_optional(pool)
            .await?;
    let (name, host_id_opt) =
        row.ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = host_id_opt.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;
    Ok((name, host_id))
}

async fn vm_disk_detach(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let target_dev = msg.payload["target_dev"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("target_dev missing"))?
        .to_string();
    let (name, host_id) = vm_host_row(&state.pool, vm_id).await?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::detach_disk(&mut client, &name, &target_dev).await?;
    state.emit_event(
        "vm.disk.detach",
        format!("Detached disk {target_dev} from {name}"),
    );
    update_task_progress(&state.pool, msg.task_id, 100, "disk detached").await?;
    Ok(())
}

async fn vm_disk_resize(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let target_dev = msg.payload["target_dev"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("target_dev missing"))?
        .to_string();
    let size_gb = msg.payload["size_gb"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("size_gb missing"))?;
    let (name, host_id) = vm_host_row(&state.pool, vm_id).await?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::resize_disk(&mut client, &name, &target_dev, size_gb).await?;
    state.emit_event(
        "vm.disk.resize",
        format!("Resized disk {target_dev} on {name} to {size_gb} GiB"),
    );
    update_task_progress(&state.pool, msg.task_id, 100, "disk resized").await?;
    Ok(())
}

async fn vm_nic_attach(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let network = msg.payload["network"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("network missing"))?
        .to_string();
    let model = msg.payload["model"]
        .as_str()
        .unwrap_or("virtio")
        .to_string();
    let (name, host_id) = vm_host_row(&state.pool, vm_id).await?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::attach_nic(&mut client, &name, &network, &model).await?;
    state.emit_event(
        "vm.nic.attach",
        format!("Attached NIC on {network} to {name}"),
    );
    update_task_progress(&state.pool, msg.task_id, 100, "nic attached").await?;
    Ok(())
}

async fn vm_nic_detach(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let mac = msg.payload["mac_address"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("mac_address missing"))?
        .to_string();
    let (name, host_id) = vm_host_row(&state.pool, vm_id).await?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::detach_nic(&mut client, &name, &mac).await?;
    state.emit_event("vm.nic.detach", format!("Detached NIC {mac} from {name}"));
    update_task_progress(&state.pool, msg.task_id, 100, "nic detached").await?;
    Ok(())
}

async fn vm_autostart(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let enabled = msg.payload["enabled"].as_bool().unwrap_or(false);
    let (name, host_id) = vm_host_row(&state.pool, vm_id).await?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::set_autostart(&mut client, &name, enabled).await?;
    state.emit_event(
        "vm.autostart",
        format!(
            "Autostart {} for {name}",
            if enabled { "enabled" } else { "disabled" }
        ),
    );
    update_task_progress(&state.pool, msg.task_id, 100, "autostart updated").await?;
    Ok(())
}

async fn vm_resize(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let kind = msg.payload["kind"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("kind missing"))?;
    let (name, host_id) = vm_host_row(&state.pool, vm_id).await?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    match kind {
        "vcpus" => {
            let count = msg.payload["count"]
                .as_u64()
                .ok_or_else(|| anyhow::anyhow!("count missing"))? as u32;
            agent_client::set_vcpus(&mut client, &name, count).await?;
            sqlx::query("UPDATE vms SET vcpus = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(count as i64)
                .bind(vm_id)
                .execute(&state.pool)
                .await?;
            state.emit_event("vm.resize", format!("Set {name} vCPUs to {count}"));
        }
        "memory" => {
            let memory_mb = msg.payload["memory_mb"]
                .as_u64()
                .ok_or_else(|| anyhow::anyhow!("memory_mb missing"))?;
            agent_client::set_memory(&mut client, &name, memory_mb).await?;
            sqlx::query("UPDATE vms SET memory_mib = ?, updated_at = datetime('now') WHERE id = ?")
                .bind(memory_mb as i64)
                .bind(vm_id)
                .execute(&state.pool)
                .await?;
            state.emit_event("vm.resize", format!("Set {name} memory to {memory_mb} MiB"));
        }
        other => anyhow::bail!("unknown resize kind: {other}"),
    }
    update_task_progress(&state.pool, msg.task_id, 100, "resize complete").await?;
    Ok(())
}

async fn vm_guest_tools_install(state: &AppState, msg: &TaskMessage) -> anyhow::Result<()> {
    let vm_id: Uuid = msg.payload["vm_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| anyhow::anyhow!("vm_id missing"))?;
    let row: (String, Option<Uuid>) = sqlx::query_as("SELECT name, host_id FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("vm {} not found", vm_id))?;
    let host_id = row.1.ok_or_else(|| anyhow::anyhow!("vm {} has no host", vm_id))?;
    let agent_addr = host_agent_addr(&state.pool, host_id).await?;
    let mut client = agent_client::connect(&agent_addr).await?;
    agent_client::install_guest_tools(&mut client, &row.0).await?;
    crate::engine::vm_health::sync_guest_tools(&state.pool, vm_id, &row.0, host_id).await;
    sqlx::query(
        "UPDATE vms SET guest_tools_status = 'installed', updated_at = datetime('now') WHERE id = ?",
    )
    .bind(vm_id)
    .execute(&state.pool)
    .await?;
    state.emit_event(
        "vm.guest_tools",
        format!("Guest tools channel attached for {}", row.0),
    );
    update_task_progress(&state.pool, msg.task_id, 100, "guest tools install queued").await?;
    Ok(())
}

async fn run_incremental_backup(
    pool: &SqlitePool,
    vm_id: Uuid,
    vm_name: &str,
    dest: &str,
    agent_addr: &str,
) -> anyhow::Result<machina_agent::pb::BackupVmResponse> {
    let prior: Option<String> = sqlx::query_scalar(
        "SELECT backup_path FROM backup_records
         WHERE vm_id = ? AND status = 'completed' AND backup_path != ''
         ORDER BY datetime(created_at) DESC LIMIT 1",
    )
    .bind(vm_id)
    .fetch_optional(pool)
    .await?;
    let mut client = agent_client::connect(agent_addr).await?;
    let resp = agent_client::backup_vm(&mut client, vm_name, dest).await?;
    if resp.ok {
        if let Some(base) = prior.filter(|p| std::path::Path::new(p).exists()) {
            let base_owned = base.clone();
            let path_owned = resp.path.clone();
            let rebase_result = tokio::task::spawn_blocking(move || {
                std::process::Command::new("qemu-img")
                    .args(["rebase", "-u", "-b", &base_owned, &path_owned])
                    .output()
            })
            .await;
            match rebase_result {
                Ok(Err(e)) => tracing::warn!("qemu-img rebase unavailable: {e}"),
                Ok(Ok(out)) if !out.status.success() => {
                    tracing::warn!("qemu-img rebase failed: {}", String::from_utf8_lossy(&out.stderr));
                }
                Err(e) => tracing::warn!("qemu-img rebase task panicked: {e}"),
                _ => {}
            }
        }
    }
    Ok(resp)
}

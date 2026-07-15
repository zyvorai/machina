// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, Query, State};
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::tasks::TaskResponse;
use crate::api::ApiError;
use crate::auth::{require_admin, require_operator, AuthUser};
use crate::engine::host_validate;
use crate::state::AppState;
use crate::tasks::enqueue::{enqueue_task, write_audit};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct HostRow {
    pub id: Uuid,
    pub hostname: String,
    pub address: String,
    pub state: String,
    pub maintenance_mode: bool,
    /// false = cordoned (no new VM placement); see engine/placement.rs.
    pub schedulable: bool,
    pub agent_grpc_addr: String,
    pub vm_count: i32,
    pub cpu_percent: f32,
    pub memory_used_mib: i64,
    pub memory_total_mib: i64,
    pub fenced: bool,
    pub validation_status: String,
    pub last_heartbeat_at: Option<chrono::DateTime<chrono::Utc>>,
    pub site: String,
    pub rack: String,
    pub rack_u: Option<i32>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct HostDetailRow {
    pub id: Uuid,
    pub hostname: String,
    pub address: String,
    pub state: String,
    pub maintenance_mode: bool,
    /// false = cordoned (no new VM placement); see engine/placement.rs.
    pub schedulable: bool,
    pub agent_grpc_addr: String,
    pub agent_console_addr: String,
    pub libvirt_uri: String,
    pub agent_version: String,
    pub vm_count: i32,
    pub cpu_percent: f32,
    pub memory_used_mib: i64,
    pub memory_total_mib: i64,
    pub cpu_model: String,
    pub libvirt_version: String,
    pub qemu_version: String,
    pub fenced: bool,
    pub notes: String,
    pub validation_status: String,
    pub validation_report: serde_json::Value,
    pub last_heartbeat_at: Option<chrono::DateTime<chrono::Utc>>,
    pub site: String,
    pub rack: String,
    pub rack_u: Option<i32>,
}

const HOST_LIST_SQL: &str =
    "SELECT id, hostname, address, state, maintenance_mode,
         COALESCE(schedulable, 1) AS schedulable, agent_grpc_addr, vm_count,
         cpu_percent, memory_used_mib, memory_total_mib, fenced,
         COALESCE(validation_status, 'pending') AS validation_status,
         last_heartbeat_at,
         COALESCE(site, '') AS site, COALESCE(rack, '') AS rack, rack_u FROM hosts";

const HOST_DETAIL_SQL: &str =
    "SELECT id, hostname, address, state, maintenance_mode,
         COALESCE(schedulable, 1) AS schedulable, agent_grpc_addr,
         COALESCE(agent_console_addr, '127.0.0.1:50052') AS agent_console_addr,
         COALESCE(libvirt_uri, 'qemu:///system') AS libvirt_uri,
         COALESCE(agent_version, '') AS agent_version,
         vm_count, cpu_percent, memory_used_mib, memory_total_mib,
         COALESCE(cpu_model, '') AS cpu_model,
         COALESCE(libvirt_version, '') AS libvirt_version,
         COALESCE(qemu_version, '') AS qemu_version,
         fenced, COALESCE(notes, '') AS notes,
         COALESCE(validation_status, 'pending') AS validation_status,
         COALESCE(validation_report, '[]') AS validation_report,
         last_heartbeat_at,
         COALESCE(site, '') AS site, COALESCE(rack, '') AS rack, rack_u FROM hosts";

#[derive(Debug, Deserialize)]
pub struct CreateHostRequest {
    pub hostname: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub agent_grpc_addr: Option<String>,
    #[serde(default)]
    pub libvirt_uri: Option<String>,
}

pub async fn list_hosts(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<HostRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, HostRow>(&format!("{HOST_LIST_SQL} ORDER BY hostname LIMIT 500"))
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows.into_iter().map(apply_stale_host_state).collect()))
}

fn apply_stale_host_state(mut row: HostRow) -> HostRow {
    if row.maintenance_mode {
        return row;
    }
    if let Some(hb) = row.last_heartbeat_at {
        let age = chrono::Utc::now().signed_duration_since(hb);
        if age > chrono::Duration::minutes(2) && row.state == "online" {
            row.state = "offline".into();
        }
    }
    row
}

async fn fetch_host_row(state: &AppState, id: Uuid) -> Result<HostRow, ApiError> {
    let row = sqlx::query_as::<_, HostRow>(&format!("{HOST_LIST_SQL} WHERE id = ?"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    Ok(apply_stale_host_state(row))
}

pub async fn get_host(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<HostRow>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(fetch_host_row(&state, id).await?))
}

pub async fn get_host_gpus(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let agent_addr: String = sqlx::query_scalar("SELECT agent_grpc_addr FROM hosts WHERE id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    let mut client = crate::agent_client::connect(&agent_addr)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let resp = crate::agent_client::list_host_gpus(&mut client)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let devices: Vec<serde_json::Value> = resp
        .devices
        .into_iter()
        .map(|d| {
            serde_json::json!({
                "pci_address": d.pci_address,
                "vendor": d.vendor,
                "device_name": d.device_name,
                "iommu_group": d.iommu_group,
                "mig_profile": d.mig_profile,
            })
        })
        .collect();
    Ok(Json(serde_json::json!({
        "devices": devices,
        "nvidia_smi_summary": resp.nvidia_smi_summary,
    })))
}

async fn fetch_host_detail_row(state: &AppState, id: Uuid) -> Result<HostDetailRow, ApiError> {
    let row = sqlx::query_as::<_, HostDetailRow>(&format!("{HOST_DETAIL_SQL} WHERE id = ?"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    let mut detail = row;
    if !detail.maintenance_mode {
        if let Some(hb) = detail.last_heartbeat_at {
            let age = chrono::Utc::now().signed_duration_since(hb);
            if age > chrono::Duration::minutes(2) && detail.state == "online" {
                detail.state = "offline".into();
            }
        }
    }
    Ok(detail)
}

pub async fn get_host_detail(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<HostDetailRow>, ApiError> {
    require_operator(&actor)?;
    Ok(Json(fetch_host_detail_row(&state, id).await?))
}

pub async fn create_host(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(req): Json<CreateHostRequest>,
) -> Result<Json<HostRow>, ApiError> {
    require_operator(&actor)?;
    let cluster_id: Uuid = sqlx::query_scalar("SELECT id FROM clusters LIMIT 1")
        .fetch_one(&state.pool)
        .await?;
    let id = Uuid::new_v4();
    let agent_addr = req
        .agent_grpc_addr
        .unwrap_or_else(|| state.config.default_agent_addr.clone());
    let libvirt_uri = req
        .libvirt_uri
        .unwrap_or_else(|| state.config.default_libvirt_uri.clone());

    sqlx::query(
        "INSERT INTO hosts (id, cluster_id, hostname, address, agent_grpc_addr, libvirt_uri, state, validation_status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_validation', 'pending')",
    )
    .bind(id)
    .bind(cluster_id)
    .bind(&req.hostname)
    .bind(&req.address)
    .bind(&agent_addr)
    .bind(&libvirt_uri)
    .execute(&state.pool)
    .await?;

    write_audit(
        &state,
        &actor.username,
        "host.create",
        "host",
        Some(id),
        serde_json::json!({ "hostname": req.hostname }),
    )
    .await?;

    if let Err(e) = enqueue_task(
        &state,
        "host.validate",
        serde_json::json!({ "host_id": id.to_string() }),
        Some("host"),
        Some(id),
        Some(id),
    )
    .await
    {
        tracing::warn!(host_id = %id, "host.validate enqueue failed after create: {}", e.message);
    }

    fetch_host_row(&state, id).await.map(Json)
}

pub async fn validate_host(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<host_validate::HostValidationReport>, ApiError> {
    require_operator(&actor)?;
    let report = host_validate::validate_host(&state.pool, id).await?;
    host_validate::persist_validation(&state.pool, id, &report).await?;
    Ok(Json(report))
}

pub async fn enqueue_validate_host(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskResponse>, ApiError> {
    require_operator(&actor)?;
    let task_id = enqueue_task(
        &state,
        "host.validate",
        serde_json::json!({ "host_id": id.to_string() }),
        Some("host"),
        Some(id),
        Some(id),
    )
    .await?;
    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "host.validate".into(),
    }))
}

pub async fn sync_host(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskResponse>, ApiError> {
    require_operator(&actor)?;
    let task_id = enqueue_task(
        &state,
        "host.inventory",
        serde_json::json!({ "host_id": id.to_string() }),
        Some("host"),
        Some(id),
        Some(id),
    )
    .await?;
    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "host.inventory".into(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct JoinHostRequest {
    pub token: String,
    pub hostname: String,
    #[serde(default)]
    pub address: String,
    pub agent_grpc_addr: String,
    #[serde(default)]
    pub agent_console_addr: Option<String>,
    #[serde(default)]
    pub libvirt_uri: Option<String>,
}

pub async fn join_host(
    State(state): State<AppState>,
    Json(req): Json<JoinHostRequest>,
) -> Result<Json<HostRow>, ApiError> {
    let id = Uuid::new_v4();
    let console_addr = req
        .agent_console_addr
        .unwrap_or_else(|| "127.0.0.1:50052".into());
    let libvirt_uri = req
        .libvirt_uri
        .unwrap_or_else(|| state.config.default_libvirt_uri.clone());

    if req.agent_grpc_addr.is_empty()
        || req.agent_grpc_addr.starts_with("127.0.0.1:")
        || req.agent_grpc_addr.starts_with("localhost:")
    {
        tracing::warn!(
            hostname = %req.hostname,
            agent_grpc_addr = %req.agent_grpc_addr,
            "host join carrying a loopback/empty agent address; any existing routable address is preserved — investigate the caller if this is a managed remote host"
        );
    }

    let mut tx = state.pool.begin().await?;
    // Atomically consume the single-use token inside the transaction so two
    // concurrent joins can't both observe it unused and each enroll a host
    // (the old flow validated with a read outside any tx, then stamped used_at
    // unconditionally — a TOCTOU that let one token enroll N hosts).
    let consumed: Option<(Uuid,)> = sqlx::query_as(
        "UPDATE enrollment_tokens SET used_at = datetime('now')
         WHERE token = ? AND used_at IS NULL
           AND (expires_at IS NULL OR expires_at > datetime('now'))
         RETURNING cluster_id",
    )
    .bind(&req.token)
    .fetch_optional(&mut *tx)
    .await?;
    let (cluster_id,) =
        consumed.ok_or_else(|| ApiError::bad_request("invalid or expired join token"))?;

    sqlx::query(
        "INSERT INTO hosts (id, cluster_id, hostname, address, agent_grpc_addr, agent_console_addr, libvirt_uri, state, validation_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_validation', 'pending')
         ON CONFLICT (cluster_id, hostname) DO UPDATE SET
           address = EXCLUDED.address,
           -- Never downgrade an already-routable agent address to a loopback/empty
           -- default: a stray re-join carrying 127.0.0.1 (the agent's bind default)
           -- must not clobber the reachable address the fleet is managing the host by.
           agent_grpc_addr = CASE
             WHEN (EXCLUDED.agent_grpc_addr = '' OR EXCLUDED.agent_grpc_addr LIKE '127.0.0.1:%' OR EXCLUDED.agent_grpc_addr LIKE 'localhost:%')
                  AND hosts.agent_grpc_addr <> ''
                  AND hosts.agent_grpc_addr NOT LIKE '127.0.0.1:%'
                  AND hosts.agent_grpc_addr NOT LIKE 'localhost:%'
               THEN hosts.agent_grpc_addr
             ELSE EXCLUDED.agent_grpc_addr
           END,
           agent_console_addr = EXCLUDED.agent_console_addr,
           libvirt_uri = EXCLUDED.libvirt_uri,
           state = 'pending_validation',
           validation_status = 'pending'",
    )
    .bind(id)
    .bind(cluster_id)
    .bind(&req.hostname)
    .bind(&req.address)
    .bind(&req.agent_grpc_addr)
    .bind(&console_addr)
    .bind(&libvirt_uri)
    .execute(&mut *tx)
    .await?;

    let host_id: Uuid =
        sqlx::query_scalar("SELECT id FROM hosts WHERE cluster_id = ? AND hostname = ?")
            .bind(cluster_id)
            .bind(&req.hostname)
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;

    link_baremetal_firewall_on_join(&state.pool, host_id, &req.hostname).await;

    if let Err(e) = enqueue_task(
        &state,
        "host.validate",
        serde_json::json!({ "host_id": host_id.to_string() }),
        Some("host"),
        Some(host_id),
        Some(host_id),
    )
    .await
    {
        tracing::warn!(host_id = %host_id, "host.validate enqueue failed after join: {}", e.message);
    }

    fetch_host_row(&state, host_id).await.map(Json)
}

async fn link_baremetal_firewall_on_join(pool: &sqlx::SqlitePool, host_id: Uuid, hostname: &str) {
    if let Ok(Some(metal_id)) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM baremetal_servers WHERE hostname = ? LIMIT 1",
    )
    .bind(hostname)
    .fetch_optional(pool)
    .await
    {
        let _ = crate::engine::baremetal::link_host_firewall_profile(pool, metal_id, host_id).await;
    }
}

#[derive(Debug, Deserialize)]
pub struct MaintenanceRequest {
    #[serde(default = "default_maint_action")]
    pub action: String,
    #[serde(default = "default_true")]
    pub evacuate: bool,
}

fn default_maint_action() -> String {
    "enter".into()
}
fn default_true() -> bool {
    true
}

pub async fn host_maintenance(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(req): Json<MaintenanceRequest>,
) -> Result<Json<TaskResponse>, ApiError> {
    require_operator(&actor)?;
    let task_id = enqueue_task(
        &state,
        "host.maintenance",
        serde_json::json!({
            "host_id": id.to_string(),
            "action": req.action,
            "evacuate": req.evacuate,
        }),
        Some("host"),
        Some(id),
        Some(id),
    )
    .await?;
    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "host.maintenance".into(),
    }))
}

#[derive(Debug, serde::Deserialize)]
pub struct CordonRequest {
    /// true = cordon (unschedulable), false = uncordon (schedulable).
    pub cordon: bool,
}

/// Cordon/uncordon a host: toggles `schedulable`. A cordoned host takes no NEW VM
/// placement (see engine/placement.rs) while its existing VMs keep running — the safe
/// "cordon before rolling maintenance" primitive, distinct from maintenance-mode evacuate.
pub async fn cordon_host(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(req): Json<CordonRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let res = sqlx::query("UPDATE hosts SET schedulable = ? WHERE id = ?")
        .bind(!req.cordon)
        .bind(id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(ApiError::not_found("host not found"));
    }
    state.emit_event(
        if req.cordon { "host.cordon" } else { "host.uncordon" },
        format!(
            "Host {} {}",
            id,
            if req.cordon { "cordoned (unschedulable)" } else { "uncordoned (schedulable)" }
        ),
    );
    Ok(Json(serde_json::json!({
        "host_id": id.to_string(),
        "schedulable": !req.cordon,
    })))
}

pub async fn sync_all_hosts(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<TaskResponse>>, ApiError> {
    require_operator(&actor)?;
    let ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM hosts ORDER BY hostname LIMIT 500")
        .fetch_all(&state.pool)
        .await?;
    let mut out = Vec::new();
    for id in ids {
        let task_id = enqueue_task(
            &state,
            "host.inventory",
            serde_json::json!({ "host_id": id.to_string() }),
            Some("host"),
            Some(id),
            Some(id),
        )
        .await?;
        out.push(TaskResponse {
            task_id: task_id.to_string(),
            status: "pending".into(),
            operation: "host.inventory".into(),
        });
    }
    Ok(Json(out))
}

#[derive(Debug, Deserialize)]
pub struct PatchHostBody {
    pub address: Option<String>,
    pub agent_grpc_addr: Option<String>,
    pub libvirt_uri: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub fence_method: Option<String>,
    pub ipmi_address: Option<String>,
    pub ipmi_username: Option<String>,
    pub ipmi_password: Option<String>,
    pub site: Option<String>,
    pub rack: Option<String>,
    pub rack_u: Option<i32>,
}

pub async fn patch_host(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchHostBody>,
) -> Result<Json<HostDetailRow>, ApiError> {
    require_operator(&actor)?;
    let mut tx = state.pool.begin().await?;
    if let Some(v) = &body.address {
        sqlx::query("UPDATE hosts SET address = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.agent_grpc_addr {
        let incoming_loopback =
            v.is_empty() || v.starts_with("127.0.0.1:") || v.starts_with("localhost:");
        let existing_addr: String =
            sqlx::query_scalar("SELECT COALESCE(address, '') FROM hosts WHERE id = ?")
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .unwrap_or_default();
        let host_is_remote = !existing_addr.is_empty()
            && existing_addr != "127.0.0.1"
            && existing_addr != "localhost"
            && !existing_addr.starts_with("127.");
        // Don't let a patch downgrade a managed *remote* host's agent address to a
        // loopback/empty default (an accidental value from a form or an automated
        // sync) — that silently points the controller at its own local agent.
        if incoming_loopback && host_is_remote {
            tracing::warn!(
                host_id = %id, actor = %actor.username, agent_grpc_addr = %v,
                "ignoring host patch that would downgrade a routable agent address to loopback"
            );
        } else {
            sqlx::query("UPDATE hosts SET agent_grpc_addr = ? WHERE id = ?")
                .bind(v)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
    }
    if let Some(v) = &body.libvirt_uri {
        sqlx::query("UPDATE hosts SET libvirt_uri = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.notes {
        sqlx::query("UPDATE hosts SET notes = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(tags) = &body.tags {
        sqlx::query("UPDATE hosts SET tags = ? WHERE id = ?")
            .bind(serde_json::to_string(tags).unwrap_or_else(|_| "[]".into()))
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.fence_method {
        sqlx::query("UPDATE hosts SET fence_method = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.ipmi_address {
        sqlx::query("UPDATE hosts SET ipmi_address = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.ipmi_username {
        sqlx::query("UPDATE hosts SET ipmi_username = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.ipmi_password {
        if !v.is_empty() && v != "***" {
            sqlx::query("UPDATE hosts SET ipmi_password = ? WHERE id = ?")
                .bind(v)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
    }
    if let Some(v) = &body.site {
        sqlx::query("UPDATE hosts SET site = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = &body.rack {
        sqlx::query("UPDATE hosts SET rack = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(v) = body.rack_u {
        sqlx::query("UPDATE hosts SET rack_u = ? WHERE id = ?")
            .bind(v)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    write_audit(
        &state,
        &actor.username,
        "host.patch",
        "host",
        Some(id),
        serde_json::json!({}),
    )
    .await?;
    fetch_host_detail_row(&state, id).await.map(Json)
}

#[derive(Debug, Default, Deserialize)]
pub struct DeleteHostQuery {
    /// Evict a decommissioned/unreachable host even though it still has VM
    /// records assigned, pruning those orphaned records. Guarded so it can never
    /// be used on a host that is still live (see below).
    #[serde(default)]
    pub force: bool,
}

pub async fn delete_host(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Query(q): Query<DeleteHostQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let vm_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vms WHERE host_id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    if vm_count > 0 {
        if !q.force {
            return Err(ApiError::conflict(
                format!("host still has {vm_count} VM record(s) assigned"),
                "Migrate or delete the VMs first. For a decommissioned or unreachable host, \
                 pass ?force=true to evict it and prune its orphaned VM records.",
            )
            .with_code("host_has_vms"));
        }
        // Never force-evict a host that is still live — that would strip real,
        // running VMs of their controller records. Only permit force when the host
        // is offline or its heartbeat is stale (>2m), matching the staleness rule
        // used to render host status elsewhere in this file.
        let row = sqlx::query_as::<_, (String, Option<chrono::DateTime<chrono::Utc>>)>(
            "SELECT COALESCE(state, 'unknown'), last_heartbeat_at FROM hosts WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("host not found"))?;
        let live = row.0 == "online"
            && row
                .1
                .map(|hb| {
                    chrono::Utc::now().signed_duration_since(hb) <= chrono::Duration::minutes(2)
                })
                .unwrap_or(false);
        if live {
            return Err(ApiError::conflict(
                "refusing to force-delete a host that is currently online",
                "Put the host in maintenance and migrate or delete its VMs, or wait for it to \
                 go offline before forcing eviction.",
            )
            .with_code("host_is_live"));
        }
    }
    let mut tx = state.pool.begin().await?;
    // Clear child rows whose FKs to hosts/vms are NOT ON DELETE CASCADE, in dependency
    // order, so the host (and any assigned VM records) can be removed without tripping
    // a FOREIGN KEY constraint. VM-owned rows with ON DELETE CASCADE (snapshots, tags,
    // port-forwards, …) are removed automatically when their vms row goes.
    sqlx::query(
        "DELETE FROM migration_jobs
         WHERE source_host_id = ? OR dest_host_id = ?
            OR vm_id IN (SELECT id FROM vms WHERE host_id = ?)",
    )
    .bind(id)
    .bind(id)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM placement_recommendations WHERE from_host_id = ? OR to_host_id = ?")
        .bind(id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for stmt in [
        "DELETE FROM fence_events WHERE host_id = ?",
        "DELETE FROM maintenance_windows WHERE host_id = ?",
        "DELETE FROM tasks WHERE host_id = ?",
    ] {
        sqlx::query(stmt).bind(id).execute(&mut *tx).await?;
    }
    let pruned = sqlx::query("DELETE FROM vms WHERE host_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    let deleted = sqlx::query("DELETE FROM hosts WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if deleted == 0 {
        // Roll back the (already-issued) VM delete if the host row was gone.
        tx.rollback().await?;
        return Err(ApiError::not_found("host not found"));
    }
    tx.commit().await?;
    write_audit(
        &state,
        &actor.username,
        "host.delete",
        "host",
        Some(id),
        serde_json::json!({ "force": q.force, "vms_pruned": pruned }),
    )
    .await?;
    if pruned > 0 {
        state.emit_event(
            "host.evicted",
            format!("Evicted host and pruned {pruned} orphaned VM record(s) from inventory"),
        );
    }
    Ok(Json(serde_json::json!({ "deleted": true, "vms_pruned": pruned })))
}

pub async fn host_lldp(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<machina_core::libvirt::host_network::LldpInventory>, ApiError> {
    require_admin(&actor)?;
    let row: (String, String) = sqlx::query_as(
        "SELECT hostname, COALESCE(NULLIF(agent_console_addr, ''), agent_grpc_addr)
         FROM hosts WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("host not found"))?;

    let lldp = match crate::engine::network_overlay::fetch_host_lldp(&row.1).await {
        Ok(lldp) => lldp,
        Err(e) => {
            tracing::warn!("{} LLDP live fetch failed: {e}", row.0);
            if let Ok(Some(cached)) = sqlx::query_as::<_, (String, serde_json::Value, String)>(
                "SELECT source, neighbors_json, summary FROM host_lldp_cache WHERE host_id = ?",
            )
            .bind(id)
            .fetch_optional(&state.pool)
            .await
            {
                let neighbors: Vec<machina_core::libvirt::host_network::LldpNeighbor> =
                    serde_json::from_value(cached.1).unwrap_or_default();
                machina_core::libvirt::host_network::LldpInventory {
                    source: format!("{} (cached)", cached.0),
                    neighbors,
                    raw_text: String::new(),
                    summary: cached.2,
                }
            } else {
                machina_core::libvirt::host_network::LldpInventory {
                    source: "unavailable".into(),
                    neighbors: vec![],
                    raw_text: String::new(),
                    summary: format!("LLDP unavailable for {}: {e}", row.0),
                }
            }
        }
    };
    if let Ok(neighbors_json) = serde_json::to_value(&lldp.neighbors) {
        let _ = sqlx::query(
            "INSERT INTO host_lldp_cache (host_id, source, neighbors_json, summary, fetched_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT (host_id) DO UPDATE SET
               source = EXCLUDED.source,
               neighbors_json = EXCLUDED.neighbors_json,
               summary = EXCLUDED.summary,
               fetched_at = datetime('now')",
        )
        .bind(id)
        .bind(&lldp.source)
        .bind(neighbors_json)
        .bind(&lldp.summary)
        .execute(&state.pool)
        .await;
    }
    Ok(Json(lldp))
}

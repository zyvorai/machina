// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use axum::extract::{Extension, Path, Query, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use machina_core::build_precheck;
use machina_core::host_inventory::{
    gather_hardware_inventory_report, inventory_history_jsonl_path, load_inventory_history_entries,
    HardwareInventoryReport,
};
use machina_core::host_platform;
use machina_core::libvirt::node;
use machina_core::libvirt::{extras, storage, virt_builder};
use machina_core::{audit, AuditEvent, LibvirtError, LibvirtManager, MachinaConfig};
use serde::Deserialize;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

use crate::auth::{
    require_api_scope, require_browse_host_paths, require_browser_session_for_host_insight,
    require_destroy_vm, require_usb_pci, RequestActor,
};
use crate::conn_query::{spawn_libvirt_actor, ConnQuery};
use crate::error::AppError;

/// Caps concurrent blocking host probes (`package-updates`, `net-rates`) that can stall the default pool.
static HOST_HEAVY_PROBE_SEM: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(2));

/// Only one mutating package action at a time (can run for a long time and locks package managers).
static HOST_PACKAGE_ACTION_SEM: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(1));

/// Short-lived cache for `virt-builder --list --list-format json` (avoid hammering the tool on every UI poll).
const VIRT_BUILDER_LIST_CACHE_TTL: Duration = Duration::from_secs(300);

struct VirtBuilderIndexCache {
    fetched_at: Instant,
    index: virt_builder::VirtBuilderIndex,
}

static VIRT_BUILDER_INDEX_CACHE: Mutex<Option<VirtBuilderIndexCache>> = Mutex::new(None);

fn log_audit(action: &str, target: &str, result: &str) {
    let event = AuditEvent {
        timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        action: action.to_string(),
        target: target.to_string(),
        result: result.to_string(),
        actor: String::new(),
    };
    audit::write_audit_event(&event);
}

fn log_audit_with_actor(actor: &RequestActor, action: &str, target: &str, result: &str) {
    let event = AuditEvent {
        timestamp: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        action: action.to_string(),
        target: target.to_string(),
        result: result.to_string(),
        actor: actor.username.clone(),
    };
    audit::write_audit_event(&event);
}

// ── ISO / Disk Browser ─────────────────────────────────────────────

async fn list_isos(
    State(manager): State<LibvirtManager>,
) -> Result<Json<extras::BrowseFilesResponse>, AppError> {
    let mgr = manager.clone();
    let res = tokio::task::spawn_blocking(move || mgr.with_conn(extras::list_iso_files))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(res))
}

async fn list_disk_images(
    State(manager): State<LibvirtManager>,
) -> Result<Json<extras::BrowseFilesResponse>, AppError> {
    let mgr = manager.clone();
    let res = tokio::task::spawn_blocking(move || mgr.with_conn(extras::list_disk_images))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(res))
}

#[derive(Deserialize)]
struct BrowseDirQuery {
    /// Absolute directory on the hypervisor; omit or empty to open the first allowed root.
    path: Option<String>,
}

async fn browse_directory_handler(
    Extension(actor): Extension<RequestActor>,
    State(manager): State<LibvirtManager>,
    Query(q): Query<BrowseDirQuery>,
) -> Result<Json<extras::BrowseDirResponse>, AppError> {
    require_browse_host_paths(&actor)?;
    let path = q.path.unwrap_or_default();
    let mgr = manager.clone();
    let res =
        tokio::task::spawn_blocking(move || mgr.with_conn(|c| extras::browse_directory(c, &path)))
            .await
            .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(res))
}

#[derive(Deserialize)]
struct DeleteImageQuery {
    path: String,
}

async fn delete_disk_image(
    Extension(actor): Extension<RequestActor>,
    State(manager): State<LibvirtManager>,
    Query(q): Query<DeleteImageQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_destroy_vm(&actor)?;
    let path = q.path.trim().to_string();
    if path.is_empty() {
        return Err(AppError::from(LibvirtError::Invalid(
            "path is required".into(),
        )));
    }
    let mgr = manager.clone();
    let allowed_prefixes: Vec<String> = tokio::task::spawn_blocking(move || {
        mgr.with_conn(storage::disk_image_delete_allowed_prefixes)
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    if !allowed_prefixes.iter().any(|p| path.starts_with(p)) {
        return Err(AppError::from(LibvirtError::Invalid(format!(
            "Path not in an allowed images directory: {path}"
        ))));
    }
    // Reject path traversal.
    if path.contains("..") {
        return Err(AppError::from(LibvirtError::Invalid(
            "Path traversal not allowed".into(),
        )));
    }
    // Only delete known disk image extensions.
    let ok_ext = path.ends_with(".qcow2")
        || path.ends_with(".raw")
        || path.ends_with(".img")
        || path.ends_with(".vmdk");
    if !ok_ext {
        return Err(AppError::from(LibvirtError::Invalid(format!(
            "File extension not allowed for deletion: {path}"
        ))));
    }
    match std::fs::remove_file(&path) {
        Ok(()) => {
            log_audit("delete-disk-image", &path, "ok");
            Ok(Json(
                serde_json::json!({ "status": "deleted", "path": path }),
            ))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Json(
            serde_json::json!({ "status": "not_found", "path": path }),
        )),
        Err(e) => Err(AppError::from(LibvirtError::Operation(format!(
            "Failed to delete {path}: {e}"
        )))),
    }
}

#[derive(Debug, Deserialize)]
struct VirtBuilderListQuery {
    /// When true, bypass the in-memory cache and re-run `virt-builder --list --list-format json`.
    #[serde(default)]
    refresh: bool,
}

struct VirtBuilderCatalogMeta {
    allowed: bool,
    installed: bool,
    version: Option<String>,
    catalog_error: Option<String>,
}

fn virt_builder_catalog_json(
    index: &virt_builder::VirtBuilderIndex,
    cached: bool,
    cache_age_secs: Option<u64>,
    meta: VirtBuilderCatalogMeta,
) -> serde_json::Value {
    let names: Vec<String> = index.items.iter().map(|i| i.name.clone()).collect();
    serde_json::json!({
        "virt_builder_allowed": meta.allowed,
        "virt_builder_installed": meta.installed,
        "virt_builder_version": meta.version,
        "catalog_error": meta.catalog_error,
        "format_version": index.format_version,
        "source_uri": index.source_uri,
        "items": index.items,
        "templates": names,
        "cached": cached,
        "cache_age_secs": cache_age_secs,
    })
}

fn empty_virt_builder_index() -> virt_builder::VirtBuilderIndex {
    virt_builder::VirtBuilderIndex {
        format_version: 0,
        source_uri: None,
        items: Vec::new(),
    }
}

async fn list_virt_builder_templates(
    Query(q): Query<VirtBuilderListQuery>,
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = MachinaConfig::load();
    let allowed = cfg.libvirt.virt_builder_allowed;

    let (installed, version) = tokio::task::spawn_blocking(|| {
        let ins = virt_builder::virt_builder_installed();
        let ver = if ins {
            virt_builder::virt_builder_version_line().ok()
        } else {
            None
        };
        (ins, ver)
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))?;

    if !allowed {
        return Ok(Json(virt_builder_catalog_json(
            &empty_virt_builder_index(),
            false,
            None,
            VirtBuilderCatalogMeta {
                allowed: false,
                installed,
                version,
                catalog_error: Some(
                    "virt-builder is disabled ([libvirt] virt_builder_allowed = false); use mkosi_workspace / mkosi build."
                        .into(),
                ),
            },
        )));
    }

    if !installed {
        return Ok(Json(virt_builder_catalog_json(
            &empty_virt_builder_index(),
            false,
            None,
            VirtBuilderCatalogMeta {
                allowed: true,
                installed: false,
                version: None,
                catalog_error: Some(
                    "virt-builder is not installed on this host (install libguestfs-tools or guestfs-tools)."
                        .into(),
                ),
            },
        )));
    }

    if !q.refresh {
        if let Ok(guard) = VIRT_BUILDER_INDEX_CACHE.lock() {
            if let Some(ref c) = *guard {
                let age = c.fetched_at.elapsed();
                if age < VIRT_BUILDER_LIST_CACHE_TTL {
                    return Ok(Json(virt_builder_catalog_json(
                        &c.index,
                        true,
                        Some(age.as_secs()),
                        VirtBuilderCatalogMeta {
                            allowed: true,
                            installed: true,
                            version: version.clone(),
                            catalog_error: None,
                        },
                    )));
                }
            }
        }
    }

    match tokio::task::spawn_blocking(virt_builder::list_builder_index).await {
        Ok(Ok(index)) => {
            if let Ok(mut g) = VIRT_BUILDER_INDEX_CACHE.lock() {
                *g = Some(VirtBuilderIndexCache {
                    fetched_at: Instant::now(),
                    index: index.clone(),
                });
            }
            Ok(Json(virt_builder_catalog_json(
                &index,
                false,
                None,
                VirtBuilderCatalogMeta {
                    allowed: true,
                    installed: true,
                    version,
                    catalog_error: None,
                },
            )))
        }
        Ok(Err(e)) => {
            let msg = e.to_string();
            Ok(Json(virt_builder_catalog_json(
                &empty_virt_builder_index(),
                false,
                None,
                VirtBuilderCatalogMeta {
                    allowed: true,
                    installed: true,
                    version,
                    catalog_error: Some(msg),
                },
            )))
        }
        Err(e) => Err(AppError::from(LibvirtError::Internal(format!(
            "Task failed: {e}"
        )))),
    }
}

async fn virt_builder_probe_template_handler(
    State(_m): State<LibvirtManager>,
    Path(template): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = MachinaConfig::load();
    if !cfg.libvirt.virt_builder_allowed {
        return Ok(Json(serde_json::json!({
            "virt_builder_allowed": false,
            "name_valid": false,
            "in_cached_catalog": false,
            "hint": "Enable [libvirt] virt_builder_allowed = true on the daemon.",
        })));
    }
    let t = template.trim().to_string();
    if let Err(e) = machina_core::validate::validate_virt_builder_os(&t) {
        return Ok(Json(serde_json::json!({
            "virt_builder_allowed": true,
            "name_valid": false,
            "in_cached_catalog": false,
            "hint": e.to_string(),
        })));
    }

    let in_cached = tokio::task::spawn_blocking(move || {
        if let Ok(guard) = VIRT_BUILDER_INDEX_CACHE.lock() {
            if let Some(ref c) = *guard {
                return c.index.items.iter().any(|i| i.name == t);
            }
        }
        false
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))?;

    let hint = if in_cached {
        serde_json::Value::Null
    } else {
        serde_json::json!("Name format is valid but this id is not in the server catalog cache; refresh the virt-builder catalog on Disk images or check spelling.")
    };

    Ok(Json(serde_json::json!({
        "virt_builder_allowed": true,
        "name_valid": true,
        "in_cached_catalog": in_cached,
        "hint": hint,
    })))
}

async fn list_virt_image_output_roots(
    State(manager): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mgr = manager.clone();
    let prefixes = tokio::task::spawn_blocking(move || {
        mgr.with_conn(storage::disk_image_delete_allowed_prefixes)
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    let tmpdir = build_precheck::effective_tmpdir();
    Ok(Json(serde_json::json!({
        "allowed_prefixes": prefixes,
        "effective_tmpdir": tmpdir.to_string_lossy(),
    })))
}

async fn virt_image_build_handler(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(conn_q): Query<ConnQuery>,
    Json(mut req): Json<virt_image_build::BuildDiskRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !MachinaConfig::load().libvirt.virt_builder_allowed {
        return Err(AppError::from(LibvirtError::Invalid(
            "virt-builder / virt-image-build is disabled ([libvirt] virt_builder_allowed = false)"
                .into(),
        )));
    }

    let out_path = req.output.trim().to_string();
    if out_path.is_empty() {
        return Err(AppError::from(LibvirtError::Invalid(
            "output is required".into(),
        )));
    }

    let timeout_secs = MachinaConfig::load().libvirt.virt_image_build_timeout_secs;
    if req.timeout_secs == 0 && timeout_secs > 0 {
        req.timeout_secs = timeout_secs;
    }

    let block = spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        crate::virt_image_validate::validate_virt_image_build(conn, &req)?;
        virt_image_build::build_disk_image(&req).map_err(|e| LibvirtError::Operation(e.to_string()))
    })
    .await;

    match block {
        Ok(()) => {
            log_audit("virt-image-build", &out_path, "ok");
            Ok(Json(
                serde_json::json!({ "status": "ok", "path": out_path }),
            ))
        }
        Err(e) => {
            log_audit("virt-image-build", &out_path, "error");
            Err(e)
        }
    }
}

async fn list_mkosi_workspaces_handler(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let workspaces = extras::list_mkosi_workspaces();
    Ok(Json(serde_json::json!(workspaces)))
}

async fn virt_builder_notes_handler(
    State(_m): State<LibvirtManager>,
    Path(template): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !MachinaConfig::load().libvirt.virt_builder_allowed {
        return Err(AppError::from(LibvirtError::Invalid(
            "virt-builder is disabled ([libvirt] virt_builder_allowed = false); use mkosi_workspace / mkosi build".into(),
        )));
    }
    let t = template.clone();
    let notes = tokio::task::spawn_blocking(move || virt_builder::template_notes(&t))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(
        serde_json::json!({ "template": template, "notes": notes }),
    ))
}

// ── USB Passthrough ────────────────────────────────────────────────

async fn list_usb(State(_m): State<LibvirtManager>) -> Result<Json<serde_json::Value>, AppError> {
    let devices = extras::list_usb_devices()?;
    Ok(Json(serde_json::json!(devices)))
}

#[derive(Deserialize)]
struct UsbRequest {
    vendor_id: String,
    product_id: String,
}

async fn attach_usb_handler(
    Extension(actor): Extension<RequestActor>,
    State(m): State<LibvirtManager>,
    Query(conn_q): Query<ConnQuery>,
    Path(name): Path<String>,
    Json(req): Json<UsbRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_usb_pci(&actor)?;
    let vid = req.vendor_id.clone();
    let pid = req.product_id.clone();
    let name2 = name.clone();
    spawn_libvirt_actor(m, Some(&actor), conn_q, move |conn| {
        extras::attach_usb(conn, &name2, &vid, &pid)
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "attached", "name": name }),
    ))
}

async fn detach_usb_handler(
    Extension(actor): Extension<RequestActor>,
    State(m): State<LibvirtManager>,
    Query(conn_q): Query<ConnQuery>,
    Path(name): Path<String>,
    Json(req): Json<UsbRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_usb_pci(&actor)?;
    let vid = req.vendor_id.clone();
    let pid = req.product_id.clone();
    let name2 = name.clone();
    spawn_libvirt_actor(m, Some(&actor), conn_q, move |conn| {
        extras::detach_usb(conn, &name2, &vid, &pid)
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "detached", "name": name }),
    ))
}

// ── Cloud-init ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CloudInitRequest {
    hostname: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    ssh_key: String,
    #[serde(default)]
    output_path: String,
}

async fn generate_cloud_init(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(conn_q): Query<ConnQuery>,
    Json(req): Json<CloudInitRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let output_path = req.output_path.clone();
    let hostname = req.hostname.clone();
    let username = req.username.clone();
    let password = req.password.clone();
    let ssh_key = req.ssh_key.clone();
    let path = spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        let default_dir = storage::primary_vm_disk_base_dir(conn)
            .unwrap_or_else(|| "/var/lib/libvirt/images".to_string());
        let cfg = MachinaConfig::load().libvirt;
        extras::generate_cloud_init_iso(
            &output_path,
            &default_dir,
            &hostname,
            &username,
            &password,
            &ssh_key,
            Some(&cfg),
        )
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "created", "path": path }),
    ))
}

// ── VM Import ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ImportRequest {
    source: String,
    dest_name: String,
}

async fn import_disk(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(conn_q): Query<ConnQuery>,
    Json(req): Json<ImportRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let source = req.source.clone();
    let dest_name = req.dest_name.clone();
    let path = spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        extras::import_disk_image(conn, &source, &dest_name)
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "imported", "path": path }),
    ))
}

// ── Live Resize ────────────────────────────────────────────────────

async fn live_vcpus_handler(
    State(m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(conn_q): Query<ConnQuery>,
    Path((name, count)): Path<(String, u32)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name2 = name.clone();
    spawn_libvirt_actor(m, Some(&actor), conn_q, move |conn| {
        extras::live_set_vcpus(conn, &name2, count)
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "name": name, "vcpus": count, "live": true }),
    ))
}

async fn live_memory_handler(
    State(m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(conn_q): Query<ConnQuery>,
    Path((name, mb)): Path<(String, u64)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name2 = name.clone();
    spawn_libvirt_actor(m, Some(&actor), conn_q, move |conn| {
        extras::live_set_memory(conn, &name2, mb)
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "name": name, "memory_mb": mb, "live": true }),
    ))
}

// ── DHCP Leases ────────────────────────────────────────────────────

async fn list_dhcp_leases(
    State(m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(conn_q): Query<ConnQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = spawn_libvirt_actor(m, Some(&actor), conn_q, extras::list_dhcp_leases).await?;
    Ok(Json(serde_json::json!(result)))
}

// ── Host System Stats ──────────────────────────────────────────────

async fn get_host_stats(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let stats = extras::get_host_stats();
    Ok(Json(serde_json::json!(stats)))
}

async fn get_host_linux_observability(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let obs = tokio::task::spawn_blocking(machina_core::host_linux_obs::gather_linux_observability)
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(obs)))
}

async fn get_host_linux_audit(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let report =
        tokio::task::spawn_blocking(machina_core::linux_audit::gather_linux_audit_configured)
            .await
            .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(report)))
}

async fn get_host_filesystems(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = tokio::task::spawn_blocking(extras::list_host_filesystems)
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(rows)))
}

#[derive(Deserialize)]
struct HostProcessesQuery {
    /// Max rows to return (1–100, default 20).
    #[serde(default)]
    limit: Option<u32>,
    /// `rss` (default) = highest memory; `cpu` = highest %CPU.
    #[serde(default)]
    sort: Option<String>,
}

fn host_top_process_order(q: &HostProcessesQuery) -> extras::HostTopProcessOrder {
    match q
        .sort
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("cpu" | "pcpu") => extras::HostTopProcessOrder::Cpu,
        _ => extras::HostTopProcessOrder::Rss,
    }
}

async fn get_host_processes(
    State(_m): State<LibvirtManager>,
    Query(q): Query<HostProcessesQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let limit = q.limit.unwrap_or(20);
    let order = host_top_process_order(&q);
    let rows = tokio::task::spawn_blocking(move || extras::list_host_top_processes(limit, order))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(rows)))
}

#[derive(Deserialize)]
struct HostKillProcessBody {
    pid: u32,
    /// `TERM` (default) or `KILL`.
    #[serde(default)]
    signal: Option<String>,
}

async fn post_host_kill_process(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Json(body): Json<HostKillProcessBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    require_browse_host_paths(&actor)?;
    let pid = body.pid;
    let sig = body
        .signal
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("TERM")
        .to_string();
    let target = format!("pid={pid} signal={sig}");
    let sig_for_block = sig.clone();
    let res = tokio::task::spawn_blocking(move || extras::kill_host_process(pid, &sig_for_block))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))?;
    match res {
        Ok(()) => {
            log_audit_with_actor(&actor, "host-process-kill", &target, "ok");
            Ok(Json(serde_json::json!({
                "ok": true,
                "pid": pid,
                "signal": sig,
            })))
        }
        Err(e) => {
            let msg = e.to_string();
            log_audit_with_actor(&actor, "host-process-kill", &target, &msg);
            Err(AppError::from(e))
        }
    }
}

#[derive(Deserialize)]
struct HostListLimitQuery {
    /// 1–500; defaults differ per handler.
    #[serde(default)]
    limit: Option<u32>,
}

async fn get_host_package_updates(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let _permit = HOST_HEAVY_PROBE_SEM.acquire().await.map_err(|_| {
        AppError::from(LibvirtError::Internal(
            "host probe concurrency limiter closed".into(),
        ))
    })?;
    let res = tokio::task::spawn_blocking(host_platform::check_package_updates)
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(res)))
}

#[derive(Deserialize, Default)]
struct HostPackageUpgradeBody {
    /// When true, only simulates upgrade (no system changes); returns tool output in the same shape as a real run.
    #[serde(default)]
    dry_run: Option<bool>,
}

async fn post_host_package_upgrade(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Json(body): Json<HostPackageUpgradeBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let _permit = HOST_PACKAGE_ACTION_SEM.acquire().await.map_err(|_| {
        AppError::from(LibvirtError::Internal(
            "host package action concurrency limiter closed".into(),
        ))
    })?;
    let dry = body.dry_run.unwrap_or(false);
    let res = if dry {
        tokio::task::spawn_blocking(host_platform::package_upgrade_preview)
            .await
            .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??
    } else {
        tokio::task::spawn_blocking(host_platform::package_upgrade)
            .await
            .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??
    };
    let audit_result = if res.ok { "ok" } else { "failed" };
    log_audit(
        if dry {
            "host-package-upgrade-preview"
        } else {
            "host-package-upgrade"
        },
        "host",
        &format!("{audit_result} exit={}", res.exit_code),
    );
    Ok(Json(serde_json::json!(res)))
}

async fn post_host_package_autoremove(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let _permit = HOST_PACKAGE_ACTION_SEM.acquire().await.map_err(|_| {
        AppError::from(LibvirtError::Internal(
            "host package action concurrency limiter closed".into(),
        ))
    })?;
    let res = tokio::task::spawn_blocking(host_platform::package_autoremove)
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    let audit_result = if res.ok { "ok" } else { "failed" };
    log_audit(
        "host-package-autoremove",
        "host",
        &format!("{audit_result} exit={}", res.exit_code),
    );
    Ok(Json(serde_json::json!(res)))
}

#[derive(Deserialize)]
struct HostPackagesBody {
    /// Package names or pins (install/remove); max 32.
    packages: Vec<String>,
}

async fn post_host_package_install(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Json(body): Json<HostPackagesBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let _permit = HOST_PACKAGE_ACTION_SEM.acquire().await.map_err(|_| {
        AppError::from(LibvirtError::Internal(
            "host package action concurrency limiter closed".into(),
        ))
    })?;
    let pkgs = body.packages;
    let target = pkgs.join(",").chars().take(240).collect::<String>();
    let res = tokio::task::spawn_blocking(move || host_platform::package_install(pkgs))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    let audit_result = if res.ok { "ok" } else { "failed" };
    log_audit(
        "host-package-install",
        &target,
        &format!("{audit_result} exit={}", res.exit_code),
    );
    Ok(Json(serde_json::json!(res)))
}

#[derive(Deserialize)]
struct HostPackageRemoveBody {
    packages: Vec<String>,
    #[serde(default)]
    purge: Option<bool>,
}

async fn post_host_package_remove(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Json(body): Json<HostPackageRemoveBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let _permit = HOST_PACKAGE_ACTION_SEM.acquire().await.map_err(|_| {
        AppError::from(LibvirtError::Internal(
            "host package action concurrency limiter closed".into(),
        ))
    })?;
    let pkgs = body.packages;
    let purge = body.purge.unwrap_or(false);
    let target = pkgs.join(",").chars().take(240).collect::<String>();
    let res = tokio::task::spawn_blocking(move || host_platform::package_remove(pkgs, purge))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    let audit_result = if res.ok { "ok" } else { "failed" };
    log_audit(
        "host-package-remove",
        &target,
        &format!("{audit_result} exit={}", res.exit_code),
    );
    Ok(Json(serde_json::json!(res)))
}

async fn get_host_net_counters(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let rows = tokio::task::spawn_blocking(host_platform::list_net_dev_counters)
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(rows)))
}

#[derive(Deserialize)]
struct NetRatesQuery {
    /// Milliseconds between two `/proc/net/dev` reads (50–5000, default 1000).
    #[serde(default)]
    interval_ms: Option<u64>,
}

async fn get_host_net_rates(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(q): Query<NetRatesQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let _permit = HOST_HEAVY_PROBE_SEM.acquire().await.map_err(|_| {
        AppError::from(LibvirtError::Internal(
            "host probe concurrency limiter closed".into(),
        ))
    })?;
    let ms = q.interval_ms.unwrap_or(1000).clamp(50, 5000);
    let res = tokio::task::spawn_blocking(move || host_platform::list_net_dev_rates(ms))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(res)))
}

async fn get_host_passwd_users(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(q): Query<HostListLimitQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let lim = q.limit.unwrap_or(150).clamp(1, 500) as usize;
    let rows = tokio::task::spawn_blocking(move || host_platform::list_passwd_entries(lim))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(rows)))
}

async fn get_host_groups(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(q): Query<HostListLimitQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let lim = q.limit.unwrap_or(150).clamp(1, 500) as usize;
    let rows = tokio::task::spawn_blocking(move || host_platform::list_group_entries(lim))
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(rows)))
}

async fn get_host_security_summary(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let s = tokio::task::spawn_blocking(host_platform::host_security_summary)
        .await
        .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(serde_json::json!(s)))
}

// ── Save VM as Template ────────────────────────────────────────────

#[derive(Deserialize)]
struct SaveTemplateRequest {
    template_name: String,
}

async fn save_template_handler(
    State(m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(conn_q): Query<ConnQuery>,
    Path(name): Path<String>,
    Json(req): Json<SaveTemplateRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name2 = name.clone();
    let template_name = req.template_name.clone();
    spawn_libvirt_actor(m, Some(&actor), conn_q, move |conn| {
        extras::save_vm_as_template(conn, &name2, &template_name)
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "saved", "name": name, "template": req.template_name }),
    ))
}

// ── Audit Log ──────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct AuditLogQuery {
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    actor: Option<String>,
    #[serde(default)]
    q: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

async fn get_audit_log(
    State(_m): State<LibvirtManager>,
    Query(q): Query<AuditLogQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut events = audit::load_audit_events(10_000);
    if let Some(ref a) = q.action {
        let a = a.to_lowercase();
        events.retain(|e| e.action.to_lowercase().contains(&a));
    }
    if let Some(ref ac) = q.actor {
        let ac = ac.to_lowercase();
        events.retain(|e| e.actor.to_lowercase().contains(&ac));
    }
    if let Some(ref s) = q.q {
        let s = s.to_lowercase();
        events.retain(|e| {
            e.action.to_lowercase().contains(&s)
                || e.target.to_lowercase().contains(&s)
                || e.result.to_lowercase().contains(&s)
                || e.actor.to_lowercase().contains(&s)
        });
    }
    if let Some(lim) = q.limit {
        let lim = lim.max(1).min(10_000);
        if events.len() > lim {
            events.truncate(lim);
        }
    } else if events.len() > 500 {
        events.truncate(500);
    }
    Ok(Json(serde_json::json!(events)))
}

async fn export_audit_log(
    Extension(actor): Extension<RequestActor>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    require_api_scope(&actor, "audit:read").map_err(AppError::from)?;
    use axum::http::header;
    let body = audit::export_audit_ndjson(100_000);
    Ok(([(header::CONTENT_TYPE, "application/x-ndjson")], body))
}

#[derive(Deserialize)]
struct AuditVerifyQuery {
    #[serde(default = "default_audit_verify_max")]
    max_lines: usize,
}

fn default_audit_verify_max() -> usize {
    50_000
}

async fn verify_audit_log_handler(
    Extension(actor): Extension<RequestActor>,
    Query(q): Query<AuditVerifyQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_api_scope(&actor, "audit:read").map_err(AppError::from)?;
    let report = audit::verify_audit_log(q.max_lines);
    Ok(Json(serde_json::json!(report)))
}

// ── Tags (all tags summary) ──────────────────────────────────────

async fn get_all_tags_handler(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let map = extras::load_tags();
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for tags in map.values() {
        for tag in tags {
            *counts.entry(tag.clone()).or_insert(0) += 1;
        }
    }
    Ok(Json(serde_json::json!(counts)))
}

// ── PCI Passthrough ───────────────────────────────────────────────

async fn list_pci_handler(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let devices = extras::list_pci_devices()?;
    Ok(Json(serde_json::json!(devices)))
}

// ── IOMMU Groups ─────────────────────────────────────────────────

async fn list_iommu_groups_handler(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let groups = extras::list_iommu_groups()?;
    Ok(Json(serde_json::json!(groups)))
}

// ── Systemd Services ──────────────────────────────────────────────

async fn list_services_handler(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let services = extras::list_services()?;
    Ok(Json(serde_json::json!(services)))
}

async fn service_action_handler(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Path((name, action)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_destroy_vm(&actor)?;
    log_audit_with_actor(&actor, "service_action", &format!("{action} {name}"), "");
    extras::service_action(&name, &action)?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "service": name, "action": action }),
    ))
}

// ── System Logs ───────────────────────────────────────────────────

async fn get_logs_handler(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let lines: u32 = params
        .get("lines")
        .and_then(|v| v.parse().ok())
        .unwrap_or(100);
    let priority = params.get("priority").map(|s| s.as_str());
    let unit = params.get("unit").map(|s| s.as_str());
    let boot = params.get("boot").and_then(|v| v.parse::<i32>().ok());
    let since = params.get("since").map(|s| s.as_str());
    let until = params.get("until").map(|s| s.as_str());
    let grep = params.get("grep").map(|s| s.as_str());
    let uid = params.get("uid").and_then(|v| v.parse::<u32>().ok());
    let pid = params.get("pid").and_then(|v| v.parse::<u32>().ok());
    let kernel_only = params
        .get("kernel")
        .map(|v| matches!(v.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    let entries = extras::get_journal_logs(
        lines,
        priority,
        unit,
        boot,
        since,
        until,
        grep,
        uid,
        pid,
        kernel_only,
    )?;
    Ok(Json(serde_json::json!(entries)))
}

async fn list_log_boots_handler(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let boots = extras::get_journal_boots()?;
    Ok(Json(serde_json::json!(boots)))
}

// ── Host Shutdown/Reboot ──────────────────────────────────────────

async fn host_shutdown_handler(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_destroy_vm(&actor)?;
    log_audit_with_actor(&actor, "host_shutdown", "host", "");
    extras::host_shutdown()?;
    Ok(Json(serde_json::json!({ "status": "shutting_down" })))
}

async fn host_reboot_handler(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_destroy_vm(&actor)?;
    log_audit_with_actor(&actor, "host_reboot", "host", "");
    extras::host_reboot()?;
    Ok(Json(serde_json::json!({ "status": "rebooting" })))
}

// ── Host System Info ──────────────────────────────────────────────

/// Linux sysfs + DMI + `/proc/cpuinfo`, merged with libvirt node caps (inventory / audit).
async fn get_hardware_inventory_handler(
    State(manager): State<LibvirtManager>,
) -> Result<Json<HardwareInventoryReport>, AppError> {
    let mgr = manager.clone();
    let report = tokio::task::spawn_blocking(move || {
        let libvirt = mgr.with_conn(node::get_node_info).ok();
        gather_hardware_inventory_report(libvirt)
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))??;
    Ok(Json(report))
}

#[derive(Deserialize)]
struct InventoryHistoryQuery {
    limit: Option<usize>,
}

/// Newest JSON Lines from `/var/lib/machina/hardware-inventory.jsonl` (written by the periodic inventory task).
async fn get_hardware_inventory_history_handler(
    State(_manager): State<LibvirtManager>,
    Query(q): Query<InventoryHistoryQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let limit = q.limit.unwrap_or(80).min(5000).max(1);
    let entries = load_inventory_history_entries(limit)?;
    Ok(Json(serde_json::json!({
        "path": inventory_history_jsonl_path().display().to_string(),
        "entries": entries,
    })))
}

async fn get_system_info_handler(
    State(_m): State<LibvirtManager>,
) -> Result<Json<serde_json::Value>, AppError> {
    let info = extras::get_system_info()?;
    Ok(Json(serde_json::json!(info)))
}

#[derive(Deserialize)]
struct SetHostnameRequest {
    hostname: String,
}

async fn set_hostname_handler(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Json(req): Json<SetHostnameRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    log_audit_with_actor(&actor, "set_hostname", &req.hostname, "");
    extras::set_hostname(&req.hostname)?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "hostname": req.hostname }),
    ))
}

#[derive(Deserialize)]
struct SetTimezoneRequest {
    timezone: String,
}

async fn set_timezone_handler(
    State(_m): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Json(req): Json<SetTimezoneRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    log_audit_with_actor(&actor, "set_timezone", &req.timezone, "");
    extras::set_timezone(&req.timezone)?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "timezone": req.timezone }),
    ))
}

#[derive(Deserialize)]
struct CockpitSectionQuery {
    section: Option<String>,
}

async fn get_host_cockpit_handler(
    Extension(actor): Extension<RequestActor>,
    Query(q): Query<CockpitSectionQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_browser_session_for_host_insight(&actor).map_err(AppError::from)?;
    let section = q.section.as_deref().unwrap_or("all");
    let storage = if section == "all" || section == "storage" {
        Some(
            tokio::task::spawn_blocking(machina_core::host_cockpit::storage_inventory)
                .await
                .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))?
                .map_err(AppError::from)?,
        )
    } else {
        None
    };
    let network = if section == "all" || section == "network" {
        Some(
            tokio::task::spawn_blocking(machina_core::host_cockpit::network_inventory)
                .await
                .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))?
                .map_err(AppError::from)?,
        )
    } else {
        None
    };
    let system = if section == "all" || section == "system" {
        Some(
            tokio::task::spawn_blocking(machina_core::host_cockpit::system_inventory)
                .await
                .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))?
                .map_err(AppError::from)?,
        )
    } else {
        None
    };
    Ok(Json(
        serde_json::json!({ "storage": storage, "network": network, "system": system }),
    ))
}

#[derive(Deserialize)]
struct CockpitActionBody {
    action: String,
    #[serde(default)]
    payload: serde_json::Value,
}

async fn post_host_cockpit_action_handler(
    Extension(actor): Extension<RequestActor>,
    Json(body): Json<CockpitActionBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_destroy_vm(&actor)?;
    let result = tokio::task::spawn_blocking(move || match body.action.as_str() {
        "cockpit.firewalld.add_service" => {
            let zone = body
                .payload
                .get("zone")
                .and_then(|v| v.as_str())
                .unwrap_or("public");
            let service = body
                .payload
                .get("service")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("service required".into()))?;
            machina_core::host_cockpit::firewalld_add_service(zone, service)
        }
        "cockpit.selinux.set_enforce" => {
            let enforcing = body
                .payload
                .get("enforcing")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            machina_core::host_cockpit::selinux_set_enforce(enforcing)
        }
        "cockpit.tuned.set_profile" => {
            let profile = body
                .payload
                .get("profile")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("profile required".into()))?;
            machina_core::host_cockpit::tuned_set_profile(profile)
        }
        "cockpit.nm.create_bond" => {
            let name = body
                .payload
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("name required".into()))?;
            let ifaces: Vec<String> = body
                .payload
                .get("interfaces")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            machina_core::host_cockpit::nm_create_bond(name, &ifaces)
        }
        "cockpit.nm.create_team" => {
            let name = body
                .payload
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("name required".into()))?;
            let runner = body
                .payload
                .get("runner")
                .and_then(|v| v.as_str())
                .unwrap_or("loadbalance");
            let ifaces: Vec<String> = body
                .payload
                .get("interfaces")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            machina_core::host_cockpit::nm_create_team(name, &ifaces, runner)
        }
        "cockpit.nm.create_vlan" => {
            let name = body
                .payload
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let parent = body
                .payload
                .get("parent")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("parent required".into()))?;
            let vlan_id = body
                .payload
                .get("vlan_id")
                .and_then(|v| v.as_u64())
                .and_then(|n| u32::try_from(n).ok())
                .ok_or_else(|| LibvirtError::Invalid("vlan_id required".into()))?;
            machina_core::host_cockpit::nm_create_vlan(name, parent, vlan_id)
        }
        "cockpit.nm.create_wifi" => {
            let ssid = body
                .payload
                .get("ssid")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("ssid required".into()))?;
            let password = body
                .payload
                .get("password")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            machina_core::host_cockpit::nm_create_wifi(ssid, password)
        }
        "cockpit.nm.create_wireguard" => {
            let name = body
                .payload
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("name required".into()))?;
            let address = body
                .payload
                .get("address")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("address required".into()))?;
            let private_key = body
                .payload
                .get("private_key")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let peer_public_key = body
                .payload
                .get("peer_public_key")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("peer_public_key required".into()))?;
            let endpoint = body
                .payload
                .get("endpoint")
                .and_then(|v| v.as_str())
                .ok_or_else(|| LibvirtError::Invalid("endpoint required".into()))?;
            let allowed_ips = body
                .payload
                .get("allowed_ips")
                .and_then(|v| v.as_str())
                .unwrap_or("0.0.0.0/0");
            machina_core::host_cockpit::nm_create_wireguard(
                name,
                address,
                private_key,
                peer_public_key,
                endpoint,
                allowed_ips,
            )
        }
        "cockpit.packagekit.refresh" => machina_core::host_cockpit::packagekit_refresh(),
        "host.package.install" => {
            let pkgs: Vec<String> = body
                .payload
                .get("packages")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            if pkgs.is_empty() {
                return Err(LibvirtError::Invalid("packages required".into()));
            }
            let res = machina_core::host_platform::package_install(pkgs)?;
            if !res.ok {
                let detail = res.stderr.trim();
                return Err(LibvirtError::Operation(if detail.is_empty() {
                    format!("{} failed (exit {})", res.command, res.exit_code)
                } else {
                    detail.lines().next().unwrap_or(detail).to_string()
                }));
            }
            let msg = res.stdout.trim();
            Ok(if msg.is_empty() {
                format!("{} succeeded", res.command)
            } else {
                msg.lines().last().unwrap_or(msg).to_string()
            })
        }
        "host.package.remove" => {
            let pkgs: Vec<String> = body
                .payload
                .get("packages")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            if pkgs.is_empty() {
                return Err(LibvirtError::Invalid("packages required".into()));
            }
            let purge = body
                .payload
                .get("purge")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let res = machina_core::host_platform::package_remove(pkgs, purge)?;
            if !res.ok {
                let detail = res.stderr.trim();
                return Err(LibvirtError::Operation(if detail.is_empty() {
                    format!("{} failed (exit {})", res.command, res.exit_code)
                } else {
                    detail.lines().next().unwrap_or(detail).to_string()
                }));
            }
            let msg = res.stdout.trim();
            Ok(if msg.is_empty() {
                format!("{} succeeded", res.command)
            } else {
                msg.lines().last().unwrap_or(msg).to_string()
            })
        }
        other => Err(LibvirtError::Invalid(format!("unknown action: {other}"))),
    })
    .await
    .map_err(|e| AppError::from(LibvirtError::Internal(format!("Task failed: {e}"))))?
    .map_err(AppError::from)?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "message": result }),
    ))
}

// ── Router ─────────────────────────────────────────────────────────

pub fn extras_routes() -> Router<LibvirtManager> {
    Router::new()
        // Browser
        .route("/browse/isos", get(list_isos))
        .route("/browse/dir", get(browse_directory_handler))
        .route("/browse/disks", get(list_disk_images))
        .route("/browse/disks/delete", delete(delete_disk_image))
        .route(
            "/browse/virt-image-output-roots",
            get(list_virt_image_output_roots),
        )
        .route("/browse/virt-builder", get(list_virt_builder_templates))
        .route(
            "/browse/virt-builder/probe/{template}",
            get(virt_builder_probe_template_handler),
        )
        .route("/browse/virt-image-build", post(virt_image_build_handler))
        .route(
            "/browse/virt-builder/notes/{template}",
            get(virt_builder_notes_handler),
        )
        .route(
            "/browse/mkosi-workspaces",
            get(list_mkosi_workspaces_handler),
        )
        // USB
        .route("/host/usb", get(list_usb))
        .route("/vms/{name}/usb/attach", post(attach_usb_handler))
        .route("/vms/{name}/usb/detach", post(detach_usb_handler))
        // Cloud-init
        .route("/cloud-init", post(generate_cloud_init))
        // Import
        .route("/import/disk", post(import_disk))
        // Live resize
        .route("/vms/{name}/live/vcpus/{count}", post(live_vcpus_handler))
        .route("/vms/{name}/live/memory/{mb}", post(live_memory_handler))
        // Audit
        .route("/audit", get(get_audit_log))
        .route("/audit/export", get(export_audit_log))
        .route("/audit/verify", get(verify_audit_log_handler))
        // Tags (per-VM tags are in vms.rs)
        .route("/tags", get(get_all_tags_handler))
        // PCI
        .route("/host/pci", get(list_pci_handler))
        // IOMMU
        .route("/host/iommu-groups", get(list_iommu_groups_handler))
        // Host stats + DHCP
        .route("/host/stats", get(get_host_stats))
        .route(
            "/host/linux-observability",
            get(get_host_linux_observability),
        )
        .route("/host/linux-audit", get(get_host_linux_audit))
        .route("/host/filesystems", get(get_host_filesystems))
        .route("/host/processes", get(get_host_processes))
        .route("/host/processes/kill", post(post_host_kill_process))
        .route("/host/package-updates", get(get_host_package_updates))
        .route("/host/package-upgrade", post(post_host_package_upgrade))
        .route(
            "/host/package-autoremove",
            post(post_host_package_autoremove),
        )
        .route("/host/package-install", post(post_host_package_install))
        .route("/host/package-remove", post(post_host_package_remove))
        .route("/host/net-counters", get(get_host_net_counters))
        .route("/host/net-rates", get(get_host_net_rates))
        .route("/host/passwd-users", get(get_host_passwd_users))
        .route("/host/groups", get(get_host_groups))
        .route("/host/security-summary", get(get_host_security_summary))
        .route("/dhcp-leases", get(list_dhcp_leases))
        // Save as template
        .route("/vms/{name}/save-template", post(save_template_handler))
        // Systemd services
        .route("/services", get(list_services_handler))
        .route("/services/{name}/{action}", post(service_action_handler))
        // System logs
        .route("/logs", get(get_logs_handler))
        .route("/logs/boots", get(list_log_boots_handler))
        // Host shutdown/reboot
        .route("/host/shutdown", post(host_shutdown_handler))
        .route("/host/reboot", post(host_reboot_handler))
        // Host system info
        .route(
            "/host/hardware-inventory/history",
            get(get_hardware_inventory_history_handler),
        )
        .route(
            "/host/hardware-inventory",
            get(get_hardware_inventory_handler),
        )
        .route("/host/system-info", get(get_system_info_handler))
        .route("/host/hostname", post(set_hostname_handler))
        .route("/host/timezone", post(set_timezone_handler))
        .route("/host/cockpit", get(get_host_cockpit_handler))
        .route(
            "/host/cockpit/actions",
            post(post_host_cockpit_action_handler),
        )
}

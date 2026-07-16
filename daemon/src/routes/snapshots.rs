// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use axum::extract::{Extension, Path, Query, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};

use machina_core::libvirt::snapshot;
use machina_core::{CreateSnapshotRequest, LibvirtManager, SnapshotInfo};

use crate::auth::{require_write, RequestActor};
use crate::conn_query::{spawn_libvirt_actor, ConnQuery};
use crate::error::AppError;

async fn list_all_snapshots(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Query(conn_q): Query<ConnQuery>,
) -> Result<Json<Vec<SnapshotInfo>>, AppError> {
    let rows =
        spawn_libvirt_actor(manager, Some(&actor), conn_q, snapshot::list_all_snapshots).await?;
    Ok(Json(rows))
}

async fn list_vm_snapshots(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Path(vm_name): Path<String>,
    Query(conn_q): Query<ConnQuery>,
) -> Result<Json<Vec<SnapshotInfo>>, AppError> {
    let vm2 = vm_name.clone();
    let rows = spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        snapshot::list_snapshots(conn, &vm2)
    })
    .await?;
    Ok(Json(rows))
}

async fn create_snapshot_handler(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Path(vm_name): Path<String>,
    Query(conn_q): Query<ConnQuery>,
    Json(req): Json<CreateSnapshotRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_write(&actor, "vms:write")?;
    let vm2 = vm_name.clone();
    let snap_name = req.name.clone();
    let req2 = req.clone();
    spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        snapshot::create_snapshot(conn, &vm2, &req2)
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "created", "vm": vm_name, "snapshot": snap_name }),
    ))
}

async fn delete_snapshot_handler(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Path((vm_name, snap_name)): Path<(String, String)>,
    Query(conn_q): Query<ConnQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_write(&actor, "vms:write")?;
    let vm2 = vm_name.clone();
    let snap2 = snap_name.clone();
    spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        snapshot::delete_snapshot(conn, &vm2, &snap2)
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "deleted", "vm": vm_name, "snapshot": snap_name }),
    ))
}

async fn revert_snapshot_handler(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Path((vm_name, snap_name)): Path<(String, String)>,
    Query(conn_q): Query<ConnQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_write(&actor, "vms:write")?;
    let vm2 = vm_name.clone();
    let snap2 = snap_name.clone();
    spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        snapshot::revert_snapshot(conn, &vm2, &snap2)
    })
    .await?;
    Ok(Json(
        serde_json::json!({ "status": "reverted", "vm": vm_name, "snapshot": snap_name }),
    ))
}

pub fn snapshot_routes() -> Router<LibvirtManager> {
    Router::new()
        .route("/snapshots", get(list_all_snapshots))
        .route("/vms/{vm_name}/snapshots", get(list_vm_snapshots))
        .route("/vms/{vm_name}/snapshots", post(create_snapshot_handler))
        .route(
            "/vms/{vm_name}/snapshots/{snap_name}",
            delete(delete_snapshot_handler),
        )
        .route(
            "/vms/{vm_name}/snapshots/{snap_name}/revert",
            post(revert_snapshot_handler),
        )
}

// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Extended OpenStack API routes (v2).

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Extension, Json, Router,
};
use machina_core::{
    accept_volume_transfer, add_aggregate_host, add_image_member, add_router_interface,
    attach_interface, backup_instance, clone_cinder_volume, create_host_aggregate, create_keypair,
    create_port, create_router, create_security_group, create_security_group_rule,
    create_server_group, create_subnet, create_volume_from_image, create_volume_from_snapshot,
    create_volume_transfer, delete_cinder_snapshot, delete_image_member, delete_keypair,
    delete_port, delete_router, delete_security_group, delete_security_group_rule,
    delete_server_group, delete_subnet, delete_volume_transfer, detach_interface,
    extend_cinder_volume, force_delete_instance, get_cinder_snapshot, get_hypervisor, get_port,
    get_quota_summary, get_router, get_server_group, get_subnet, get_volume_transfer,
    instance_stack_hint, list_availability_zones, list_cinder_snapshots, list_compute_services,
    list_configured_clouds, list_host_aggregates, list_hypervisors, list_image_members,
    list_instance_interfaces, list_neutron_agents, list_ports, list_routers, list_server_groups,
    list_subnets, list_volume_transfers, list_volume_types, lock_instance, migrate_instance,
    remote_console_with_tunnel, remove_aggregate_host, remove_router_interface, rename_instance,
    rescue_instance, reset_instance_state, resolve_console_token, retype_cinder_volume,
    set_compute_service_state, set_hypervisor_maintenance, set_neutron_agent_admin,
    set_volume_bootable, shelve_instance, snapshot_cinder_volume, unlock_instance,
    unrescue_instance, unshelve_instance, update_cinder_volume, update_host_aggregate,
    update_image_metadata, update_image_visibility, update_network, update_port, update_quotas,
    update_router, update_subnet, upload_volume_to_image, AcceptVolumeTransferRequest,
    AddImageMemberRequest, AddRouterInterfaceRequest, AttachInterfaceRequest,
    BackupInstanceRequest, CloneVolumeRequest, CreateAggregateRequest, CreateKeypairRequest,
    CreatePortRequest, CreateSecurityGroupRequest, CreateSecurityGroupRuleRequest,
    CreateServerGroupRequest, CreateVolumeFromImageRequest, CreateVolumeFromSnapshotRequest,
    CreateVolumeTransferRequest, ExtendVolumeRequest, LibvirtManager, MigrateInstanceRequest,
    OpenStackCreateRouterRequest, OpenStackCreateSubnetRequest, RemoveRouterInterfaceRequest,
    RenameInstanceRequest, RescueInstanceRequest, RetypeVolumeRequest, SetComputeServiceRequest,
    SnapshotVolumeRequest, UpdateAggregateRequest, UpdateImageMetadataRequest,
    UpdateImageVisibilityRequest, UpdateNetworkRequest, UpdatePortRequest, UpdateQuotasRequest,
    UpdateRouterRequest, UpdateSubnetRequest, UpdateVolumeRequest, UploadVolumeToImageRequest,
};
use reqwest::Client;
use serde::Deserialize;

use crate::error::AppError;
use crate::openstack_runtime::{self, openstack_cfg};
use crate::routes::events::{EventBus, MachinaEvent};
use crate::routes::openstack::{ensure_openstack_enabled, log_audit};

fn emit(bus: &Arc<EventBus>, kind: &str, target: &str, status: &str, message: &str) {
    let mut ev = MachinaEvent::now(kind, target, status);
    ev.message = message.chars().take(512).collect();
    bus.emit(ev);
}

#[derive(Deserialize)]
pub struct ConsoleQuery {
    #[serde(default = "default_novnc")]
    pub r#type: String,
}
fn default_novnc() -> String {
    "novnc".into()
}

pub fn openstack_extended_routes() -> Router<LibvirtManager> {
    Router::new()
        .route("/openstack/clouds", get(os_list_clouds))
        .route("/openstack/cloud", post(os_select_cloud))
        .route("/openstack/quotas", get(os_quotas).put(os_update_quotas))
        .route("/openstack/subnets", get(os_subnets).post(os_create_subnet))
        .route(
            "/openstack/subnets/{id}",
            get(os_get_subnet)
                .put(os_update_subnet)
                .delete(os_delete_subnet),
        )
        .route(
            "/openstack/routers/{id}",
            get(os_get_router)
                .delete(os_delete_router)
                .put(os_update_router),
        )
        .route("/openstack/routers", get(os_routers).post(os_create_router))
        .route("/openstack/availability-zones", get(os_availability_zones))
        .route("/openstack/hypervisors", get(os_hypervisors))
        .route(
            "/openstack/hypervisors/{id}",
            get(os_get_hypervisor).put(os_hypervisor_maintenance),
        )
        .route("/openstack/compute-services", get(os_compute_services))
        .route(
            "/openstack/compute-services/enable",
            post(os_enable_compute_service),
        )
        .route(
            "/openstack/compute-services/disable",
            post(os_disable_compute_service),
        )
        .route("/openstack/neutron-agents", get(os_neutron_agents))
        .route(
            "/openstack/neutron-agents/{id}",
            put(os_update_neutron_agent),
        )
        .route(
            "/openstack/aggregates",
            get(os_aggregates).post(os_create_aggregate),
        )
        .route("/openstack/aggregates/{id}", put(os_update_aggregate))
        .route(
            "/openstack/aggregates/{id}/add-host",
            post(os_aggregate_add_host),
        )
        .route(
            "/openstack/aggregates/{id}/remove-host",
            post(os_aggregate_remove_host),
        )
        .route("/openstack/volume-snapshots", get(os_list_volume_snapshots))
        .route("/openstack/volumes/from-image", post(os_volume_from_image))
        .route("/openstack/volumes/clone", post(os_clone_volume))
        .route(
            "/openstack/volume-transfers",
            get(os_volume_transfers).post(os_create_volume_transfer),
        )
        .route(
            "/openstack/volume-transfers/accept",
            post(os_accept_volume_transfer),
        )
        .route(
            "/openstack/volume-transfers/{id}",
            get(os_get_volume_transfer).delete(os_delete_volume_transfer),
        )
        .route(
            "/openstack/volumes/from-snapshot",
            post(os_volume_from_snapshot),
        )
        .route("/openstack/volumes/{id}/retype", post(os_retype_volume))
        .route(
            "/openstack/volume-snapshots/{id}",
            get(os_get_volume_snapshot).delete(os_delete_volume_snapshot),
        )
        .route(
            "/openstack/routers/add-interface",
            post(os_router_add_interface),
        )
        .route(
            "/openstack/routers/remove-interface",
            post(os_router_remove_interface),
        )
        .route("/openstack/ports", get(os_ports).post(os_create_port))
        .route(
            "/openstack/ports/{id}",
            get(os_get_port).delete(os_delete_port).put(os_update_port),
        )
        .route("/openstack/networks/{id}", put(os_update_network))
        .route("/openstack/volume-types", get(os_volume_types))
        .route(
            "/openstack/server-groups",
            get(os_server_groups).post(os_create_server_group),
        )
        .route(
            "/openstack/server-groups/{id}",
            get(os_get_server_group).delete(os_delete_server_group),
        )
        .route("/openstack/keypairs", post(os_create_keypair))
        .route("/openstack/keypairs/{name}", delete(os_delete_keypair))
        .route("/openstack/security-groups", post(os_create_sg))
        .route("/openstack/security-groups/{id}", delete(os_delete_sg))
        .route(
            "/openstack/security-groups/{id}/rules",
            post(os_create_sg_rule),
        )
        .route(
            "/openstack/security-group-rules/{id}",
            delete(os_delete_sg_rule),
        )
        .route("/openstack/volumes/{id}/extend", post(os_extend_volume))
        .route("/openstack/volumes/{id}/snapshot", post(os_snapshot_volume))
        .route("/openstack/volumes/{id}", put(os_update_volume))
        .route(
            "/openstack/volumes/{id}/bootable",
            post(os_set_volume_bootable),
        )
        .route(
            "/openstack/volumes/{id}/upload-image",
            post(os_upload_volume_image),
        )
        .route("/openstack/images/{id}/metadata", post(os_image_metadata))
        .route(
            "/openstack/images/{id}/visibility",
            post(os_image_visibility),
        )
        .route(
            "/openstack/images/{id}/members",
            get(os_image_members).post(os_add_member),
        )
        .route(
            "/openstack/images/{id}/members/{member}",
            delete(os_delete_member),
        )
        .route("/openstack/instances/{id}/rename", post(os_rename_instance))
        .route("/openstack/instances/{id}/lock", post(os_lock_instance))
        .route("/openstack/instances/{id}/unlock", post(os_unlock_instance))
        .route(
            "/openstack/instances/{id}/reset-state",
            post(os_reset_instance_state),
        )
        .route(
            "/openstack/instances/{id}/force-delete",
            post(os_force_delete_instance),
        )
        .route("/openstack/instances/{id}/shelve", post(os_shelve))
        .route("/openstack/instances/{id}/unshelve", post(os_unshelve))
        .route("/openstack/instances/{id}/migrate", post(os_migrate))
        .route("/openstack/instances/{id}/rescue", post(os_rescue))
        .route("/openstack/instances/{id}/unrescue", post(os_unrescue))
        .route("/openstack/instances/{id}/backup", post(os_backup))
        .route(
            "/openstack/instances/{id}/interfaces",
            get(os_list_if).post(os_attach_if),
        )
        .route(
            "/openstack/instances/{id}/interfaces/{port}",
            delete(os_detach_if),
        )
        .route("/openstack/instances/{id}/stack", get(os_stack_hint))
        .route(
            "/openstack/instances/{id}/console/tunnel",
            get(os_console_tunnel),
        )
        .route("/openstack/console-tunnel/{token}", get(os_console_proxy))
}

async fn os_list_clouds() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let clouds = list_configured_clouds(&cfg)?;
    Ok(Json(serde_json::json!({ "clouds": clouds })))
}

#[derive(Deserialize)]
struct SelectCloudBody {
    cloud_name: String,
}

async fn os_select_cloud(
    Json(body): Json<SelectCloudBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let name = body.cloud_name.trim().to_string();
    if name.is_empty() {
        openstack_runtime::set_cloud_override(None);
    } else {
        openstack_runtime::set_cloud_override(Some(name.clone()));
    }
    Ok(Json(
        serde_json::json!({ "status": "ok", "cloud_name": name }),
    ))
}

async fn os_quotas() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let q = get_quota_summary(&cfg).await?;
    Ok(Json(serde_json::json!({ "quotas": q })))
}

async fn os_update_quotas(
    Json(req): Json<UpdateQuotasRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let result = update_quotas(&cfg, &req).await?;
    log_audit("openstack.quota.update", &req.service, "ok");
    Ok(Json(
        serde_json::json!({ "status": "ok", "result": result }),
    ))
}

#[derive(Deserialize)]
struct AgentAdminBody {
    admin_state_up: bool,
}

async fn os_update_neutron_agent(
    Path(id): Path<String>,
    Json(body): Json<AgentAdminBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    set_neutron_agent_admin(&cfg, &id, body.admin_state_up).await?;
    log_audit("openstack.agent.update", &id, "ok");
    Ok(Json(
        serde_json::json!({ "status": "ok", "id": id, "admin_state_up": body.admin_state_up }),
    ))
}

#[derive(Deserialize)]
struct MaintenanceBody {
    maintenance: bool,
}

async fn os_hypervisor_maintenance(
    Path(id): Path<String>,
    Json(body): Json<MaintenanceBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    set_hypervisor_maintenance(&cfg, &id, body.maintenance).await?;
    log_audit("openstack.hypervisor.maintenance", &id, "ok");
    Ok(Json(
        serde_json::json!({ "status": "ok", "id": id, "maintenance": body.maintenance }),
    ))
}

async fn os_enable_compute_service(
    Json(req): Json<SetComputeServiceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let mut r = req;
    r.disabled = false;
    set_compute_service_state(&cfg, &r).await?;
    log_audit("openstack.service.enable", &r.host, "ok");
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn os_disable_compute_service(
    Json(req): Json<SetComputeServiceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let mut r = req;
    r.disabled = true;
    set_compute_service_state(&cfg, &r).await?;
    log_audit("openstack.service.disable", &r.host, "ok");
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn os_create_aggregate(
    Json(req): Json<CreateAggregateRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let agg = create_host_aggregate(&cfg, &req).await?;
    log_audit("openstack.aggregate.create", &agg.id, "ok");
    Ok(Json(serde_json::json!({ "aggregate": agg })))
}

async fn os_update_aggregate(
    Path(id): Path<String>,
    Json(req): Json<UpdateAggregateRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let agg = update_host_aggregate(&cfg, &id, &req).await?;
    log_audit("openstack.aggregate.update", &id, "ok");
    Ok(Json(serde_json::json!({ "aggregate": agg })))
}

#[derive(Deserialize)]
struct AggregateHostBody {
    host: String,
}

async fn os_aggregate_add_host(
    Path(id): Path<String>,
    Json(body): Json<AggregateHostBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let agg = add_aggregate_host(&cfg, &id, &body.host).await?;
    log_audit("openstack.aggregate.add_host", &id, "ok");
    Ok(Json(serde_json::json!({ "aggregate": agg })))
}

async fn os_aggregate_remove_host(
    Path(id): Path<String>,
    Json(body): Json<AggregateHostBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let agg = remove_aggregate_host(&cfg, &id, &body.host).await?;
    log_audit("openstack.aggregate.remove_host", &id, "ok");
    Ok(Json(serde_json::json!({ "aggregate": agg })))
}

async fn os_subnets() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "subnets": list_subnets(&cfg).await? }),
    ))
}

async fn os_create_subnet(
    Json(req): Json<OpenStackCreateSubnetRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let subnet = create_subnet(&cfg, &req).await?;
    log_audit("openstack.subnet.create", &subnet.id, "ok");
    Ok(Json(serde_json::json!({ "subnet": subnet })))
}

async fn os_routers() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "routers": list_routers(&cfg).await? }),
    ))
}

async fn os_create_router(
    Json(req): Json<OpenStackCreateRouterRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let router = create_router(&cfg, &req).await?;
    log_audit("openstack.router.create", &router.id, "ok");
    Ok(Json(serde_json::json!({ "router": router })))
}

async fn os_list_volume_snapshots() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "snapshots": list_cinder_snapshots(&cfg).await? }),
    ))
}

async fn os_volume_from_snapshot(
    Json(req): Json<CreateVolumeFromSnapshotRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let vol = create_volume_from_snapshot(&cfg, &req).await?;
    Ok(Json(serde_json::json!({ "volume": vol })))
}

async fn os_retype_volume(
    Path(id): Path<String>,
    Json(req): Json<RetypeVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let vol = retype_cinder_volume(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "volume": vol })))
}

async fn os_delete_volume_snapshot(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_cinder_snapshot(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_router_add_interface(
    Json(req): Json<AddRouterInterfaceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let result = add_router_interface(&cfg, &req).await?;
    log_audit("openstack.router.add_interface", &req.router_id, "ok");
    Ok(Json(serde_json::json!({ "result": result })))
}

async fn os_router_remove_interface(
    Json(req): Json<RemoveRouterInterfaceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    remove_router_interface(&cfg, &req).await?;
    log_audit("openstack.router.remove_interface", &req.router_id, "ok");
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn os_create_port(
    Json(req): Json<CreatePortRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let port = create_port(&cfg, &req).await?;
    Ok(Json(serde_json::json!({ "port": port })))
}

async fn os_delete_port(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_port(&cfg, &id).await?;
    log_audit("openstack.port.delete", &id, "ok");
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

#[derive(Deserialize)]
struct PortsQuery {
    pub device_id: Option<String>,
}

async fn os_ports(Query(q): Query<PortsQuery>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "ports": list_ports(&cfg, q.device_id.as_deref()).await? }),
    ))
}

async fn os_volume_types() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "volume_types": list_volume_types(&cfg).await? }),
    ))
}

async fn os_server_groups() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "server_groups": list_server_groups(&cfg).await? }),
    ))
}

async fn os_create_server_group(
    Json(req): Json<CreateServerGroupRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let sg = create_server_group(&cfg, &req).await?;
    Ok(Json(serde_json::json!({ "server_group": sg })))
}

async fn os_get_server_group(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let sg = get_server_group(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "server_group": sg })))
}

async fn os_delete_server_group(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_server_group(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_aggregates() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "aggregates": list_host_aggregates(&cfg).await? }),
    ))
}

async fn os_volume_from_image(
    Json(req): Json<CreateVolumeFromImageRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let vol = create_volume_from_image(&cfg, &req).await?;
    Ok(Json(serde_json::json!({ "volume": vol })))
}

async fn os_update_volume(
    Path(id): Path<String>,
    Json(req): Json<UpdateVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let vol = update_cinder_volume(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "volume": vol })))
}

#[derive(Deserialize)]
struct BootableBody {
    bootable: bool,
}

async fn os_set_volume_bootable(
    Path(id): Path<String>,
    Json(body): Json<BootableBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    set_volume_bootable(&cfg, &id, body.bootable).await?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "id": id, "bootable": body.bootable }),
    ))
}

async fn os_update_port(
    Path(id): Path<String>,
    Json(req): Json<UpdatePortRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let port = update_port(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "port": port })))
}

async fn os_update_network(
    Path(id): Path<String>,
    Json(req): Json<UpdateNetworkRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let net = update_network(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "network": net })))
}

async fn os_force_delete_instance(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    force_delete_instance(&cfg, &id).await?;
    log_audit("openstack.instance.force_delete", &id, "ok");
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_create_keypair(
    Json(req): Json<CreateKeypairRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let kp = create_keypair(&cfg, &req).await?;
    Ok(Json(serde_json::json!({ "keypair": kp })))
}

async fn os_get_subnet(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let subnet = get_subnet(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "subnet": subnet })))
}

async fn os_get_router(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let router = get_router(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "router": router })))
}

async fn os_get_port(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let port = get_port(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "port": port })))
}

async fn os_get_volume_snapshot(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let snapshot = get_cinder_snapshot(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "snapshot": snapshot })))
}

async fn os_get_volume_transfer(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let transfer = get_volume_transfer(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "transfer": transfer })))
}

async fn os_get_hypervisor(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let hv = get_hypervisor(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "hypervisor": hv })))
}

async fn os_update_subnet(
    Path(id): Path<String>,
    Json(req): Json<UpdateSubnetRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let subnet = update_subnet(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "subnet": subnet })))
}

async fn os_upload_volume_image(
    Path(id): Path<String>,
    Json(req): Json<UploadVolumeToImageRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let result = upload_volume_to_image(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "upload": result })))
}

async fn os_update_router(
    Path(id): Path<String>,
    Json(req): Json<UpdateRouterRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let router = update_router(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "router": router })))
}

async fn os_delete_subnet(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_subnet(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_delete_router(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_router(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_availability_zones() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "availability_zones": list_availability_zones(&cfg).await? }),
    ))
}

async fn os_hypervisors() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "hypervisors": list_hypervisors(&cfg).await? }),
    ))
}

async fn os_compute_services() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "services": list_compute_services(&cfg).await? }),
    ))
}

async fn os_neutron_agents() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "agents": list_neutron_agents(&cfg).await? }),
    ))
}

async fn os_clone_volume(
    Json(req): Json<CloneVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let vol = clone_cinder_volume(&cfg, &req).await?;
    Ok(Json(serde_json::json!({ "volume": vol })))
}

async fn os_volume_transfers() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "transfers": list_volume_transfers(&cfg).await? }),
    ))
}

async fn os_create_volume_transfer(
    Json(req): Json<CreateVolumeTransferRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let tr = create_volume_transfer(&cfg, &req).await?;
    Ok(Json(serde_json::json!({ "transfer": tr })))
}

async fn os_accept_volume_transfer(
    Json(req): Json<AcceptVolumeTransferRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let tr = accept_volume_transfer(&cfg, &req).await?;
    Ok(Json(serde_json::json!({ "transfer": tr })))
}

async fn os_delete_volume_transfer(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_volume_transfer(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_rename_instance(
    Path(id): Path<String>,
    Json(req): Json<RenameInstanceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    rename_instance(&cfg, &id, &req).await?;
    log_audit("openstack.instance.rename", &id, "ok");
    Ok(Json(
        serde_json::json!({ "status": "ok", "id": id, "name": req.name }),
    ))
}

async fn os_lock_instance(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    lock_instance(&cfg, &id).await?;
    log_audit("openstack.instance.lock", &id, "ok");
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_unlock_instance(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    unlock_instance(&cfg, &id).await?;
    log_audit("openstack.instance.unlock", &id, "ok");
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_reset_instance_state(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    reset_instance_state(&cfg, &id).await?;
    log_audit("openstack.instance.reset_state", &id, "ok");
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_delete_keypair(Path(name): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_keypair(&cfg, &name).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "name": name })))
}

async fn os_create_sg(
    Json(req): Json<CreateSecurityGroupRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let sg = create_security_group(&cfg, &req).await?;
    Ok(Json(serde_json::json!({ "security_group": sg })))
}

async fn os_delete_sg(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_security_group(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_create_sg_rule(
    Path(id): Path<String>,
    Json(req): Json<CreateSecurityGroupRuleRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let rule = create_security_group_rule(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "rule": rule })))
}

async fn os_delete_sg_rule(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_security_group_rule(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_extend_volume(
    Path(id): Path<String>,
    Json(req): Json<ExtendVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let vol = extend_cinder_volume(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "volume": vol })))
}

async fn os_snapshot_volume(
    Path(id): Path<String>,
    Json(req): Json<SnapshotVolumeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let snap = snapshot_cinder_volume(&cfg, &id, &req).await?;
    Ok(Json(snap))
}

async fn os_image_metadata(
    Path(id): Path<String>,
    Json(req): Json<UpdateImageMetadataRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let props = update_image_metadata(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "properties": props })))
}

async fn os_image_visibility(
    Path(id): Path<String>,
    Json(req): Json<UpdateImageVisibilityRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let visibility = update_image_visibility(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "visibility": visibility })))
}

async fn os_image_members(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "members": list_image_members(&cfg, &id).await? }),
    ))
}

async fn os_add_member(
    Path(id): Path<String>,
    Json(req): Json<AddImageMemberRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let m = add_image_member(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "member": m })))
}

async fn os_delete_member(
    Path((id, member)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_image_member(&cfg, &id, &member).await?;
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

macro_rules! inst_ok {
    ($id:expr, $action:expr, $f:expr) => {{
        let cfg = openstack_cfg();
        ensure_openstack_enabled(&cfg)?;
        $f(&cfg, &$id).await?;
        log_audit($action, &$id, "ok");
        Ok(Json(serde_json::json!({ "status": "ok", "id": $id })))
    }};
}

async fn os_shelve(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    inst_ok!(id, "openstack.instance.shelve", shelve_instance)
}

async fn os_unshelve(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    inst_ok!(id, "openstack.instance.unshelve", unshelve_instance)
}

async fn os_migrate(
    Path(id): Path<String>,
    Json(req): Json<MigrateInstanceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    migrate_instance(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_rescue(
    Path(id): Path<String>,
    Json(req): Json<RescueInstanceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    rescue_instance(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_unrescue(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    inst_ok!(id, "openstack.instance.unrescue", unrescue_instance)
}

async fn os_backup(
    Path(id): Path<String>,
    Json(req): Json<BackupInstanceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    backup_instance(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "status": "ok", "id": id })))
}

async fn os_list_if(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "interfaces": list_instance_interfaces(&cfg, &id).await? }),
    ))
}

async fn os_attach_if(
    Path(id): Path<String>,
    Json(req): Json<AttachInterfaceRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let iface = attach_interface(&cfg, &id, &req).await?;
    Ok(Json(serde_json::json!({ "interface": iface })))
}

async fn os_detach_if(
    Path((id, port)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    detach_interface(&cfg, &id, &port).await?;
    Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn os_stack_hint(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let stack = instance_stack_hint(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "stack": stack })))
}

async fn os_console_tunnel(
    Path(id): Path<String>,
    Query(q): Query<ConsoleQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let (url, proxy_path) = remote_console_with_tunnel(&cfg, &id, &q.r#type).await?;
    Ok(Json(serde_json::json!({
        "console_type": q.r#type,
        "url": url,
        "proxy_path": proxy_path,
        "tunnel": true
    })))
}

async fn os_console_proxy(Path(token): Path<String>) -> Result<Response, AppError> {
    let target = resolve_console_token(&token).ok_or_else(|| {
        machina_core::LibvirtError::NotFound("console token expired or invalid".into())
    })?;
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| AppError::from(machina_core::LibvirtError::Internal(e.to_string())))?;
    let resp = client
        .get(&target)
        .send()
        .await
        .map_err(|e| AppError::from(machina_core::LibvirtError::Operation(e.to_string())))?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let ct = resp.headers().get(header::CONTENT_TYPE).cloned();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::from(machina_core::LibvirtError::Operation(e.to_string())))?;
    let mut out = Response::builder().status(status);
    if let Some(ct) = ct {
        out = out.header(header::CONTENT_TYPE, ct);
    }
    Ok(out
        .body(Body::from(bytes))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR).into_response()))
}

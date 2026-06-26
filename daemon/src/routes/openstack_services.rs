// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Heat, Octavia, Identity, and Neutron topology routes.

use axum::{
    extract::{Path, Query},
    routing::{delete, get, post, put},
    Json, Router,
};
use machina_core::{
    build_network_topology, create_heat_stack, create_identity_project, create_identity_user,
    create_lb_health_monitor, create_lb_listener, create_lb_member, create_lb_pool,
    create_load_balancer, delete_heat_stack, delete_lb_health_monitor, delete_lb_listener,
    delete_lb_member, delete_lb_pool, delete_load_balancer, get_heat_stack,
    get_heat_stack_template, get_identity_project, get_identity_user, get_load_balancer,
    grant_role_assignment, list_heat_stack_events, list_heat_stack_resources, list_heat_stacks,
    list_identity_projects, list_identity_roles, list_identity_users, list_lb_health_monitors,
    list_lb_listeners, list_lb_members, list_lb_pools, list_load_balancers, list_role_assignments,
    probe_heat_reachable, probe_octavia_reachable, revoke_role_assignment, update_heat_stack,
    update_identity_user, CreateHeatStackRequest, CreateIdentityProjectRequest,
    CreateIdentityUserRequest, CreateLbHealthMonitorRequest, CreateLbListenerRequest,
    CreateLbMemberRequest, CreateLbPoolRequest, CreateLoadBalancerRequest, LibvirtManager,
    RoleAssignmentRequest, UpdateHeatStackRequest, UpdateIdentityUserRequest,
};
use serde::Deserialize;

use crate::error::AppError;
use crate::openstack_runtime::openstack_cfg;
use crate::routes::openstack::{ensure_openstack_enabled, log_audit};

#[derive(Deserialize)]
struct ProjectQuery {
    project_id: Option<String>,
}

async fn os_heat_reachable() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "reachable": probe_heat_reachable(&cfg).await }),
    ))
}

async fn os_list_heat_stacks() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let stacks = list_heat_stacks(&cfg).await?;
    Ok(Json(serde_json::json!({ "stacks": stacks })))
}

async fn os_get_heat_stack(
    Path((name, id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let stack = get_heat_stack(&cfg, &name, &id).await?;
    Ok(Json(serde_json::json!({ "stack": stack })))
}

async fn os_list_heat_resources(
    Path((name, id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let resources = list_heat_stack_resources(&cfg, &name, &id).await?;
    Ok(Json(serde_json::json!({ "resources": resources })))
}

async fn os_list_heat_events(
    Path((name, id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let events = list_heat_stack_events(&cfg, &name, &id).await?;
    Ok(Json(serde_json::json!({ "events": events })))
}

async fn os_get_heat_template(
    Path((name, id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let template = get_heat_stack_template(&cfg, &name, &id).await?;
    Ok(Json(serde_json::json!({ "template": template })))
}

async fn os_create_heat_stack(
    Json(body): Json<CreateHeatStackRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let stack = create_heat_stack(&cfg, &body).await?;
    log_audit("openstack.heat.create", &stack.id, "ok");
    Ok(Json(serde_json::json!({ "stack": stack })))
}

async fn os_update_heat_stack(
    Path((name, id)): Path<(String, String)>,
    Json(body): Json<UpdateHeatStackRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let stack = update_heat_stack(&cfg, &name, &id, &body).await?;
    log_audit("openstack.heat.update", &id, "ok");
    Ok(Json(serde_json::json!({ "stack": stack })))
}

async fn os_delete_heat_stack(
    Path((name, id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_heat_stack(&cfg, &name, &id).await?;
    log_audit("openstack.heat.delete", &id, "ok");
    Ok(Json(
        serde_json::json!({ "status": "deleted", "stack_name": name, "id": id }),
    ))
}

async fn os_octavia_reachable() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    Ok(Json(
        serde_json::json!({ "reachable": probe_octavia_reachable(&cfg).await }),
    ))
}

async fn os_list_load_balancers() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let loadbalancers = list_load_balancers(&cfg).await?;
    Ok(Json(serde_json::json!({ "loadbalancers": loadbalancers })))
}

async fn os_get_load_balancer(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let loadbalancer = get_load_balancer(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "loadbalancer": loadbalancer })))
}

async fn os_create_load_balancer(
    Json(body): Json<CreateLoadBalancerRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let loadbalancer = create_load_balancer(&cfg, &body).await?;
    log_audit("openstack.lb.create", &loadbalancer.id, "ok");
    Ok(Json(serde_json::json!({ "loadbalancer": loadbalancer })))
}

async fn os_delete_load_balancer(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_load_balancer(&cfg, &id).await?;
    log_audit("openstack.lb.delete", &id, "ok");
    Ok(Json(serde_json::json!({ "status": "deleted", "id": id })))
}

async fn os_list_lb_listeners(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let listeners = list_lb_listeners(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "listeners": listeners })))
}

async fn os_create_lb_listener(
    Path(id): Path<String>,
    Json(body): Json<CreateLbListenerRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let mut req = body;
    if req.loadbalancer_id.trim().is_empty() {
        req.loadbalancer_id = id;
    }
    let listener = create_lb_listener(&cfg, &req).await?;
    log_audit("openstack.lb.listener.create", &listener.id, "ok");
    Ok(Json(serde_json::json!({ "listener": listener })))
}

async fn os_delete_lb_listener(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_lb_listener(&cfg, &id).await?;
    log_audit("openstack.lb.listener.delete", &id, "ok");
    Ok(Json(serde_json::json!({ "status": "deleted", "id": id })))
}

async fn os_list_lb_pools(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let pools = list_lb_pools(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "pools": pools })))
}

async fn os_create_lb_pool(
    Json(body): Json<CreateLbPoolRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let pool = create_lb_pool(&cfg, &body).await?;
    log_audit("openstack.lb.pool.create", &pool.id, "ok");
    Ok(Json(serde_json::json!({ "pool": pool })))
}

async fn os_delete_lb_pool(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_lb_pool(&cfg, &id).await?;
    log_audit("openstack.lb.pool.delete", &id, "ok");
    Ok(Json(serde_json::json!({ "status": "deleted", "id": id })))
}

async fn os_list_lb_members(
    Path(pool_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let members = list_lb_members(&cfg, &pool_id).await?;
    Ok(Json(serde_json::json!({ "members": members })))
}

async fn os_create_lb_member(
    Path(pool_id): Path<String>,
    Json(body): Json<CreateLbMemberRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let member = create_lb_member(&cfg, &pool_id, &body).await?;
    log_audit("openstack.lb.member.create", &member.id, "ok");
    Ok(Json(serde_json::json!({ "member": member })))
}

async fn os_delete_lb_member(
    Path((pool_id, member_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_lb_member(&cfg, &pool_id, &member_id).await?;
    log_audit("openstack.lb.member.delete", &member_id, "ok");
    Ok(Json(
        serde_json::json!({ "status": "deleted", "id": member_id }),
    ))
}

async fn os_list_lb_health_monitors(
    Path(pool_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let healthmonitors = list_lb_health_monitors(&cfg, &pool_id).await?;
    Ok(Json(
        serde_json::json!({ "healthmonitors": healthmonitors }),
    ))
}

async fn os_create_lb_health_monitor(
    Json(body): Json<CreateLbHealthMonitorRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let monitor = create_lb_health_monitor(&cfg, &body).await?;
    log_audit("openstack.lb.monitor.create", &monitor.id, "ok");
    Ok(Json(serde_json::json!({ "healthmonitor": monitor })))
}

async fn os_delete_lb_health_monitor(
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    delete_lb_health_monitor(&cfg, &id).await?;
    log_audit("openstack.lb.monitor.delete", &id, "ok");
    Ok(Json(serde_json::json!({ "status": "deleted", "id": id })))
}

async fn os_list_projects() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let projects = list_identity_projects(&cfg).await?;
    Ok(Json(serde_json::json!({ "projects": projects })))
}

async fn os_create_project(
    Json(body): Json<CreateIdentityProjectRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let project = create_identity_project(&cfg, &body).await?;
    log_audit("openstack.identity.project.create", &project.id, "ok");
    Ok(Json(serde_json::json!({ "project": project })))
}

async fn os_get_project(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let project = get_identity_project(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "project": project })))
}

async fn os_list_users() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let users = list_identity_users(&cfg).await?;
    Ok(Json(serde_json::json!({ "users": users })))
}

async fn os_create_user(
    Json(body): Json<CreateIdentityUserRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let user = create_identity_user(&cfg, &body).await?;
    log_audit("openstack.identity.user.create", &user.id, "ok");
    Ok(Json(serde_json::json!({ "user": user })))
}

async fn os_get_user(Path(id): Path<String>) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let user = get_identity_user(&cfg, &id).await?;
    Ok(Json(serde_json::json!({ "user": user })))
}

async fn os_update_user(
    Path(id): Path<String>,
    Json(body): Json<UpdateIdentityUserRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let user = update_identity_user(&cfg, &id, &body).await?;
    log_audit("openstack.identity.user.update", &id, "ok");
    Ok(Json(serde_json::json!({ "user": user })))
}

async fn os_list_roles() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let roles = list_identity_roles(&cfg).await?;
    Ok(Json(serde_json::json!({ "roles": roles })))
}

async fn os_list_role_assignments(
    Query(q): Query<ProjectQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let assignments = list_role_assignments(&cfg, q.project_id.as_deref()).await?;
    Ok(Json(serde_json::json!({ "role_assignments": assignments })))
}

async fn os_grant_role_assignment(
    Json(body): Json<RoleAssignmentRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    grant_role_assignment(&cfg, &body).await?;
    log_audit("openstack.identity.role.grant", &body.user_id, "ok");
    Ok(Json(serde_json::json!({ "status": "granted" })))
}

async fn os_revoke_role_assignment(
    Json(body): Json<RoleAssignmentRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    revoke_role_assignment(&cfg, &body).await?;
    log_audit("openstack.identity.role.revoke", &body.user_id, "ok");
    Ok(Json(serde_json::json!({ "status": "revoked" })))
}

async fn os_network_topology() -> Result<Json<serde_json::Value>, AppError> {
    let cfg = openstack_cfg();
    ensure_openstack_enabled(&cfg)?;
    let graph = build_network_topology(&cfg).await?;
    Ok(Json(serde_json::json!({ "graph": graph })))
}

pub fn openstack_services_routes() -> Router<LibvirtManager> {
    Router::new()
        .route("/openstack/heat/reachable", get(os_heat_reachable))
        .route(
            "/openstack/heat/stacks",
            get(os_list_heat_stacks).post(os_create_heat_stack),
        )
        .route(
            "/openstack/heat/stacks/{name}/{id}",
            get(os_get_heat_stack)
                .patch(os_update_heat_stack)
                .delete(os_delete_heat_stack),
        )
        .route(
            "/openstack/heat/stacks/{name}/{id}/resources",
            get(os_list_heat_resources),
        )
        .route(
            "/openstack/heat/stacks/{name}/{id}/events",
            get(os_list_heat_events),
        )
        .route(
            "/openstack/heat/stacks/{name}/{id}/template",
            get(os_get_heat_template),
        )
        .route("/openstack/octavia/reachable", get(os_octavia_reachable))
        .route(
            "/openstack/load-balancers",
            get(os_list_load_balancers).post(os_create_load_balancer),
        )
        .route(
            "/openstack/load-balancers/{id}",
            get(os_get_load_balancer).delete(os_delete_load_balancer),
        )
        .route(
            "/openstack/load-balancers/{id}/listeners",
            get(os_list_lb_listeners).post(os_create_lb_listener),
        )
        .route(
            "/openstack/load-balancers/listeners/{id}",
            delete(os_delete_lb_listener),
        )
        .route(
            "/openstack/load-balancers/{id}/pools",
            get(os_list_lb_pools),
        )
        .route("/openstack/load-balancers/pools", post(os_create_lb_pool))
        .route(
            "/openstack/load-balancers/pools/{id}",
            delete(os_delete_lb_pool),
        )
        .route(
            "/openstack/load-balancers/pools/{pool_id}/members",
            get(os_list_lb_members).post(os_create_lb_member),
        )
        .route(
            "/openstack/load-balancers/pools/{pool_id}/members/{member_id}",
            delete(os_delete_lb_member),
        )
        .route(
            "/openstack/load-balancers/pools/{pool_id}/health-monitors",
            get(os_list_lb_health_monitors),
        )
        .route(
            "/openstack/load-balancers/health-monitors",
            post(os_create_lb_health_monitor),
        )
        .route(
            "/openstack/load-balancers/health-monitors/{id}",
            delete(os_delete_lb_health_monitor),
        )
        .route(
            "/openstack/identity/projects",
            get(os_list_projects).post(os_create_project),
        )
        .route("/openstack/identity/projects/{id}", get(os_get_project))
        .route(
            "/openstack/identity/users",
            get(os_list_users).post(os_create_user),
        )
        .route(
            "/openstack/identity/users/{id}",
            get(os_get_user).put(os_update_user),
        )
        .route("/openstack/identity/roles", get(os_list_roles))
        .route(
            "/openstack/identity/role-assignments",
            get(os_list_role_assignments).put(os_grant_role_assignment),
        )
        .route(
            "/openstack/identity/role-assignments/revoke",
            post(os_revoke_role_assignment),
        )
        .route("/openstack/network-topology", get(os_network_topology))
}

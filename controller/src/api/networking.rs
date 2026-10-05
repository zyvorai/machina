// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! Security groups and ports — Phase B of the next-gen roadmap
//! (`/Users/ssahani/.claude/plans/lazy-munching-quilt.md`). Native `/api/v1/...`
//! resources on top of the existing flat `networks` table (`api::networks`).
//!
//! A port bound to a VM (`vm_id` set at create time) delegates the actual NIC
//! attach/detach to the existing `vms::{attach_vm_nic, detach_vm_nic}` — no new
//! libvirt plumbing here.
//!
//! **Security-group rule enforcement is not wired to `engine::zeus_firewall` in this
//! first cut** — groups and rules are real, stored, and attachable to ports, but
//! purely advisory until that integration exists. Documented rather than silently
//! implied as working.

use axum::extract::{Path, Query, State};
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::projects::default_project_id;
use crate::api::vms;
use crate::api::ApiError;
use crate::auth::{require_operator, AuthUser};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Security groups
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SecurityGroupRow {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub description: String,
    /// Always `false` today — rule enforcement isn't wired to `engine::zeus_firewall`
    /// in this first cut (see module doc comment). Surfaced on the wire so API/UI
    /// consumers don't mistake a stored-but-inert group for real traffic filtering.
    pub enforced: bool,
}

pub async fn list_security_groups(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<SecurityGroupRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, SecurityGroupRow>(
        "SELECT id, project_id, name, description, 0 AS enforced FROM security_groups ORDER BY name",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn get_security_group(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<SecurityGroupRow>, ApiError> {
    require_operator(&actor)?;
    let row = sqlx::query_as::<_, SecurityGroupRow>(
        "SELECT id, project_id, name, description, 0 AS enforced FROM security_groups WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct CreateSecurityGroupBody {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub project_id: Option<Uuid>,
}

pub async fn create_security_group(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateSecurityGroupBody>,
) -> Result<Json<SecurityGroupRow>, ApiError> {
    require_operator(&actor)?;
    machina_spec::validate_name(&body.name).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let project_id = match body.project_id {
        Some(id) => id,
        None => default_project_id(&state.pool).await?,
    };
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO security_groups (id, project_id, name, description) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(project_id)
    .bind(&body.name)
    .bind(&body.description)
    .execute(&state.pool)
    .await?;
    Ok(Json(SecurityGroupRow {
        id,
        project_id: Some(project_id),
        name: body.name,
        description: body.description,
        enforced: false,
    }))
}

pub async fn delete_security_group(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    sqlx::query("DELETE FROM security_groups WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SecurityGroupRuleRow {
    pub id: Uuid,
    pub security_group_id: Uuid,
    pub direction: String,
    pub protocol: Option<String>,
    pub port_min: Option<i32>,
    pub port_max: Option<i32>,
    pub remote_cidr: Option<String>,
    /// Always `false` today — see `SecurityGroupRow::enforced`.
    pub enforced: bool,
}

pub async fn list_security_group_rules(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<Vec<SecurityGroupRuleRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, SecurityGroupRuleRow>(
        "SELECT id, security_group_id, direction, protocol, port_min, port_max, remote_cidr, 0 AS enforced \
         FROM security_group_rules WHERE security_group_id = ? ORDER BY created_at",
    )
    .bind(group_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct CreateSecurityGroupRuleBody {
    #[serde(default = "default_direction")]
    pub direction: String,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub port_min: Option<i32>,
    #[serde(default)]
    pub port_max: Option<i32>,
    #[serde(default)]
    pub remote_cidr: Option<String>,
}

fn default_direction() -> String {
    "ingress".into()
}

pub async fn create_security_group_rule(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<CreateSecurityGroupRuleBody>,
) -> Result<Json<SecurityGroupRuleRow>, ApiError> {
    require_operator(&actor)?;
    if !matches!(body.direction.as_str(), "ingress" | "egress") {
        return Err(ApiError::bad_request("direction must be ingress or egress"));
    }
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO security_group_rules (id, security_group_id, direction, protocol, port_min, port_max, remote_cidr) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(group_id)
    .bind(&body.direction)
    .bind(&body.protocol)
    .bind(body.port_min)
    .bind(body.port_max)
    .bind(&body.remote_cidr)
    .execute(&state.pool)
    .await?;
    Ok(Json(SecurityGroupRuleRow {
        id,
        security_group_id: group_id,
        direction: body.direction,
        protocol: body.protocol,
        port_min: body.port_min,
        port_max: body.port_max,
        remote_cidr: body.remote_cidr,
        enforced: false,
    }))
}

pub async fn delete_security_group_rule(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    sqlx::query("DELETE FROM security_group_rules WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PortRow {
    pub id: Uuid,
    pub network_id: Uuid,
    pub project_id: Option<Uuid>,
    pub vm_id: Option<Uuid>,
    pub mac_address: Option<String>,
    pub security_group_id: Option<Uuid>,
    pub status: String,
}

const PORT_SELECT: &str =
    "SELECT id, network_id, project_id, vm_id, mac_address, security_group_id, status FROM ports";

#[derive(Debug, Deserialize)]
pub struct ListPortsQuery {
    #[serde(default)]
    pub network_id: Option<Uuid>,
    #[serde(default)]
    pub vm_id: Option<Uuid>,
}

pub async fn list_ports(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Query(q): Query<ListPortsQuery>,
) -> Result<Json<Vec<PortRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, PortRow>(&format!(
        "{PORT_SELECT} WHERE (?1 IS NULL OR network_id = ?1) AND (?2 IS NULL OR vm_id = ?2) ORDER BY created_at"
    ))
    .bind(q.network_id)
    .bind(q.vm_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn get_port(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<PortRow>, ApiError> {
    require_operator(&actor)?;
    let row = sqlx::query_as::<_, PortRow>(&format!("{PORT_SELECT} WHERE id = ?"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct CreatePortBody {
    pub network_id: Uuid,
    #[serde(default)]
    pub vm_id: Option<Uuid>,
    #[serde(default)]
    pub security_group_id: Option<Uuid>,
    #[serde(default)]
    pub project_id: Option<Uuid>,
}

/// `POST /api/v1/ports` — creating a port with `vm_id` set delegates the actual NIC
/// attach to the existing `vms::attach_vm_nic`, waits for it to complete, then
/// resolves the resulting MAC from the VM's live NIC inventory (`vms::list_vm_nics`,
/// which reads straight from libvirt — there's no separate NIC table to insert into).
pub async fn create_port(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreatePortBody>,
) -> Result<Json<PortRow>, ApiError> {
    require_operator(&actor)?;
    let network_name: String = sqlx::query_scalar("SELECT name FROM networks WHERE id = ?")
        .bind(body.network_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::bad_request("network not found"))?;
    let project_id = match body.project_id {
        Some(id) => id,
        None => default_project_id(&state.pool).await?,
    };

    let cloud_owner: Option<Uuid> = sqlx::query_scalar("SELECT v.project_id FROM cloud_subnets s JOIN cloud_vpcs v ON v.id=s.vpc_id WHERE s.network_id=?").bind(body.network_id).fetch_optional(&state.pool).await?;
    if let Some(owner) = cloud_owner {
        if owner != project_id {
            return Err(ApiError::forbidden(
                "port project must match cloud subnet project",
            ));
        }
        let mut conn = state.pool.acquire().await?;
        crate::api::cloud::access(&mut conn, &actor, owner, true).await?;
    }
    let id = Uuid::new_v4();
    let mut mac_address: Option<String> = None;
    let mut status = "DOWN";

    if let Some(vm_id) = body.vm_id {
        let task = vms::attach_vm_nic(
            State(state.clone()),
            Extension(actor.clone()),
            Path(vm_id),
            Json(vms::AttachNicBody {
                network: network_name.clone(),
                model: "virtio".into(),
            }),
        )
        .await?;
        crate::api::volumes::wait_for_task(&state.pool, &task.0.task_id).await?;

        // Known race: if two ports are created concurrently for the same VM+network,
        // both attach calls complete before either lists NICs, so this "last matching
        // NIC" heuristic could attribute the wrong MAC to a port. There's no
        // synchronous "MAC of the NIC I just attached" signal from the agent RPC to
        // key off instead — narrowing this needs a deeper agent-side change, not
        // something to paper over here.
        let nics = vms::list_vm_nics(State(state.clone()), Path(vm_id)).await?;
        mac_address = nics
            .0
            .iter()
            .rev()
            .find(|n| n.network == network_name)
            .map(|n| n.mac_address.clone());
        status = "ACTIVE";
    }

    sqlx::query(
        "INSERT INTO ports (id, network_id, project_id, vm_id, mac_address, security_group_id, status) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(body.network_id)
    .bind(project_id)
    .bind(body.vm_id)
    .bind(&mac_address)
    .bind(body.security_group_id)
    .bind(status)
    .execute(&state.pool)
    .await?;

    Ok(Json(PortRow {
        id,
        network_id: body.network_id,
        project_id: Some(project_id),
        vm_id: body.vm_id,
        mac_address,
        security_group_id: body.security_group_id,
        status: status.to_string(),
    }))
}

pub async fn delete_port(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let row: Option<(Option<Uuid>, Option<String>)> =
        sqlx::query_as("SELECT vm_id, mac_address FROM ports WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;
    let Some((vm_id, mac_address)) = row else {
        return Err(ApiError::not_found("port not found"));
    };
    if let (Some(vm_id), Some(mac)) = (vm_id, mac_address) {
        let task =
            vms::detach_vm_nic(State(state.clone()), Extension(actor), Path((vm_id, mac))).await?;
        crate::api::volumes::wait_for_task(&state.pool, &task.0.task_id).await?;
    }
    sqlx::query("DELETE FROM ports WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

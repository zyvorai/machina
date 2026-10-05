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
//! Security groups are advisory (`mode = audit`) until an operator sets `mode = enforce`; enforcing
//! groups are compiled by `engine::sg_enforce` into per-VM policies on the VM edge and `enforcement`
//! reports what the hosts actually say.

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
    /// `true` only when the group is in enforce mode; see `enforcement` for what the datapath reports.
    pub enforced: bool,
    pub mode: String,
    #[sqlx(skip)]
    pub enforcement: Option<serde_json::Value>,
}

async fn with_enforcement(pool: &sqlx::SqlitePool, mut r: SecurityGroupRow) -> SecurityGroupRow {
    r.enforcement = Some(crate::engine::sg_enforce::enforcement(pool, &r.id.simple().to_string()).await);
    r
}

fn resync(state: &AppState) {
    let pool = state.pool.clone();
    tokio::spawn(async move {
        crate::engine::vm_netpol::reconcile(&pool, false).await;
    });
}

pub async fn list_security_groups(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<SecurityGroupRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, SecurityGroupRow>(
        "SELECT id, project_id, name, description, (mode = 'enforce') AS enforced, mode FROM security_groups ORDER BY name",
    )
    .fetch_all(&state.pool)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(with_enforcement(&state.pool, r).await);
    }
    Ok(Json(out))
}

pub async fn get_security_group(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<SecurityGroupRow>, ApiError> {
    require_operator(&actor)?;
    let row = sqlx::query_as::<_, SecurityGroupRow>(
        "SELECT id, project_id, name, description, (mode = 'enforce') AS enforced, mode FROM security_groups WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(with_enforcement(&state.pool, row).await))
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
    // EC2 parity: a new group allows all outbound traffic until the operator removes the rule.
    sqlx::query(
        "INSERT INTO security_group_rules (id, security_group_id, direction, remote_cidr, description) \
         VALUES (?, ?, 'egress', '0.0.0.0/0', 'default: allow all outbound')",
    )
    .bind(Uuid::new_v4())
    .bind(id)
    .execute(&state.pool)
    .await?;
    Ok(Json(SecurityGroupRow {
        id,
        project_id: Some(project_id),
        name: body.name,
        description: body.description,
        enforced: false,
        mode: "audit".into(),
        enforcement: None,
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
    pub remote_sg_id: Option<String>,
    pub description: String,
}

pub async fn list_security_group_rules(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<Vec<SecurityGroupRuleRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, SecurityGroupRuleRow>(
        "SELECT id, security_group_id, direction, protocol, port_min, port_max, remote_cidr, remote_sg_id, description \
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
    /// Peer = every instance carrying this group (instead of a CIDR).
    #[serde(default)]
    pub remote_sg_id: Option<String>,
    #[serde(default)]
    pub description: String,
}

fn validate_rule(b: &CreateSecurityGroupRuleBody) -> Result<(), ApiError> {
    if !matches!(b.direction.as_str(), "ingress" | "egress") {
        return Err(ApiError::bad_request("direction must be ingress or egress"));
    }
    if let Some(p) = b.protocol.as_deref() {
        if !matches!(p.to_ascii_lowercase().as_str(), "tcp" | "udp" | "icmp" | "icmpv6" | "all" | "-1" | "any") {
            return Err(ApiError::bad_request("protocol must be tcp, udp, icmp, icmpv6 or all"));
        }
    }
    let tcp_udp = matches!(b.protocol.as_deref().map(str::to_ascii_lowercase).as_deref(), Some("tcp") | Some("udp"));
    if let (Some(lo), hi) = (b.port_min, b.port_max) {
        if tcp_udp && !(1..=65535).contains(&lo) {
            return Err(ApiError::bad_request("port_min must be 1-65535"));
        }
        if tcp_udp && hi.is_some_and(|h| h < lo || h > 65535) {
            return Err(ApiError::bad_request("port_max must be between port_min and 65535"));
        }
    }
    if b.remote_cidr.is_some() && b.remote_sg_id.as_deref().is_some_and(|s| !s.is_empty()) {
        return Err(ApiError::bad_request("use remote_cidr or remote_sg_id, not both"));
    }
    if let Some(c) = b.remote_cidr.as_deref() {
        let (ip, bits) = c.split_once('/').unwrap_or((c, if c.contains(':') { "128" } else { "32" }));
        let ok = ip.parse::<std::net::IpAddr>().is_ok()
            && bits.parse::<u8>().is_ok_and(|n| n <= if ip.contains(':') { 128 } else { 32 });
        if !ok {
            return Err(ApiError::bad_request("remote_cidr is not a valid CIDR"));
        }
    }
    if b.description.len() > 255 {
        return Err(ApiError::bad_request("description is limited to 255 characters"));
    }
    Ok(())
}

fn default_direction() -> String {
    "ingress".into()
}

pub async fn create_security_group_rule(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(group_id): Path<Uuid>,
    Json(mut body): Json<CreateSecurityGroupRuleBody>,
) -> Result<Json<SecurityGroupRuleRow>, ApiError> {
    require_operator(&actor)?;
    validate_rule(&body)?;
    if let Some(r) = body.remote_sg_id.as_deref().filter(|s| !s.is_empty()) {
        let rid = Uuid::parse_str(r).map_err(|_| ApiError::bad_request("remote_sg_id must be a security group id"))?;
        let known: Option<i64> = sqlx::query_scalar("SELECT 1 FROM security_groups WHERE id = ?")
            .bind(rid)
            .fetch_optional(&state.pool)
            .await?;
        if known.is_none() {
            return Err(ApiError::bad_request("remote_sg_id is not a security group"));
        }
        body.remote_sg_id = Some(rid.simple().to_string());
    }
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO security_group_rules (id, security_group_id, direction, protocol, port_min, port_max, remote_cidr, remote_sg_id, description) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(group_id)
    .bind(&body.direction)
    .bind(&body.protocol)
    .bind(body.port_min)
    .bind(body.port_max)
    .bind(&body.remote_cidr)
    .bind(&body.remote_sg_id)
    .bind(&body.description)
    .execute(&state.pool)
    .await?;
    resync(&state);
    Ok(Json(SecurityGroupRuleRow {
        id,
        security_group_id: group_id,
        direction: body.direction,
        protocol: body.protocol,
        port_min: body.port_min,
        port_max: body.port_max,
        remote_cidr: body.remote_cidr,
        remote_sg_id: body.remote_sg_id,
        description: body.description,
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
    resync(&state);
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


// ---------------------------------------------------------------------------
// Enforcement mode and instance attachment
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SecurityGroupModeBody {
    pub mode: String,
}

/// `audit` (advisory) or `enforce`. Enforcing is refused while an attached instance has no known
/// address (the VM edge could not tell its traffic from spoofed traffic).
pub async fn set_security_group_mode(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<SecurityGroupModeBody>,
) -> Result<Json<SecurityGroupRow>, ApiError> {
    require_operator(&actor)?;
    if !matches!(body.mode.as_str(), "audit" | "enforce") {
        return Err(ApiError::bad_request("mode must be audit or enforce"));
    }
    if body.mode == "enforce" {
        let blind: Vec<String> = sqlx::query_scalar(
            "SELECT v.name FROM instance_security_groups i \
             JOIN vms v ON v.id = i.vm_id \
             WHERE i.sg_id = ? AND COALESCE(v.guest_ip, '') = '' AND COALESCE(v.guest_ips, '') IN ('', '[]')",
        )
        .bind(id)
        .fetch_all(&state.pool)
        .await?;
        if !blind.is_empty() {
            return Err(ApiError::conflict(
                format!("instances without a known address: {}", blind.join(", ")),
                "wait for the guest address to be learned (or install the guest agent), then retry",
            )
            .with_code("sg_enforce_unknown_address"));
        }
    }
    let r = sqlx::query("UPDATE security_groups SET mode = ? WHERE id = ?")
        .bind(&body.mode)
        .bind(id)
        .execute(&state.pool)
        .await?;
    if r.rows_affected() == 0 {
        return Err(ApiError::not_found("security group not found"));
    }
    resync(&state);
    get_security_group(State(state), Extension(actor), Path(id)).await
}

pub async fn list_instance_security_groups(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(vm_id): Path<Uuid>,
) -> Result<Json<Vec<SecurityGroupRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, SecurityGroupRow>(
        "SELECT g.id, g.project_id, g.name, g.description, (g.mode = 'enforce') AS enforced, g.mode \
         FROM security_groups g JOIN instance_security_groups i ON i.sg_id = g.id \
         WHERE i.vm_id = ? ORDER BY g.name",
    )
    .bind(vm_id)
    .fetch_all(&state.pool)
    .await?;
    let mut out = Vec::new();
    for r in rows {
        out.push(with_enforcement(&state.pool, r).await);
    }
    Ok(Json(out))
}

pub async fn attach_instance_security_group(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path((vm_id, sg_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let vm: Option<String> = sqlx::query_scalar("SELECT name FROM vms WHERE id = ?")
        .bind(vm_id)
        .fetch_optional(&state.pool)
        .await?;
    if vm.is_none() {
        return Err(ApiError::not_found("instance not found"));
    }
    let sg: Option<String> = sqlx::query_scalar("SELECT name FROM security_groups WHERE id = ?")
        .bind(sg_id)
        .fetch_optional(&state.pool)
        .await?;
    if sg.is_none() {
        return Err(ApiError::not_found("security group not found"));
    }
    sqlx::query("INSERT OR IGNORE INTO instance_security_groups (vm_id, sg_id) VALUES (?, ?)")
        .bind(vm_id)
        .bind(sg_id)
        .execute(&state.pool)
        .await?;
    resync(&state);
    Ok(Json(serde_json::json!({ "vm_id": vm_id, "security_group_id": sg_id, "attached": true })))
}

pub async fn detach_instance_security_group(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path((vm_id, sg_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    sqlx::query("DELETE FROM instance_security_groups WHERE vm_id = ? AND sg_id = ?")
        .bind(vm_id)
        .bind(sg_id)
        .execute(&state.pool)
        .await?;
    resync(&state);
    Ok(Json(serde_json::json!({ "vm_id": vm_id, "security_group_id": sg_id, "attached": false })))
}

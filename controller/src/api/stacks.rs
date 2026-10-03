// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! Declarative multi-resource stacks — Phase D of the next-gen roadmap
//! (`/Users/ssahani/.claude/plans/lazy-munching-quilt.md`). A stack template
//! describes a set of resources (security groups, volumes, VMs) created together and
//! torn down as a unit — not a new orchestration engine, just a thin composition layer
//! over the existing native `create_security_group`/`create_volume`/`create_vm`
//! handlers, created in a fixed dependency order (security groups and volumes first,
//! since VMs may reference them by name) and torn down in reverse.

use std::time::Duration;

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
use machina_spec::VirtualMachine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::networking::{self, CreateSecurityGroupBody, CreateSecurityGroupRuleBody};
use crate::api::projects::default_project_id;
use crate::api::vms::{self, CreateVmBody};
use crate::api::volumes::{self, AttachVolumeBody, CreateVolumeBody};
use crate::api::ApiError;
use crate::auth::{require_operator, AuthUser};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Template shape
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StackTemplate {
    #[serde(default)]
    pub security_groups: Vec<StackSecurityGroup>,
    #[serde(default)]
    pub volumes: Vec<StackVolume>,
    #[serde(default)]
    pub vms: Vec<StackVm>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StackSecurityGroup {
    pub name: String,
    #[serde(default)]
    pub rules: Vec<StackSecurityGroupRule>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StackSecurityGroupRule {
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

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StackVolume {
    pub name: String,
    pub size_gib: i64,
    #[serde(default = "default_volume_class")]
    pub volume_class: String,
}

fn default_volume_class() -> String {
    "silver".into()
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StackVm {
    pub name: String,
    #[serde(default = "default_memory")]
    pub memory: String,
    #[serde(default = "default_cores")]
    pub cpu_cores: u32,
    #[serde(default = "default_disk_gib")]
    pub disk_gib: i64,
    #[serde(default = "default_network")]
    pub network: String,
    /// Names of `volumes` (above) in this same template to attach once the VM is running.
    #[serde(default)]
    pub attach_volumes: Vec<String>,
}

fn default_memory() -> String {
    "1Gi".into()
}
fn default_cores() -> u32 {
    1
}
fn default_disk_gib() -> i64 {
    10
}
fn default_network() -> String {
    "default".into()
}

// ---------------------------------------------------------------------------
// Stack rows
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StackResourceRef {
    kind: String,
    id: Uuid,
    name: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct StackRow {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub status: String,
    pub last_error: Option<String>,
    pub template_json: sqlx::types::Json<StackTemplate>,
    pub resources_json: sqlx::types::Json<serde_json::Value>,
}

const STACK_SELECT: &str =
    "SELECT id, project_id, name, status, last_error, template_json, resources_json FROM stacks";

pub async fn list_stacks(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<StackRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = sqlx::query_as::<_, StackRow>(&format!("{STACK_SELECT} ORDER BY created_at DESC"))
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(rows))
}

pub async fn get_stack(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<StackRow>, ApiError> {
    require_operator(&actor)?;
    let row = sqlx::query_as::<_, StackRow>(&format!("{STACK_SELECT} WHERE id = ?"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct CreateStackBody {
    pub name: String,
    pub template: StackTemplate,
    #[serde(default)]
    pub project_id: Option<Uuid>,
}

/// `build_stack` creates every listed resource synchronously, in-process, inside a
/// single HTTP request — bypassing the per-route rate-limit/tracing middleware that
/// would normally apply if each resource were created via its own `POST` call. Cap the
/// template so one `create_stack` request can't fan out into an unbounded burst of
/// real VM/volume/security-group creation against the underlying hosts.
const MAX_STACK_RESOURCES: usize = 25;

fn validate_stack_size(template: &StackTemplate) -> Result<(), ApiError> {
    let total = template.security_groups.len() + template.volumes.len() + template.vms.len();
    if total > MAX_STACK_RESOURCES {
        return Err(ApiError::bad_request(format!(
            "stack template has {total} resources, exceeding the {MAX_STACK_RESOURCES} limit per stack"
        )));
    }
    Ok(())
}

/// `POST /api/v1/stacks` — creates every resource in the template, in order (security
/// groups, then volumes, then VMs with their `attach_volumes` resolved by name), and
/// records what was created so `delete_stack` can tear it all down. On any failure
/// partway through, the resources created so far are left in place (matching every
/// other create handler in this codebase — no silent rollback) and the stack is
/// marked `error` with the resource list captured up to the failure point, so the
/// operator can inspect and clean up via the normal per-resource DELETE endpoints.
pub async fn create_stack(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateStackBody>,
) -> Result<Json<StackRow>, ApiError> {
    require_operator(&actor)?;
    machina_spec::validate_name(&body.name).map_err(|e| ApiError::bad_request(e.to_string()))?;
    validate_stack_size(&body.template)?;
    let project_id = match body.project_id {
        Some(id) => id,
        None => default_project_id(&state.pool).await?,
    };
    // vms.project is matched by free-text NAME (see Phase A's backward-compat note),
    // not by projects.id — resolve the name once so VM creation stays consistent with
    // every other project-scoped query in the codebase.
    let project_name: String = sqlx::query_scalar("SELECT name FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(&state.pool)
        .await?;

    let id = Uuid::new_v4();
    let template_json = serde_json::to_value(&body.template).map_err(|e| ApiError::internal(e.to_string()))?;
    sqlx::query(
        "INSERT INTO stacks (id, project_id, name, template_json, status) VALUES (?, ?, ?, ?, 'creating')",
    )
    .bind(id)
    .bind(project_id)
    .bind(&body.name)
    .bind(&template_json)
    .execute(&state.pool)
    .await?;

    let result = build_stack(&state, actor, &body.template, project_id, &project_name).await;
    let (status, resources, error) = match &result {
        Ok(refs) => ("created", refs.clone(), None),
        Err((refs, e)) => ("error", refs.clone(), Some(e.message.clone())),
    };
    let resources_json =
        serde_json::to_value(&resources).map_err(|e| ApiError::internal(e.to_string()))?;
    sqlx::query("UPDATE stacks SET status = ?, resources_json = ?, last_error = ? WHERE id = ?")
        .bind(status)
        .bind(&resources_json)
        .bind(&error)
        .bind(id)
        .execute(&state.pool)
        .await?;

    let row = sqlx::query_as::<_, StackRow>(&format!("{STACK_SELECT} WHERE id = ?"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    if let Err((_, e)) = result {
        return Err(ApiError::internal(format!(
            "stack '{}' partially created before failing: {}",
            body.name, e.message
        ))
        .with_code("stack_partial_failure"));
    }
    Ok(Json(row))
}

async fn build_stack(
    state: &AppState,
    actor: AuthUser,
    template: &StackTemplate,
    project_id: Uuid,
    project_name: &str,
) -> Result<Vec<StackResourceRef>, (Vec<StackResourceRef>, ApiError)> {
    let mut created = Vec::new();
    let mut attach_count: usize = 0;

    for sg in &template.security_groups {
        let group = networking::create_security_group(
            State(state.clone()),
            Extension(actor.clone()),
            Json(CreateSecurityGroupBody { name: sg.name.clone(), description: String::new(), project_id: Some(project_id) }),
        )
        .await
        .map_err(|e| (created.clone(), e))?;
        created.push(StackResourceRef { kind: "security_group".into(), id: group.0.id, name: sg.name.clone() });

        for rule in &sg.rules {
            let _ = networking::create_security_group_rule(
                State(state.clone()),
                Extension(actor.clone()),
                Path(group.0.id),
                Json(CreateSecurityGroupRuleBody {
                    direction: rule.direction.clone(),
                    protocol: rule.protocol.clone(),
                    port_min: rule.port_min,
                    port_max: rule.port_max,
                    remote_cidr: rule.remote_cidr.clone(),
                }),
            )
            .await
            .map_err(|e| (created.clone(), e))?;
        }
    }

    let mut volume_ids: std::collections::HashMap<String, Uuid> = std::collections::HashMap::new();
    for vol in &template.volumes {
        let row = volumes::create_volume(
            State(state.clone()),
            Extension(actor.clone()),
            Json(CreateVolumeBody {
                name: vol.name.clone(),
                size_gib: vol.size_gib,
                project_id: Some(project_id),
                volume_class: vol.volume_class.clone(),
            }),
        )
        .await
        .map_err(|e| (created.clone(), e))?;
        created.push(StackResourceRef { kind: "volume".into(), id: row.0.id, name: vol.name.clone() });
        volume_ids.insert(vol.name.clone(), row.0.id);
    }

    for vm_spec in &template.vms {
        let mut vm = VirtualMachine::new(&vm_spec.name, &vm_spec.memory);
        vm.metadata.project = Some(project_name.to_string());
        vm.spec.cpu.cores = vm_spec.cpu_cores.max(1);
        if let Some(root) = vm.spec.storage.first_mut() {
            root.size = format!("{}Gi", vm_spec.disk_gib.max(1));
        }
        if let Some(net) = vm.spec.network.first_mut() {
            net.network = vm_spec.network.clone();
        }
        let task = vms::create_vm(
            State(state.clone()),
            Extension(actor.clone()),
            Json(CreateVmBody { vm, host_id: None, tags: vec!["stack".into()], desired_state: "running".into(), atlas_root_disk: false, atlas_policy: None }),
        )
        .await
        .map_err(|e| (created.clone(), e))?;
        let task_uuid = Uuid::parse_str(&task.0.task_id)
            .map_err(|e| (created.clone(), ApiError::internal(e.to_string())))?;
        let vm_id: Uuid = sqlx::query_scalar("SELECT resource_id FROM tasks WHERE id = ?")
            .bind(task_uuid)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| (created.clone(), ApiError::from(e)))?;
        // Track the VM as created BEFORE waiting on its provisioning task: if the wait
        // below times out or the task fails partway through a real libvirt define+start,
        // the VM may still exist on the host and must be in `created` so `delete_stack`
        // (and the operator-visible partial-failure resource list) can find and remove
        // it — losing this entry here would leak the VM.
        created.push(StackResourceRef { kind: "vm".into(), id: vm_id, name: vm_spec.name.clone() });
        // VM provisioning (define + start via libvirt) runs well past the 20s default
        // used elsewhere in this file — give it a generous ceiling before giving up.
        volumes::wait_for_task_timeout(&state.pool, &task.0.task_id, Duration::from_secs(180))
            .await
            .map_err(|e| (created.clone(), e))?;

        for vol_name in &vm_spec.attach_volumes {
            let vol_id = *volume_ids
                .get(vol_name)
                .ok_or_else(|| (created.clone(), ApiError::bad_request(format!("attach_volumes references unknown volume '{vol_name}'"))))?;
            attach_count += 1;
            let _ = volumes::attach_volume(
                State(state.clone()),
                Extension(actor.clone()),
                Path(vol_id),
                Json(AttachVolumeBody { vm_id, target_dev: default_target_dev_for(attach_count) }),
            )
            .await
            .map_err(|e| (created.clone(), e))?;
        }
    }

    Ok(created)
}

/// `n` is a 1-based attach count (the VM's own root disk is always `vda`, reserved and
/// never assigned here). Bijective base-26 over b..z, then aa, ab, ... — same scheme
/// spreadsheet columns use — so n=1 -> vdb, n=25 -> vdz, n=26 -> vdaa, and it never
/// wraps back around to collide with vda no matter how many volumes are attached.
fn default_target_dev_for(n: usize) -> String {
    let mut v = n + 1; // v=1 is reserved for vda; attachments start at v=2 ('b').
    let mut letters = Vec::new();
    while v > 0 {
        v -= 1;
        letters.push((b'a' + (v % 26) as u8) as char);
        v /= 26;
    }
    letters.reverse();
    format!("vd{}", letters.into_iter().collect::<String>())
}

/// `DELETE /api/v1/stacks/{id}` — tears down every tracked resource in reverse
/// creation order (VMs first, so their FK `ON DELETE SET NULL` frees any attached
/// volumes before those volumes are deleted; security groups last).
pub async fn delete_stack(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let resources_json: sqlx::types::Json<Vec<StackResourceRef>> =
        sqlx::query_scalar("SELECT resources_json FROM stacks WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| ApiError::not_found("stack not found"))?;

    let mut errors = Vec::new();
    for res in resources_json.0.iter().rev() {
        let result = match res.kind.as_str() {
            // Must wait for the delete task to actually finish — vms::delete_vm only
            // enqueues it. Without this, the immediately-following volume delete (which
            // requires attached_vm_id to already be NULL via the FK's ON DELETE SET
            // NULL) races the still-pending VM deletion and fails with "still attached"
            // even though the VM is in the process of being removed.
            "vm" => match vms::delete_vm(State(state.clone()), Extension(actor.clone()), Path(res.id), None).await {
                Ok(task) => volumes::wait_for_task(&state.pool, &task.0.task_id).await,
                Err(e) => Err(e),
            },
            "volume" => volumes::delete_volume(State(state.clone()), Extension(actor.clone()), Path(res.id))
                .await
                .map(|_| ()),
            "security_group" => {
                networking::delete_security_group(State(state.clone()), Extension(actor.clone()), Path(res.id))
                    .await
                    .map(|_| ())
            }
            other => Err(ApiError::internal(format!("unknown stack resource kind '{other}'"))),
        };
        if let Err(e) = result {
            errors.push(format!("{} '{}': {}", res.kind, res.name, e.message));
        }
    }

    if errors.is_empty() {
        sqlx::query("DELETE FROM stacks WHERE id = ?").bind(id).execute(&state.pool).await?;
        Ok(Json(serde_json::json!({ "deleted": true })))
    } else {
        sqlx::query("UPDATE stacks SET status = 'delete_failed', last_error = ? WHERE id = ?")
            .bind(errors.join("; "))
            .bind(id)
            .execute(&state.pool)
            .await?;
        Err(ApiError::internal(format!("stack teardown had {} failure(s): {}", errors.len(), errors.join("; "))))
    }
}

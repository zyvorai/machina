// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, Query, State};
use axum::Extension;
use axum::Json;
use machina_spec::{CloudInitSpec, VirtualMachine};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::tasks::TaskResponse;
use crate::api::ApiError;
use crate::auth::AuthUser;
use crate::engine::migrate_precheck::run_migrate_precheck;
use crate::engine::placement::pick_host_for_vm;
use crate::engine::policy;
use crate::engine::template::upsert_ha_policy;
use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct VmRow {
    pub id: Uuid,
    pub name: String,
    pub host_id: Option<Uuid>,
    pub desired_state: String,
    pub observed_state: String,
    pub lifecycle_phase: String,
    pub last_error: String,
    pub managed: bool,
    pub uuid: Option<String>,
    pub vcpus: i32,
    pub memory_mib: i64,
    pub ha_enabled: bool,
    pub project: Option<String>,
    pub tags: Vec<String>,
    pub inventory_source: String,
    pub k8s_namespace: Option<String>,
    pub last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, serde::Deserialize)]
pub struct VmListQuery {
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub host_id: Option<Uuid>,
    #[serde(default)]
    pub managed: Option<bool>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

pub async fn list_vms(
    State(state): State<AppState>,
    Query(q): Query<VmListQuery>,
) -> Result<Json<Vec<VmRow>>, ApiError> {
    let rows = sqlx::query_as::<_, VmRow>(
        "SELECT v.id, v.name, v.host_id, v.desired_state, v.observed_state,
                COALESCE(v.lifecycle_phase, 'idle') AS lifecycle_phase,
                COALESCE(v.last_error, '') AS last_error,
                COALESCE(v.managed, TRUE) AS managed,
                v.uuid, v.vcpus, v.memory_mib,
                COALESCE(hp.enabled, FALSE) AS ha_enabled, v.project, COALESCE(v.tags, '{}') AS tags,
                COALESCE(v.inventory_source, 'libvirt') AS inventory_source,
                v.k8s_namespace, v.last_seen_at
         FROM vms v LEFT JOIN ha_policies hp ON hp.vm_id = v.id
         LEFT JOIN vm_metrics m ON m.vm_id = v.id
         WHERE ($1::text IS NULL OR v.project = $1)
           AND ($2::uuid IS NULL OR v.host_id = $2)
           AND ($3::bool IS NULL OR v.managed = $3)
           AND ($4::text IS NULL OR $4 = ANY(v.tags))
           AND ($6::text IS NULL OR v.inventory_source = $6)
           AND (
             $5::text IS NULL
             OR ($5 = 'running' AND v.observed_state = 'running')
             OR ($5 = 'stopped' AND v.observed_state NOT IN ('running', 'missing'))
             OR ($5 = 'discovered' AND v.managed = FALSE)
             OR ($5 = 'missing' AND v.observed_state = 'missing')
             OR ($5 = 'untagged' AND (v.tags IS NULL OR v.tags = '{}'))
             OR ($5 = 'high_cpu' AND m.cpu_percent > 85)
             OR ($5 = 'unprotected' AND NOT EXISTS (
               SELECT 1 FROM backup_records b
               WHERE b.vm_id = v.id AND b.status = 'completed'
                 AND b.created_at > NOW() - INTERVAL '7 days'
             ))
             OR ($5 = 'ha_enabled' AND hp.enabled = TRUE)
             OR $5 = 'all'
           )
         ORDER BY v.name",
    )
    .bind(q.project.as_deref())
    .bind(q.host_id)
    .bind(q.managed)
    .bind(q.tag.as_deref())
    .bind(q.folder.as_deref())
    .bind(q.source.as_deref())
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn get_vm(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<VmRow>, ApiError> {
    let row = sqlx::query_as::<_, VmRow>(
        "SELECT v.id, v.name, v.host_id, v.desired_state, v.observed_state,
                COALESCE(v.lifecycle_phase, 'idle') AS lifecycle_phase,
                COALESCE(v.last_error, '') AS last_error,
                COALESCE(v.managed, TRUE) AS managed,
                v.uuid, v.vcpus, v.memory_mib,
                COALESCE(hp.enabled, FALSE) AS ha_enabled, v.project, COALESCE(v.tags, '{}') AS tags,
                COALESCE(v.inventory_source, 'libvirt') AS inventory_source,
                v.k8s_namespace, v.last_seen_at
         FROM vms v LEFT JOIN ha_policies hp ON hp.vm_id = v.id
         WHERE v.id = $1",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

pub async fn get_vm_spec(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let spec: serde_json::Value = sqlx::query_scalar("SELECT spec_json FROM vms WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(spec))
}

#[derive(Debug, Deserialize)]
pub struct CreateVmBody {
    #[serde(flatten)]
    pub vm: VirtualMachine,
    #[serde(default)]
    pub host_id: Option<Uuid>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_desired")]
    pub desired_state: String,
}

fn default_desired() -> String {
    "running".into()
}

pub async fn create_vm(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateVmBody>,
) -> Result<Json<TaskResponse>, ApiError> {
    body.vm.validate()
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    let cluster_id: Uuid = sqlx::query_scalar("SELECT id FROM clusters LIMIT 1")
        .fetch_one(&state.pool)
        .await?;

    let vcpus = body.vm.total_vcpus() as i32;
    let memory_mib = body.vm.memory_mib().map_err(|e| ApiError::bad_request(e.to_string()))? as i64;
    let mut storage_gib: i64 = 0;
    for vol in &body.vm.spec.storage {
        storage_gib += machina_spec::parse_size_gib(&vol.size)
            .map_err(|e| ApiError::bad_request(e.to_string()))? as i64;
    }
    let project = body
        .vm
        .metadata
        .project
        .clone()
        .unwrap_or_else(|| "default".into());
    if let Err(v) = policy::evaluate_vm_create(
        &state.pool,
        &project,
        &body.tags,
        vcpus,
        memory_mib,
        storage_gib,
        body.vm.spec.ha.enabled,
    )
    .await
    {
        return Err(ApiError::policy_violation(v.message, v.remediation));
    }

    let host_id = match body.host_id {
        Some(id) => id,
        None => pick_host_for_vm(&state.pool, &body.tags, memory_mib)
            .await
            .map_err(|e| ApiError::bad_request(e.to_string()))?,
    };

    let vm_id = Uuid::new_v4();
    let spec_json = serde_json::to_value(&body.vm).map_err(|e| ApiError::internal(e.to_string()))?;

    sqlx::query(
        "INSERT INTO vms (id, cluster_id, host_id, name, project, spec_json, desired_state, lifecycle_phase, vcpus, memory_mib, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'creating', $8, $9, $10)",
    )
    .bind(vm_id)
    .bind(cluster_id)
    .bind(host_id)
    .bind(&body.vm.metadata.name)
    .bind(&body.vm.metadata.project)
    .bind(&spec_json)
    .bind(&body.desired_state)
    .bind(vcpus)
    .bind(memory_mib)
    .bind(&body.tags)
    .execute(&state.pool)
    .await?;

    for vol in &body.vm.spec.storage {
        let size_gib = machina_spec::parse_size_gib(&vol.size)
            .map_err(|e| ApiError::bad_request(e.to_string()))? as i64;
        sqlx::query(
            "INSERT INTO vm_disks (id, vm_id, name, size_gib, storage_class) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(Uuid::new_v4())
        .bind(vm_id)
        .bind(&vol.name)
        .bind(size_gib)
        .bind(&vol.class)
        .execute(&state.pool)
        .await?;
    }

    if body.vm.spec.ha.enabled {
        upsert_ha_policy(
            &state.pool,
            vm_id,
            true,
            3,
            body.vm
                .spec
                .ha
                .restart_priority
                .as_deref()
                .unwrap_or("medium"),
            false,
            body.vm.spec.ha.anti_affinity.is_some(),
        )
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    }

    let task_id = enqueue_task(
        &state,
        "vm.apply",
        serde_json::json!({
            "vm_id": vm_id.to_string(),
            "host_id": host_id.to_string(),
        }),
        Some("vm"),
        Some(vm_id),
        Some(host_id),
    )
    .await?;

    sqlx::query(
        "INSERT INTO audit_logs (id, actor, action, resource_type, resource_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(&actor.username)
    .bind("vm.create")
    .bind("vm")
    .bind(vm_id)
    .bind(serde_json::json!({ "name": body.vm.metadata.name }))
    .execute(&state.pool)
    .await?;

    if let Some(net) = body.vm.spec.network.first() {
        if let Some(profile) = &net.firewall_profile {
            let _ = sqlx::query(
                "INSERT INTO firewall_timeline (target_kind, target_id, kind, summary, detail_json, actor)
                 VALUES ('vm', $1, 'profile_requested', $2, $3, $4)",
            )
            .bind(vm_id)
            .bind(format!("VM network requests firewall profile {profile}"))
            .bind(serde_json::json!({ "profile": profile, "host_id": host_id.to_string(), "network": net.network }))
            .bind(&actor.username)
            .execute(&state.pool)
            .await;
        }
    }

    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "vm.apply".into(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct CreateFromTemplateBody {
    pub template_ref: String,
    pub name: String,
    #[serde(default = "default_memory")]
    pub memory: String,
    #[serde(default)]
    pub host_id: Option<Uuid>,
    #[serde(default = "default_desired")]
    pub desired_state: String,
    #[serde(default)]
    pub cloud_init_user: Option<String>,
    #[serde(default)]
    pub cloud_init_password: Option<String>,
    #[serde(default)]
    pub cloud_init_ssh_pubkey: Option<String>,
}

fn default_memory() -> String {
    "4Gi".into()
}

pub async fn create_from_template(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateFromTemplateBody>,
) -> Result<Json<TaskResponse>, ApiError> {
    machina_spec::validate_name(&body.name).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let mut vm = VirtualMachine::new(&body.name, &body.memory);
    vm.spec.template_ref = Some(body.template_ref.clone());
    if body.cloud_init_user.is_some()
        || body.cloud_init_password.is_some()
        || body.cloud_init_ssh_pubkey.is_some()
    {
        vm.spec.cloud_init = Some(CloudInitSpec {
            user: body
                .cloud_init_user
                .clone()
                .unwrap_or_else(|| "ubuntu".into()),
            password: body.cloud_init_password.clone(),
            ssh_pubkey: body.cloud_init_ssh_pubkey.clone(),
        });
    }
    if let Ok(Some(profile)) =
        crate::engine::template::resolve_template_firewall_profile(&state.pool, &body.template_ref)
            .await
    {
        if let Some(net) = vm.spec.network.first_mut() {
            net.firewall_profile = Some(profile);
        }
    }
    let create_body = CreateVmBody {
        vm,
        host_id: body.host_id,
        tags: vec![],
        desired_state: body.desired_state,
    };
    create_vm(State(state), Extension(actor), Json(create_body)).await
}

pub async fn migrate_precheck(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<MigrateVmBody>,
) -> Result<Json<crate::engine::migrate_precheck::MigratePrecheckResult>, ApiError> {
    let result = run_migrate_precheck(&state.pool, id, body.dest_host_id, body.live)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(result))
}

pub async fn start_vm(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskResponse>, ApiError> {
    power_action(&state, id, "start", "vm.start").await
}

pub async fn stop_vm(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskResponse>, ApiError> {
    power_action(&state, id, "stop", "vm.stop").await
}

pub async fn reboot_vm(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskResponse>, ApiError> {
    power_action(&state, id, "reboot", "vm.reboot").await
}

pub async fn delete_vm(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    body: Option<Json<DeleteVmBody>>,
) -> Result<Json<TaskResponse>, ApiError> {
    let require: bool = sqlx::query_scalar(
        "SELECT require_vm_delete_approval FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_one(&state.pool)
    .await
    .unwrap_or(false);
    if require && !body.as_ref().is_some_and(|b| b.0.confirmed) {
        return Err(ApiError::bad_request(
            "VM deletion requires approval — resubmit with {\"confirmed\": true}",
        ));
    }

    let host_id: Option<Uuid> = sqlx::query_scalar("SELECT host_id FROM vms WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;

    let task_id = enqueue_task(
        &state,
        "vm.delete",
        serde_json::json!({ "vm_id": id.to_string() }),
        Some("vm"),
        Some(id),
        host_id,
    )
    .await?;

    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "vm.delete".into(),
    }))
}

#[derive(Debug, Deserialize, Default)]
pub struct DeleteVmBody {
    #[serde(default)]
    pub confirmed: bool,
}

pub async fn install_guest_tools(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskResponse>, ApiError> {
    let host_id: Option<Uuid> = sqlx::query_scalar("SELECT host_id FROM vms WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    let task_id = enqueue_task(
        &state,
        "vm.guest_tools.install",
        serde_json::json!({ "vm_id": id.to_string() }),
        Some("vm"),
        Some(id),
        host_id,
    )
    .await?;
    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "vm.guest_tools.install".into(),
    }))
}

async fn power_action(
    state: &AppState,
    vm_id: Uuid,
    action: &str,
    operation: &str,
) -> Result<Json<TaskResponse>, ApiError> {
    let meta: (Option<Uuid>, String, String) = sqlx::query_as(
        "SELECT host_id, COALESCE(inventory_source, 'libvirt'), observed_state FROM vms WHERE id = $1",
    )
    .bind(vm_id)
    .fetch_one(&state.pool)
    .await?;
    if meta.1 == "kubevirt" {
        return Err(ApiError::bad_request(
            "Power actions apply to libvirt VMs only — use Kubernetes / KubeVirt tools for cluster guests",
        ));
    }
    if meta.2 == "missing" {
        return Err(ApiError::bad_request(
            "VM is missing from hypervisor inventory — sync hosts or remove the stale record",
        ));
    }
    let host_id = meta
        .0
        .ok_or_else(|| ApiError::bad_request("VM has no host assigned"))?;

    let task_id = enqueue_task(
        state,
        "vm.power",
        serde_json::json!({
            "vm_id": vm_id.to_string(),
            "action": action,
        }),
        Some("vm"),
        Some(vm_id),
        Some(host_id),
    )
    .await?;

    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: operation.to_string(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct MigrateVmBody {
    pub dest_host_id: Uuid,
    #[serde(default = "default_live")]
    pub live: bool,
}

fn default_live() -> bool {
    true
}

pub async fn migrate_vm(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<MigrateVmBody>,
) -> Result<Json<TaskResponse>, ApiError> {
    let source_host: Option<Uuid> = sqlx::query_scalar("SELECT host_id FROM vms WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;

    let task_id = enqueue_task(
        &state,
        "vm.migrate",
        serde_json::json!({
            "vm_id": id.to_string(),
            "dest_host_id": body.dest_host_id.to_string(),
            "live": body.live,
        }),
        Some("vm"),
        Some(id),
        source_host,
    )
    .await?;

    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "vm.migrate".into(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct CloneVmBody {
    pub new_name: String,
}

pub async fn clone_vm(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<CloneVmBody>,
) -> Result<Json<TaskResponse>, ApiError> {
    machina_spec::validate_name(&body.new_name)
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    let host_id: Option<Uuid> = sqlx::query_scalar("SELECT host_id FROM vms WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;

    let task_id = enqueue_task(
        &state,
        "vm.clone",
        serde_json::json!({
            "vm_id": id.to_string(),
            "new_name": body.new_name,
        }),
        Some("vm"),
        Some(id),
        host_id,
    )
    .await?;

    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "vm.clone".into(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct PatchVmBody {
    pub desired_state: Option<String>,
    pub project: Option<String>,
    pub tags: Option<Vec<String>>,
}

pub async fn patch_vm(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchVmBody>,
) -> Result<Json<VmRow>, ApiError> {
    if let Some(ds) = &body.desired_state {
        sqlx::query("UPDATE vms SET desired_state = $1, updated_at = NOW() WHERE id = $2")
            .bind(ds)
            .bind(id)
            .execute(&state.pool)
            .await?;
    }
    if let Some(project) = &body.project {
        sqlx::query("UPDATE vms SET project = $1, updated_at = NOW() WHERE id = $2")
            .bind(project)
            .bind(id)
            .execute(&state.pool)
            .await?;
    }
    if let Some(tags) = &body.tags {
        sqlx::query("UPDATE vms SET tags = $1, updated_at = NOW() WHERE id = $2")
            .bind(tags)
            .bind(id)
            .execute(&state.pool)
            .await?;
    }
    get_vm(State(state), Path(id)).await
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct VmDiskRow {
    pub id: Uuid,
    pub name: String,
    pub size_gib: i64,
    pub storage_class: String,
    pub path: Option<String>,
}

pub async fn list_vm_disks(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<VmDiskRow>>, ApiError> {
    let rows = sqlx::query_as::<_, VmDiskRow>(
        "SELECT id, name, size_gib, storage_class, path FROM vm_disks WHERE vm_id = $1",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct VmMetricsRow {
    pub vm_id: Uuid,
    pub cpu_percent: f32,
    pub memory_used_mib: i64,
    pub disk_read_iops: i64,
    pub disk_write_iops: i64,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

pub async fn get_vm_metrics(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<VmMetricsRow>, ApiError> {
    let row = sqlx::query_as::<_, VmMetricsRow>(
        "SELECT vm_id, cpu_percent, memory_used_mib, disk_read_iops, disk_write_iops, updated_at
         FROM vm_metrics WHERE vm_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;
    row.map(Json)
        .ok_or_else(|| ApiError::not_found("vm metrics not found"))
}

pub async fn adopt_vm(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<VmRow>, ApiError> {
    let row: Option<(bool, String)> =
        sqlx::query_as("SELECT managed, observed_state FROM vms WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;
    let Some((managed, observed)) = row else {
        return Err(ApiError::not_found("vm not found"));
    };
    if managed {
        return Err(ApiError::bad_request("VM is already managed"));
    }
    let source: String = sqlx::query_scalar(
        "SELECT COALESCE(inventory_source, 'libvirt') FROM vms WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    let desired = if source == "kubevirt" {
        if observed == "running" {
            "running"
        } else if observed == "stopped" {
            "stopped"
        } else {
            "unknown"
        }
    } else if observed == "running" {
        "running"
    } else {
        "stopped"
    };
    let lifecycle = match desired {
        "running" => crate::engine::vm_lifecycle::PHASE_RUNNING,
        "stopped" => crate::engine::vm_lifecycle::PHASE_STOPPED,
        _ => crate::engine::vm_lifecycle::PHASE_IDLE,
    };
    sqlx::query(
        "UPDATE vms SET managed = TRUE, desired_state = $1, lifecycle_phase = $2, last_error = '', updated_at = NOW() WHERE id = $3",
    )
    .bind(desired)
    .bind(lifecycle)
    .bind(id)
    .execute(&state.pool)
    .await?;
    crate::tasks::enqueue::write_audit(
        &state,
        &actor.username,
        "vm.adopt",
        "vm",
        Some(id),
        serde_json::json!({}),
    )
    .await?;
    state.emit_event("vm.adopt", format!("VM {id} adopted into platform inventory"));
    get_vm(State(state), Path(id)).await
}

#[derive(Debug, Serialize)]
pub struct PruneMissingResponse {
    pub deleted: u64,
}

pub async fn prune_missing_vms(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<PruneMissingResponse>, ApiError> {
    if actor.role != "admin" {
        return Err(ApiError::bad_request("admin role required"));
    }
    let result = sqlx::query(
        "DELETE FROM vms WHERE observed_state = 'missing' RETURNING id",
    )
    .execute(&state.pool)
    .await?;
    let deleted = result.rows_affected();
    if deleted > 0 {
        state.emit_event(
            "vm.pruned",
            format!("Pruned {deleted} missing VM record(s) from inventory"),
        );
    }
    Ok(Json(PruneMissingResponse { deleted }))
}

#[derive(Debug, Deserialize)]
pub struct AttachDiskBody {
    pub disk_path: String,
    #[serde(default = "default_target")]
    pub target_dev: String,
    #[serde(default)]
    pub size_gib: Option<i64>,
}

fn default_target() -> String {
    "vdb".into()
}

pub async fn attach_vm_disk(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<AttachDiskBody>,
) -> Result<Json<TaskResponse>, ApiError> {
    let host_id: Option<Uuid> = sqlx::query_scalar("SELECT host_id FROM vms WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    if let Some(size) = body.size_gib {
        sqlx::query(
            "INSERT INTO vm_disks (id, vm_id, name, size_gib, storage_class, path)
             VALUES ($1, $2, $3, $4, 'silver', $5)",
        )
        .bind(Uuid::new_v4())
        .bind(id)
        .bind(&body.target_dev)
        .bind(size)
        .bind(&body.disk_path)
        .execute(&state.pool)
        .await?;
    }
    let task_id = enqueue_task(
        &state,
        "vm.disk.attach",
        serde_json::json!({
            "vm_id": id.to_string(),
            "disk_path": body.disk_path,
            "target_dev": body.target_dev,
        }),
        Some("vm"),
        Some(id),
        host_id,
    )
    .await?;
    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "vm.disk.attach".into(),
    }))
}

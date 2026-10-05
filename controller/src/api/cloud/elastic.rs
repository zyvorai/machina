// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

use super::{access, audit, conflict, invalid};
use crate::{api::ApiError, auth::AuthUser, state::AppState};
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use machina_spec::{ScalingPolicy, VirtualMachine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Serialize, sqlx::FromRow)]
pub struct LaunchTemplate {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTemplate {
    name: String,
    vm: VirtualMachine,
}
pub async fn create_template(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(project): Path<Uuid>,
    Json(body): Json<CreateTemplate>,
) -> Result<Json<LaunchTemplate>, ApiError> {
    machina_spec::validate_name(&body.name).map_err(invalid)?;
    // The group supplies its subnet, so a launch template can omit networking.
    // Validate the remaining spec through the existing VM validator using a
    // placeholder attachment; it is never persisted or provisioned.
    let mut validation_vm = body.vm.clone();
    if validation_vm.spec.network.is_empty() {
        validation_vm
            .spec
            .network
            .push(machina_spec::NetworkAttachmentSpec {
                network: "default".into(),
                ip_mode: "dhcp".into(),
                firewall_profile: None,
            });
    }
    validation_vm
        .validate_operator_submission()
        .map_err(invalid)?;
    if body.vm.spec.ha.enabled {
        return Err(invalid(
            "host-local cloud templates do not support cross-host HA",
        ));
    }
    // Usernames/passwords and public console opt-ins are not copied into a
    // reusable template. Use SSH public keys and the authenticated console.
    if body
        .vm
        .spec
        .cloud_init
        .as_ref()
        .is_some_and(|c| c.password.is_some())
        || body.vm.spec.graphics.allow_public_listen
    {
        return Err(invalid(
            "templates require SSH keys and private console listeners",
        ));
    }
    let mut tx = state.pool.begin_with("BEGIN IMMEDIATE").await?;
    access(&mut tx, &actor, project, true).await?;
    let duplicate: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM cloud_launch_templates WHERE project_id=? AND name=?)",
    )
    .bind(project)
    .bind(&body.name)
    .fetch_one(&mut *tx)
    .await?;
    if duplicate {
        return Err(conflict(
            "template name already exists; templates are immutable",
        ));
    }
    let row = LaunchTemplate {
        id: Uuid::new_v4(),
        project_id: project,
        name: body.name,
    };
    sqlx::query(
        "INSERT INTO cloud_launch_templates (id,project_id,name,spec_json) VALUES (?,?,?,?)",
    )
    .bind(row.id)
    .bind(project)
    .bind(&row.name)
    .bind(serde_json::to_string(&body.vm).map_err(invalid)?)
    .execute(&mut *tx)
    .await?;
    audit(&mut tx, &actor, "cloud.template.create", row.id).await?;
    tx.commit().await?;
    Ok(Json(row))
}
pub async fn list_templates(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(project): Path<Uuid>,
) -> Result<Json<Vec<LaunchTemplate>>, ApiError> {
    let mut conn = state.pool.acquire().await?;
    access(&mut conn, &actor, project, false).await?;
    // Listing never returns cloud-init data (keys/userdata may be sensitive).
    Ok(Json(sqlx::query_as("SELECT id,project_id,name FROM cloud_launch_templates WHERE project_id=? ORDER BY name LIMIT 500").bind(project).fetch_all(&mut *conn).await?))
}
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Group {
    pub id: Uuid,
    pub project_id: Uuid,
    pub template_id: Uuid,
    pub subnet_id: Uuid,
    pub name: String,
    pub policy_json: String,
    pub paused: bool,
    pub last_scaled_at: String,
    pub last_error: String,
}
const GROUPS:&str="SELECT id,project_id,template_id,subnet_id,name,policy_json,paused,last_scaled_at,last_error FROM cloud_instance_groups";
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateGroup {
    name: String,
    template_id: Uuid,
    subnet_id: Uuid,
    policy: ScalingPolicy,
}
pub async fn create_group(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(project): Path<Uuid>,
    Json(body): Json<CreateGroup>,
) -> Result<Json<Value>, ApiError> {
    machina_spec::validate_name(&body.name).map_err(invalid)?;
    body.policy.validate().map_err(invalid)?;
    let mut tx = state.pool.begin_with("BEGIN IMMEDIATE").await?;
    access(&mut tx, &actor, project, true).await?;
    let template: Option<Uuid> =
        sqlx::query_scalar("SELECT project_id FROM cloud_launch_templates WHERE id=?")
            .bind(body.template_id)
            .fetch_optional(&mut *tx)
            .await?;
    let subnet:Option<Uuid>=sqlx::query_scalar("SELECT v.project_id FROM cloud_subnets s JOIN cloud_vpcs v ON v.id=s.vpc_id WHERE s.id=? AND s.status='ready'").bind(body.subnet_id).fetch_optional(&mut *tx).await?;
    if template != Some(project) || subnet != Some(project) {
        return Err(invalid(
            "ready subnet and template from the same project required",
        ));
    }
    let duplicate: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM cloud_instance_groups WHERE project_id=? AND name=?)",
    )
    .bind(project)
    .bind(&body.name)
    .fetch_one(&mut *tx)
    .await?;
    if duplicate {
        return Err(conflict("instance group name already exists"));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO cloud_instance_groups (id,project_id,template_id,subnet_id,name,policy_json) VALUES (?,?,?,?,?,?)").bind(id).bind(project).bind(body.template_id).bind(body.subnet_id).bind(&body.name).bind(serde_json::to_string(&body.policy).map_err(invalid)?).execute(&mut *tx).await?;
    audit(&mut tx, &actor, "cloud.group.create", id).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"id":id,"status":"pending","policy":body.policy}),
    ))
}
pub async fn list_groups(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(project): Path<Uuid>,
) -> Result<Json<Vec<Group>>, ApiError> {
    let mut conn = state.pool.acquire().await?;
    access(&mut conn, &actor, project, false).await?;
    Ok(Json(
        sqlx::query_as(&format!(
            "{GROUPS} WHERE project_id=? ORDER BY name LIMIT 500"
        ))
        .bind(project)
        .fetch_all(&mut *conn)
        .await?,
    ))
}
pub async fn get_group(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let mut conn = state.pool.acquire().await?;
    let row: Group = sqlx::query_as(&format!("{GROUPS} WHERE id=?"))
        .bind(id)
        .fetch_one(&mut *conn)
        .await?;
    access(&mut conn, &actor, row.project_id, false).await?;
    let members:Vec<(i64,Option<Uuid>,Option<String>,Option<String>)>=sqlx::query_as("SELECT m.slot,m.vm_id,v.name,v.observed_state FROM cloud_group_members m LEFT JOIN vms v ON v.id=m.vm_id WHERE m.group_id=? ORDER BY m.slot").bind(id).fetch_all(&mut *conn).await?;
    Ok(Json(
        json!({"group":row,"members":members.into_iter().map(|(slot,vm_id,name,state)|json!({"slot":slot,"vm_id":vm_id,"name":name,"observed_state":state})).collect::<Vec<_>>(),"scale_in":"stop-and-retain","network_backend":"host-local-isolated"}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateGroup {
    policy: ScalingPolicy,
    paused: bool,
}
pub async fn update_group(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateGroup>,
) -> Result<Json<Value>, ApiError> {
    body.policy.validate().map_err(invalid)?;
    let mut tx = state.pool.begin_with("BEGIN IMMEDIATE").await?;
    let project: Uuid =
        sqlx::query_scalar("SELECT project_id FROM cloud_instance_groups WHERE id=?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    access(&mut tx, &actor, project, true).await?;
    sqlx::query("UPDATE cloud_instance_groups SET policy_json=?,paused=?,last_scaled_at=CURRENT_TIMESTAMP,last_error='' WHERE id=?").bind(serde_json::to_string(&body.policy).map_err(invalid)?).bind(body.paused).bind(id).execute(&mut *tx).await?;
    audit(&mut tx, &actor, "cloud.group.update", id).await?;
    tx.commit().await?;
    Ok(Json(json!({"updated":true})))
}

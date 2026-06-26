// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path as AxumPath, Query, State};
use axum::http::HeaderMap;
use axum::Extension;
use axum::Json;
use machina_spec::VmTemplate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::tasks::TaskResponse;
use crate::api::ApiError;
use crate::auth::{require_admin, require_operator, AuthUser};
use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TemplateRow {
    pub id: Uuid,
    pub name: String,
    pub version: String,
    pub source_disk: String,
    pub cloud_init: bool,
    pub os_family: Option<String>,
    pub category: String,
    pub workload: String,
    pub description: String,
    pub featured: bool,
    pub marketplace: bool,
    pub icon: Option<String>,
    pub firewall_profile: Option<String>,
    pub approval_status: String,
    pub git_ref: String,
    pub daemon_json_path: String,
    pub project: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateTemplateBody {
    pub name: String,
    pub version: String,
    pub source_disk: String,
    #[serde(default)]
    pub cloud_init: bool,
    #[serde(default)]
    pub os_family: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub featured: bool,
    #[serde(default = "default_marketplace")]
    pub marketplace: bool,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListTemplatesQuery {
    pub marketplace: Option<bool>,
    pub featured: Option<bool>,
}

fn default_category() -> String {
    "Linux".into()
}

fn default_marketplace() -> bool {
    true
}

const TEMPLATE_SELECT: &str =
    "SELECT id, name, version, source_disk, cloud_init, os_family, category, COALESCE(workload, '') AS workload, description, featured, marketplace, icon, firewall_profile, COALESCE(approval_status, 'approved') AS approval_status, COALESCE(git_ref, '') AS git_ref, COALESCE(daemon_json_path, '') AS daemon_json_path, COALESCE(project, '') AS project FROM templates";

pub async fn list_templates(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Query(q): Query<ListTemplatesQuery>,
) -> Result<Json<Vec<TemplateRow>>, ApiError> {
    require_operator(&actor)?;
    let rows = match (q.marketplace, q.featured) {
        (Some(true), Some(true)) => {
            sqlx::query_as::<_, TemplateRow>(&format!(
            "{TEMPLATE_SELECT} WHERE marketplace = TRUE AND featured = TRUE ORDER BY name, version"
        ))
            .fetch_all(&state.pool)
            .await?
        }
        (Some(true), _) => {
            sqlx::query_as::<_, TemplateRow>(&format!(
                "{TEMPLATE_SELECT} WHERE marketplace = TRUE ORDER BY featured DESC, name, version"
            ))
            .fetch_all(&state.pool)
            .await?
        }
        (_, Some(true)) => {
            sqlx::query_as::<_, TemplateRow>(&format!(
                "{TEMPLATE_SELECT} WHERE featured = TRUE ORDER BY name, version"
            ))
            .fetch_all(&state.pool)
            .await?
        }
        _ => {
            sqlx::query_as::<_, TemplateRow>(&format!("{TEMPLATE_SELECT} ORDER BY name, version"))
                .fetch_all(&state.pool)
                .await?
        }
    };
    Ok(Json(rows))
}

fn template_rows_with_auto_fetch(rows: Vec<TemplateRow>) -> Vec<serde_json::Value> {
    rows.iter()
        .map(|t| {
            let mut v = serde_json::to_value(t).unwrap_or(serde_json::json!({}));
            if let Some(obj) = v.as_object_mut() {
                obj.insert(
                    "auto_fetch".into(),
                    serde_json::json!(crate::engine::template_catalog::download_url_for(
                        &t.name, &t.version
                    )
                    .is_some()),
                );
            }
            v
        })
        .collect()
}

pub async fn list_marketplace_templates(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_operator(&actor)?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM templates WHERE marketplace = TRUE")
        .fetch_one(&state.pool)
        .await?;
    if count == 0 {
        let _ = crate::engine::template_catalog::seed_default_templates(&state.pool).await;
    } else {
        let _ =
            crate::engine::template_catalog::prune_stale_marketplace_templates(&state.pool).await;
    }
    let rows = sqlx::query_as::<_, TemplateRow>(&format!(
        "{TEMPLATE_SELECT} WHERE marketplace = TRUE ORDER BY featured DESC, category, name, version"
    ))
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(template_rows_with_auto_fetch(rows)))
}

pub async fn seed_templates(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let inserted = crate::engine::template_catalog::seed_default_templates(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let pruned = crate::engine::template_catalog::prune_stale_marketplace_templates(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let rows = sqlx::query_as::<_, TemplateRow>(&format!(
        "{TEMPLATE_SELECT} WHERE marketplace = TRUE ORDER BY featured DESC, category, name, version"
    ))
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(serde_json::json!({
        "inserted": inserted,
        "pruned": pruned,
        "templates": rows,
    })))
}

pub async fn create_template(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateTemplateBody>,
) -> Result<Json<TemplateRow>, ApiError> {
    require_operator(&actor)?;
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO templates (id, name, version, source_disk, cloud_init, os_family, category, description, featured, marketplace, icon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(&body.name)
    .bind(&body.version)
    .bind(&body.source_disk)
    .bind(body.cloud_init)
    .bind(&body.os_family)
    .bind(&body.category)
    .bind(&body.description)
    .bind(body.featured)
    .bind(body.marketplace)
    .bind(&body.icon)
    .execute(&state.pool)
    .await?;

    fetch_template_by_id(&state, id).await
}

pub async fn get_template(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    AxumPath((name, version)): AxumPath<(String, String)>,
) -> Result<Json<TemplateRow>, ApiError> {
    require_operator(&actor)?;
    let row = sqlx::query_as::<_, TemplateRow>(&format!(
        "{TEMPLATE_SELECT} WHERE name = ? AND version = ?"
    ))
    .bind(&name)
    .bind(&version)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

pub async fn get_template_readiness(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    AxumPath((name, version)): AxumPath<(String, String)>,
) -> Result<Json<crate::engine::template_readiness::TemplateReadiness>, ApiError> {
    require_operator(&actor)?;
    let readiness =
        crate::engine::template_readiness::check_template_readiness(&state.pool, &name, &version)
            .await
            .map_err(|e| ApiError::bad_request(e.to_string()))?;
    Ok(Json(readiness))
}

#[derive(Debug, Deserialize, Default)]
pub struct PrefetchMissingImagesBody {
    #[serde(default)]
    pub host_id: Option<uuid::Uuid>,
}

pub async fn prefetch_missing_template_images(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    body: Option<Json<PrefetchMissingImagesBody>>,
) -> Result<Json<TaskResponse>, ApiError> {
    require_operator(&actor)?;
    let body = body.map(|j| j.0).unwrap_or_default();
    let host_id = if let Some(id) = body.host_id {
        id
    } else {
        sqlx::query_scalar("SELECT id FROM hosts WHERE state = 'online' ORDER BY hostname LIMIT 1")
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| ApiError::bad_request("no online hosts"))?
    };
    let task_id = enqueue_task(
        &state,
        "templates.prefetch_missing",
        serde_json::json!({ "host_id": host_id.to_string() }),
        Some("templates"),
        None,
        Some(host_id),
    )
    .await?;
    Ok(Json(TaskResponse {
        task_id: task_id.to_string(),
        status: "pending".into(),
        operation: "templates.prefetch_missing".into(),
    }))
}

pub async fn list_missing_template_images(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let _ = crate::engine::template_catalog::ensure_default_templates(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let missing = crate::engine::template_readiness::list_missing_marketplace_images(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let auto_fetch_count = missing.iter().filter(|m| m.auto_fetch).count();
    Ok(Json(serde_json::json!({
        "missing": missing,
        "count": missing.len(),
        "auto_fetch_count": auto_fetch_count,
        "summary": if missing.is_empty() {
            "All marketplace golden images are present on online hosts.".to_string()
        } else {
            format!(
                "{} golden image(s) missing — {} can auto-download on first VM create.",
                missing.len(),
                auto_fetch_count
            )
        },
    })))
}

pub async fn delete_template(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    AxumPath((name, version)): AxumPath<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let deleted = sqlx::query("DELETE FROM templates WHERE name = ? AND version = ?")
        .bind(&name)
        .bind(&version)
        .execute(&state.pool)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(ApiError::bad_request("template not found"));
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn fetch_template_by_id(state: &AppState, id: Uuid) -> Result<Json<TemplateRow>, ApiError> {
    let row = sqlx::query_as::<_, TemplateRow>(&format!("{TEMPLATE_SELECT} WHERE id = ?"))
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct ApproveTemplateBody {
    pub approval_status: String,
}

async fn run_git_template_sync(pool: &sqlx::SqlitePool) -> Result<usize, ApiError> {
    let dir = std::env::var("MACHINA_TEMPLATES_GIT_DIR")
        .map_err(|_| ApiError::bad_request("MACHINA_TEMPLATES_GIT_DIR not set"))?;
    crate::engine::template_git::sync_templates_from_git(pool, std::path::Path::new(&dir))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
}

pub async fn sync_git_templates(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_operator(&actor)?;
    let synced = run_git_template_sync(&state.pool).await?;
    Ok(Json(serde_json::json!({ "synced": synced })))
}

/// GitHub/GitLab push webhook — optional `X-Machina-Template-Sync-Token` when `MACHINA_TEMPLATES_SYNC_TOKEN` is set.
pub async fn sync_git_templates_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    if let Ok(expected) = std::env::var("MACHINA_TEMPLATES_SYNC_TOKEN") {
        if !expected.is_empty() {
            let token = headers
                .get("x-machina-template-sync-token")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            if token != expected {
                return Err(ApiError::policy_violation(
                    "invalid template sync token",
                    "Set X-Machina-Template-Sync-Token to match MACHINA_TEMPLATES_SYNC_TOKEN",
                ));
            }
        }
    }
    let synced = run_git_template_sync(&state.pool).await?;
    Ok(Json(
        serde_json::json!({ "synced": synced, "source": "webhook" }),
    ))
}

pub async fn approve_template(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    AxumPath((name, version)): AxumPath<(String, String)>,
    Json(body): Json<ApproveTemplateBody>,
) -> Result<Json<TemplateRow>, ApiError> {
    require_admin(&actor)?;
    let status = body.approval_status.trim();
    if !["approved", "pending", "draft", "rejected"].contains(&status) {
        return Err(ApiError::bad_request(
            "approval_status must be approved|pending|draft|rejected",
        ));
    }
    sqlx::query("UPDATE templates SET approval_status = ? WHERE name = ? AND version = ?")
        .bind(status)
        .bind(&name)
        .bind(&version)
        .execute(&state.pool)
        .await?;
    let row = sqlx::query_as::<_, TemplateRow>(&format!(
        "{TEMPLATE_SELECT} WHERE name = ? AND version = ?"
    ))
    .bind(&name)
    .bind(&version)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

pub fn template_to_spec(t: &TemplateRow) -> VmTemplate {
    VmTemplate {
        name: t.name.clone(),
        version: t.version.clone(),
        source_disk: t.source_disk.clone(),
        cloud_init: t.cloud_init,
        os_family: t.os_family.clone(),
    }
}

// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, Query, State};
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::ApiError;
use crate::auth::{require_admin, AuthUser};
use crate::state::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WebhookRow {
    pub id: Uuid,
    pub url: String,
    pub events: sqlx::types::Json<Vec<String>>,
    pub enabled: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWebhookBody {
    pub url: String,
    pub events: Vec<String>,
    #[serde(default)]
    pub secret: String,
}

pub async fn list_webhooks(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<WebhookRow>>, ApiError> {
    require_admin(&actor)?;
    let rows = sqlx::query_as::<_, WebhookRow>(
        "SELECT id, url, events, enabled, created_at FROM webhooks ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

fn validate_webhook_url(url: &str) -> Result<(), ApiError> {
    let parsed = url::Url::parse(url)
        .map_err(|_| ApiError::bad_request("webhook url is not a valid URL"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(ApiError::bad_request("webhook url must use http or https")),
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| ApiError::bad_request("webhook url has no host"))?;
    // Reject loopback / private / link-local to prevent SSRF.
    let blocked = matches!(
        host,
        "localhost" | "127.0.0.1" | "::1" | "0.0.0.0"
    ) || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
        || host.starts_with("fc")
        || host.starts_with("fd");
    // Also block 172.16.0.0/12 range.
    let blocked = blocked || {
        if let Some(rest) = host.strip_prefix("172.") {
            rest.split('.')
                .next()
                .and_then(|s| s.parse::<u8>().ok())
                .is_some_and(|n| (16..=31).contains(&n))
        } else {
            false
        }
    };
    if blocked {
        return Err(ApiError::bad_request(
            "webhook url must not target private or loopback addresses",
        ));
    }
    Ok(())
}

pub async fn create_webhook(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateWebhookBody>,
) -> Result<Json<WebhookRow>, ApiError> {
    require_admin(&actor)?;
    validate_webhook_url(&body.url)?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(&body.url)
        .bind(serde_json::to_string(&body.events).unwrap_or_else(|_| "[]".into()))
        .bind(&body.secret)
        .execute(&state.pool)
        .await?;
    let row = sqlx::query_as::<_, WebhookRow>(
        "SELECT id, url, events, enabled, created_at FROM webhooks WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

pub async fn delete_webhook(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("DELETE FROM webhook_deliveries WHERE webhook_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM webhooks WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

pub async fn toggle_webhook(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<WebhookRow>, ApiError> {
    require_admin(&actor)?;
    sqlx::query("UPDATE webhooks SET enabled = NOT enabled WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    let row = sqlx::query_as::<_, WebhookRow>(
        "SELECT id, url, events, enabled, created_at FROM webhooks WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WebhookDeliveryRow {
    pub id: Uuid,
    pub webhook_id: Option<Uuid>,
    pub url: String,
    pub event_kind: String,
    pub attempts: i32,
    pub max_attempts: i32,
    pub status: String,
    pub last_error: String,
    pub next_retry_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ListWebhookDeliveriesQuery {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    50
}

pub async fn list_webhook_deliveries(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Query(q): Query<ListWebhookDeliveriesQuery>,
) -> Result<Json<Vec<WebhookDeliveryRow>>, ApiError> {
    require_admin(&actor)?;
    let limit = q.limit.clamp(1, 200);
    let rows = if let Some(status) = &q.status {
        sqlx::query_as::<_, WebhookDeliveryRow>(
            "SELECT id, webhook_id, url, event_kind, attempts, max_attempts, status, last_error,
                    next_retry_at, created_at
             FROM webhook_deliveries WHERE status = ?
             ORDER BY created_at DESC LIMIT ?",
        )
        .bind(status)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, WebhookDeliveryRow>(
            "SELECT id, webhook_id, url, event_kind, attempts, max_attempts, status, last_error,
                    next_retry_at, created_at
             FROM webhook_deliveries ORDER BY created_at DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    };
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct PurgeWebhookDeliveriesBody {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub url_contains: Option<String>,
}

pub async fn purge_webhook_deliveries(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<PurgeWebhookDeliveriesBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    let status = body.status.as_deref();
    let url_pat = body.url_contains.as_deref().map(|s| format!("%{s}%"));
    let deleted = if let (Some(st), Some(url)) = (status, url_pat.as_deref()) {
        sqlx::query("DELETE FROM webhook_deliveries WHERE status = ? AND url LIKE ?")
            .bind(st)
            .bind(url)
            .execute(&state.pool)
            .await?
            .rows_affected()
    } else if let Some(st) = status {
        sqlx::query("DELETE FROM webhook_deliveries WHERE status = ?")
            .bind(st)
            .execute(&state.pool)
            .await?
            .rows_affected()
    } else if let Some(url) = url_pat.as_deref() {
        sqlx::query("DELETE FROM webhook_deliveries WHERE url LIKE ?")
            .bind(url)
            .execute(&state.pool)
            .await?
            .rows_affected()
    } else {
        return Err(ApiError::bad_request(
            "provide status and/or url_contains to purge deliveries",
        ));
    };
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

pub async fn retry_webhook_delivery(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<WebhookDeliveryRow>, ApiError> {
    require_admin(&actor)?;
    sqlx::query(
        "UPDATE webhook_deliveries SET status = 'pending', attempts = 0, last_error = '',
         next_retry_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .execute(&state.pool)
    .await?;
    let row = sqlx::query_as::<_, WebhookDeliveryRow>(
        "SELECT id, webhook_id, url, event_kind, attempts, max_attempts, status, last_error,
                next_retry_at, created_at FROM webhook_deliveries WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(row))
}

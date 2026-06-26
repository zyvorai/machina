// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::ApiError;
use crate::auth::{require_admin, AuthUser};
use crate::state::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ApiKeyRow {
    pub id: Uuid,
    pub name: String,
    pub role: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyBody {
    pub name: String,
    #[serde(default = "default_role")]
    pub role: String,
}

fn default_role() -> String {
    "operator".into()
}

#[derive(Debug, Serialize)]
pub struct CreateApiKeyResponse {
    pub id: String,
    pub name: String,
    pub role: String,
    pub token: String,
}

pub async fn list_api_keys(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<ApiKeyRow>>, ApiError> {
    require_admin(&actor)?;
    let rows = sqlx::query_as::<_, ApiKeyRow>(
        "SELECT id, name, role,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at,
                strftime('%Y-%m-%dT%H:%M:%SZ', last_used_at) AS last_used_at
         FROM api_keys ORDER BY created_at DESC LIMIT 500",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn create_api_key(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<CreateApiKeyBody>,
) -> Result<Json<CreateApiKeyResponse>, ApiError> {
    require_admin(&actor)?;
    if body.name.is_empty() || body.name.len() > 128 {
        return Err(ApiError::bad_request("api key name must be 1–128 characters"));
    }
    if !matches!(body.role.as_str(), "admin" | "operator" | "viewer") {
        return Err(ApiError::bad_request("role must be admin, operator, or viewer"));
    }
    let id = Uuid::new_v4();
    let token = format!("machina_{}", Uuid::new_v4());
    let hash = hash_token(&token);
    sqlx::query("INSERT INTO api_keys (id, name, key_hash, role) VALUES (?, ?, ?, ?)")
        .bind(id)
        .bind(&body.name)
        .bind(hash)
        .bind(&body.role)
        .execute(&state.pool)
        .await?;
    Ok(Json(CreateApiKeyResponse {
        id: id.to_string(),
        name: body.name,
        role: body.role,
        token,
    }))
}

pub async fn delete_api_key(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    sqlx::query("DELETE FROM api_keys WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

pub fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub async fn authenticate_api_key(
    pool: &sqlx::SqlitePool,
    token: &str,
) -> anyhow::Result<Option<AuthUser>> {
    let hash = hash_token(token);
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT name, role FROM api_keys WHERE key_hash = ?")
            .bind(&hash)
            .fetch_optional(pool)
            .await?;
    if let Some((name, role)) = row {
        let _ = sqlx::query("UPDATE api_keys SET last_used_at = datetime('now') WHERE key_hash = ?")
            .bind(&hash)
            .execute(pool)
            .await;
        Ok(Some(AuthUser {
            username: format!("apikey:{name}"),
            role,
            auth_source: None,
        }))
    } else {
        Ok(None)
    }
}

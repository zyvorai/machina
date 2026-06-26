// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::extract::{Path, State};
use axum::Extension;
use axum::Json;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::ApiError;
use crate::auth::{require_admin, AuthUser};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct EnrollmentTokenResponse {
    pub token: String,
    pub expires_at: String,
    pub install_command: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateEnrollmentRequest {
    #[serde(default)]
    pub ttl_hours: i64,
}

pub async fn create_enrollment_token(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(req): Json<CreateEnrollmentRequest>,
) -> Result<Json<EnrollmentTokenResponse>, ApiError> {
    require_admin(&actor)?;
    const MAX_TTL_HOURS: i64 = 720; // 30 days
    let ttl = if req.ttl_hours <= 0 {
        24
    } else if req.ttl_hours > MAX_TTL_HOURS {
        return Err(ApiError::bad_request(
            "ttl_hours must be <= 720 (30 days)",
        ));
    } else {
        req.ttl_hours
    };
    let token = format!("join-{}", Uuid::new_v4());
    let expires = Utc::now() + Duration::hours(ttl);
    let cluster_id: Uuid = sqlx::query_scalar("SELECT id FROM clusters LIMIT 1")
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::internal("no cluster configured"))?;

    sqlx::query(
        "INSERT INTO enrollment_tokens (token, cluster_id, expires_at) VALUES (?, ?, ?)",
    )
    .bind(&token)
    .bind(cluster_id)
    .bind(expires)
    .execute(&state.pool)
    .await?;

    let controller_base = format!("http://{}:{}", state.config.host, state.config.port);
    let install_command = format!(
        "curl -fsSL {controller_base}/install.sh | sudo bash -s -- --controller {controller_base} --token {token}"
    );

    sqlx::query(
        "INSERT INTO audit_logs (id, actor, action, resource_type, detail)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4())
    .bind(&actor.username)
    .bind("enrollment.create")
    .bind("enrollment")
    .bind(serde_json::json!({ "token_prefix": &token[..12.min(token.len())] }))
    .execute(&state.pool)
    .await?;

    Ok(Json(EnrollmentTokenResponse {
        token,
        expires_at: expires.to_rfc3339(),
        install_command,
    }))
}

pub async fn install_script(
) -> Result<([(axum::http::header::HeaderName, &'static str); 1], String), ApiError> {
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/x-shellscript")],
        r#"#!/usr/bin/env bash
set -euo pipefail
CONTROLLER=""
TOKEN=""
while [[ $# -gt 0 ]]; do
  case "?" in
    --controller) CONTROLLER="?"; shift 2 ;;
    --token) TOKEN="?"; shift 2 ;;
    *) shift ;;
  esac
done
: "${CONTROLLER:?set --controller URL}"
: "${TOKEN:?set --token TOKEN}"
echo "Joining Machina controller at $CONTROLLER"
if command -v machina-agent >/dev/null 2>&1; then
  exec machina-agent join --controller "$CONTROLLER" --token "$TOKEN"
fi
echo "machina-agent not found — install the agent package, then run:"
echo "  machina-agent join --controller \"$CONTROLLER\" --token \"$TOKEN\""
"#
        .into(),
    ))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct EnrollmentTokenRow {
    pub token: String,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_enrollment_tokens(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<EnrollmentTokenRow>>, ApiError> {
    require_admin(&actor)?;
    let rows = sqlx::query_as::<_, EnrollmentTokenRow>(
        "SELECT token, expires_at, used_at, created_at FROM enrollment_tokens
         ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows))
}

pub async fn revoke_enrollment_token(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_admin(&actor)?;
    sqlx::query("DELETE FROM enrollment_tokens WHERE token = ? AND used_at IS NULL")
        .bind(&token)
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({ "revoked": true })))
}

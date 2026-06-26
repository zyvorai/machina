// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, Request, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use base64::Engine;

use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub username: String,
    pub role: String,
    /// Federated auth source from JWT claim (`oidc`, `saml`, `local`).
    pub auth_source: Option<String>,
}

pub fn require_admin(user: &AuthUser) -> Result<(), crate::api::ApiError> {
    if user.role == "admin" {
        Ok(())
    } else {
        Err(crate::api::ApiError::forbidden("admin role required")
            .with_remediation("Sign in with an administrator account to manage users."))
    }
}

pub fn require_operator(user: &AuthUser) -> Result<(), crate::api::ApiError> {
    if user.role == "admin" || user.role == "operator" {
        Ok(())
    } else {
        Err(crate::api::ApiError::forbidden("operator role required"))
    }
}

pub async fn authenticate(
    pool: &sqlx::SqlitePool,
    username: &str,
    password: &str,
) -> anyhow::Result<Option<AuthUser>> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT password_hash, role FROM users WHERE username = ?")
            .bind(username)
            .fetch_optional(pool)
            .await?;

    let Some((hash, role)) = row else {
        return Ok(None);
    };
    if bcrypt::verify(password, &hash)? {
        Ok(Some(AuthUser {
            username: username.to_string(),
            role,
            auth_source: Some("local".into()),
        }))
    } else {
        Ok(None)
    }
}

fn parse_basic_auth(value: &str) -> Option<(String, String)> {
    let encoded = value.strip_prefix("Basic ")?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    let (user, pass) = decoded.split_once(':')?;
    Some((user.to_string(), pass.to_string()))
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    if std::env::var("MACHINA_SKIP_AUTH").ok().as_deref() == Some("1") {
        req.extensions_mut().insert(AuthUser {
            username: "dev".into(),
            role: "admin".into(),
            auth_source: Some("local".into()),
        });
        return Ok(next.run(req).await);
    }

    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    if let Some(value) = auth_header {
        if let Some((user, pass)) = parse_basic_auth(value) {
            if let Ok(Some(user)) = authenticate(&state.pool, &user, &pass).await {
                req.extensions_mut().insert(user);
                return Ok(next.run(req).await);
            }
        }
        if let Some(token) = value.strip_prefix("Bearer ") {
            let token = token.trim();
            if let Ok(Some(user)) =
                crate::api::apikeys::authenticate_api_key(&state.pool, token).await
            {
                req.extensions_mut().insert(user);
                return Ok(next.run(req).await);
            }
            if let Ok(claims) = crate::jwt::verify_token(&state.config.jwt_secret, token) {
                req.extensions_mut().insert(AuthUser {
                    username: claims.sub,
                    role: claims.role,
                    auth_source: claims.auth,
                });
                return Ok(next.run(req).await);
            }
        }
    }

    Err(StatusCode::UNAUTHORIZED)
}

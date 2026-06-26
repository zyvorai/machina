// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::Deserialize;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct OidcConfig {
    pub enabled: bool,
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

#[derive(Debug, Deserialize)]
struct OidcDiscovery {
    authorization_endpoint: String,
    token_endpoint: String,
    userinfo_endpoint: Option<String>,
    jwks_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserInfo {
    sub: String,
    email: Option<String>,
    preferred_username: Option<String>,
    name: Option<String>,
}

pub async fn load_config(pool: &SqlitePool, fallback_redirect: &str) -> anyhow::Result<OidcConfig> {
    let row: (bool, String, String, String, String) = sqlx::query_as(
        "SELECT oidc_enabled, oidc_issuer, oidc_client_id, oidc_client_secret,
                COALESCE(NULLIF(oidc_redirect_uri, ''), ?)
         FROM clusters ORDER BY created_at LIMIT 1",
    )
    .bind(fallback_redirect)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("no cluster configured — run machina-controller bootstrap"))?;
    Ok(OidcConfig {
        enabled: row.0,
        issuer: row.1.trim_end_matches('/').to_string(),
        client_id: row.2,
        client_secret: row.3,
        redirect_uri: row.4,
    })
}

pub async fn begin_login(pool: &SqlitePool, cfg: &OidcConfig) -> anyhow::Result<(String, String)> {
    let discovery = fetch_discovery(&cfg.issuer).await?;
    let state = Uuid::new_v4().to_string();
    let nonce = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO oidc_states (state, nonce) VALUES (?, ?)")
        .bind(&state)
        .bind(&nonce)
        .execute(pool)
        .await?;
    let url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope=openid%20profile%20email&state={}&nonce={}",
        discovery.authorization_endpoint,
        urlencoding::encode(&cfg.client_id),
        urlencoding::encode(&cfg.redirect_uri),
        urlencoding::encode(&state),
        urlencoding::encode(&nonce),
    );
    Ok((state, url))
}

pub async fn complete_login(
    pool: &SqlitePool,
    cfg: &OidcConfig,
    jwt_secret: &str,
    code: &str,
    state: &str,
) -> anyhow::Result<(String, String, String)> {
    // Fetch nonce alongside state validation; None means state not found or expired.
    let stored_nonce: Option<Option<String>> = sqlx::query_scalar(
        "SELECT nonce FROM oidc_states WHERE state = ? AND created_at > datetime('now', '-10 minutes')",
    )
    .bind(state)
    .fetch_optional(pool)
    .await?;
    let Some(nonce) = stored_nonce else {
        anyhow::bail!("invalid or expired OIDC state");
    };
    sqlx::query("DELETE FROM oidc_states WHERE state = ?")
        .bind(state)
        .execute(pool)
        .await?;

    let discovery = fetch_discovery(&cfg.issuer).await?;
    let client = reqwest::Client::new();
    let token: TokenResponse = client
        .post(&discovery.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", cfg.redirect_uri.as_str()),
            ("client_id", cfg.client_id.as_str()),
            ("client_secret", cfg.client_secret.as_str()),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let username = if let Some(ref userinfo_url) = discovery.userinfo_endpoint {
        let info: UserInfo = client
            .get(userinfo_url)
            .bearer_auth(&token.access_token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        info.email
            .or(info.preferred_username)
            .or(info.name)
            .unwrap_or(info.sub)
    } else if let Some(ref id_token) = token.id_token {
        if let Some(jwks_uri) = discovery.jwks_uri.as_deref() {
            match crate::oidc_jwt::validate_id_token(
                id_token,
                &cfg.issuer,
                &cfg.client_id,
                jwks_uri,
                nonce.as_deref(),
            )
            .await
            {
                Ok(u) => u,
                Err(e) => {
                    tracing::warn!("id_token JWKS validation failed: {e:#}");
                    return Err(anyhow::anyhow!("id_token signature verification failed"));
                }
            }
        } else {
            return Err(anyhow::anyhow!(
                "OIDC provider has no jwks_uri — cannot verify id_token signature"
            ));
        }
    } else {
        format!(
            "oidc-{}",
            &token.access_token.chars().take(8).collect::<String>()
        )
    };

    let role: String = match sqlx::query_scalar("SELECT role FROM users WHERE username = ?")
        .bind(&username)
        .fetch_optional(pool)
        .await?
    {
        Some(r) => r,
        None => {
            let role = "viewer".to_string();
            sqlx::query(
                "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4())
            .bind(&username)
            .bind("oidc")
            .bind(&role)
            .execute(pool)
            .await?;
            role
        }
    };

    let token = crate::jwt::issue_token(jwt_secret, &username, &role, 86400, Some("oidc"))?;
    Ok((username, role, token))
}

async fn fetch_discovery(issuer: &str) -> anyhow::Result<OidcDiscovery> {
    if !issuer.starts_with("https://") {
        return Err(anyhow::anyhow!(
            "OIDC issuer must use HTTPS — got: {issuer}"
        ));
    }
    let url = format!("{issuer}/.well-known/openid-configuration");
    let discovery: OidcDiscovery = reqwest::get(&url).await?.error_for_status()?.json().await?;
    // Validate that token_endpoint and userinfo_endpoint share the issuer's origin
    // to prevent SSRF via attacker-controlled discovery document fields.
    let issuer_origin = issuer
        .trim_end_matches('/')
        .split('/')
        .take(3)
        .collect::<Vec<_>>()
        .join("/");
    if !discovery.token_endpoint.starts_with(&issuer_origin) {
        return Err(anyhow::anyhow!(
            "OIDC token_endpoint '{}' does not match issuer origin '{issuer_origin}'",
            discovery.token_endpoint
        ));
    }
    if let Some(ref ui) = discovery.userinfo_endpoint {
        if !ui.starts_with(&issuer_origin) {
            return Err(anyhow::anyhow!(
                "OIDC userinfo_endpoint '{ui}' does not match issuer origin '{issuer_origin}'"
            ));
        }
    }
    if let Some(ref jwks) = discovery.jwks_uri {
        if !jwks.starts_with(&issuer_origin) {
            return Err(anyhow::anyhow!(
                "OIDC jwks_uri '{jwks}' does not match issuer origin '{issuer_origin}'"
            ));
        }
    }
    Ok(discovery)
}

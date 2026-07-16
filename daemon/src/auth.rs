// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use axum::body::Body;
use axum::extract::Query;
use axum::extract::State;
use axum::http::{header, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, DecodingKey, Validation};
use machina_core::libvirt::automation::{
    effective_token_scopes, get_user_role, load_roles, token_allows, Role,
};
use machina_core::{AuthConfig, LibvirtError, LibvirtManager, OidcConfig, OidcDefaultRole};
use rand::Rng;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use tracing::{info, warn};

use crate::error::AppError;

/// Authenticated HTTP actor (cookie session or API bearer token).
#[derive(Clone, Debug)]
pub struct RequestActor {
    pub username: String,
    /// Local Linux account used for sudo/libvirt session policy when present.
    pub effective_linux_user: Option<String>,
    /// API tokens must not perform sensitive host administration (e.g. OS user creation).
    pub from_api_token: bool,
    /// Effective RBAC role (from `api-tokens.json` or `roles.json` for browser sessions).
    pub role: Role,
    /// Where the request identity came from.
    pub auth_source: AuthSource,
    /// API token scopes (empty for browser/OIDC sessions).
    pub token_scopes: Vec<String>,
}

/// Enforce scope for bearer-token requests (`vms:write`, `fleet:proxy`, `*`, etc.).
pub fn require_api_scope(actor: &RequestActor, scope: &str) -> Result<(), LibvirtError> {
    if !actor.from_api_token {
        return Ok(());
    }
    if token_allows(&actor.token_scopes, scope) {
        Ok(())
    } else {
        Err(LibvirtError::Forbidden(format!(
            "API token lacks required scope '{scope}'"
        )))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthSource {
    Pam,
    Ldap,
    Oidc,
    ApiToken,
}

/// Host insight that reads passwd-like data, runs package managers, or sleeps on `/proc/net/dev`.
/// API tokens are rejected so automation credentials cannot scrape the hypervisor.
pub fn require_browser_session_for_host_insight(actor: &RequestActor) -> Result<(), LibvirtError> {
    if actor.from_api_token {
        Err(LibvirtError::Forbidden(
            "This endpoint requires a browser session (cookie), not an API token.".into(),
        ))
    } else {
        Ok(())
    }
}

/// Session store: token -> (username, created_at)
#[derive(Clone)]
pub struct SessionStore {
    // RwLock so concurrent reads (validate_session on every request) don't serialize.
    // Only writes (create/revoke/remove) need exclusive access.
    sessions: Arc<RwLock<HashMap<String, SessionData>>>,
    ws_tokens: Arc<Mutex<HashMap<String, WsTokenData>>>,
    oidc_states: Arc<Mutex<HashMap<String, OidcStateData>>>,
    max_sessions_global: usize,
    /// `0` = unlimited concurrent sessions per username.
    max_sessions_per_user: usize,
}

struct SessionData {
    actor: RequestActor,
    created_at: Instant,
    /// Opaque id for admin revoke (never the secret cookie token).
    public_id: String,
}

/// Row for `GET /admin/sessions` (root only).
#[derive(Serialize)]
pub struct SessionListEntry {
    pub session_id: String,
    pub username: String,
    pub auth_source: AuthSource,
    pub age_secs: u64,
    pub expires_in_secs: u64,
    pub is_current: bool,
}

const SESSION_TTL_SECS: u64 = 86400; // 24 hours

struct WsTokenData {
    actor: RequestActor,
    created_at: Instant,
}

struct OidcStateData {
    nonce: String,
    created_at: Instant,
}

const OIDC_STATE_TTL_SECS: u64 = 300;

impl SessionStore {
    pub fn new(max_sessions_global: usize, max_sessions_per_user: usize) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            ws_tokens: Arc::new(Mutex::new(HashMap::new())),
            oidc_states: Arc::new(Mutex::new(HashMap::new())),
            max_sessions_global: max_sessions_global.max(1),
            max_sessions_per_user,
        }
    }

    /// Active browser sessions for `username` (non-expired).
    pub fn active_sessions_for_user(&self, username: &str) -> usize {
        let sessions = self.sessions.read().unwrap_or_else(|e| e.into_inner());
        sessions
            .values()
            .filter(|d| {
                d.created_at.elapsed().as_secs() < SESSION_TTL_SECS && d.actor.username == username
            })
            .count()
    }

    /// Non-expired browser cookie sessions (API tokens are not counted).
    pub fn active_session_count(&self) -> usize {
        let sessions = self.sessions.read().unwrap_or_else(|e| e.into_inner());
        sessions
            .values()
            .filter(|d| d.created_at.elapsed().as_secs() < SESSION_TTL_SECS)
            .count()
    }

    fn create_session(&self, actor: RequestActor) -> String {
        let mut rng = rand::thread_rng();
        let token_bytes: [u8; 32] = rng.gen();
        let token = hex::encode(token_bytes);
        let public_id_bytes: [u8; 16] = rng.gen();
        let public_id = hex::encode(public_id_bytes);

        let mut sessions = self.sessions.write().unwrap_or_else(|e| e.into_inner());

        // Purge expired sessions
        sessions.retain(|_, data| data.created_at.elapsed().as_secs() < SESSION_TTL_SECS);

        // Global cap only (oldest session anywhere).
        if sessions.len() >= self.max_sessions_global {
            if let Some(oldest_token) = sessions
                .iter()
                .min_by_key(|(_, data)| data.created_at)
                .map(|(tok, _)| tok.clone())
            {
                sessions.remove(&oldest_token);
            }
        }

        // Per-user cap when configured (> 0). Default 0 = concurrent sessions allowed.
        if self.max_sessions_per_user > 0 {
            let user_sessions: Vec<String> = sessions
                .iter()
                .filter(|(_, data)| data.actor.username == actor.username)
                .map(|(tok, _)| tok.clone())
                .collect();
            if user_sessions.len() >= self.max_sessions_per_user {
                if let Some(oldest_token) = user_sessions
                    .iter()
                    .min_by_key(|tok| sessions.get(tok.as_str()).map(|d| d.created_at))
                    .cloned()
                {
                    sessions.remove(&oldest_token);
                }
            }
        }

        sessions.insert(
            token.clone(),
            SessionData {
                actor,
                created_at: Instant::now(),
                public_id,
            },
        );
        token
    }

    fn validate_session(&self, token: &str) -> Option<RequestActor> {
        // Use a read lock so concurrent requests don't serialize. Expired entries are
        // pruned lazily in the write paths (create_session, list_browser_sessions).
        let sessions = self.sessions.read().unwrap_or_else(|e| e.into_inner());
        let data = sessions.get(token)?;
        if data.created_at.elapsed().as_secs() < SESSION_TTL_SECS {
            Some(data.actor.clone())
        } else {
            None
        }
    }

    /// Public id for the given session cookie token, if still valid.
    pub fn session_public_id(&self, token: &str) -> Option<String> {
        let sessions = self.sessions.read().unwrap_or_else(|e| e.into_inner());
        sessions.get(token).and_then(|data| {
            if data.created_at.elapsed().as_secs() < SESSION_TTL_SECS {
                Some(data.public_id.clone())
            } else {
                None
            }
        })
    }

    /// All non-expired browser sessions (in-memory).
    pub fn list_browser_sessions(&self, current_public_id: Option<&str>) -> Vec<SessionListEntry> {
        let mut sessions = self.sessions.write().unwrap_or_else(|e| e.into_inner());
        sessions.retain(|_, data| data.created_at.elapsed().as_secs() < SESSION_TTL_SECS);
        let mut out: Vec<SessionListEntry> = sessions
            .iter()
            .map(|(_, data)| {
                let age = data.created_at.elapsed().as_secs();
                SessionListEntry {
                    session_id: data.public_id.clone(),
                    username: data.actor.username.clone(),
                    auth_source: data.actor.auth_source,
                    age_secs: age,
                    expires_in_secs: SESSION_TTL_SECS.saturating_sub(age),
                    is_current: current_public_id == Some(data.public_id.as_str()),
                }
            })
            .collect();
        out.sort_by(|a, b| a.age_secs.cmp(&b.age_secs));
        out
    }

    /// Revoke a session by its public id. Returns false if not found.
    pub fn revoke_session_by_public_id(&self, public_id: &str) -> bool {
        let mut sessions = self.sessions.write().unwrap_or_else(|e| e.into_inner());
        let token = sessions
            .iter()
            .find(|(_, d)| d.public_id == public_id)
            .map(|(t, _)| t.clone());
        if let Some(t) = token {
            sessions.remove(&t);
            return true;
        }
        false
    }

    pub fn remove_session(&self, token: &str) {
        let mut sessions = self.sessions.write().unwrap_or_else(|e| e.into_inner());
        sessions.remove(token);
    }

    /// Short-lived WebSocket token (reusable until expiry — supports React remount / reconnect).
    pub fn create_ws_token(&self, actor: &RequestActor) -> String {
        const WS_TOKEN_TTL_SECS: u64 = 120;

        let mut rng = rand::thread_rng();
        let token_bytes: [u8; 32] = rng.gen();
        let token = hex::encode(token_bytes);

        let mut ws_tokens = self.ws_tokens.lock().unwrap_or_else(|e| e.into_inner());
        ws_tokens.retain(|_, data| data.created_at.elapsed().as_secs() < WS_TOKEN_TTL_SECS);
        ws_tokens.insert(
            token.clone(),
            WsTokenData {
                actor: actor.clone(),
                created_at: Instant::now(),
            },
        );
        token
    }

    /// Validate a WebSocket token without removing it (noVNC may open the socket more than once).
    pub fn validate_ws_token(&self, token: &str) -> Option<RequestActor> {
        const WS_TOKEN_TTL_SECS: u64 = 120;

        let mut ws_tokens = self.ws_tokens.lock().unwrap_or_else(|e| e.into_inner());
        ws_tokens.retain(|_, data| data.created_at.elapsed().as_secs() < WS_TOKEN_TTL_SECS);
        let data = ws_tokens.get(token)?;
        if data.created_at.elapsed().as_secs() < WS_TOKEN_TTL_SECS {
            Some(data.actor.clone())
        } else {
            None
        }
    }

    pub fn create_oidc_state(&self, nonce: String) -> String {
        let mut rng = rand::thread_rng();
        let state_bytes: [u8; 32] = rng.gen();
        let state = hex::encode(state_bytes);
        let mut states = self.oidc_states.lock().unwrap_or_else(|e| e.into_inner());
        states.retain(|_, data| data.created_at.elapsed().as_secs() < OIDC_STATE_TTL_SECS);
        states.insert(
            state.clone(),
            OidcStateData {
                nonce,
                created_at: Instant::now(),
            },
        );
        state
    }

    pub fn take_oidc_state(&self, state: &str) -> Option<String> {
        let mut states = self.oidc_states.lock().unwrap_or_else(|e| e.into_inner());
        states.retain(|_, data| data.created_at.elapsed().as_secs() < OIDC_STATE_TTL_SECS);
        states.remove(state).and_then(|data| {
            if data.created_at.elapsed().as_secs() < OIDC_STATE_TTL_SECS {
                Some(data.nonce)
            } else {
                None
            }
        })
    }
}

fn browser_actor(
    username: String,
    effective_linux_user: Option<String>,
    role: Role,
    auth_source: AuthSource,
) -> RequestActor {
    RequestActor {
        username,
        effective_linux_user,
        from_api_token: false,
        role,
        auth_source,
        token_scopes: Vec::new(),
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct PlatformJwtClaims {
    sub: String,
    role: String,
    exp: usize,
    iat: usize,
    #[serde(default)]
    auth: Option<String>,
}

const DEV_JWT_SECRET: &str = "machina-dev-jwt-secret-change-me";

/// The configured platform JWT secret, or None when it is unset or still the well-known
/// dev placeholder. Returning None makes actor_from_platform_jwt refuse ALL platform
/// JWTs, so a token signed with the public dev secret can never mint a session (it maps
/// role="admin" → Role::Admin, i.e. unauthenticated admin takeover otherwise).
fn platform_jwt_secret() -> Option<String> {
    match std::env::var("MACHINA_JWT_SECRET") {
        Ok(s) if !s.is_empty() && s != DEV_JWT_SECRET => Some(s),
        _ => None,
    }
}

fn skip_auth_enabled() -> bool {
    std::env::var("MACHINA_DAEMON_SKIP_AUTH").ok().as_deref() == Some("1")
}

fn dev_bypass_actor() -> RequestActor {
    browser_actor("dev".into(), None, Role::Admin, AuthSource::Pam)
}

fn role_from_platform_jwt(role: &str) -> Role {
    match role.to_lowercase().as_str() {
        "admin" => Role::Admin,
        "operator" => Role::Operator,
        _ => Role::ReadOnly,
    }
}

fn auth_source_from_platform_jwt(auth: Option<&str>) -> AuthSource {
    match auth {
        Some("oidc") | Some("saml") => AuthSource::Oidc,
        _ => AuthSource::Pam,
    }
}

fn actor_from_platform_jwt(token: &str) -> Option<RequestActor> {
    let secret = platform_jwt_secret()?;
    let data = decode::<PlatformJwtClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .ok()?;
    let claims = data.claims;
    Some(browser_actor(
        claims.sub,
        None,
        role_from_platform_jwt(&claims.role),
        auth_source_from_platform_jwt(claims.auth.as_deref()),
    ))
}

fn actor_from_bearer_token(token: &str) -> Option<RequestActor> {
    if token.starts_with("mach_") || token.starts_with("vs_") {
        let api = machina_core::libvirt::automation::validate_api_token(token)?;
        let scopes = effective_token_scopes(&api);
        return Some(RequestActor {
            username: api.username,
            effective_linux_user: None,
            from_api_token: true,
            role: api.role,
            auth_source: AuthSource::ApiToken,
            token_scopes: scopes,
        });
    }
    actor_from_platform_jwt(token)
}

fn actor_from_cookie(sessions: &SessionStore, cookie_header: &str) -> Option<RequestActor> {
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("machina_session=") {
            let token = value.trim();
            if !token.is_empty() {
                return sessions.validate_session(token);
            }
        }
    }
    None
}

fn resolve_actor(sessions: &SessionStore, headers: &axum::http::HeaderMap) -> Option<RequestActor> {
    if skip_auth_enabled() {
        return Some(dev_bypass_actor());
    }

    if let Some(cookie_header) = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()) {
        if let Some(actor) = actor_from_cookie(sessions, cookie_header) {
            return Some(actor);
        }
    }

    if let Some(auth_header) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth_header.strip_prefix("Bearer ") {
            let token = token.trim();
            if !token.is_empty() {
                if let Some(actor) = actor_from_bearer_token(token) {
                    return Some(actor);
                }
                if token.starts_with("mach_") || token.starts_with("vs_") {
                    machina_core::obs_counters::inc_api_token_fail();
                }
            }
        }
    }

    None
}

pub fn effective_linux_user(actor: &RequestActor) -> Option<&str> {
    actor.effective_linux_user.as_deref()
}

fn resolve_oidc_role(username: &str, groups: &[String], cfg: &OidcConfig) -> Role {
    if groups
        .iter()
        .any(|g| cfg.admin_groups.iter().any(|want| want == g))
    {
        return Role::Admin;
    }
    if groups
        .iter()
        .any(|g| cfg.operator_groups.iter().any(|want| want == g))
    {
        return Role::Operator;
    }
    let roles = load_roles();
    if let Some(local_role) = roles.get(username) {
        return local_role.clone();
    }
    match cfg.default_role {
        OidcDefaultRole::Admin => Role::Admin,
        OidcDefaultRole::Operator => Role::Operator,
        OidcDefaultRole::ReadOnly => Role::ReadOnly,
    }
}

#[derive(Clone)]
pub struct OidcAuth(pub std::sync::Arc<AuthConfig>);

#[derive(Debug, Deserialize, Serialize)]
struct OidcProviderMetadata {
    enabled: bool,
    button_label: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct SamlProviderMetadata {
    enabled: bool,
    button_label: String,
    /// SAML browser login is not implemented yet — metadata only.
    login_available: bool,
}

#[derive(Debug, Deserialize)]
struct OidcDiscoveryDocument {
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
    issuer: String,
}

#[derive(Debug, Deserialize)]
struct OidcCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OidcTokenResponse {
    id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OidcClaims {
    sub: String,
    exp: usize,
    #[serde(default)]
    nbf: Option<usize>,
    #[serde(default)]
    iss: Option<String>,
    #[serde(default)]
    aud: Option<serde_json::Value>,
    #[serde(default)]
    nonce: Option<String>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

async fn fetch_oidc_discovery(cfg: &OidcConfig) -> Result<OidcDiscoveryDocument, AppError> {
    let base = cfg.issuer_url.trim_end_matches('/');
    let url = format!("{base}/.well-known/openid-configuration");
    let res = reqwest::get(&url)
        .await
        .map_err(|e| LibvirtError::Operation(format!("Fetch OIDC discovery: {e}")))?;
    if !res.status().is_success() {
        return Err(AppError::from(LibvirtError::Operation(format!(
            "Fetch OIDC discovery: HTTP {}",
            res.status()
        ))));
    }
    res.json::<OidcDiscoveryDocument>().await.map_err(|e| {
        AppError::from(LibvirtError::Operation(format!(
            "Decode OIDC discovery document: {e}"
        )))
    })
}

async fn fetch_oidc_jwks(url: &str) -> Result<JwkSet, AppError> {
    let res = reqwest::get(url)
        .await
        .map_err(|e| LibvirtError::Operation(format!("Fetch OIDC JWKS: {e}")))?;
    if !res.status().is_success() {
        return Err(AppError::from(LibvirtError::Operation(format!(
            "Fetch OIDC JWKS: HTTP {}",
            res.status()
        ))));
    }
    res.json::<JwkSet>()
        .await
        .map_err(|e| AppError::from(LibvirtError::Operation(format!("Decode OIDC JWKS: {e}"))))
}

fn claim_strings(value: Option<&serde_json::Value>) -> Vec<String> {
    match value {
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| match v {
                serde_json::Value::String(s) => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn claim_string(value: Option<&serde_json::Value>) -> Option<String> {
    match value {
        Some(serde_json::Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn resolve_effective_linux_user(
    username: &str,
    claims: &HashMap<String, serde_json::Value>,
    cfg: &OidcConfig,
) -> Option<String> {
    let claimed = claim_string(claims.get(&cfg.linux_username_claim))
        .or_else(|| claim_string(claims.get(&cfg.username_claim)))
        .or_else(|| Some(username.to_string()))?;
    if machina_core::system_accounts::unix_user_exists(&claimed) {
        Some(claimed)
    } else {
        None
    }
}

fn validate_oidc_id_token(
    id_token: &str,
    jwks: &JwkSet,
    discovery: &OidcDiscoveryDocument,
    cfg: &OidcConfig,
    expected_nonce: &str,
) -> Result<(String, Option<String>, Role), AppError> {
    let header = decode_header(id_token).map_err(|e| {
        AppError::from(LibvirtError::Forbidden(format!(
            "Decode OIDC token header: {e}"
        )))
    })?;
    let kid = header.kid.ok_or_else(|| {
        AppError::from(LibvirtError::Forbidden(
            "OIDC id_token is missing key id".into(),
        ))
    })?;
    let jwk = jwks.find(&kid).ok_or_else(|| {
        AppError::from(LibvirtError::Forbidden(format!(
            "OIDC signing key '{kid}' not found in JWKS"
        )))
    })?;
    let key = DecodingKey::from_jwk(jwk).map_err(|e| {
        AppError::from(LibvirtError::Forbidden(format!(
            "Build OIDC decoding key from JWKS: {e}"
        )))
    })?;

    let mut validation = Validation::new(header.alg);
    validation.set_audience(&[cfg.client_id.as_str()]);
    validation.set_issuer(&[discovery.issuer.as_str()]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.validate_nbf = true;

    let token = decode::<OidcClaims>(id_token, &key, &validation).map_err(|e| {
        AppError::from(LibvirtError::Forbidden(format!(
            "Validate OIDC id_token: {e}"
        )))
    })?;
    let claims = token.claims;
    let _ = claims.exp;
    let _ = &claims.aud;
    let _ = &claims.iss;
    let _ = claims.nbf;

    if claims.nonce.as_deref() != Some(expected_nonce) {
        return Err(AppError::from(LibvirtError::Forbidden(
            "OIDC nonce mismatch".into(),
        )));
    }

    let username = claim_string(claims.extra.get(&cfg.username_claim))
        .or_else(|| claim_string(claims.extra.get("email")))
        .unwrap_or(claims.sub);
    let effective_linux_user = resolve_effective_linux_user(&username, &claims.extra, cfg);
    let groups = claim_strings(claims.extra.get(&cfg.groups_claim));
    let role = resolve_oidc_role(&username, &groups, cfg);
    Ok((username, effective_linux_user, role))
}

/// Extract session token from cookie header.
fn extract_token(req: &Request<Body>) -> Option<String> {
    let cookie_header = req.headers().get(header::COOKIE)?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("machina_session=") {
            let token = value.trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    None
}

/// Auth middleware — checks for valid session cookie.
/// Skips health check. Applied via route_layer on API/WS routes.
pub async fn auth_middleware(
    State(store): State<SessionStore>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let path = req.uri().path();

    // Public endpoints (paths after nest stripping of /api/v1 or /ws/v1)
    if path == "/health" || path == "/license" || path == "/openapi.json" || path.starts_with("/auth/") {
        return next.run(req).await;
    }

    // Check session cookie
    if skip_auth_enabled() {
        req.extensions_mut().insert(dev_bypass_actor());
        return next.run(req).await;
    }

    if let Some(token) = extract_token(&req) {
        if let Some(actor) = store.validate_session(&token) {
            req.extensions_mut().insert(actor);
            return next.run(req).await;
        }
    }

    // Check Authorization header for API tokens or platform JWT (Bearer …).
    if let Some(auth_header) = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
    {
        if let Some(token) = auth_header.strip_prefix("Bearer ") {
            let token = token.trim();
            if let Some(actor) = actor_from_bearer_token(token) {
                req.extensions_mut().insert(actor);
                return next.run(req).await;
            }
            if token.starts_with("mach_") || token.starts_with("vs_") {
                machina_core::obs_counters::inc_api_token_fail();
            }
        }
    }

    (
        StatusCode::UNAUTHORIZED,
        Json(
            serde_json::json!({ "error": "Authentication required", "error_code": "unauthorized" }),
        ),
    )
        .into_response()
}

// ── WebSocket token handler ────────────────────────────────────────

/// Create a single-use WebSocket token. Must be called from an authenticated context.
pub async fn ws_token_handler(
    Extension(sessions): Extension<SessionStore>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    match resolve_actor(&sessions, &headers) {
        Some(actor) => {
            let token = sessions.create_ws_token(&actor);
            (StatusCode::OK, Json(serde_json::json!({ "token": token }))).into_response()
        }
        None => {
            (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Authentication required", "error_code": "unauthorized" })),
            )
                .into_response()
        }
    }
}

/// WebSocket auth middleware — checks for `?token=` query parameter.
pub async fn ws_auth_middleware(
    State(store): State<SessionStore>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let path = req.uri().path();
    // Platform VNC/serial use controller-issued tokens; machina-controller validates them.
    // The WS routes are nested at /ws/v1, so the full path is /ws/v1/platform/vnc/... or
    // /ws/v1/platform/serial/... — match either prefix to accommodate future re-nesting.
    if path.contains("/platform/vnc/") || path.contains("/platform/serial/") || path.contains("/platform/spice/") {
        return next.run(req).await;
    }

    // Extract token from query string
    let token = req.uri().query().and_then(|q| {
        q.split('&')
            .find_map(|pair| pair.strip_prefix("token=").map(|v| v.to_string()))
    });

    if let Some(ref tok) = token {
        if let Some(actor) = store.validate_ws_token(tok) {
            req.extensions_mut().insert(actor);
            return next.run(req).await;
        }
    }

    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({ "error": "Valid WebSocket token required", "error_code": "unauthorized" })),
    )
        .into_response()
}

// ── Auth handlers (use Extension<SessionStore>) ────────────────────

#[derive(Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn login_handler(
    Extension(store): Extension<SessionStore>,
    Extension(auth): Extension<OidcAuth>,
    Extension(stats): Extension<std::sync::Arc<crate::daemon_stats::DaemonStats>>,
    Json(req): Json<LoginRequest>,
) -> Response {
    if req.username.is_empty() || req.password.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Username and password required", "error_code": "invalid_request" }))).into_response();
    }

    let cfg = &auth.0;
    if !req.username.chars().all(|c| {
        c.is_alphanumeric()
            || c == '_'
            || c == '-'
            || c == '.'
            || (c == '@' && cfg.ldap.is_enabled())
    }) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Invalid username characters", "error_code": "invalid_request" }))).into_response();
    }

    if cfg.ldap.is_enabled() {
        match crate::ldap_auth::ldap_authenticate_async(&cfg.ldap, &req.username, &req.password)
            .await
        {
            Ok(ldap) => {
                let role = ldap.role.clone();
                info!(
                    "LDAP login successful for user '{}' (role {:?})",
                    ldap.username, role
                );
                let token = store.create_session(browser_actor(
                    ldap.username.clone(),
                    Some(ldap.username.clone()),
                    role.clone(),
                    AuthSource::Ldap,
                ));
                let cookie = format!("machina_session={token}; Path=/; HttpOnly; SameSite=Strict");
                stats.inc_auth_attempt("ldap", "success");
                return (
                    StatusCode::OK,
                    [(header::SET_COOKIE, cookie)],
                    Json(serde_json::json!({
                        "status": "ok",
                        "username": ldap.username,
                        "role": role,
                        "auth_source": "ldap"
                    })),
                )
                    .into_response();
            }
            Err(e) => {
                warn!("LDAP login failed for user '{}': {}", req.username, e);
                stats.inc_auth_attempt("ldap", "failure");
                return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid username or password", "error_code": "unauthorized" }))).into_response();
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        if !cfg.ldap.is_enabled() {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": "Password login via PAM is only available when machina-daemon runs on Linux",
                    "error_code": "pam_unavailable"
                })),
            )
                .into_response();
        }
    }

    match pam_authenticate(&req.username, &req.password, &cfg.pam_service) {
        Ok(()) => {
            info!("PAM login successful for user '{}'", req.username);
            let token = store.create_session(browser_actor(
                req.username.clone(),
                Some(req.username.clone()),
                get_user_role(&req.username),
                AuthSource::Pam,
            ));
            let cookie = format!("machina_session={token}; Path=/; HttpOnly; SameSite=Strict");
            stats.inc_auth_attempt("pam", "success");
            (
                StatusCode::OK,
                [(header::SET_COOKIE, cookie)],
                Json(serde_json::json!({
                    "status": "ok",
                    "username": req.username,
                    "auth_source": "pam"
                })),
            )
                .into_response()
        }
        Err(e) => {
            warn!("PAM login failed for user '{}': {}", req.username, e);
            stats.inc_auth_attempt("pam", "failure");
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid username or password", "error_code": "unauthorized" }))).into_response()
        }
    }
}

async fn logout_handler(Extension(store): Extension<SessionStore>, req: Request<Body>) -> Response {
    if let Some(token) = extract_token(&req) {
        store.remove_session(&token);
    }
    let cookie = "machina_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({ "status": "logged_out" })),
    )
        .into_response()
}

async fn session_handler(
    Extension(store): Extension<SessionStore>,
    req: Request<Body>,
) -> Response {
    if let Some(token) = extract_token(&req) {
        if let Some(actor) = store.validate_session(&token) {
            let session_id = store.session_public_id(&token);
            let run_as = machina_core::MachinaConfig::load().auth.run_as_user;
            let mode = serde_json::to_value(&run_as.mode).unwrap_or(serde_json::json!("disabled"));
            let active_for_user = store.active_sessions_for_user(&actor.username);
            return (
                StatusCode::OK,
                Json(serde_json::json!({
                    "authenticated": true,
                    "username": actor.username,
                    "effective_linux_user": actor.effective_linux_user,
                    "session_id": session_id,
                    "role": actor.role,
                    "auth_source": actor.auth_source,
                    "active_sessions_for_user": active_for_user,
                    "max_sessions_per_user": store.max_sessions_per_user,
                    "run_as_user": {
                        "enabled": run_as.wants_impersonation(),
                        "mode": mode,
                        "impersonation_active": run_as.impersonation_active(),
                        "prefer_session_libvirt_on_impersonation": run_as.prefer_session_libvirt_on_impersonation,
                    },
                })),
            )
                .into_response();
        }
    }
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({ "authenticated": false })),
    )
        .into_response()
}

async fn auth_providers_handler(Extension(auth): Extension<OidcAuth>) -> Response {
    let cfg = &auth.0;
    let oidc = &cfg.oidc;
    let ldap_on = cfg.ldap.is_enabled();
    let saml = &cfg.saml;
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "pam": { "enabled": !ldap_on },
            "ldap": { "enabled": ldap_on },
            "oidc": OidcProviderMetadata {
                enabled: oidc.is_enabled(),
                button_label: oidc.button_label.clone(),
            },
            "saml": SamlProviderMetadata {
                enabled: saml.is_configured(),
                button_label: saml.button_label.clone(),
                login_available: false,
            }
        })),
    )
        .into_response()
}

async fn oidc_login_handler(
    Extension(store): Extension<SessionStore>,
    Extension(auth): Extension<OidcAuth>,
) -> Response {
    let cfg = &auth.0.oidc;
    if !cfg.is_enabled() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "OIDC login is not enabled" })),
        )
            .into_response();
    }

    let discovery = match fetch_oidc_discovery(cfg).await {
        Ok(doc) => doc,
        Err(e) => return e.into_response(),
    };

    let mut rng = rand::thread_rng();
    let nonce_bytes: [u8; 32] = rng.gen();
    let nonce = hex::encode(nonce_bytes);
    let state = store.create_oidc_state(nonce.clone());
    let mut url = match reqwest::Url::parse(&discovery.authorization_endpoint) {
        Ok(url) => url,
        Err(e) => {
            return AppError::from(LibvirtError::Operation(format!(
                "Invalid OIDC authorization endpoint: {e}"
            )))
            .into_response();
        }
    };
    let scope = if cfg.scopes.is_empty() {
        "openid profile email".to_string()
    } else {
        cfg.scopes.join(" ")
    };
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", cfg.client_id.trim())
        .append_pair("redirect_uri", cfg.redirect_url.trim())
        .append_pair("scope", &scope)
        .append_pair("state", &state)
        .append_pair("nonce", &nonce);

    axum::response::Redirect::temporary(url.as_ref()).into_response()
}

async fn oidc_callback_handler(
    Extension(store): Extension<SessionStore>,
    Extension(auth): Extension<OidcAuth>,
    Extension(stats): Extension<std::sync::Arc<crate::daemon_stats::DaemonStats>>,
    Query(query): Query<OidcCallbackQuery>,
) -> Response {
    let cfg = &auth.0.oidc;
    if !cfg.is_enabled() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "OIDC login is not enabled" })),
        )
            .into_response();
    }
    if let Some(err) = query.error {
        let msg = query
            .error_description
            .unwrap_or_else(|| "OIDC provider rejected the login".to_string());
        warn!("OIDC callback error '{}': {}", err, msg);
        stats.inc_auth_attempt("oidc", "failure");
        return axum::response::Redirect::temporary("/login?error=oidc").into_response();
    }

    let state = match query.state {
        Some(state) if !state.is_empty() => state,
        _ => {
            stats.inc_auth_attempt("oidc", "failure");
            return AppError::from(LibvirtError::Forbidden(
                "OIDC callback missing state".into(),
            ))
            .into_response();
        }
    };
    let expected_nonce = match store.take_oidc_state(&state) {
        Some(nonce) => nonce,
        None => {
            stats.inc_auth_attempt("oidc", "failure");
            return AppError::from(LibvirtError::Forbidden(
                "OIDC state is invalid or expired".into(),
            ))
            .into_response();
        }
    };
    let code = match query.code {
        Some(code) if !code.is_empty() => code,
        _ => {
            stats.inc_auth_attempt("oidc", "failure");
            return AppError::from(LibvirtError::Forbidden("OIDC callback missing code".into()))
                .into_response();
        }
    };

    let discovery = match fetch_oidc_discovery(cfg).await {
        Ok(doc) => doc,
        Err(e) => return e.into_response(),
    };
    let client = reqwest::Client::new();
    let token_res = match client
        .post(&discovery.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", cfg.redirect_url.as_str()),
            ("client_id", cfg.client_id.as_str()),
            ("client_secret", cfg.client_secret.as_str()),
        ])
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            return AppError::from(LibvirtError::Operation(format!(
                "Exchange OIDC authorization code: {e}"
            )))
            .into_response();
        }
    };
    if !token_res.status().is_success() {
        stats.inc_auth_attempt("oidc", "failure");
        return AppError::from(LibvirtError::Forbidden(format!(
            "OIDC token endpoint returned HTTP {}",
            token_res.status()
        )))
        .into_response();
    }
    let token_body = match token_res.json::<OidcTokenResponse>().await {
        Ok(body) => body,
        Err(e) => {
            return AppError::from(LibvirtError::Operation(format!(
                "Decode OIDC token response: {e}"
            )))
            .into_response();
        }
    };
    let id_token = match token_body.id_token {
        Some(token) if !token.is_empty() => token,
        _ => {
            stats.inc_auth_attempt("oidc", "failure");
            return AppError::from(LibvirtError::Forbidden(
                "OIDC token response did not include id_token".into(),
            ))
            .into_response();
        }
    };
    let jwks = match fetch_oidc_jwks(&discovery.jwks_uri).await {
        Ok(set) => set,
        Err(e) => return e.into_response(),
    };
    let (username, effective_linux_user, role) =
        match validate_oidc_id_token(&id_token, &jwks, &discovery, cfg, &expected_nonce) {
            Ok(actor) => actor,
            Err(e) => {
                stats.inc_auth_attempt("oidc", "failure");
                return e.into_response();
            }
        };

    let token = store.create_session(browser_actor(
        username.clone(),
        effective_linux_user,
        role,
        AuthSource::Oidc,
    ));
    let cookie = format!("machina_session={token}; Path=/; HttpOnly; SameSite=Strict");
    info!("OIDC login successful for user '{}'", username);
    stats.inc_auth_attempt("oidc", "success");
    (
        StatusCode::TEMPORARY_REDIRECT,
        [
            (header::SET_COOKIE, cookie),
            (header::LOCATION, "/".to_string()),
        ],
    )
        .into_response()
}

pub fn require_destroy_vm(actor: &RequestActor) -> Result<(), AppError> {
    if actor.role.can_destroy_vm() {
        Ok(())
    } else {
        Err(AppError::from(LibvirtError::Forbidden(
            "Destroying or undefining VMs requires the admin role.".into(),
        )))
    }
}

/// Gate a mutating handler: the caller must have write role (operator/admin) AND, for
/// API-token callers, the required scope. Many storage/device/snapshot/migrate handlers
/// historically authenticated but never authorized, letting a read-only token perform
/// destructive host/VM operations — this is the single guard they were missing.
pub fn require_write(actor: &RequestActor, scope: &str) -> Result<(), AppError> {
    require_api_scope(actor, scope).map_err(AppError::from)?;
    if !actor.role.can_write() {
        return Err(AppError::from(LibvirtError::Forbidden(
            "This operation requires the operator or admin role.".into(),
        )));
    }
    Ok(())
}

pub fn require_usb_pci(actor: &RequestActor) -> Result<(), AppError> {
    if actor.role.can_usb_pci() {
        Ok(())
    } else {
        Err(AppError::from(LibvirtError::Forbidden(
            "USB and PCI passthrough require the operator or admin role.".into(),
        )))
    }
}

pub fn require_browse_host_paths(actor: &RequestActor) -> Result<(), AppError> {
    if actor.role.can_browse_host_paths() {
        Ok(())
    } else {
        Err(AppError::from(LibvirtError::Forbidden(
            "Browsing host paths requires the admin role.".into(),
        )))
    }
}

fn require_root_session(actor: &RequestActor) -> Result<(), LibvirtError> {
    if actor.from_api_token {
        return Err(LibvirtError::Forbidden(
            "Session administration requires a browser login as root".into(),
        ));
    }
    if actor.username != "root" {
        return Err(LibvirtError::Forbidden(
            "Only the root user may list or revoke web sessions".into(),
        ));
    }
    Ok(())
}

async fn admin_list_sessions(
    Extension(store): Extension<SessionStore>,
    Extension(actor): Extension<RequestActor>,
    req: Request<Body>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_root_session(&actor)?;
    let current_public_id = extract_token(&req).and_then(|t| store.session_public_id(&t));
    let list = store.list_browser_sessions(current_public_id.as_deref());
    let total_sessions = list.len();
    let by_user: std::collections::HashMap<String, usize> =
        list.iter()
            .fold(std::collections::HashMap::new(), |mut acc, s| {
                *acc.entry(s.username.clone()).or_insert(0) += 1;
                acc
            });
    Ok(Json(serde_json::json!({
        "sessions": list,
        "total_sessions": total_sessions,
        "users_logged_in": by_user.len(),
        "sessions_per_username": by_user,
    })))
}

async fn admin_revoke_session(
    Extension(store): Extension<SessionStore>,
    Extension(actor): Extension<RequestActor>,
    axum::extract::Path(session_id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_root_session(&actor)?;
    if session_id.chars().count() != 32 || !session_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(LibvirtError::Invalid("Invalid session_id".into()).into());
    }
    if store.revoke_session_by_public_id(&session_id) {
        info!("Session {} revoked by root", session_id);
        Ok(Json(
            serde_json::json!({ "status": "revoked", "session_id": session_id }),
        ))
    } else {
        Err(LibvirtError::NotFound("Session not found or already expired".into()).into())
    }
}

#[cfg(target_os = "linux")]
fn pam_authenticate(username: &str, password: &str, pam_service: &str) -> Result<(), String> {
    let mut client = pam::Client::with_password(pam_service)
        .map_err(|e| format!("PAM init failed ({pam_service}): {e}"))?;
    client
        .conversation_mut()
        .set_credentials(username, password);
    client
        .authenticate()
        .map_err(|e| format!("PAM auth failed: {e}"))?;
    // Skip open_session() — pam_loginuid fails under systemd with NoNewPrivileges.
    // We only need credential verification, not a full login session.
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn pam_authenticate(_username: &str, _password: &str, _pam_service: &str) -> Result<(), String> {
    Err("PAM authentication is only compiled on Linux".into())
}

#[derive(Debug, Deserialize)]
struct TokenSessionRequest {
    token: String,
}

/// Exchange a platform-issued JWT (`?token=` deep link) for a browser session cookie.
async fn token_session_handler(
    Extension(store): Extension<SessionStore>,
    Extension(stats): Extension<std::sync::Arc<crate::daemon_stats::DaemonStats>>,
    Json(req): Json<TokenSessionRequest>,
) -> Response {
    let token = req.token.trim();
    if token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "token required", "error_code": "invalid_request" })),
        )
            .into_response();
    }
    if token.starts_with("mach_") || token.starts_with("vs_") {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "API automation tokens cannot be exchanged for browser sessions",
                "error_code": "invalid_request"
            })),
        )
            .into_response();
    }
    let Some(actor) = actor_from_platform_jwt(token) else {
        stats.inc_auth_attempt("oidc", "failure");
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or expired token", "error_code": "unauthorized" })),
        )
            .into_response();
    };
    let session_token = store.create_session(actor.clone());
    let cookie = format!("machina_session={session_token}; Path=/; HttpOnly; SameSite=Strict");
    stats.inc_auth_attempt("oidc", "success");
    info!(
        "Platform JWT exchanged for browser session for user '{}'",
        actor.username
    );
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({
            "status": "ok",
            "username": actor.username,
            "role": actor.role,
            "auth_source": actor.auth_source,
        })),
    )
        .into_response()
}

async fn saml_metadata_handler(Extension(auth): Extension<OidcAuth>) -> Response {
    let saml = &auth.0.saml;
    if !saml.is_configured() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "SAML is not configured" })),
        )
            .into_response();
    }
    let entity = xml_escape(&saml.sp_entity_id);
    let acs = xml_escape(if saml.sp_acs_url.trim().is_empty() {
        "/api/v1/auth/saml/acs"
    } else {
        saml.sp_acs_url.as_str()
    });
    let xml = format!(
        r#"<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="{entity}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>{nameid}</NameIDFormat>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="{acs}" index="1"/>
  </SPSSODescriptor>
</EntityDescriptor>"#,
        entity = entity,
        acs = acs,
        nameid = xml_escape(&saml.name_id_format),
    );
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/samlmetadata+xml")],
        xml,
    )
        .into_response()
}

fn xml_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

async fn run_as_user_status_handler(Extension(auth): Extension<OidcAuth>) -> Response {
    let cfg = &auth.0.run_as_user;
    let mode = serde_json::to_value(&cfg.mode).unwrap_or(serde_json::json!("disabled"));
    Json(serde_json::json!({
        "enabled": cfg.wants_impersonation(),
        "mode": mode,
        "impersonation_active": cfg.impersonation_active(),
        "setuid_helper_path": cfg.setuid_helper_path,
        "prefer_session_libvirt_on_impersonation": cfg.prefer_session_libvirt_on_impersonation,
        "supported_programs": ["useradd", "userdel", "usermod", "homectl", "chpasswd", "id", "getent"],
    }))
    .into_response()
}

/// Auth routes — these use Extension<SessionStore> so they can be merged
/// into Router<LibvirtManager> without state conflicts.
pub fn auth_routes(session_store: SessionStore, auth_cfg: AuthConfig) -> Router<LibvirtManager> {
    Router::new()
        .route("/auth/providers", get(auth_providers_handler))
        .route("/auth/run-as-user", get(run_as_user_status_handler))
        .route("/auth/login", post(login_handler))
        .route("/auth/oidc/login", get(oidc_login_handler))
        .route("/auth/oidc/callback", get(oidc_callback_handler))
        .route("/auth/token/session", post(token_session_handler))
        .route("/auth/saml/metadata", get(saml_metadata_handler))
        .route("/auth/logout", post(logout_handler))
        .route("/auth/session", get(session_handler))
        .route("/ws-token", post(ws_token_handler))
        .route("/admin/sessions", get(admin_list_sessions))
        .route("/admin/sessions/{session_id}", delete(admin_revoke_session))
        .layer(Extension(session_store))
        .layer(Extension(OidcAuth(std::sync::Arc::new(auth_cfg))))
}

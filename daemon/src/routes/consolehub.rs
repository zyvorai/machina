// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
//! Classic-mode ConsoleHub: plan, Guacamole sessions, same-origin reverse proxy to local guacd.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Path, Query, Request, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use libvirt_guac_bridge::{bridge_from_plan, GuacBridgeTarget, GuacamoleBridgeParams};
use machina_core::libvirt::{guest_health, vnc};
use machina_core::{LibvirtManager, MachinaConfig};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::auth::{AuthSource, RequestActor};
use crate::conn_query::{spawn_libvirt_actor, ConnQuery};
use crate::error::AppError;

const PROXY_PREFIX: &str = "/consolehub/guacamole";

#[derive(Clone)]
pub struct ConsoleSessionStore {
    inner: Arc<RwLock<HashMap<Uuid, LiveConsoleSession>>>,
    history: Arc<RwLock<Vec<SessionHistoryRow>>>,
}

#[derive(Clone)]
struct LiveConsoleSession {
    vm_name: String,
    actor: String,
    protocol: String,
    backend: String,
    guac_token: Option<String>,
    guacamole_base: String,
    emergency_url: Option<String>,
    expires: Instant,
    audit_id: Uuid,
}

#[derive(Clone, Serialize)]
struct SessionHistoryRow {
    session_id: String,
    vm_name: String,
    actor: String,
    protocol: String,
    backend: String,
    started_at: String,
    ended_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConsoleHubPlan {
    pub vm_name: String,
    pub recommended: String,
    pub native: NativeConsoleInfo,
    pub guacamole: GuacamoleConsoleInfo,
    pub guest_ip: Option<String>,
    pub ssh_user: Option<String>,
    pub os_hint: String,
    pub protocols: Vec<String>,
    pub webrtc_spice_available: bool,
}

#[derive(Debug, Serialize)]
pub struct NativeConsoleInfo {
    pub console_type: String,
    pub ws_path: String,
    pub serial_ws_path: String,
    pub available: bool,
}

#[derive(Debug, Serialize)]
pub struct GuacamoleConsoleInfo {
    pub available: bool,
    pub protocols: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSessionBody {
    pub protocol: Option<String>,
    #[serde(default)]
    pub rdp_username: Option<String>,
    #[serde(default)]
    pub rdp_domain: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConsoleSessionResponse {
    pub session_id: String,
    pub vm_name: String,
    pub protocol: String,
    pub backend: String,
    pub embed_path: String,
    pub emergency_url: Option<String>,
    pub audit_id: String,
    pub expires_at: String,
}

impl ConsoleSessionStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            history: Arc::new(RwLock::new(Vec::new())),
        }
    }

    async fn insert(&self, session: LiveConsoleSession) -> Uuid {
        let id = Uuid::new_v4();
        let row = SessionHistoryRow {
            session_id: id.to_string(),
            vm_name: session.vm_name.clone(),
            actor: session.actor.clone(),
            protocol: session.protocol.clone(),
            backend: session.backend.clone(),
            started_at: chrono::Utc::now().to_rfc3339(),
            ended_at: None,
        };
        let mut map = self.inner.write().await;
        map.retain(|_, v| v.expires > Instant::now());
        map.insert(id, session);
        drop(map);
        let mut hist = self.history.write().await;
        hist.push(row);
        if hist.len() > 200 {
            let excess = hist.len() - 200;
            hist.drain(0..excess);
        }
        id
    }

    async fn get(&self, id: Uuid) -> Option<LiveConsoleSession> {
        let map = self.inner.read().await;
        let entry = map.get(&id)?;
        if entry.expires < Instant::now() {
            return None;
        }
        Some(entry.clone())
    }

    async fn end(&self, id: Uuid, actor: &str) -> bool {
        let mut map = self.inner.write().await;
        let removed = map.remove(&id);
        drop(map);
        let Some(session) = removed else {
            return false;
        };
        if session.actor != actor {
            return false;
        }
        let mut hist = self.history.write().await;
        if let Some(row) = hist
            .iter_mut()
            .rev()
            .find(|r| r.session_id == id.to_string())
        {
            row.ended_at = Some(chrono::Utc::now().to_rfc3339());
        }
        true
    }

    async fn list_for_vm(&self, vm_name: &str) -> Vec<SessionHistoryRow> {
        let hist = self.history.read().await;
        hist.iter()
            .rev()
            .filter(|r| r.vm_name == vm_name)
            .take(50)
            .cloned()
            .collect()
    }
}

fn guacamole_reachable(base_url: &str) -> bool {
    let trimmed = base_url.trim();
    let host_port = trimmed
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("127.0.0.1:8081");
    let addr = if host_port.contains(':') {
        host_port.to_string()
    } else {
        format!("{host_port}:8081")
    };
    std::net::TcpStream::connect_timeout(
        &addr
            .parse()
            .unwrap_or_else(|_| "127.0.0.1:8081".parse().unwrap()),
        Duration::from_millis(400),
    )
    .is_ok()
}

fn build_protocol_list(
    console_type: &str,
    guac_up: bool,
    vnc_port: i32,
    guest_ip: &str,
    os_hint: &str,
) -> Vec<String> {
    let mut out = vec!["novnc".into()];
    if console_type == "spice" {
        out.push("spice".into());
        out.push("webrtc_spice".into());
    }
    if guac_up {
        if vnc_port > 0 {
            out.push("guacamole_vnc".into());
        }
        if !guest_ip.is_empty() {
            out.push("guacamole_ssh".into());
            if os_hint == "windows" {
                out.push("guacamole_rdp".into());
            }
        }
    }
    out.push("serial".into());
    out
}

async fn build_plan(
    manager: &LibvirtManager,
    actor: &RequestActor,
    conn_q: ConnQuery,
    vm_name: &str,
) -> Result<ConsoleHubPlan, AppError> {
    let cfg = MachinaConfig::load();
    let name2 = vm_name.to_string();
    let conn_str = conn_q.connection.clone().unwrap_or_default();
    let (vnc_host, vnc_port, console_type, serial_available, guest_ip, os_hint) =
        spawn_libvirt_actor(manager.clone(), Some(actor), conn_q, move |conn| {
            let xml = machina_core::libvirt::domain::get_vm_xml(conn, &name2).unwrap_or_default();
            let has_spice = machina_core::libvirt::graphics_convert::domain_has_spice_graphics(&xml);
            let (vnc_host, vnc_port) = vnc::resolve_vnc_tcp_xml(conn, &name2, &xml).unwrap_or(("".into(), 0));
            let console_type = if vnc_port > 0 {
                "vnc".to_string()
            } else if has_spice {
                "spice".to_string()
            } else {
                "unknown".to_string()
            };
            let serial_available = machina_core::xml::extract_attr(&xml, "console", "tty")
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    for block in machina_core::xml::split_blocks(&xml, "console") {
                        if let Some(p) = machina_core::xml::extract_attr(&block, "source", "path") {
                            if !p.is_empty() {
                                return Some(p);
                            }
                        }
                    }
                    None
                })
                .is_some();
            let mut guest_ip = String::new();
            let mut os_hint = "unknown".to_string();
            if xml.to_lowercase().contains("microsoft windows")
                || xml.to_lowercase().contains("<os>windows")
            {
                os_hint = "windows".into();
            } else if !xml.is_empty() {
                os_hint = "linux".into();
            }
            if let Ok(health) = guest_health::gather_guest_health(conn, &name2) {
                if let Some(guest) = &health.guest {
                    guest_ip = guest
                        .ip_addresses
                        .iter()
                        .find(|a| a.ip_type == "ipv4" && !a.address.starts_with("127."))
                        .map(|a| a.address.clone())
                        .unwrap_or_default();
                }
                if let Some(ref pretty) = health.os_pretty_name {
                    let lower = pretty.to_lowercase();
                    if lower.contains("windows") {
                        os_hint = "windows".into();
                    } else if os_hint == "unknown" {
                        os_hint = "linux".into();
                    }
                }
            }
            Ok((vnc_host, vnc_port, console_type, serial_available, guest_ip, os_hint))
        })
        .await?;

    let guac_cfg = &cfg.guacamole;
    let guac_up = guac_cfg.enabled
        && !guac_cfg.json_secret_hex.trim().is_empty()
        && guacamole_reachable(&guac_cfg.base_url);
    let mut guac_protocols = Vec::new();
    if guac_up {
        if vnc_port > 0 {
            guac_protocols.push("vnc".into());
        }
        if !guest_ip.is_empty() {
            guac_protocols.push("ssh".into());
            if os_hint == "windows" {
                guac_protocols.push("rdp".into());
            }
        }
    }

    // Serial is always the last resort — only when no graphical display and no SSH/RDP alternative.
    let recommended = if os_hint == "windows" && !guest_ip.is_empty() && guac_up {
        "guacamole_rdp".into()
    } else if console_type == "spice" {
        "spice".into()
    } else if console_type == "vnc" && vnc_port > 0 {
        "novnc".into()
    } else if !guest_ip.is_empty() && guac_up {
        "guacamole_ssh".into()
    } else if serial_available {
        "serial".into()
    } else {
        "novnc".into()
    };

    let ssh_user = std::env::var("MACHINA_DEFAULT_SSH_USER").unwrap_or_else(|_| "ubuntu".into());
    let ws_suffix = if conn_str.is_empty() || conn_str == "system" {
        String::new()
    } else {
        format!("&connection={}", urlencoding_light(&conn_str))
    };
    let guest_ip_for_protocols = guest_ip.clone();
    let protocols = build_protocol_list(
        &console_type,
        guac_up,
        vnc_port as i32,
        &guest_ip_for_protocols,
        &os_hint,
    );

    Ok(ConsoleHubPlan {
        vm_name: vm_name.to_string(),
        recommended,
        native: NativeConsoleInfo {
            console_type: console_type.clone(),
            ws_path: format!(
                "/ws/v1/vnc/{}?token=__WS_TOKEN__{ws_suffix}",
                urlencoding_light(vm_name)
            ),
            serial_ws_path: format!(
                "/ws/v1/console/{}?token=__WS_TOKEN__{ws_suffix}",
                urlencoding_light(vm_name)
            ),
            available: vnc_port > 0,
        },
        guacamole: GuacamoleConsoleInfo {
            available: guac_up,
            protocols: guac_protocols,
        },
        guest_ip: if guest_ip.is_empty() {
            None
        } else {
            Some(guest_ip)
        },
        ssh_user: Some(ssh_user),
        os_hint,
        protocols,
        webrtc_spice_available: console_type == "spice",
    })
}

fn urlencoding_light(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

pub fn api_routes() -> Router<LibvirtManager> {
    Router::new()
        .route("/vms/{name}/consolehub/plan", get(consolehub_plan))
        .route(
            "/vms/{name}/consolehub/sessions",
            get(list_sessions).post(create_session),
        )
        .route("/consolehub/sessions/{session_id}/end", post(end_session))
}

pub fn proxy_routes() -> Router {
    Router::new()
        .route(
            "/consolehub/guacamole/{session_id}/websocket-tunnel",
            any(guac_ws_proxy),
        )
        .route(
            "/consolehub/guacamole/{session_id}",
            any(guac_http_proxy_root),
        )
        .route(
            "/consolehub/guacamole/{session_id}/",
            any(guac_http_proxy_root),
        )
        .route(
            "/consolehub/guacamole/{session_id}/{*path}",
            any(guac_http_proxy),
        )
}

async fn consolehub_plan(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Path(name): Path<String>,
    Query(conn_q): Query<ConnQuery>,
) -> Result<Json<ConsoleHubPlan>, AppError> {
    let _ = &actor;
    Ok(Json(build_plan(&manager, &actor, conn_q, &name).await?))
}

async fn list_sessions(
    Extension(store): Extension<ConsoleSessionStore>,
    Path(name): Path<String>,
) -> Json<Vec<SessionHistoryRow>> {
    Json(store.list_for_vm(&name).await)
}

fn check_oidc_for_console(actor: &RequestActor) -> Result<(), AppError> {
    let required = std::env::var("CONSOLEHUB_REQUIRE_OIDC")
        .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    if !required {
        return Ok(());
    }
    if actor.auth_source == AuthSource::Oidc {
        return Ok(());
    }
    Err(AppError::from(machina_core::LibvirtError::Forbidden(
        "ConsoleHub requires OIDC federation — sign in via SSO before opening a console.".into(),
    )))
}

async fn create_session(
    State(manager): State<LibvirtManager>,
    Extension(actor): Extension<RequestActor>,
    Extension(store): Extension<ConsoleSessionStore>,
    Path(name): Path<String>,
    Query(conn_q): Query<ConnQuery>,
    Json(body): Json<CreateSessionBody>,
) -> Result<Json<ConsoleSessionResponse>, AppError> {
    check_oidc_for_console(&actor)?;
    let plan = build_plan(&manager, &actor, conn_q.clone(), &name).await?;
    let protocol = body
        .protocol
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| plan.recommended.clone());

    let cfg = MachinaConfig::load();
    let ttl = Duration::from_secs(
        std::env::var("CONSOLEHUB_SESSION_TTL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(600),
    );
    let audit_id = Uuid::new_v4();
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(ttl.as_secs() as i64);

    let (backend, guac_token, emergency_url, guacamole_base) = if protocol.starts_with("guacamole_")
    {
        let guac = &cfg.guacamole;
        if !guac.enabled || guac.json_secret_hex.trim().is_empty() {
            return Err(AppError::from(machina_core::LibvirtError::Invalid(
                "Guacamole not configured — run scripts/install-guacamole.sh".into(),
            )));
        }
        let guest_ip = plan.guest_ip.clone().unwrap_or_default();
        let name2 = name.clone();
        let (vnc_host, vnc_port) =
            spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
                vnc::resolve_vnc_tcp(conn, &name2).map_err(machina_core::LibvirtError::from)
            })
            .await?;
        let target = guac_target_for_protocol(
            &protocol,
            &vnc_host,
            vnc_port,
            &guest_ip,
            plan.ssh_user.as_deref().unwrap_or("ubuntu"),
            body.rdp_username.as_deref(),
            body.rdp_domain.as_deref(),
        )?;
        let username_storage = guac.json_username.trim().to_string();
        let username_ref = if username_storage.is_empty() {
            "machina"
        } else {
            username_storage.as_str()
        };
        let public = guac.public_vnc_host.trim();
        let public_opt = if public.is_empty() {
            None
        } else {
            Some(public)
        };
        let params = GuacamoleBridgeParams {
            secret_hex: &guac.json_secret_hex,
            base_url: &guac.base_url,
            public_vnc_host: public_opt,
            fetch_token: guac.fetch_token,
            username: username_ref,
        };
        let bridge = bridge_from_plan(name.clone(), target, &params)
            .await
            .map_err(|e| machina_core::LibvirtError::Invalid(e.to_string()))?;
        let base = guac.base_url.trim_end_matches('/').to_string();
        let emergency = bridge
            .token
            .as_ref()
            .map(|t| format!("{base}/#/?token={}", urlencoding_light(t)));
        ("guacamole".to_string(), bridge.token, emergency, base)
    } else {
        ("native".to_string(), None, None, String::new())
    };

    let session_id = store
        .insert(LiveConsoleSession {
            vm_name: name.clone(),
            actor: actor.username.clone(),
            protocol: protocol.clone(),
            backend: backend.clone(),
            guac_token: guac_token.clone(),
            guacamole_base,
            emergency_url: emergency_url.clone(),
            expires: Instant::now() + ttl,
            audit_id,
        })
        .await;

    let token_q = guac_token
        .as_deref()
        .map(|t| format!("?token={}", urlencoding_light(t)))
        .unwrap_or_default();
    let embed_path = if backend == "guacamole" {
        // Must include a path segment — `{*path}` does not match `/session/?token=…` (SPA fallback → 404).
        format!("{PROXY_PREFIX}/{session_id}/index.html{token_q}")
    } else {
        format!(
            "/vms/{}/consolehub?session={session_id}&native=1",
            urlencoding_light(&name)
        )
    };

    Ok(Json(ConsoleSessionResponse {
        session_id: session_id.to_string(),
        vm_name: name,
        protocol,
        backend,
        embed_path,
        emergency_url,
        audit_id: audit_id.to_string(),
        expires_at: expires_at.to_rfc3339(),
    }))
}

fn guac_target_for_protocol(
    protocol: &str,
    vnc_host: &str,
    vnc_port: u16,
    guest_ip: &str,
    ssh_user: &str,
    rdp_user: Option<&str>,
    rdp_domain: Option<&str>,
) -> Result<GuacBridgeTarget, AppError> {
    match protocol {
        "guacamole_vnc" => {
            if vnc_port == 0 {
                return Err(AppError::from(machina_core::LibvirtError::Invalid(
                    "VNC not available".into(),
                )));
            }
            Ok(GuacBridgeTarget::Vnc {
                host: vnc_host.to_string(),
                port: vnc_port,
            })
        }
        "guacamole_rdp" => {
            if guest_ip.is_empty() {
                return Err(AppError::from(machina_core::LibvirtError::Invalid(
                    "guest IP required for RDP".into(),
                )));
            }
            Ok(GuacBridgeTarget::Rdp {
                host: guest_ip.to_string(),
                port: 3389,
                username: rdp_user.unwrap_or("Administrator").to_string(),
                domain: rdp_domain.unwrap_or("").to_string(),
            })
        }
        "guacamole_ssh" => {
            if guest_ip.is_empty() {
                return Err(AppError::from(machina_core::LibvirtError::Invalid(
                    "guest IP required for SSH".into(),
                )));
            }
            Ok(GuacBridgeTarget::Ssh {
                host: guest_ip.to_string(),
                port: 22,
                username: ssh_user.to_string(),
            })
        }
        other => Err(AppError::from(machina_core::LibvirtError::Invalid(
            format!("unsupported Guacamole protocol: {other}"),
        ))),
    }
}

async fn end_session(
    Extension(actor): Extension<RequestActor>,
    Extension(store): Extension<ConsoleSessionStore>,
    Path(session_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let ended = store.end(session_id, &actor.username).await;
    Ok(Json(serde_json::json!({
        "ended": ended,
        "session_id": session_id.to_string(),
    })))
}

async fn guac_http_proxy_root(
    Extension(store): Extension<ConsoleSessionStore>,
    Path(session_id): Path<Uuid>,
    req: Request<Body>,
) -> Result<Response, StatusCode> {
    guac_http_proxy_impl(store, session_id, String::new(), req).await
}

async fn guac_http_proxy(
    Extension(store): Extension<ConsoleSessionStore>,
    Path((session_id, path)): Path<(Uuid, String)>,
    req: Request<Body>,
) -> Result<Response, StatusCode> {
    guac_http_proxy_impl(store, session_id, path, req).await
}

async fn guac_http_proxy_impl(
    store: ConsoleSessionStore,
    session_id: Uuid,
    path: String,
    req: Request<Body>,
) -> Result<Response, StatusCode> {
    let session = store.get(session_id).await.ok_or(StatusCode::NOT_FOUND)?;
    let (parts, body) = req.into_parts();
    let path = path.trim_start_matches('/');
    let query = parts
        .uri
        .query()
        .map(|q| format!("?{q}"))
        .unwrap_or_default();
    let base = session.guacamole_base.trim_end_matches('/');
    let url = if path.is_empty() {
        format!("{base}/{query}")
    } else {
        format!("{base}/{path}{query}")
    };

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let method = parts.method.clone();
    let mut rb = client.request(method.clone(), &url);
    for (k, v) in parts.headers.iter() {
        let name = k.as_str();
        if matches!(
            name,
            "host" | "connection" | "transfer-encoding" | "upgrade" | "content-length"
        ) {
            continue;
        }
        if let Ok(s) = v.to_str() {
            rb = rb.header(name, s);
        }
    }

    let body_bytes = axum::body::to_bytes(body, 32 * 1024 * 1024)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    if method != Method::GET && method != Method::HEAD && !body_bytes.is_empty() {
        rb = rb.body(body_bytes.to_vec());
    }

    let resp = rb.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut out = Response::builder().status(status);
    let headers = out.headers_mut().ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    for (k, v) in resp.headers().iter() {
        let name = k.as_str();
        if matches!(
            name,
            "transfer-encoding" | "connection" | "content-encoding"
        ) {
            continue;
        }
        if let Ok(val) = HeaderValue::from_bytes(v.as_bytes()) {
            headers.insert(k, val);
        }
    }
    let bytes = resp.bytes().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    Ok(out.body(Body::from(bytes)).unwrap())
}

async fn guac_ws_proxy(
    Extension(store): Extension<ConsoleSessionStore>,
    Path(session_id): Path<Uuid>,
    ws: WebSocketUpgrade,
    req: Request<Body>,
) -> Result<impl IntoResponse, StatusCode> {
    let session = store.get(session_id).await.ok_or(StatusCode::NOT_FOUND)?;
    let query = req.uri().query().unwrap_or("").to_string();
    let ws_base = session
        .guacamole_base
        .replace("http://", "ws://")
        .replace("https://", "wss://")
        .trim_end_matches('/')
        .to_string();
    let target = if query.is_empty() {
        format!("{ws_base}/websocket-tunnel")
    } else {
        format!("{ws_base}/websocket-tunnel?{query}")
    };
    Ok(ws.on_upgrade(move |socket| proxy_guac_ws(socket, target)))
}

async fn proxy_guac_ws(client: WebSocket, target: String) {
    use tokio_tungstenite::{connect_async, tungstenite::Message as TsMessage};

    let upstream = match connect_async(&target).await {
        Ok((stream, _)) => stream,
        Err(_) => {
            let (mut sink, _) = client.split();
            let _ = sink.close().await;
            return;
        }
    };

    let (mut client_sink, mut client_stream) = client.split();
    let (mut up_sink, mut up_stream) = upstream.split();

    let c2u = tokio::spawn(async move {
        while let Some(Ok(msg)) = client_stream.next().await {
            let out = match msg {
                Message::Binary(b) => TsMessage::Binary(b.to_vec().into()),
                Message::Text(t) => TsMessage::Text(t.to_string().into()),
                Message::Ping(p) => TsMessage::Ping(p.into()),
                Message::Pong(p) => TsMessage::Pong(p.into()),
                Message::Close(c) => TsMessage::Close(c.map(|f| {
                    tokio_tungstenite::tungstenite::protocol::CloseFrame {
                        code: f.code.into(),
                        reason: f.reason.to_string().into(),
                    }
                })),
            };
            if up_sink.send(out).await.is_err() {
                break;
            }
        }
    });

    let u2c = tokio::spawn(async move {
        while let Some(Ok(msg)) = up_stream.next().await {
            let out = match msg {
                TsMessage::Binary(b) => Message::Binary(b.into()),
                TsMessage::Text(t) => Message::Text(t.to_string().into()),
                TsMessage::Ping(p) => Message::Ping(p.into()),
                TsMessage::Pong(p) => Message::Pong(p.into()),
                TsMessage::Close(_) => Message::Close(None),
                _ => continue,
            };
            if client_sink.send(out).await.is_err() {
                break;
            }
        }
    });

    tokio::select! {
        _ = c2u => {},
        _ = u2c => {},
    }
}

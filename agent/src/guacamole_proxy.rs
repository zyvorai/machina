// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Reverse-proxy Guacamole web UI on localhost for ConsoleHub (controller → agent → guacamole).

use std::time::Duration;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Request, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message as TsMessage};

#[derive(Clone)]
pub struct GuacamoleProxyState {
    pub upstream_base: String,
}

impl GuacamoleProxyState {
    pub fn from_env() -> Self {
        let upstream = std::env::var("GUACAMOLE_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8081/guacamole".into());
        Self {
            upstream_base: upstream.trim_end_matches('/').to_string(),
        }
    }
}

pub fn router(state: GuacamoleProxyState) -> Router {
    Router::new()
        .route("/guacamole-proxy/websocket-tunnel", any(guac_ws_tunnel))
        .route("/guacamole-proxy/{*path}", any(guac_http_proxy))
        .with_state(state)
}

fn guacamole_host_port(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    let host_port = trimmed
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("127.0.0.1:8081");
    if host_port.contains(':') {
        host_port.to_string()
    } else {
        format!("{host_port}:8081")
    }
}

pub fn guacamole_reachable() -> bool {
    let base = std::env::var("GUACAMOLE_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8081/guacamole".into());
    let addr = guacamole_host_port(&base);
    std::net::TcpStream::connect_timeout(
        &addr
            .parse()
            .unwrap_or_else(|_| "127.0.0.1:8081".parse().unwrap()),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// Guacamole HTTP port up **and** JSON API secret configured (matches daemon/controller session gates).
pub fn guacamole_configured() -> bool {
    if !guacamole_reachable() {
        return false;
    }
    std::env::var("GUACAMOLE_JSON_SECRET_HEX")
        .or_else(|_| std::env::var("MACHINA_GUACAMOLE_JSON_SECRET_HEX"))
        .map(|s| s.trim().len() >= 32)
        .unwrap_or(false)
}

async fn guac_http_proxy(
    State(st): State<GuacamoleProxyState>,
    Path(path): Path<String>,
    req: Request<Body>,
) -> Result<Response, StatusCode> {
    let (parts, body) = req.into_parts();
    let path = path.trim_start_matches('/');
    let query = parts
        .uri
        .query()
        .map(|q| format!("?{q}"))
        .unwrap_or_default();
    let url = if path.is_empty() {
        format!("{}/{query}", st.upstream_base)
    } else {
        format!("{}/{path}{query}", st.upstream_base)
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

async fn guac_ws_tunnel(
    State(st): State<GuacamoleProxyState>,
    ws: WebSocketUpgrade,
    req: Request<Body>,
) -> impl IntoResponse {
    let query = req.uri().query().unwrap_or("").to_string();
    let ws_url = st
        .upstream_base
        .replace("http://", "ws://")
        .replace("https://", "wss://");
    let target = if query.is_empty() {
        format!("{ws_url}/websocket-tunnel")
    } else {
        format!("{ws_url}/websocket-tunnel?{query}")
    };
    ws.on_upgrade(move |socket| proxy_ws(socket, target))
}

async fn proxy_ws(client: WebSocket, target: String) {
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

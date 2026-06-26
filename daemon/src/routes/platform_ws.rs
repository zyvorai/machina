// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Same-origin WebSocket proxy to machina-controller platform VNC/serial (controller validates ?token=).

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use machina_core::LibvirtManager;
use serde::Deserialize;
use tokio_tungstenite::{connect_async, tungstenite::Message as TsMessage};

use super::platform_controller::controller_base;

#[derive(Debug, Deserialize)]
struct PlatformWsQuery {
    token: String,
}

fn controller_ws_base() -> String {
    let base = controller_base();
    if base.starts_with("https://") {
        base.replacen("https://", "wss://", 1)
    } else {
        base.replacen("http://", "ws://", 1)
    }
}

async fn relay_platform_ws(socket: WebSocket, upstream_path: String, token: String) {
    let url = format!("{upstream_path}?token={token}");

    let upstream = match connect_async(&url).await {
        Ok((stream, _)) => stream,
        Err(_) => {
            let (mut sink, _) = socket.split();
            let _ = sink.close().await;
            return;
        }
    };

    let (mut client_sink, mut client_stream) = socket.split();
    let (mut upstream_sink, mut upstream_stream) = upstream.split();

    let c2u = tokio::spawn(async move {
        while let Some(Ok(msg)) = client_stream.next().await {
            let up = match msg {
                Message::Binary(b) => TsMessage::Binary(b.to_vec()),
                Message::Text(t) => TsMessage::Text(t.to_string().into()),
                Message::Close(_) => {
                    let _ = upstream_sink.send(TsMessage::Close(None)).await;
                    break;
                }
                _ => continue,
            };
            if upstream_sink.send(up).await.is_err() {
                break;
            }
        }
    });

    let u2c = tokio::spawn(async move {
        while let Some(Ok(msg)) = upstream_stream.next().await {
            let down = match msg {
                TsMessage::Binary(b) => Message::Binary(b.into()),
                TsMessage::Text(t) => Message::Text(t.to_string().into()),
                TsMessage::Close(_) => {
                    let _ = client_sink.send(Message::Close(None)).await;
                    break;
                }
                _ => continue,
            };
            if client_sink.send(down).await.is_err() {
                break;
            }
        }
    });

    tokio::select! {
        _ = c2u => {},
        _ = u2c => {},
    }
}

async fn platform_vnc_ws_proxy(
    ws: WebSocketUpgrade,
    Path(vm_id): Path<String>,
    Query(q): Query<PlatformWsQuery>,
) -> impl IntoResponse {
    let path = format!("{}/ws/v1/platform/vnc/{vm_id}", controller_ws_base());
    ws.on_upgrade(move |socket| relay_platform_ws(socket, path, q.token))
}

async fn platform_serial_ws_proxy(
    ws: WebSocketUpgrade,
    Path(vm_id): Path<String>,
    Query(q): Query<PlatformWsQuery>,
) -> impl IntoResponse {
    let path = format!("{}/ws/v1/platform/serial/{vm_id}", controller_ws_base());
    ws.on_upgrade(move |socket| relay_platform_ws(socket, path, q.token))
}

async fn platform_spice_ws_proxy(
    ws: WebSocketUpgrade,
    Path(vm_id): Path<String>,
    Query(q): Query<PlatformWsQuery>,
) -> impl IntoResponse {
    let path = format!("{}/ws/v1/platform/spice/{vm_id}", controller_ws_base());
    ws.on_upgrade(move |socket| relay_platform_ws(socket, path, q.token))
}

pub fn platform_ws_routes() -> Router<LibvirtManager> {
    Router::new()
        .route("/platform/vnc/{vm_id}", get(platform_vnc_ws_proxy))
        .route("/platform/serial/{vm_id}", get(platform_serial_ws_proxy))
        .route("/platform/spice/{vm_id}", get(platform_spice_ws_proxy))
}

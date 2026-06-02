// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Same-origin WebSocket proxy to machina-controller platform VNC (controller validates ?token=).

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
struct PlatformVncQuery {
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

async fn platform_vnc_ws_proxy(
    ws: WebSocketUpgrade,
    Path(vm_id): Path<String>,
    Query(q): Query<PlatformVncQuery>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| proxy_platform_vnc(socket, vm_id, q.token))
}

async fn proxy_platform_vnc(socket: WebSocket, vm_id: String, token: String) {
    let url = format!(
        "{}/ws/v1/platform/vnc/{vm_id}?token={token}",
        controller_ws_base()
    );

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
            match msg {
                Message::Binary(b) => {
                    if upstream_sink.send(TsMessage::Binary(b.to_vec())).await.is_err() {
                        break;
                    }
                }
                Message::Close(_) => {
                    let _ = upstream_sink.send(TsMessage::Close(None)).await;
                    break;
                }
                _ => {}
            }
        }
    });

    let u2c = tokio::spawn(async move {
        while let Some(Ok(msg)) = upstream_stream.next().await {
            match msg {
                TsMessage::Binary(b) => {
                    if client_sink.send(Message::Binary(b.into())).await.is_err() {
                        break;
                    }
                }
                TsMessage::Close(_) => {
                    let _ = client_sink.send(Message::Close(None)).await;
                    break;
                }
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = c2u => {},
        _ = u2c => {},
    }
}

pub fn platform_ws_routes() -> Router<LibvirtManager> {
    Router::new().route("/platform/vnc/{vm_id}", get(platform_vnc_ws_proxy))
}

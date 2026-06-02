// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::net::SocketAddr;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use std::sync::{Arc, Mutex};

use crate::libvirt_ops::LibvirtCtx;

#[derive(Clone)]
pub struct ConsoleProxyState {
    pub libvirt: Arc<Mutex<LibvirtCtx>>,
    pub secret: String,
}

pub fn router(state: ConsoleProxyState) -> Router {
    Router::new()
        .route("/ws/vnc/{name}", get(vnc_ws))
        .with_state(state)
}

async fn vnc_ws(
    ws: WebSocketUpgrade,
    State(st): State<ConsoleProxyState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let libvirt = st.libvirt.clone();
    ws.on_upgrade(move |socket| handle_vnc(socket, name, libvirt))
}

async fn handle_vnc(socket: WebSocket, name: String, libvirt: Arc<Mutex<LibvirtCtx>>) {
    let resolved = tokio::task::spawn_blocking(move || {
        let ctx = libvirt
            .lock()
            .map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
        ctx.resolve_vnc(&name)
    })
    .await;

    let (host, port) = match resolved {
        Ok(Ok((h, p))) if p > 0 => (h, p),
        _ => {
            let (mut sink, _) = socket.split();
            let _ = sink.close().await;
            return;
        }
    };

    let tcp = match tokio::net::TcpStream::connect(format!("{host}:{port}")).await {
        Ok(s) => s,
        Err(_) => {
            let (mut sink, _) = socket.split();
            let _ = sink.close().await;
            return;
        }
    };
    let _ = tcp.set_nodelay(true);

    let (mut tcp_read, mut tcp_write) = tcp.into_split();
    let (mut ws_sink, mut ws_stream) = socket.split();

    let read_task = tokio::spawn(async move {
        let mut buf = [0u8; 65536];
        loop {
            match tcp_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if ws_sink
                        .send(Message::Binary(buf[..n].to_vec().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let write_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Binary(data) => {
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Message::Text(text) => {
                    if tcp_write.write_all(text.as_bytes()).await.is_err() {
                        break;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = read_task => {},
        _ = write_task => {},
    }
}

pub async fn serve(listen: SocketAddr, state: ConsoleProxyState) -> anyhow::Result<()> {
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(listen).await?;
    tracing::info!("machina-agent console proxy on {listen}");
    axum::serve(listener, app).await?;
    Ok(())
}

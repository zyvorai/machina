// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::sync::{Arc, Mutex};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::guacamole_proxy::GuacamoleProxyState;
use crate::libvirt_ops::LibvirtCtx;

#[derive(Clone)]
pub struct ConsoleProxyState {
    pub libvirt: Arc<Mutex<LibvirtCtx>>,
    pub secret: String,
    pub guacamole: GuacamoleProxyState,
}

pub fn vnc_router(state: ConsoleProxyState) -> Router {
    Router::new()
        .route("/ws/vnc/{name}", get(vnc_ws))
        .route("/ws/spice/{name}", get(spice_ws))
        .route("/ws/serial/{name}", get(serial_ws))
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

async fn serial_ws(
    ws: WebSocketUpgrade,
    State(st): State<ConsoleProxyState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let libvirt = st.libvirt.clone();
    ws.on_upgrade(move |socket| handle_serial(socket, name, libvirt))
}

async fn spice_ws(
    ws: WebSocketUpgrade,
    State(st): State<ConsoleProxyState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let libvirt = st.libvirt.clone();
    ws.on_upgrade(move |socket| handle_spice(socket, name, libvirt))
}

fn resolve_console_pty(xml: &str) -> Option<String> {
    machina_core::xml::extract_attr(xml, "console", "tty")
        .filter(|s| !s.is_empty())
        .or_else(|| {
            for block in machina_core::xml::split_blocks(xml, "console") {
                if let Some(p) = machina_core::xml::extract_attr(&block, "source", "path") {
                    if !p.is_empty() {
                        return Some(p);
                    }
                }
            }
            None
        })
}

async fn handle_vnc(socket: WebSocket, name: String, libvirt: Arc<Mutex<LibvirtCtx>>) {
    let resolved = tokio::task::spawn_blocking(move || {
        let mut ctx = libvirt
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

    let read_abort = read_task.abort_handle();
    let write_abort = write_task.abort_handle();
    tokio::select! {
        _ = read_task => { write_abort.abort(); },
        _ = write_task => { read_abort.abort(); },
    }
}

async fn handle_serial(socket: WebSocket, name: String, libvirt: Arc<Mutex<LibvirtCtx>>) {
    let display_name = name.clone();
    let pty_path = tokio::task::spawn_blocking(move || {
        let ctx = libvirt
            .lock()
            .map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
        let xml = ctx.get_domain_xml(&name)?;
        resolve_console_pty(&xml).ok_or_else(|| {
            machina_core::LibvirtError::Operation(format!("no serial PTY for VM '{name}'"))
        })
    })
    .await;

    let pty_path = match pty_path {
        Ok(Ok(p)) => p,
        _ => {
            let (mut sink, _) = socket.split();
            let _ = sink
                .send(Message::Text(
                    format!("\r\nNo console PTY found for VM '{display_name}'. Is it running?\r\n")
                        .into(),
                ))
                .await;
            let _ = sink.close().await;
            return;
        }
    };

    let pty = match std::fs::canonicalize(&pty_path) {
        Ok(canonical) if canonical.starts_with("/dev/pts/") => {
            canonical.to_string_lossy().to_string()
        }
        Ok(canonical) => {
            let (mut sink, _) = socket.split();
            let _ = sink
                .send(Message::Text(
                    format!(
                        "\r\nInvalid PTY path '{}' resolved to '{}'\r\n",
                        pty_path,
                        canonical.display()
                    )
                    .into(),
                ))
                .await;
            return;
        }
        Err(e) => {
            let (mut sink, _) = socket.split();
            let _ = sink
                .send(Message::Text(
                    format!("\r\nFailed to open console PTY '{pty_path}': {e}\r\n").into(),
                ))
                .await;
            return;
        }
    };

    let pty_file = match tokio::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&pty)
        .await
    {
        Ok(f) => f,
        Err(e) => {
            let (mut sink, _) = socket.split();
            let _ = sink
                .send(Message::Text(
                    format!("\r\nFailed to open console PTY: {e}\r\n").into(),
                ))
                .await;
            return;
        }
    };

    let (mut pty_read, mut pty_write) = tokio::io::split(pty_file);
    // Wake idle getty/login prompts so the first browser frame is not a blank canvas.
    let _ = pty_write.write_all(b"\r").await;

    let (mut ws_sink, mut ws_stream) = socket.split();

    let read_task = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match pty_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if ws_sink.send(Message::Text(text.into())).await.is_err() {
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
                Message::Text(text) => {
                    if pty_write.write_all(text.as_bytes()).await.is_err() {
                        break;
                    }
                }
                Message::Binary(data) => {
                    if pty_write.write_all(&data).await.is_err() {
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

fn resolve_spice_endpoint(xml: &str) -> Option<(String, u16)> {
    for block in machina_core::xml::split_blocks(xml, "graphics") {
        if machina_core::xml::extract_attr(&block, "graphics", "type").as_deref() != Some("spice") {
            continue;
        }
        let port: i32 = machina_core::xml::extract_attr(&block, "graphics", "port")
            .and_then(|p| p.parse().ok())
            .unwrap_or(0);
        if port <= 0 {
            continue;
        }
        let port = u16::try_from(port).ok()?;
        let listen = machina_core::xml::extract_attr(&block, "graphics", "listen")
            .or_else(|| machina_core::xml::extract_attr(&block, "listen", "address"))
            .unwrap_or_default();
        let host = match listen.trim() {
            "" | "0.0.0.0" | "::" | "[::]" => "127.0.0.1".to_string(),
            h => h.to_string(),
        };
        return Some((host, port));
    }
    None
}

async fn handle_spice(socket: WebSocket, name: String, libvirt: Arc<Mutex<LibvirtCtx>>) {
    let endpoint = tokio::task::spawn_blocking(move || {
        let ctx = libvirt
            .lock()
            .map_err(|e| machina_core::LibvirtError::Internal(e.to_string()))?;
        let xml = ctx.get_domain_xml(&name)?;
        resolve_spice_endpoint(&xml)
            .ok_or_else(|| machina_core::LibvirtError::Operation(format!("no SPICE port for VM '{name}'")))
    })
    .await;

    let (host, port) = match endpoint {
        Ok(Ok(ep)) => ep,
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

    let read_abort = read_task.abort_handle();
    let write_abort = write_task.abort_handle();
    tokio::select! {
        _ = read_task => { write_abort.abort(); },
        _ = write_task => { read_abort.abort(); },
    }
}

pub fn router(state: ConsoleProxyState) -> Router {
    let vnc = vnc_router(state.clone());
    let guac = crate::guacamole_proxy::router(state.guacamole);
    vnc.merge(guac)
}

pub async fn serve(listen: std::net::SocketAddr, state: ConsoleProxyState) -> anyhow::Result<()> {
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(listen).await?;
    tracing::info!("machina-agent console + guacamole proxy on {listen}");
    axum::serve(listener, app).await?;
    Ok(())
}

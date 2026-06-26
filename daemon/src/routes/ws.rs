// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use machina_core::libvirt::domain;
use machina_core::{LibvirtManager, SshTerminalConfig};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::auth::RequestActor;
use crate::vm_watch::VmWatchCoordinator;
use crate::conn_query::{spawn_libvirt_actor, ConnQuery};
use crate::kubevirt_k8s_ws_proxy;
use crate::terminal::{run_ssh_terminal, TerminalSessionStore};

// ── KubeVirt (cluster) VNC / serial console via kubectl proxy ───────

async fn kubevirt_vnc_ws_handler(
    ws: WebSocketUpgrade,
    Path((namespace, name)): Path<(String, String)>,
) -> impl IntoResponse {
    if !kubevirt_k8s_ws_proxy::validate_k8s_name(&namespace)
        || !kubevirt_k8s_ws_proxy::validate_k8s_name(&name)
    {
        return (StatusCode::BAD_REQUEST, "invalid namespace or VM name").into_response();
    }
    ws.on_upgrade(move |socket| {
        kubevirt_k8s_ws_proxy::proxy_kubevirt_ws(socket, namespace, name, "vnc")
    })
}

async fn kubevirt_console_ws_handler(
    ws: WebSocketUpgrade,
    Path((namespace, name)): Path<(String, String)>,
) -> impl IntoResponse {
    if !kubevirt_k8s_ws_proxy::validate_k8s_name(&namespace)
        || !kubevirt_k8s_ws_proxy::validate_k8s_name(&name)
    {
        return (StatusCode::BAD_REQUEST, "invalid namespace or VM name").into_response();
    }
    ws.on_upgrade(move |socket| {
        kubevirt_k8s_ws_proxy::proxy_kubevirt_ws(socket, namespace, name, "console")
    })
}

// ── VM state watch WebSocket ────────────────────────────────────────

async fn ws_handler(
    ws: WebSocketUpgrade,
    Extension(watch): Extension<VmWatchCoordinator>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_watch_socket(socket, watch))
}

async fn handle_watch_socket(mut socket: WebSocket, watch: VmWatchCoordinator) {
    info!(
        "WebSocket watch client connected ({} subscribers)",
        watch.subscriber_count()
    );
    let mut rx = watch.subscribe();

    loop {
        let payload = match rx.recv().await {
            Ok(msg) => msg,
            Err(broadcast::error::RecvError::Lagged(_)) => {
                serde_json::json!({ "event": "heartbeat", "vm_count": 0 }).to_string()
            }
            Err(broadcast::error::RecvError::Closed) => break,
        };

        if socket
            .send(Message::Text(payload.into()))
            .await
            .is_err()
        {
            info!("WebSocket watch client disconnected");
            break;
        }
    }
}

// ── Serial console WebSocket ────────────────────────────────────────

async fn console_handler(
    ws: WebSocketUpgrade,
    Extension(actor): Extension<RequestActor>,
    Path(name): Path<String>,
    Query(conn_q): Query<ConnQuery>,
    State(manager): State<LibvirtManager>,
) -> impl IntoResponse {
    let name_xml = name.clone();
    let pty_path = match spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        let xml = domain::get_vm_xml(conn, &name_xml)?;
        let path = machina_core::xml::extract_attr(&xml, "console", "tty")
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
            });
        Ok(path)
    })
    .await
    {
        Ok(path) => path,
        Err(_) => {
            warn!("Failed to get console info for VM '{}'", name);
            None
        }
    };

    ws.on_upgrade(move |socket| handle_console(socket, name, pty_path))
}

async fn handle_console(socket: WebSocket, name: String, pty_path: Option<String>) {
    info!("Console WebSocket connected for VM '{}'", name);

    let pty = match pty_path {
        Some(ref p) => match std::fs::canonicalize(p) {
            Ok(canonical) if canonical.starts_with("/dev/pts/") => {
                canonical.to_string_lossy().to_string()
            }
            Ok(canonical) => {
                warn!(
                    "PTY path '{}' resolved to '{}' which is outside /dev/pts/",
                    p,
                    canonical.display()
                );
                let (mut sink, _) = socket.split();
                let _ = sink
                    .send(Message::Text(
                        format!("\r\nInvalid PTY path for VM '{}'\r\n", name).into(),
                    ))
                    .await;
                return;
            }
            Err(_) => {
                let (mut sink, _) = socket.split();
                let _ = sink
                    .send(Message::Text(
                        format!(
                            "\r\nNo console PTY found for VM '{}'. Is it running?\r\n",
                            name
                        )
                        .into(),
                    ))
                    .await;
                return;
            }
        },
        _ => {
            let (mut sink, _) = socket.split();
            let _ = sink
                .send(Message::Text(
                    format!(
                        "\r\nNo console PTY found for VM '{}'. Is it running?\r\n",
                        name
                    )
                    .into(),
                ))
                .await;
            return;
        }
    };

    // CRITICAL: Open PTY directly with tokio — do NOT use socat or any external process.
    // socat's OPEN: mode fails on PTY devices (/dev/pts/N). Direct async file I/O is the
    // only approach that works reliably for bidirectional serial console over WebSocket.
    // Do NOT change this to socat, Command::new, or any other process-based approach.
    let pty_file = match tokio::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&pty)
        .await
    {
        Ok(f) => f,
        Err(e) => {
            warn!("Failed to open PTY {}: {}", pty, e);
            let (mut sink, _) = socket.split();
            let _ = sink
                .send(Message::Text(
                    format!("\r\nFailed to open console PTY: {}\r\n", e).into(),
                ))
                .await;
            return;
        }
    };

    let (mut pty_read, mut pty_write) = tokio::io::split(pty_file);
    let (mut ws_sink, mut ws_stream) = socket.split();

    // PTY → WebSocket
    let mut read_task = tokio::spawn(async move {
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

    // WebSocket → PTY
    let console_name = name.clone();
    let mut write_task = tokio::spawn(async move {
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
                Message::Ping(_) | Message::Pong(_) => { /* axum handles pong automatically */ }
                Message::Close(_) => break,
            }
        }
    });

    tokio::select! {
        _ = &mut read_task => { write_task.abort(); }
        _ = &mut write_task => { read_task.abort(); }
    }

    info!("Console WebSocket closed for VM '{}'", console_name);
}

// ── VNC WebSocket proxy ─────────────────────────────────────────────

async fn vnc_handler(
    ws: WebSocketUpgrade,
    Extension(actor): Extension<RequestActor>,
    Path(name): Path<String>,
    Query(conn_q): Query<ConnQuery>,
    State(manager): State<LibvirtManager>,
) -> impl IntoResponse {
    let name2 = name.clone();
    let resolved = spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        machina_core::libvirt::vnc::resolve_vnc_tcp(conn, &name2)
    })
    .await;

    let (host, port) = match resolved {
        Ok((h, p)) if p > 0 => (h, p),
        Ok(_) => {
            return (StatusCode::NOT_FOUND, "No VNC display for this VM").into_response();
        }
        Err(_) => {
            warn!("VNC resolve failed for VM '{}'", name);
            return (StatusCode::NOT_FOUND, "No VNC display for this VM").into_response();
        }
    };

    ws.on_upgrade(move |socket| handle_vnc_proxy(socket, name, host, port))
}

async fn handle_vnc_proxy(socket: WebSocket, name: String, host: String, port: u16) {
    info!(
        "VNC WebSocket proxy connecting to {}:{} for VM '{}'",
        host, port, name
    );

    let tcp = match tokio::net::TcpStream::connect(format!("{}:{}", host, port)).await {
        Ok(s) => s,
        Err(e) => {
            warn!("Failed to connect to VNC port {}: {}", port, e);
            let (mut sink, _) = socket.split();
            let _ = sink.close().await;
            return;
        }
    };

    if let Err(e) = tcp.set_nodelay(true) {
        warn!(
            "VNC TCP set_nodelay failed for {}:{} VM '{}': {}",
            host, port, name, e
        );
    }

    info!("VNC TCP connected to {}:{} for VM '{}'", host, port, name);

    let (mut tcp_read, mut tcp_write) = tcp.into_split();
    let (mut ws_sink, mut ws_stream) = socket.split();

    // TCP → WebSocket (binary frames)
    let mut read_task = tokio::spawn(async move {
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

    // WebSocket → TCP
    let mut write_task = tokio::spawn(async move {
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
                Message::Ping(_) | Message::Pong(_) => { /* axum handles pong automatically */ }
                Message::Close(_) => break,
            }
        }
    });

    tokio::select! {
        _ = &mut read_task => { write_task.abort(); }
        _ = &mut write_task => { read_task.abort(); }
    }

    info!("VNC WebSocket proxy closed for VM '{}' port {}", name, port);
}

// ── RDP WebSocket proxy (TCP 3389, binary frames — use with built-in client or external) ──

async fn rdp_handler(
    ws: WebSocketUpgrade,
    Extension(actor): Extension<RequestActor>,
    Path(name): Path<String>,
    Query(conn_q): Query<ConnQuery>,
    State(manager): State<LibvirtManager>,
) -> impl IntoResponse {
    let name2 = name.clone();
    let resolved = spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        machina_core::libvirt::rdp::resolve_rdp_endpoint(conn, &name2)
    })
    .await;

    let (host, port) = match resolved {
        Ok((h, p)) if p > 0 => (h, p),
        Ok(_) => {
            return (StatusCode::NOT_FOUND, "No RDP endpoint for this VM").into_response();
        }
        Err(_) => {
            warn!("RDP resolve failed for VM '{}'", name);
            return (StatusCode::NOT_FOUND, "No RDP endpoint for this VM").into_response();
        }
    };

    ws.on_upgrade(move |socket| handle_rdp_proxy(socket, name, host, port))
}

async fn handle_rdp_proxy(socket: WebSocket, name: String, host: String, port: u16) {
    info!(
        "RDP WebSocket proxy connecting to {}:{} for VM '{}'",
        host, port, name
    );

    let tcp = match tokio::net::TcpStream::connect(format!("{}:{}", host, port)).await {
        Ok(s) => s,
        Err(e) => {
            warn!("Failed to connect to RDP {}:{}: {}", host, port, e);
            let (mut sink, _) = socket.split();
            let _ = sink.close().await;
            return;
        }
    };

    if let Err(e) = tcp.set_nodelay(true) {
        warn!(
            "RDP TCP set_nodelay failed for {}:{} VM '{}': {}",
            host, port, name, e
        );
    }

    let (mut tcp_read, mut tcp_write) = tcp.into_split();
    let (mut ws_sink, mut ws_stream) = socket.split();

    let mut read_task = tokio::spawn(async move {
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

    let mut write_task = tokio::spawn(async move {
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
                Message::Ping(_) | Message::Pong(_) => {}
                Message::Close(_) => break,
            }
        }
    });

    tokio::select! {
        _ = &mut read_task => { write_task.abort(); }
        _ = &mut write_task => { read_task.abort(); }
    }

    info!("RDP WebSocket proxy closed for VM '{}' port {}", name, port);
}

// ── SPICE WebSocket proxy ──────────────────────────────────────────

async fn spice_handler(
    ws: WebSocketUpgrade,
    Extension(actor): Extension<RequestActor>,
    Path(name): Path<String>,
    Query(conn_q): Query<ConnQuery>,
    State(manager): State<LibvirtManager>,
) -> impl IntoResponse {
    let name2 = name.clone();
    let port = match spawn_libvirt_actor(manager, Some(&actor), conn_q, move |conn| {
        let xml = domain::get_vm_xml(conn, &name2)?;
        let mut port = 0u16;
        for block in machina_core::xml::split_blocks(&xml, "graphics") {
            let gtype =
                machina_core::xml::extract_attr(&block, "graphics", "type").unwrap_or_default();
            if gtype == "spice" {
                port = machina_core::xml::extract_attr(&block, "graphics", "port")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                break;
            }
        }
        Ok(port)
    })
    .await
    {
        Ok(p) => p,
        Err(_) => {
            warn!("SPICE port lookup failed for VM '{}'", name);
            0u16
        }
    };

    ws.on_upgrade(move |socket| handle_spice_proxy(socket, name, port))
}

async fn handle_spice_proxy(socket: WebSocket, name: String, port: u16) {
    if port == 0 {
        info!("SPICE: no port for VM '{}'", name);
        let (mut sink, _) = socket.split();
        let _ = sink.close().await;
        return;
    }

    info!(
        "SPICE WebSocket proxy connecting to 127.0.0.1:{} for VM '{}'",
        port, name
    );

    let tcp = match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await {
        Ok(s) => s,
        Err(e) => {
            warn!("Failed to connect to SPICE port {}: {}", port, e);
            let (mut sink, _) = socket.split();
            let _ = sink.close().await;
            return;
        }
    };

    if let Err(e) = tcp.set_nodelay(true) {
        warn!(
            "SPICE TCP set_nodelay failed for port {} VM '{}': {}",
            port, name, e
        );
    }

    info!("SPICE TCP connected to port {} for VM '{}'", port, name);

    let (mut tcp_read, mut tcp_write) = tcp.into_split();
    let (mut ws_sink, mut ws_stream) = socket.split();

    let mut read_task = tokio::spawn(async move {
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

    let mut write_task = tokio::spawn(async move {
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
                Message::Ping(_) | Message::Pong(_) => {}
                Message::Close(_) => break,
            }
        }
    });

    tokio::select! {
        _ = &mut read_task => { write_task.abort(); }
        _ = &mut write_task => { read_task.abort(); }
    }

    info!(
        "SPICE WebSocket proxy closed for VM '{}' port {}",
        name, port
    );
}

// ── SSH WebSocket proxy (legacy raw I/O) ───────────────────────────

async fn ssh_handler(
    ws: WebSocketUpgrade,
    Path(host): Path<String>,
    Extension(cfg): Extension<SshTerminalConfig>,
) -> impl IntoResponse {
    if !cfg.legacy_plain_host_websocket {
        return (
            StatusCode::NOT_FOUND,
            "Legacy SSH WebSocket disabled. Use POST /api/v1/terminal/sessions then wss://…/ws/v1/terminal/{session_id}?token=…",
        )
            .into_response();
    }
    ws.on_upgrade(move |socket| handle_ssh_proxy(socket, host))
}

// ── SSH terminal (session id + JSON control, PTY + ssh) ─────────────

async fn invalid_terminal_session(socket: WebSocket) {
    let (mut tx, _) = socket.split();
    let _ = tx
        .send(Message::Text(
            r#"{"type":"error","message":"invalid or expired session"}"#.into(),
        ))
        .await;
}

async fn terminal_ws_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    Extension(store): Extension<TerminalSessionStore>,
    Extension(cfg): Extension<SshTerminalConfig>,
) -> impl IntoResponse {
    let ttl = std::time::Duration::from_secs(cfg.session_ttl_secs.clamp(30, 3600));
    match store.take(&session_id, ttl) {
        Some(session) => ws.on_upgrade(move |socket| run_ssh_terminal(socket, session)),
        None => ws.on_upgrade(invalid_terminal_session),
    }
}

async fn handle_ssh_proxy(socket: WebSocket, host: String) {
    // Validate host: must be a hostname or IP, no path traversal or injection
    if host.is_empty()
        || host.contains('/')
        || host.contains('\\')
        || host.contains(' ')
        || host.contains('\0')
        || host.contains(';')
        || host.contains('|')
        || host.contains('&')
    {
        info!("SSH: invalid host '{}'", host);
        let (mut sink, _) = socket.split();
        let _ = sink.close().await;
        return;
    }

    info!("SSH WebSocket spawning ssh process to {}", host);

    // Spawn ssh via 'script' to allocate a PTY (ssh requires a PTY for interactive login)
    // script -qfc "ssh ..." /dev/null allocates a PTY and runs the command
    let mut child = match tokio::process::Command::new("script")
        .args([
            "-qfc",
            &format!("ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR {host}"),
            "/dev/null",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("Failed to spawn ssh to {}: {}", host, e);
            let (mut sink, _) = socket.split();
            let _ = sink
                .send(Message::Text(
                    format!("\r\nFailed to start SSH to {}: {}\r\n", host, e).into(),
                ))
                .await;
            let _ = sink.close().await;
            return;
        }
    };

    let mut stdin = match child.stdin.take() {
        Some(s) => s,
        None => {
            let (mut sink, _) = socket.split();
            let _ = sink
                .send(Message::Text("\r\nFailed to get SSH stdin\r\n".into()))
                .await;
            return;
        }
    };

    let mut stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let (mut sink, _) = socket.split();
            let _ = sink
                .send(Message::Text("\r\nFailed to get SSH stdout\r\n".into()))
                .await;
            return;
        }
    };

    let (mut ws_sink, mut ws_stream) = socket.split();

    // SSH stdout → WebSocket
    let mut read_task = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match stdout.read(&mut buf).await {
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

    // WebSocket → SSH stdin
    let ssh_host = host.clone();
    let mut write_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            match msg {
                Message::Text(text) => {
                    if stdin.write_all(text.as_bytes()).await.is_err() {
                        break;
                    }
                }
                Message::Binary(data) => {
                    if stdin.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Message::Ping(_) | Message::Pong(_) => {}
                Message::Close(_) => break,
            }
        }
    });

    tokio::select! {
        _ = &mut read_task => { write_task.abort(); }
        _ = &mut write_task => { read_task.abort(); }
    }

    // Kill ssh process
    let _ = child.kill().await;

    info!("SSH WebSocket closed for host '{}'", ssh_host);
}

// ── Routes ──────────────────────────────────────────────────────────

pub fn ws_routes() -> Router<LibvirtManager> {
    Router::new()
        .route("/watch", get(ws_handler))
        .route(
            "/k8s-kubevirt/{namespace}/{name}/vnc",
            get(kubevirt_vnc_ws_handler),
        )
        .route(
            "/k8s-kubevirt/{namespace}/{name}/console",
            get(kubevirt_console_ws_handler),
        )
        .route("/console/{name}", get(console_handler))
        .route("/vnc/{name}", get(vnc_handler))
        .route("/rdp/{name}", get(rdp_handler))
        .route("/spice/{name}", get(spice_handler))
        .route("/terminal/{session_id}", get(terminal_ws_handler))
        .route("/ssh/{host}", get(ssh_handler))
}

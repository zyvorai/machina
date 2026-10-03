// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};

use clap::{Parser, Subcommand};
use machina_agent::console_ws::{self, ConsoleProxyState};
use machina_agent::grpc::AgentService;
use machina_agent::libvirt_ops::LibvirtCtx;
use machina_agent::pb::host_agent_server::HostAgentServer;
use machina_agent::state::shared_state;
use tonic::transport::{Identity, Server, ServerTlsConfig};
use tracing::info;

#[derive(Parser)]
#[command(
    name = "machina-agent",
    about = "Machina host agent (libvirt executor)"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    #[arg(long, default_value = "127.0.0.1:50051")]
    listen: String,
    #[arg(long, default_value = "127.0.0.1:50052")]
    console_listen: String,
    #[arg(long, env = "MACHINA_LIBVIRT_URI", default_value = "qemu:///system")]
    libvirt_uri: String,
    #[arg(long, env = "MACHINA_AGENT_HOSTNAME")]
    hostname: Option<String>,
}

#[derive(Subcommand)]
enum Command {
    /// Register with controller and run gRPC + console proxy (default).
    Serve,
    /// Join a controller cluster using an enrollment token.
    Join {
        #[arg(long)]
        controller: String,
        #[arg(long)]
        token: String,
        #[arg(long)]
        address: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();

    if let Some(Command::Join {
        controller,
        token,
        address,
    }) = &cli.command
    {
        return run_join(&cli, controller, token, address.as_deref()).await;
    }

    run_serve(&cli).await
}

async fn run_join(
    cli: &Cli,
    controller: &str,
    token: &str,
    address: Option<&str>,
) -> anyhow::Result<()> {
    let hostname = cli.hostname.clone().unwrap_or_else(|| {
        std::env::var("HOSTNAME")
            .or_else(|_| std::env::var("HOST"))
            .unwrap_or_else(|_| "localhost".into())
    });
    let addr = address.unwrap_or("127.0.0.1");
    let grpc_addr = cli.listen.clone();
    let console_addr = cli.console_listen.clone();
    let body = serde_json::json!({
        "token": token,
        "hostname": hostname,
        "address": addr,
        "agent_grpc_addr": grpc_addr,
        "agent_console_addr": console_addr,
        "libvirt_uri": cli.libvirt_uri,
    });
    let url = format!("{}/api/v1/hosts/join", controller.trim_end_matches('/'));
    if controller.starts_with("http://") {
        tracing::warn!(
            "Joining controller over plaintext HTTP — enrollment token will be transmitted \
             unencrypted. Use HTTPS in production."
        );
    }
    let client = reqwest::Client::new();
    let resp = client.post(&url).json(&body).send().await?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("join failed: {text}");
    }
    info!("joined controller at {controller}");
    run_serve(cli).await
}

/// Constant-time byte comparison for the shared agent token (avoids leaking
/// length/prefix match timing).
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    diff == 0
}

async fn run_serve(cli: &Cli) -> anyhow::Result<()> {
    let hostname = cli.hostname.clone().unwrap_or_else(|| {
        std::env::var("HOSTNAME")
            .or_else(|_| std::env::var("HOST"))
            .unwrap_or_else(|_| "localhost".into())
    });
    let state = shared_state(hostname);
    let libvirt_uri = cli.libvirt_uri.clone();
    let libvirt = Arc::new(Mutex::new(LibvirtCtx::open(&libvirt_uri)?));
    let service = AgentService::new(state, libvirt.clone());

    let grpc_addr: SocketAddr = cli.listen.parse()?;
    let console_addr: SocketAddr = cli.console_listen.parse()?;
    // Reuse the shared agent token to authenticate the console port (serial/VNC/SPICE
    // console WS). Empty = unauthenticated (dev), warned below.
    let console_secret = std::env::var("MACHINA_AGENT_TOKEN")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_default();
    if console_secret.is_empty() {
        tracing::warn!(
            "MACHINA_AGENT_TOKEN not set — agent console proxy ({console_addr}) accepts \
             UNAUTHENTICATED connections (serial console = interactive root shell). Set a \
             shared token on the controller and this agent to require auth."
        );
    }
    let console_state = ConsoleProxyState {
        libvirt,
        secret: console_secret,
    };

    // The console proxy (VNC/SPICE/serial — serial is an interactive root shell)
    // has no TLS support of its own: it always serves plaintext TCP, regardless
    // of whether MACHINA_AGENT_TLS_CERT/KEY are configured for the gRPC port.
    // Anyone positioned on the network path can read the console token (sent as
    // a `?token=` query param) and the console traffic itself. Terminate TLS in
    // front of this port (stunnel/nginx/an SSH tunnel) until the proxy gains
    // native TLS.
    tracing::warn!(
        "agent console proxy ({console_addr}) has no built-in TLS and always serves \
         plaintext, independent of MACHINA_AGENT_TLS_CERT/KEY — put it behind a TLS \
         terminator (stunnel/nginx/SSH tunnel) if it is reachable off-host"
    );

    info!("machina-agent gRPC on {grpc_addr}, console proxy on {console_addr}");
    tokio::try_join!(
        async {
            // Shared-secret auth for the gRPC surface. When MACHINA_AGENT_TOKEN is
            // set, every RPC must carry `authorization: Bearer <token>` (the
            // controller attaches it via agent_client). Unset = accept unauthenticated
            // (dev/backward-compat) with a loud warning.
            let expected_token = std::env::var("MACHINA_AGENT_TOKEN")
                .ok()
                .filter(|s| !s.is_empty());
            if expected_token.is_none() {
                tracing::warn!(
                    "MACHINA_AGENT_TOKEN not set — agent gRPC accepts UNAUTHENTICATED requests; \
                     set a shared token on the controller and this agent to require auth"
                );
            }
            let auth = move |req: tonic::Request<()>| -> Result<tonic::Request<()>, tonic::Status> {
                match &expected_token {
                    None => Ok(req),
                    Some(exp) => {
                        let provided = req
                            .metadata()
                            .get("authorization")
                            .and_then(|v| v.to_str().ok())
                            .and_then(|s| s.strip_prefix("Bearer "));
                        match provided {
                            Some(t) if ct_eq(t.as_bytes(), exp.as_bytes()) => Ok(req),
                            _ => Err(tonic::Status::unauthenticated(
                                "invalid or missing agent token",
                            )),
                        }
                    }
                }
            };
            let mut builder = Server::builder();
            match (
                std::env::var("MACHINA_AGENT_TLS_CERT").ok(),
                std::env::var("MACHINA_AGENT_TLS_KEY").ok(),
            ) {
                (None, None) => {
                    tracing::warn!(
                        "MACHINA_AGENT_TLS_CERT/MACHINA_AGENT_TLS_KEY not set — \
                         gRPC serving UNENCRYPTED plaintext; set env vars in production"
                    );
                }
                (Some(cert_path), Some(key_path)) => {
                    // Both vars are set — the operator explicitly asked for TLS. Refuse
                    // to start rather than silently falling back to plaintext if the
                    // paths turn out not to exist (e.g. a typo, or certs not yet
                    // provisioned): the previous behavior of downgrading unnoticed to
                    // an unencrypted root-capable gRPC surface is a fail-open bug.
                    if !Path::new(&cert_path).exists() || !Path::new(&key_path).exists() {
                        anyhow::bail!(
                            "MACHINA_AGENT_TLS_CERT/MACHINA_AGENT_TLS_KEY are set but do not \
                             both point to existing files (cert='{cert_path}', key='{key_path}') \
                             — refusing to start rather than silently falling back to plaintext"
                        );
                    }
                    let cert = tokio::fs::read_to_string(&cert_path).await?;
                    let key = tokio::fs::read_to_string(&key_path).await?;
                    let tls = ServerTlsConfig::new().identity(Identity::from_pem(cert, key));
                    builder = builder.tls_config(tls)?;
                    info!("agent gRPC TLS enabled");
                }
                (cert, key) => {
                    // Only one of the two is set — almost certainly a misconfiguration,
                    // not an intentional plaintext choice. Fail closed instead of
                    // guessing.
                    anyhow::bail!(
                        "only one of MACHINA_AGENT_TLS_CERT ({}) / MACHINA_AGENT_TLS_KEY ({}) \
                         is set — both are required to enable TLS; refusing to start in an \
                         ambiguous state",
                        cert.is_some(),
                        key.is_some()
                    );
                }
            }
            builder
                .add_service(HostAgentServer::with_interceptor(service, auth))
                .serve(grpc_addr)
                .await
                .map_err(anyhow::Error::from)
        },
        console_ws::serve(console_addr, console_state),
    )?;
    Ok(())
}

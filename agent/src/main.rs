// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};

use clap::{Parser, Subcommand};
use machina_agent::console_ws::{self, ConsoleProxyState};
use machina_agent::libvirt_ops::LibvirtCtx;
use machina_agent::grpc::AgentService;
use machina_agent::pb::host_agent_server::HostAgentServer;
use machina_agent::state::shared_state;
use tonic::transport::{Identity, Server, ServerTlsConfig};
use tracing::info;

#[derive(Parser)]
#[command(name = "machina-agent", about = "Machina host agent (libvirt executor)")]
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
    let url = format!(
        "{}/api/v1/hosts/join",
        controller.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let resp = client.post(&url).json(&body).send().await?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("join failed: {text}");
    }
    info!("joined controller at {controller}");
    run_serve(cli).await
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
    let console_state = ConsoleProxyState {
        libvirt,
        secret: String::new(),
    };

    info!("machina-agent gRPC on {grpc_addr}, console proxy on {console_addr}");
    tokio::try_join!(
        async {
            let mut builder = Server::builder();
            if let (Ok(cert_path), Ok(key_path)) = (
                std::env::var("MACHINA_AGENT_TLS_CERT"),
                std::env::var("MACHINA_AGENT_TLS_KEY"),
            ) {
                if Path::new(&cert_path).exists() && Path::new(&key_path).exists() {
                    let cert = tokio::fs::read_to_string(&cert_path).await?;
                    let key = tokio::fs::read_to_string(&key_path).await?;
                    let tls = ServerTlsConfig::new().identity(Identity::from_pem(cert, key));
                    builder = builder.tls_config(tls)?;
                    info!("agent gRPC TLS enabled");
                }
            }
            builder
                .add_service(HostAgentServer::new(service))
                .serve(grpc_addr)
                .await
                .map_err(anyhow::Error::from)
        },
        console_ws::serve(console_addr, console_state),
    )?;
    Ok(())
}

// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

mod auth;
mod automation_worker;
mod cluster_bootstrap;
mod conn_query;
mod daemon_stats;
mod error;
mod http_metrics;
mod hyper2kvm_exec;
mod inventory_history;
mod job_registry;
mod k8s_inventory_history;
mod k8s_kubeconfig;
mod k8s_metrics_cache;
mod k8s_quantity;
mod kubevirt_exec;
mod kubevirt_k8s_ws_proxy;
mod ldap_auth;
mod metrics_history;
mod obs_reload;
mod obs_workers;
mod openstack_runtime;
mod otlp_worker;
mod routes;
mod server;
mod systemd;
mod terminal;
mod virt_image_validate;
mod vm_events;

use clap::Parser;
use machina_core::{LibvirtManager, MachinaConfig};
use tokio::signal;
use tracing::info;

#[derive(Parser)]
#[command(
    name = "machina-daemon",
    about = "machina-daemon — HTTP/WebSocket control plane for Linux hypervisor hosts (libvirt/QEMU/KVM)"
)]
struct Cli {
    /// Host to bind to
    #[arg(long)]
    host: Option<String>,

    /// Port to bind to
    #[arg(short, long)]
    port: Option<u16>,

    /// Libvirt connection URI
    #[arg(long)]
    libvirt_uri: Option<String>,

    /// Config file path
    #[arg(short, long)]
    config: Option<String>,
}

fn init_rustls_crypto_provider() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|e| anyhow::anyhow!("rustls CryptoProvider::install_default: {e:?}"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Default log filter: suppress noisy rustls SNI WARN that fires for every
    // TLS client that connects using an IP address literal instead of a hostname.
    // RFC 6066 forbids IP literals in SNI; rustls logs WARN but still serves the
    // connection fine. Suppress at WARN level; keep it visible at ERROR+ if RUST_LOG
    // is set explicitly.
    if std::env::var("RUST_LOG").is_err() {
        // SAFETY: single-threaded at this point (before tokio runtime starts workers).
        unsafe {
            std::env::set_var("RUST_LOG", "info,rustls::msgs::handshake=error");
        }
    }
    tracing_subscriber::fmt::init();
    init_rustls_crypto_provider()?;

    // Same idea as h2kweb: ensure under-/run paths exist for locks / future workflow use.
    for dir in ["/run/machina", "/run/machina/workflow"] {
        if let Err(e) = std::fs::create_dir_all(dir) {
            tracing::warn!("cannot create {dir}: {e}");
        }
    }

    let cli = Cli::parse();

    let mut config = if let Some(path) = &cli.config {
        let contents = std::fs::read_to_string(path)?;
        toml::from_str(&contents)?
    } else {
        MachinaConfig::load()
    };

    // CLI args override config
    if let Some(host) = cli.host {
        config.daemon.host = host;
    }
    if let Some(port) = cli.port {
        config.daemon.port = port;
    }
    if let Some(uri) = cli.libvirt_uri {
        config.libvirt.uri = uri;
    }

    machina_core::audit::configure_rotation(config.audit.clone());
    machina_core::audit_ship::configure_ship(config.audit.clone());
    machina_core::linux_audit::configure_linux_audit(config.observability.linux_audit.clone());

    let manager = LibvirtManager::new(&config.libvirt).map_err(|e| anyhow::anyhow!("{e}"))?;

    info!("Connected to libvirt ({})", manager.primary_uri_display());
    match manager
        .with_conn(|conn| Ok(machina_core::libvirt::network::bootstrap_autostart_networks(conn)))
    {
        Ok(failures) => {
            for (name, err) in &failures {
                tracing::warn!("libvirt network '{name}' autostart failed at daemon boot: {err}");
            }
            if failures.is_empty() {
                info!("libvirt autostart networks are active");
            }
        }
        Err(e) => tracing::warn!("could not bootstrap libvirt autostart networks: {e}"),
    }
    info!(
        "PAM service for web login: /etc/pam.d/{}",
        config.auth.pam_service
    );
    if config.auth.oidc.is_enabled() {
        info!(
            "OIDC browser login enabled: issuer={} redirect={}",
            config.auth.oidc.issuer_url, config.auth.oidc.redirect_url
        );
    } else if config.auth.oidc.enabled {
        tracing::warn!(
            "OIDC marked enabled but missing issuer_url/client_id/redirect_url; browser SSO is disabled"
        );
    }
    if config.auth.run_as_user.wants_impersonation() {
        use machina_core::config::RunAsUserMode;
        match config.auth.run_as_user.mode {
            RunAsUserMode::Sudo => {
                info!(
                    "auth.run_as_user sudo mode: OS user create/delete runs as effective_linux_user via sudo -n"
                );
            }
            RunAsUserMode::Polkit => {
                info!(
                    "auth.run_as_user polkit mode: OS user create/delete runs via pkexec --user (install contrib/polkit/machina-run-as-user.rules)"
                );
            }
            RunAsUserMode::SetuidHelper => {
                info!(
                    "auth.run_as_user setuid_helper mode: allow-listed commands via {} (install with contrib/run-as-user/README.md)",
                    config.auth.run_as_user.setuid_helper_path
                );
            }
            RunAsUserMode::Disabled => {}
        }
    }

    inventory_history::spawn_inventory_history_worker(
        manager.clone(),
        config.inventory_history.clone(),
    );
    automation_worker::spawn_automation_worker(manager.clone());

    let bind_addr = config.bind_addr();
    let tls_enabled =
        config.tls.enabled && !config.tls.cert_path.is_empty() && !config.tls.key_path.is_empty();
    let tls_cert_path = config.tls.cert_path.clone();
    let tls_key_path = config.tls.key_path.clone();

    let app = server::create_app(manager, config);

    if tls_enabled {
        info!("listening on {bind_addr} (TLS enabled)");
        info!("  cert: {}", tls_cert_path);
        info!("  key:  {}", tls_key_path);

        let tls_config =
            axum_server::tls_rustls::RustlsConfig::from_pem_file(&tls_cert_path, &tls_key_path)
                .await?;

        // bind_rustls opens its own listener — do not TcpListener::bind first or we get EADDRINUSE.
        systemd::notify_ready();
        systemd::spawn_watchdog_pinger();
        axum_server::bind_rustls(bind_addr.parse()?, tls_config)
            .serve(app.into_make_service())
            .await?;
    } else {
        info!("listening on {bind_addr}");
        let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
        systemd::notify_ready();
        systemd::spawn_watchdog_pinger();
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    info!("Shutting down");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(e) = signal::ctrl_c().await {
            tracing::error!("Failed to listen for ctrl+c: {e}");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(e) => tracing::error!("Failed to listen for SIGTERM: {e}"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

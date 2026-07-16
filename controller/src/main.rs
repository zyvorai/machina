// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::net::SocketAddr;
use std::sync::Arc;

use clap::Parser;
use machina_controller::api;
use machina_controller::config::ControllerConfig;
use machina_controller::db;
use machina_controller::engine::{drs, ha, reconcile, scheduler, webhook_worker};
use machina_controller::leader;
use machina_controller::state::AppState;
use machina_controller::sync;
use machina_controller::tasks::bus::{FanoutTaskBus, InMemoryTaskBus, NatsTaskBus};
use machina_controller::tasks::{nats_subscriber, worker};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

#[derive(Parser)]
#[command(
    name = "machina-controller",
    about = "Machina central management controller"
)]
struct Cli {
    #[arg(long, env = "MACHINA_CONTROLLER_HOST")]
    host: Option<String>,
    #[arg(long, env = "MACHINA_CONTROLLER_PORT")]
    port: Option<u16>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    machina_controller::engine::ai::crypto::init();
    let cli = Cli::parse();
    let mut config = ControllerConfig::default();
    if let Some(host) = cli.host {
        config.host = host;
    }
    if let Some(port) = cli.port {
        config.port = port;
    }
    let config = Arc::new(config);

    // The built-in default is exactly 32 bytes, so a length-only check never fires on
    // it. A shipped default secret lets anyone forge an admin JWT, so REFUSE TO BOOT on
    // the known dev default unless an operator explicitly opts into dev mode. Same for
    // the default admin password.
    let dev_secrets_allowed = std::env::var("MACHINA_ALLOW_DEV_SECRETS").ok().as_deref()
        == Some("1")
        || std::env::var("MACHINA_SKIP_AUTH").ok().as_deref() == Some("1");
    if config.jwt_secret == "machina-dev-jwt-secret-change-me" {
        if dev_secrets_allowed {
            tracing::warn!(
                "MACHINA_JWT_SECRET is the built-in DEV DEFAULT — admin tokens are forgeable. Allowed only because MACHINA_ALLOW_DEV_SECRETS/MACHINA_SKIP_AUTH is set."
            );
        } else {
            tracing::error!(
                "Refusing to start: MACHINA_JWT_SECRET is unset (built-in DEV DEFAULT). Anyone could forge admin tokens. Set MACHINA_JWT_SECRET (>=32 random bytes) on the controller AND daemon, or set MACHINA_ALLOW_DEV_SECRETS=1 for local dev."
            );
            std::process::exit(1);
        }
    } else if config.jwt_secret.len() < 32 {
        tracing::warn!(
            "MACHINA_JWT_SECRET is shorter than 32 bytes ({} bytes) — set a strong secret in production",
            config.jwt_secret.len()
        );
    }
    if config.admin_password == "admin" && !dev_secrets_allowed {
        tracing::error!(
            "Refusing to start: default admin password 'admin' is in use. Set MACHINA_ADMIN_PASSWORD, or set MACHINA_ALLOW_DEV_SECRETS=1 for local dev."
        );
        std::process::exit(1);
    }

    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;
    db::ensure_bootstrap(&pool, &config.admin_user, &config.admin_password).await?;
    if let Err(e) = machina_controller::engine::packetwolf_local_db::hydrate(&pool).await {
        tracing::warn!("PacketWolf local fabric hydrate: {e:#}");
    }

    // Reap orphaned in-flight tasks left by a previous run — ONLY for the in-memory
    // task bus (no NATS). There, a restart drops the in-memory queue, so any task still
    // 'pending'/'running' in the DB will never be picked up; left alone these rows also
    // trip the per-host anti-backlog guard in sync.rs, wedging host.inventory so hosts
    // go stale → offline → VM placement fails "no online hosts available".
    //
    // With NATS configured (the multi-controller / HA topology) we must NOT do this: the
    // broker redelivers in-flight work, and a peer controller may own or be about to
    // claim these rows — blindly failing them would kill a peer's live task. In that
    // topology, ensure_bootstrap already performs a controller-scoped 'running' reap.
    if config.nats_url.is_none() {
        match sqlx::query(
            "UPDATE tasks SET status = 'failed', \
             message = COALESCE(NULLIF(message,''),'') || ' [orphaned by controller restart]', \
             updated_at = datetime('now') \
             WHERE status IN ('pending', 'running')",
        )
        .execute(&pool)
        .await
        {
            Ok(r) if r.rows_affected() > 0 => {
                info!("reaped {} orphaned in-flight task(s) at startup", r.rows_affected());
            }
            Ok(_) => {}
            Err(e) => tracing::warn!("orphan task reap at startup failed: {e:#}"),
        }
    }

    let (local_bus, rx) = InMemoryTaskBus::new();
    let local_tx = local_bus.sender();
    let nats_bus = if let Some(url) = &config.nats_url {
        match NatsTaskBus::connect(url).await {
            Ok(n) => {
                info!("NATS task fan-out enabled on {url}");
                nats_subscriber::spawn(url.clone(), local_tx);
                Some(n)
            }
            Err(e) => {
                tracing::warn!("NATS connect failed ({e:#}); using in-memory bus only");
                None
            }
        }
    } else {
        None
    };
    let task_bus = FanoutTaskBus::new(local_bus, nats_bus);

    let leader = leader::spawn(pool.clone(), config.controller_id.clone());
    let state = AppState::new(pool, config.clone(), task_bus, leader.clone());
    worker::spawn(state.clone(), rx);
    webhook_worker::spawn(state.pool.clone(), leader);
    sync::spawn_periodic(state.clone());
    reconcile::spawn(state.clone());
    ha::spawn(state.clone());
    drs::spawn(state.clone());
    scheduler::spawn(state.clone());
    machina_controller::engine::ai::worker::spawn(state.clone());
    machina_controller::engine::zeus_firewall::worker::spawn(state.clone());
    machina_controller::engine::operations_scheduler::spawn(state.clone());
    machina_controller::engine::vault_sync_scheduler::spawn(state.clone());
    machina_controller::engine::fleet_snapshot_scheduler::spawn(state.clone());
    machina_controller::engine::fleet_backup_scheduler::spawn(state.clone());
    machina_controller::engine::alert_evaluator::spawn(state.clone());
    machina_controller::engine::scheduled_jobs_runner::spawn(state.clone());
    machina_controller::engine::health_watchdog::spawn(state.clone());
    machina_controller::engine::channel_worker::spawn(state.pool.clone(), state.leader.clone());
    machina_controller::engine::cert_monitor::spawn(state.clone());
    machina_controller::engine::vm_schedule_runner::spawn(state.clone());
    machina_controller::engine::soc::worker::spawn(state.clone());

    let app = api::router(state)
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive());

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    info!(
        "machina-controller listening on http://{addr} (id={})",
        config.controller_id
    );
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Push PacketWolf security bundles to machina-agent during inventory and tasks.

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::agent_client;
use crate::config::ControllerConfig;
use crate::engine::packetwolf_bridge;
use crate::engine::packetwolf_local::{self, DEFAULT_TETRAGON_VERSION};
use crate::engine::packetwolf_local_db;

fn bundle_has_work(bundle: &serde_json::Value) -> bool {
    let has_policies = bundle
        .get("tracing_policies")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    let has_install = bundle
        .get("tetragon_install")
        .map(|v| !v.is_null())
        .unwrap_or(false);
    has_policies || has_install
}

fn pending_install_json(host_id: &str, export_url: &str) -> serde_json::Value {
    serde_json::json!({
        "host_id": host_id,
        "status": "queued",
        "install_unit": "tetragon.service",
        "export_url": export_url,
    })
}

async fn persist_local_enrollment(
    pool: &SqlitePool,
    host_id: &str,
    export_url: &str,
) -> anyhow::Result<()> {
    packetwolf_local_db::upsert_sensor(pool, host_id, "registered", DEFAULT_TETRAGON_VERSION, None)
        .await?;
    let pending = pending_install_json(host_id, export_url);
    packetwolf_local_db::set_pending_tetragon(pool, host_id, &pending).await?;
    Ok(())
}

async fn apply_bundle(
    cfg: &ControllerConfig,
    pool: &SqlitePool,
    host_id: &str,
    agent_addr: &str,
    bundle: &serde_json::Value,
) -> anyhow::Result<bool> {
    let bundle_json = serde_json::to_string(bundle)?;
    match agent_client::apply_security_bundle(agent_addr, &bundle_json, false).await {
        Ok(result)
            if result.ok
                && (!result.tetragon_install_attempted || result.tetragon_service_active) =>
        {
            let _ = packetwolf_bridge::ack_agent_bundle(cfg, host_id).await;
            let _ = packetwolf_local_db::clear_pending_tetragon(pool, host_id).await;
            if result.tetragon_service_active {
                packetwolf_local::mark_sensor_healthy(host_id);
                let _ = packetwolf_local_db::upsert_sensor(
                    pool,
                    host_id,
                    "healthy",
                    DEFAULT_TETRAGON_VERSION,
                    None,
                )
                .await;
            }
            tracing::info!(
                host_id = %host_id,
                policies = result.policies_written,
                tetragon = result.tetragon_service_active,
                "security bundle applied on agent"
            );
            Ok(true)
        }
        Ok(result) => {
            tracing::warn!(
                host_id = %host_id,
                message = %result.message,
                tetragon_active = result.tetragon_service_active,
                "security bundle apply incomplete"
            );
            Ok(false)
        }
        Err(e) => {
            tracing::warn!(host_id = %host_id, "security bundle apply failed: {e:#}");
            Ok(false)
        }
    }
}

/// Enroll host Tetragon sensor: register, queue install, push bundle, verify service.
pub async fn sync_host_tetragon_install(
    pool: &SqlitePool,
    cfg: &ControllerConfig,
    host_id: Uuid,
    agent_addr: &str,
) -> anyhow::Result<()> {
    if !cfg.packetwolf_enabled {
        return Ok(());
    }
    let host_id_str = host_id.to_string();
    let export_url = packetwolf_bridge::ingest_base_url(cfg);

    let _ = packetwolf_bridge::register_sensor(cfg, &host_id_str).await;
    let _ = packetwolf_bridge::queue_tetragon_install(cfg, &host_id_str).await;
    persist_local_enrollment(pool, &host_id_str, &export_url).await?;

    let mut bundle = packetwolf_bridge::agent_bundle(cfg, &host_id_str).await;
    if bundle
        .get("tetragon_install")
        .map(|v| v.is_null())
        .unwrap_or(true)
    {
        bundle["tetragon_install"] = pending_install_json(&host_id_str, &export_url);
    }
    bundle["host_id"] = serde_json::json!(host_id_str);

    if !apply_bundle(cfg, pool, &host_id_str, agent_addr, &bundle).await? {
        anyhow::bail!("Tetragon install bundle did not activate tetragon.service on agent");
    }
    Ok(())
}

/// Pull the agent bundle from PacketWolf and apply TracingPolicy files on the host.
pub async fn sync_host_security_bundle(
    cfg: &ControllerConfig,
    pool: &SqlitePool,
    host_id: Uuid,
    agent_addr: &str,
) -> anyhow::Result<()> {
    if !cfg.packetwolf_enabled {
        return Ok(());
    }
    let host_id_str = host_id.to_string();
    let bundle = packetwolf_bridge::agent_bundle(cfg, &host_id_str).await;
    if !bundle_has_work(&bundle) {
        return Ok(());
    }
    apply_bundle(cfg, pool, &host_id_str, agent_addr, &bundle).await?;
    Ok(())
}

/// Apply bundles for all online hosts (maintenance / operator trigger).
pub async fn sync_all_online(pool: &SqlitePool, cfg: &ControllerConfig) -> anyhow::Result<usize> {
    let hosts: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT id, agent_grpc_addr FROM hosts WHERE state = 'online' ORDER BY hostname LIMIT 200",
    )
    .fetch_all(pool)
    .await?;

    let mut synced = 0usize;
    for (host_id, addr) in hosts {
        if sync_host_security_bundle(cfg, pool, host_id, &addr)
            .await
            .is_ok()
        {
            synced += 1;
        }
    }
    Ok(synced)
}

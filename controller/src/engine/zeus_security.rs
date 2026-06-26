// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Zeus Security Fabric — fleet risk aggregation and PacketWolf orchestration.

use serde::Serialize;
use sqlx::SqlitePool;

use crate::config::ControllerConfig;
use crate::engine::ai::security_graph;
use crate::engine::packetwolf_bridge;
use crate::engine::zeus_firewall;

#[derive(Debug, Serialize)]
pub struct ZeusSecurityStatus {
    pub packetwolf: packetwolf_bridge::PacketwolfStatus,
    pub zeus_firewall: serde_json::Value,
    pub fabric_reachable: bool,
}

pub async fn status(cfg: &ControllerConfig) -> ZeusSecurityStatus {
    let pw = packetwolf_bridge::status_async(cfg).await;
    ZeusSecurityStatus {
        fabric_reachable: pw.reachable,
        packetwolf: pw,
        zeus_firewall: zeus_firewall::zeus_firewall_status().await,
    }
}

#[derive(Debug, Serialize)]
pub struct FleetThreatSummary {
    pub fleet_threat_score: f32,
    pub firewall_targets: usize,
    pub critical_events: Vec<serde_json::Value>,
    pub packetwolf: serde_json::Value,
    pub security_graph_summary: String,
}

pub async fn fleet_threat(
    pool: &SqlitePool,
    cfg: &ControllerConfig,
) -> anyhow::Result<FleetThreatSummary> {
    let pw = packetwolf_bridge::fleet_threat_summary(cfg).await;
    let overview = zeus_firewall::overview(pool, cfg).await?;
    let graph = security_graph::build_graph(pool).await?;

    let fleet_score = pw
        .get("fleet_threat_score")
        .and_then(|v| v.as_f64())
        .unwrap_or(75.0) as f32;

    let critical = pw
        .get("critical_events")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(FleetThreatSummary {
        fleet_threat_score: fleet_score,
        firewall_targets: overview.targets.len(),
        critical_events: critical,
        packetwolf: pw,
        security_graph_summary: format!(
            "{} nodes · {} edges in infrastructure security graph",
            graph.nodes.len(),
            graph.edges.len()
        ),
    })
}

pub async fn host_summary(cfg: &ControllerConfig, host_id: &str) -> serde_json::Value {
    packetwolf_bridge::host_fabric(cfg, host_id, "summary", "").await
}

pub async fn host_resource(
    cfg: &ControllerConfig,
    host_id: &str,
    resource: &str,
    hours: u32,
) -> serde_json::Value {
    let q = if hours > 0 {
        format!("?hours={hours}&limit=100")
    } else {
        String::new()
    };
    packetwolf_bridge::host_fabric(cfg, host_id, resource, &q).await
}

pub async fn fleet_timeline(cfg: &ControllerConfig, hours: u32) -> serde_json::Value {
    packetwolf_bridge::fleet_timeline(cfg, hours).await
}

pub async fn sync_security_alerts(pool: &SqlitePool, cfg: &ControllerConfig) -> anyhow::Result<usize> {
    let pw = packetwolf_bridge::fetch_anomalies(cfg).await;
    let anomalies = pw
        .get("anomalies")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut inserted = 0usize;
    for a in anomalies.iter().filter(|x| {
        x.get("severity")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s == "critical" || s == "high")
    }) {
        let summary = a
            .get("summary")
            .or_else(|| a.get("description"))
            .and_then(|v| v.as_str())
            .unwrap_or("Security alert");
        let host_id = a.get("host_id").and_then(|v| v.as_str()).unwrap_or("");
        if insert_security_alert(pool, summary, host_id, a).await? {
            inserted += 1;
        }
    }

    let health = packetwolf_bridge::fabric_health(cfg).await;
    if let Some(issues) = health.get("issues").and_then(|v| v.as_array()) {
        for issue in issues.iter().filter(|x| {
            x.get("severity")
                .and_then(|v| v.as_str())
                .is_some_and(|s| s == "critical" || s == "high" || s == "warning")
        }) {
            let summary = issue
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("Fabric health issue");
            let host_id = issue.get("host_id").and_then(|v| v.as_str()).unwrap_or("");
            if insert_security_alert(pool, summary, host_id, issue).await? {
                inserted += 1;
            }
        }
    }
    Ok(inserted)
}

async fn insert_security_alert(
    pool: &SqlitePool,
    summary: &str,
    host_id: &str,
    detail: &serde_json::Value,
) -> anyhow::Result<bool> {
    let id = uuid::Uuid::new_v4();
    let payload = serde_json::json!({
        "title": summary,
        "host_id": host_id,
        "severity": detail.get("severity"),
        "kind": detail.get("kind"),
        "source": "packetwolf",
    });
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM notification_outbox
            WHERE kind = 'security.alert' AND json_extract(payload, '$.title') = ? AND created_at > datetime('now', '-1 hours')
        )",
    )
    .bind(summary)
    .fetch_one(pool)
    .await
    .unwrap_or(false);
    if exists {
        return Ok(false);
    }
    sqlx::query("INSERT INTO notification_outbox (id, kind, payload) VALUES (?, ?, ?)")
        .bind(id)
        .bind("security.alert")
        .bind(payload)
        .execute(pool)
        .await?;
    Ok(true)
}

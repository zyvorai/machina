// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Fleet desktop aggregator (Phase 35).

use serde::Serialize;
use sqlx::SqlitePool;

use crate::config::ControllerConfig;
use crate::engine::ai::zeus_summary;
use crate::engine::fleet_linux;
use crate::engine::fleet_linux::FleetLinuxHealthOverview;
use crate::engine::observability;

#[derive(Debug, Clone, Serialize)]
pub struct FleetDesktopOverview {
    pub summary: String,
    pub zeus_status: String,
    pub zeus_highlights: Vec<String>,
    pub slo_count: usize,
    pub slo_breach_count: usize,
    pub p95_latency_ms: i32,
    pub hosts_online: i64,
    pub hosts_total: i64,
    pub vm_count: i64,
    pub active_tasks: i64,
    pub failed_tasks_24h: i64,
    pub unread_notifications: i64,
    pub pressure_hosts: usize,
    pub linux_summary: String,
}

pub async fn overview(
    pool: &SqlitePool,
    cfg: &ControllerConfig,
) -> anyhow::Result<FleetDesktopOverview> {
    let zeus = zeus_summary::summarize(pool).await?;
    let obs = observability::overview(pool).await?;
    let linux =
        fleet_linux::overview(pool, cfg)
            .await
            .unwrap_or_else(|_| FleetLinuxHealthOverview {
                hosts_scanned: 0,
                pressure_hosts: 0,
                thermal_alerts: 0,
                smart_alerts: 0,
                hosts: vec![],
                summary: "Linux health unavailable".into(),
            });
    let hosts_total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hosts")
        .fetch_one(pool)
        .await?;
    let vm_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vms")
        .fetch_one(pool)
        .await?;
    let active_tasks: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE status IN ('pending', 'running')")
            .fetch_one(pool)
            .await?;
    let failed_tasks_24h: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tasks WHERE status = 'failed' AND created_at > datetime('now', '-24 hours')",
    )
    .fetch_one(pool)
    .await?;
    let unread_notifications: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM notification_outbox WHERE delivered = FALSE")
            .fetch_one(pool)
            .await
            .unwrap_or(0);
    let slo_breach_count = obs.slos.iter().filter(|s| s.status == "breach").count();
    Ok(FleetDesktopOverview {
        summary: format!(
            "Zeus {} · {} SLO(s) · {} hosts · {} VMs · {} active tasks · {}",
            zeus.status,
            obs.slos.len(),
            zeus.hosts_online,
            vm_count,
            active_tasks,
            linux.summary
        ),
        zeus_status: zeus.status,
        zeus_highlights: zeus.highlights,
        slo_count: obs.slos.len(),
        slo_breach_count,
        p95_latency_ms: obs.p95_latency_ms,
        hosts_online: zeus.hosts_online,
        hosts_total,
        vm_count,
        active_tasks,
        failed_tasks_24h,
        unread_notifications,
        pressure_hosts: linux.pressure_hosts,
        linux_summary: linux.summary,
    })
}

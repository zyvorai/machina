// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Serialize)]
pub struct ZeusOsSummary {
    pub status: String,
    pub tagline: String,
    pub hosts_online: i64,
    pub vm_count: i64,
    pub monthly_cost_usd: f64,
    pub security_risk: String,
    pub sre_alerts: usize,
    pub fleet_hotspots: usize,
    pub compliance_grade: String,
    pub firewall_critical_hosts: usize,
    pub firewall_drift_hosts: i64,
    pub baremetal_critical_count: usize,
    pub exposure_waste_usd: f64,
    pub highlights: Vec<String>,
}

pub async fn summarize(pool: &SqlitePool) -> anyhow::Result<ZeusOsSummary> {
    let hosts_online: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hosts WHERE state = 'online'")
        .fetch_one(pool)
        .await?;
    let vm_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vms")
        .fetch_one(pool)
        .await?;

    let cost = super::cost::analyze(pool).await?;
    let security = super::security::scan(pool).await?;
    let sre = super::sre_predict::forecast(pool).await?;
    let heat = super::fleet_heatmap::heatmap(pool).await?;
    let compliance = super::compliance::generate(pool).await?;
    let firewall = super::firewall_remediate::propose(pool).await?;

    let firewall_critical = firewall
        .remediations
        .iter()
        .filter(|r| r.risk == "Critical")
        .count();

    let firewall_drift_hosts: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT target_id) FROM firewall_timeline
         WHERE kind = 'drift' AND created_at > datetime('now', '-7 days')",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let baremetal_critical_count =
        if let Ok(ov) = crate::engine::zeus_firewall::metal::metal_overview(pool).await {
            ov.critical_count
        } else {
            0
        };

    let cfg = crate::config::ControllerConfig::default();
    let exposure_waste_usd = crate::engine::zeus_firewall::finops::exposure_rollup(pool, &cfg)
        .await
        .map(|r| r.idle_port_waste_usd + r.fleet_exposure_monthly_usd * 0.05)
        .unwrap_or(0.0);

    let status = if security.risk_level == "high"
        || firewall_critical > 0
        || baremetal_critical_count > 0
        || firewall_drift_hosts > 0
        || sre.forecasts.iter().any(|f| f.severity == "critical")
    {
        "attention"
    } else if heat.hotspots.is_empty() {
        "healthy"
    } else {
        "watch"
    };

    let mut highlights = Vec::new();
    if firewall_critical > 0 {
        highlights.push(format!(
            "{firewall_critical} host(s) with critical firewall exposure"
        ));
    }
    if firewall_drift_hosts > 0 {
        highlights.push(format!(
            "{firewall_drift_hosts} host(s) with firewall drift (7d)"
        ));
    }
    if baremetal_critical_count > 0 {
        highlights.push(format!(
            "{baremetal_critical_count} bare-metal BMC exposure(s) need attention"
        ));
    }
    if !heat.hotspots.is_empty() {
        highlights.push(format!("{} fleet hotspot(s)", heat.hotspots.len()));
    }
    if cost.idle_vm_count > 0 {
        highlights.push(format!(
            "{} idle VMs — FinOps opportunity",
            cost.idle_vm_count
        ));
    }
    if exposure_waste_usd > 25.0 {
        highlights.push(format!(
            "${:.0}/mo exposure waste — FinOps × Security",
            exposure_waste_usd
        ));
    }
    if sre.forecasts.len() > 0 {
        highlights.push(format!("{} SRE forecast(s)", sre.forecasts.len()));
    }
    if highlights.is_empty() {
        highlights.push("Autonomous datacenter operating within guardrails.".into());
    }

    Ok(ZeusOsSummary {
        status: status.into(),
        tagline: "Machina Zeus OS — AI-native infrastructure operating system".into(),
        hosts_online,
        vm_count,
        monthly_cost_usd: cost.estimated_monthly_usd,
        security_risk: security.risk_level,
        sre_alerts: sre.forecasts.len(),
        fleet_hotspots: heat.hotspots.len(),
        compliance_grade: compliance.grade,
        firewall_critical_hosts: firewall_critical,
        firewall_drift_hosts,
        baremetal_critical_count,
        exposure_waste_usd,
        highlights,
    })
}

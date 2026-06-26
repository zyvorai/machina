// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FleetClusterSlice {
    pub label: String,
    pub reachable: bool,
    pub vm_count: i64,
    pub estimated_monthly_usd: f64,
    pub memory_headroom_mib: i64,
    pub security_risk_level: String,
}

#[derive(Debug, Serialize)]
pub struct FleetZeusSummary {
    pub clusters: Vec<FleetClusterSlice>,
    pub aggregate_monthly_usd: f64,
    pub aggregate_vm_count: i64,
    pub peer_count: usize,
    pub reachable_peers: usize,
}

pub async fn summarize(pool: &SqlitePool) -> anyhow::Result<FleetZeusSummary> {
    let mut clusters = vec![local_slice(pool).await?];
    let peer_urls = super::settings::get_fleet_peer_urls(pool).await?;
    let mut reachable_peers = 0usize;

    for url in &peer_urls {
        let slice = fetch_peer_slice(url).await;
        if slice.reachable {
            reachable_peers += 1;
        }
        clusters.push(slice);
    }

    let aggregate_monthly_usd = clusters.iter().map(|c| c.estimated_monthly_usd).sum();
    let aggregate_vm_count = clusters.iter().map(|c| c.vm_count).sum();

    Ok(FleetZeusSummary {
        peer_count: peer_urls.len(),
        reachable_peers,
        aggregate_monthly_usd,
        aggregate_vm_count,
        clusters,
    })
}

async fn local_slice(pool: &SqlitePool) -> anyhow::Result<FleetClusterSlice> {
    let name: String = sqlx::query_scalar("SELECT name FROM clusters ORDER BY created_at LIMIT 1")
        .fetch_one(pool)
        .await?;
    let cost = super::cost::analyze(pool).await?;
    let cap = super::capacity::plan(pool).await?;
    let sec = super::security::scan(pool).await?;
    Ok(FleetClusterSlice {
        label: name,
        reachable: true,
        vm_count: cost.vm_count,
        estimated_monthly_usd: cost.estimated_monthly_usd,
        memory_headroom_mib: cap.memory_headroom_mib,
        security_risk_level: sec.risk_level,
    })
}

async fn fetch_peer_slice(base: &str) -> FleetClusterSlice {
    let base = base.trim_end_matches('/');
    let label = base.to_string();
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return FleetClusterSlice {
                label,
                reachable: false,
                vm_count: 0,
                estimated_monthly_usd: 0.0,
                memory_headroom_mib: 0,
                security_risk_level: "unknown".into(),
            };
        }
    };

    let health = client.get(format!("{base}/api/v1/health")).send().await;
    if health
        .as_ref()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
        == false
    {
        return FleetClusterSlice {
            label,
            reachable: false,
            vm_count: 0,
            estimated_monthly_usd: 0.0,
            memory_headroom_mib: 0,
            security_risk_level: "unknown".into(),
        };
    }

    let mut req = client.get(format!("{base}/api/v1/ai/fleet/local"));
    if let Ok(key) = std::env::var("ZEUS_FLEET_API_KEY") {
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
    }

    match req.send().await {
        Ok(resp) if resp.status().is_success() => resp
            .json::<FleetClusterSlice>()
            .await
            .unwrap_or_else(|_| unreachable_peer(&label)),
        _ => unreachable_peer(&label),
    }
}

fn unreachable_peer(label: &str) -> FleetClusterSlice {
    FleetClusterSlice {
        label: label.to_string(),
        reachable: false,
        vm_count: 0,
        estimated_monthly_usd: 0.0,
        memory_headroom_mib: 0,
        security_risk_level: "unknown".into(),
    }
}

pub async fn local_export(pool: &SqlitePool) -> anyhow::Result<FleetClusterSlice> {
    local_slice(pool).await
}

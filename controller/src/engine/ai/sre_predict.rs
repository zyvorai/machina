// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::Serialize;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct ResourceExhaustionForecast {
    pub vm_id: String,
    pub vm_name: String,
    pub resource: String,
    pub severity: String,
    pub message: String,
    pub hours_until_critical: Option<f64>,
    pub confidence: f64,
}

#[derive(Debug, Serialize)]
pub struct SreForecastReport {
    pub forecasts: Vec<ResourceExhaustionForecast>,
}

pub async fn forecast(pool: &SqlitePool) -> anyhow::Result<SreForecastReport> {
    let rows: Vec<(Uuid, String, i64, i64, f64)> = sqlx::query_as(
        "SELECT v.id, v.name, v.memory_mib, m.memory_used_mib, m.cpu_percent
         FROM vms v
         JOIN vm_metrics m ON m.vm_id = v.id
         WHERE v.observed_state = 'running'
         ORDER BY v.name
         LIMIT 100",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let pool_ratio: f64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(used_gib * 1.0 / NULLIF(capacity_gib, 0)), 0.0) FROM storage_pools WHERE capacity_gib > 0",
    )
    .fetch_optional(pool)
    .await?
    .unwrap_or(0.0);

    let mut forecasts = Vec::new();
    for (vid, name, mem_alloc, mem_used, cpu) in rows {
        if mem_alloc > 0 {
            let ratio = mem_used as f64 / mem_alloc as f64;
            if ratio >= 0.85 {
                let hours = estimate_hours_to_full(ratio);
                forecasts.push(ResourceExhaustionForecast {
                    vm_id: vid.to_string(),
                    vm_name: name.clone(),
                    resource: "memory".into(),
                    severity: if ratio >= 0.95 { "critical" } else { "high" }.into(),
                    message: format!(
                        "VM {name} memory at {:.0}% — may exhaust allocated RAM within ~{:.0}h at current trend",
                        ratio * 100.0,
                        hours
                    ),
                    hours_until_critical: Some(hours),
                    confidence: 0.68,
                });
            }
        }
        if cpu >= 90.0 {
            forecasts.push(ResourceExhaustionForecast {
                vm_id: vid.to_string(),
                vm_name: name.clone(),
                resource: "cpu".into(),
                severity: "high".into(),
                message: format!("VM {name} sustained CPU at {cpu:.0}% — latency risk"),
                hours_until_critical: None,
                confidence: 0.62,
            });
        }
    }

    if pool_ratio >= 0.9 {
        forecasts.push(ResourceExhaustionForecast {
            vm_id: "cluster".into(),
            vm_name: "(cluster)".into(),
            resource: "storage".into(),
            severity: "critical".into(),
            message: format!(
                "Storage pool >{:.0}% full — VM IO failures likely",
                pool_ratio * 100.0
            ),
            hours_until_critical: Some(6.0),
            confidence: 0.75,
        });
    }

    forecasts.sort_by(|a, b| {
        b.severity.cmp(&a.severity).then_with(|| {
            a.hours_until_critical
                .partial_cmp(&b.hours_until_critical)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    forecasts.truncate(20);

    Ok(SreForecastReport { forecasts })
}

fn estimate_hours_to_full(ratio: f64) -> f64 {
    let remaining = (1.0 - ratio).max(0.01);
    (remaining * 48.0).clamp(1.0, 168.0)
}

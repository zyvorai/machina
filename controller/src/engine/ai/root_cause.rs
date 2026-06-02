// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct TimelineEntry {
    pub at: DateTime<Utc>,
    pub source: String,
    pub kind: String,
    pub message: String,
    pub severity: String,
}

#[derive(Debug, Serialize)]
pub struct IncidentAnalysis {
    pub window_hours: i32,
    pub timeline: Vec<TimelineEntry>,
    pub root_cause: String,
    pub confidence: f64,
    pub contributing_factors: Vec<String>,
    pub suggested_actions: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnalyzeIncidentQuery {
    #[serde(default = "default_hours")]
    pub hours: i32,
    pub vm_id: Option<Uuid>,
    pub vm_name: Option<String>,
}

fn default_hours() -> i32 {
    4
}

pub async fn analyze(pool: &PgPool, q: &AnalyzeIncidentQuery) -> anyhow::Result<IncidentAnalysis> {
    let hours = q.hours.clamp(1, 72);
    let vm_id = resolve_vm(pool, q.vm_id, q.vm_name.as_deref()).await?;

    let mut timeline = Vec::new();

    let audits: Vec<(DateTime<Utc>, String, String, Option<String>)> = sqlx::query_as(
        "SELECT created_at, actor, action, resource_type
         FROM audit_logs
         WHERE created_at > NOW() - make_interval(hours => $1)
         ORDER BY created_at DESC LIMIT 80",
    )
    .bind(hours)
    .fetch_all(pool)
    .await?;
    for (at, actor, action, rt) in audits {
        timeline.push(TimelineEntry {
            at,
            source: "audit".into(),
            kind: action.clone(),
            message: format!("{actor} — {action}{}", rt.map(|r| format!(" ({r})")).unwrap_or_default()),
            severity: audit_severity(&action),
        });
    }

    let events: Vec<(DateTime<Utc>, String, String)> = sqlx::query_as(
        "SELECT created_at, kind, message FROM events
         WHERE created_at > NOW() - make_interval(hours => $1)
         ORDER BY created_at DESC LIMIT 60",
    )
    .bind(hours)
    .fetch_all(pool)
    .await?;
    for (at, kind, message) in events {
        timeline.push(TimelineEntry {
            at,
            source: "event".into(),
            kind: kind.clone(),
            message: message.clone(),
            severity: if kind.contains("error") || kind.contains("fail") {
                "high".into()
            } else {
                "medium".into()
            },
        });
    }

    let tasks: Vec<(DateTime<Utc>, String, String, Option<Uuid>)> = if let Some(vid) = vm_id {
        sqlx::query_as(
            "SELECT created_at, operation, status, resource_id FROM tasks
             WHERE created_at > NOW() - make_interval(hours => $1)
               AND (resource_id = $2 OR status = 'failed')
             ORDER BY created_at DESC LIMIT 40",
        )
        .bind(hours)
        .bind(vid)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT created_at, operation, status, resource_id FROM tasks
             WHERE created_at > NOW() - make_interval(hours => $1)
             ORDER BY created_at DESC LIMIT 40",
        )
        .bind(hours)
        .fetch_all(pool)
        .await?
    };
    for (at, op, status, _) in tasks {
        timeline.push(TimelineEntry {
            at,
            source: "task".into(),
            kind: op.clone(),
            message: format!("{op} — {status}"),
            severity: if status == "failed" { "high".into() } else { "low".into() },
        });
    }

    timeline.sort_by(|a, b| b.at.cmp(&a.at));
    timeline.truncate(100);

    let (root_cause, confidence, factors, actions) = infer_root_cause(&timeline, vm_id.is_some());
    Ok(IncidentAnalysis {
        window_hours: hours,
        timeline,
        root_cause,
        confidence,
        contributing_factors: factors,
        suggested_actions: actions,
    })
}

/// Merge PacketWolf anomalies and correlations into incident timeline.
pub fn merge_packetwolf(timeline: &mut Vec<TimelineEntry>, packetwolf: &serde_json::Value) {
    let Some(items) = packetwolf.get("anomalies").and_then(|v| v.as_array()) else {
        return;
    };
    for a in items {
        let summary = a
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("PacketWolf security event");
        let severity = a
            .get("severity")
            .and_then(|v| v.as_str())
            .unwrap_or("medium");
        let kind = a.get("kind").and_then(|v| v.as_str()).unwrap_or("security");
        timeline.push(TimelineEntry {
            at: chrono::Utc::now(),
            source: "packetwolf".into(),
            kind: kind.into(),
            message: summary.into(),
            severity: severity.into(),
        });
    }
    timeline.sort_by(|a, b| b.at.cmp(&a.at));
    timeline.truncate(120);
}

async fn resolve_vm(
    pool: &PgPool,
    vm_id: Option<Uuid>,
    vm_name: Option<&str>,
) -> anyhow::Result<Option<Uuid>> {
    if let Some(id) = vm_id {
        return Ok(Some(id));
    }
    if let Some(name) = vm_name.filter(|n| !n.is_empty()) {
        let id: Option<Uuid> = sqlx::query_scalar("SELECT id FROM vms WHERE name = $1")
            .bind(name)
            .fetch_optional(pool)
            .await?;
        return Ok(id);
    }
    Ok(None)
}

fn audit_severity(action: &str) -> String {
    let a = action.to_lowercase();
    if a.contains("delete") || a.contains("fence") {
        "critical".into()
    } else if a.contains("migrate") || a.contains("network") || a.contains("firewall") {
        "high".into()
    } else {
        "medium".into()
    }
}

fn infer_root_cause(
    timeline: &[TimelineEntry],
    vm_scoped: bool,
) -> (String, f64, Vec<String>, Vec<String>) {
    let mut factors = Vec::new();
    let mut actions = Vec::new();

    let storage_hit = timeline.iter().any(|e| {
        e.message.to_lowercase().contains("storage")
            || e.message.to_lowercase().contains("disk")
            || e.message.to_lowercase().contains("pool full")
    });
    let network_hit = timeline.iter().any(|e| {
        e.kind.to_lowercase().contains("network")
            || e.message.to_lowercase().contains("firewall")
            || e.message.to_lowercase().contains("connect")
    });
    let vm_restart = timeline.iter().any(|e| {
        e.message.to_lowercase().contains("restart")
            || e.message.to_lowercase().contains("vm.start")
            || e.message.to_lowercase().contains("vm.stop")
    });
    let failed_task = timeline.iter().any(|e| e.source == "task" && e.severity == "high");

    if storage_hit && vm_restart {
        factors.push("Storage pressure correlated with VM lifecycle change.".into());
        actions.push("Expand storage pool or prune snapshots.".into());
        actions.push("Verify VM disk quotas and backup retention.".into());
        return (
            "Storage pool pressure likely caused VM restart and downstream outage.".into(),
            0.82,
            factors,
            actions,
        );
    }

    if network_hit {
        factors.push("Network or firewall change detected in timeline.".into());
        actions.push("Review recent network policy and route changes.".into());
        actions.push("Run Network Lens reachability check.".into());
        return (
            "Network configuration change likely caused connectivity loss.".into(),
            0.76,
            factors,
            actions,
        );
    }

    if failed_task {
        factors.push("Failed orchestration task in window.".into());
        actions.push("Open Tasks drawer and retry or rollback.".into());
        actions.push("Generate runbook from failed operation.".into());
        return (
            "Failed platform task is the most likely trigger — check task detail and agent logs."
                .into(),
            0.71,
            factors,
            actions,
        );
    }

    if vm_scoped {
        actions.push("Open Zeus SRE for VM health score.".into());
        return (
            "No dominant correlation — review timeline and VM metrics for gradual degradation."
                .into(),
            0.45,
            factors,
            actions,
        );
    }

    actions.push("Narrow analysis with vm_name or vm_id query parameter.".into());
    (
        "Insufficient signal in cluster window — expand hours or scope to a VM.".into(),
        0.35,
        factors,
        actions,
    )
}

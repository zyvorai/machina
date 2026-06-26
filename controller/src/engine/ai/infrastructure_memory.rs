// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct MemoryIncident {
    pub at: DateTime<Utc>,
    pub kind: String,
    pub summary: String,
    pub actor: String,
    pub lesson: String,
}

#[derive(Debug, Serialize)]
pub struct InfrastructureMemory {
    pub incidents: Vec<MemoryIncident>,
    pub runbook_hints: Vec<String>,
}

pub async fn recall(pool: &SqlitePool, limit: i64) -> anyhow::Result<InfrastructureMemory> {
    let cap = limit.clamp(1, 50);

    let mut incidents = Vec::new();

    let structured: Vec<(DateTime<Utc>, String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at), severity, title, summary, root_cause FROM ai_incidents
         ORDER BY created_at DESC LIMIT ?",
    )
    .bind(cap)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for (at, severity, title, summary, root_cause) in structured {
        incidents.push(MemoryIncident {
            at,
            kind: format!("incident:{severity}"),
            summary: if let Some(rc) = root_cause {
                format!("{title} — {rc}")
            } else {
                format!("{title}: {summary}")
            },
            actor: "zeus".into(),
            lesson: "Structured incident from Infrastructure Memory.".into(),
        });
    }

    let rows: Vec<(DateTime<Utc>, String, String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at), actor, action, detail FROM audit_logs
         WHERE action LIKE '%fail%'
            OR action LIKE 'ai.autopilot%'
            OR action LIKE '%migrate%'
            OR action LIKE '%delete%'
         ORDER BY created_at DESC LIMIT ?",
    )
    .bind(cap)
    .fetch_all(pool)
    .await?;

    for (at, actor, action, detail) in rows {
        let lesson = match action.as_str() {
            a if a.contains("fail") => {
                "Review failed task logs before retry; check agent connectivity."
            }
            a if a.contains("autopilot") => {
                "Autopilot action audited — verify guardrails before expanding batch size."
            }
            a if a.contains("migrate") => {
                "Migration events affect placement — check DRS recommendations after."
            }
            a if a.contains("delete") => {
                "Destructive change recorded — ensure approval workflow was followed."
            }
            _ => "Historical infrastructure change — correlate with Mission Control timeline.",
        };
        let summary = detail
            .and_then(|d| d.get("message").and_then(|m| m.as_str()).map(String::from))
            .unwrap_or_else(|| action.clone());
        incidents.push(MemoryIncident {
            at,
            kind: action,
            summary,
            actor,
            lesson: lesson.into(),
        });
    }

    let runbook_hints = vec![
        "Storage full → expand pool, prune snapshots, migrate VMs off hot host.".into(),
        "Network change → run Network Lens reachability before closing incident.".into(),
        "VM restart loop → Zeus SRE score + guest tools health.".into(),
    ];

    Ok(InfrastructureMemory {
        incidents,
        runbook_hints,
    })
}

#[derive(Debug, Serialize)]
pub struct SimilarIncident {
    pub at: DateTime<Utc>,
    pub kind: String,
    pub summary: String,
    pub similarity: f32,
}

#[derive(Debug, Serialize)]
pub struct SimilarIncidentsResult {
    pub query: String,
    pub incidents: Vec<SimilarIncident>,
    pub summary: String,
}

pub async fn similar(
    pool: &SqlitePool,
    query: &str,
    limit: i64,
) -> anyhow::Result<SimilarIncidentsResult> {
    let cap = limit.clamp(1, 20);
    let pattern = format!("%{}%", query.trim());

    let rows: Vec<(DateTime<Utc>, String, String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at), action, actor, detail FROM audit_logs
         WHERE action LIKE ? OR actor LIKE ?
            OR detail LIKE ?
         ORDER BY created_at DESC LIMIT ?",
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .bind(cap)
    .fetch_all(pool)
    .await?;

    let incidents: Vec<SimilarIncident> = rows
        .into_iter()
        .enumerate()
        .map(|(i, (at, action, _actor, detail))| {
            let summary = detail
                .and_then(|d| d.get("message").and_then(|m| m.as_str()).map(String::from))
                .unwrap_or_else(|| action.clone());
            SimilarIncident {
                at,
                kind: action,
                summary,
                similarity: (1.0 - i as f32 * 0.05).max(0.4),
            }
        })
        .collect();

    let summary = if incidents.is_empty() {
        format!("No similar incidents for '{query}' in audit history.")
    } else {
        format!(
            "Found {} similar incident(s) for '{query}'.",
            incidents.len()
        )
    };

    Ok(SimilarIncidentsResult {
        query: query.into(),
        incidents,
        summary,
    })
}

#[derive(Debug, Serialize)]
pub struct ChangeBeforeOutage {
    pub incident_id: Option<String>,
    pub changes: Vec<MemoryIncident>,
    pub summary: String,
}

pub async fn changes_before_outage(
    pool: &SqlitePool,
    incident_id: Option<Uuid>,
    hours_before: i32,
) -> anyhow::Result<ChangeBeforeOutage> {
    let window_start = if let Some(id) = incident_id {
        sqlx::query_scalar::<_, DateTime<Utc>>(
            "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', COALESCE(window_start, created_at)) FROM ai_incidents WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };

    let end = window_start.unwrap_or_else(Utc::now);
    let start = end - chrono::Duration::hours(hours_before.clamp(1, 48) as i64);

    let rows: Vec<(DateTime<Utc>, String, String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at), actor, action, detail FROM audit_logs
         WHERE created_at BETWEEN ? AND ?
           AND (action LIKE '%network%' OR action LIKE '%firewall%' OR action LIKE '%migrate%'
                OR action LIKE '%storage%' OR action LIKE '%delete%' OR action LIKE '%update%')
         ORDER BY created_at ASC LIMIT 50",
    )
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;

    let changes: Vec<MemoryIncident> = rows
        .into_iter()
        .map(|(at, actor, action, detail)| {
            let summary = detail
                .and_then(|d| d.get("message").and_then(|m| m.as_str()).map(String::from))
                .unwrap_or_else(|| action.clone());
            MemoryIncident {
                at,
                kind: action.clone(),
                summary,
                actor,
                lesson: "Configuration change before incident window.".into(),
            }
        })
        .collect();

    Ok(ChangeBeforeOutage {
        incident_id: incident_id.map(|id| id.to_string()),
        summary: format!(
            "{} change(s) in the {}h before incident.",
            changes.len(),
            hours_before
        ),
        changes,
    })
}

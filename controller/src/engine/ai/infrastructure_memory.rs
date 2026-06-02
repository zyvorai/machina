// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;

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

pub async fn recall(pool: &PgPool, limit: i64) -> anyhow::Result<InfrastructureMemory> {
    let cap = limit.clamp(1, 50);

    let rows: Vec<(DateTime<Utc>, String, String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT created_at, actor, action, detail FROM audit_logs
         WHERE action LIKE '%fail%'
            OR action LIKE 'ai.autopilot%'
            OR action LIKE '%migrate%'
            OR action LIKE '%delete%'
         ORDER BY created_at DESC LIMIT $1",
    )
    .bind(cap)
    .fetch_all(pool)
    .await?;

    let mut incidents = Vec::new();
    for (at, actor, action, detail) in rows {
        let lesson = match action.as_str() {
            a if a.contains("fail") => "Review failed task logs before retry; check agent connectivity.",
            a if a.contains("autopilot") => "Autopilot action audited — verify guardrails before expanding batch size.",
            a if a.contains("migrate") => "Migration events affect placement — check DRS recommendations after.",
            a if a.contains("delete") => "Destructive change recorded — ensure approval workflow was followed.",
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

pub async fn similar(pool: &PgPool, query: &str, limit: i64) -> anyhow::Result<SimilarIncidentsResult> {
    let cap = limit.clamp(1, 20);
    let pattern = format!("%{}%", query.trim());

    let rows: Vec<(DateTime<Utc>, String, String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT created_at, action, actor, detail FROM audit_logs
         WHERE action ILIKE $1 OR actor ILIKE $1
            OR detail::text ILIKE $1
         ORDER BY created_at DESC LIMIT $2",
    )
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
        format!("Found {} similar incident(s) for '{query}'.", incidents.len())
    };

    Ok(SimilarIncidentsResult {
        query: query.into(),
        incidents,
        summary,
    })
}

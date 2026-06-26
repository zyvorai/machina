// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Serialize)]
pub struct SiemFirewallExport {
    pub exported_at: String,
    pub event_count: usize,
    pub events: Vec<SiemEvent>,
}

#[derive(Debug, Serialize)]
pub struct SiemEvent {
    pub target_kind: String,
    pub target_id: String,
    pub kind: String,
    pub summary: String,
    pub actor: Option<String>,
    pub created_at: String,
    pub detail: serde_json::Value,
}

pub async fn export_timeline(pool: &SqlitePool, hours: i32) -> anyhow::Result<SiemFirewallExport> {
    let rows: Vec<(
        String,
        uuid::Uuid,
        String,
        String,
        Option<String>,
        chrono::DateTime<chrono::Utc>,
        serde_json::Value,
    )> = sqlx::query_as(
        "SELECT target_kind, target_id, kind, summary, actor, created_at, detail_json
             FROM firewall_timeline
             WHERE created_at >= datetime('now', '-' || ? || ' hours')
             ORDER BY created_at DESC
             LIMIT 5000",
    )
    .bind(hours)
    .fetch_all(pool)
    .await?;

    let events: Vec<SiemEvent> = rows
        .into_iter()
        .map(
            |(target_kind, target_id, kind, summary, actor, created_at, detail)| {
                let mut detail = detail;
                if target_kind == "bare_metal" {
                    if let Some(obj) = detail.as_object_mut() {
                        obj.entry("tag".to_string())
                            .or_insert(serde_json::json!("metal"));
                    } else {
                        detail = serde_json::json!({ "tag": "metal", "raw": detail });
                    }
                }
                SiemEvent {
                    target_kind,
                    target_id: target_id.to_string(),
                    kind,
                    summary,
                    actor,
                    created_at: created_at.to_rfc3339(),
                    detail,
                }
            },
        )
        .collect();
    let event_count = events.len();
    Ok(SiemFirewallExport {
        exported_at: chrono::Utc::now().to_rfc3339(),
        event_count,
        events,
    })
}

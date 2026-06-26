// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::config::ControllerConfig;
use crate::engine::packetwolf_bridge;

pub async fn ingest_recent(pool: &SqlitePool, cfg: &ControllerConfig) -> anyhow::Result<IngestStats> {
    let mut stats = IngestStats::default();
    stats.firewall += ingest_firewall_timeline(pool).await?;
    stats.audit += ingest_audit_logs(pool).await?;
    stats.platform += ingest_platform_events(pool).await?;
    stats.packetwolf += ingest_packetwolf(pool, cfg).await?;
    Ok(stats)
}

#[derive(Debug, Default, serde::Serialize)]
pub struct IngestStats {
    pub firewall: usize,
    pub audit: usize,
    pub platform: usize,
    pub packetwolf: usize,
}

async fn watermark(pool: &SqlitePool, source: &str) -> anyhow::Result<DateTime<Utc>> {
    let ts: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT last_at FROM soc_ingest_watermarks WHERE source = ?")
            .bind(source)
            .fetch_optional(pool)
            .await?;
    Ok(ts.unwrap_or_else(|| Utc::now() - chrono::Duration::days(7)))
}

async fn advance_watermark(pool: &SqlitePool, source: &str, ts: DateTime<Utc>) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE soc_ingest_watermarks SET last_at = CASE WHEN last_at > ? THEN last_at ELSE ? END WHERE source = ?",
    )
    .bind(ts)
    .bind(ts)
    .bind(source)
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_event(
    pool: &SqlitePool,
    occurred_at: DateTime<Utc>,
    source: &str,
    category: &str,
    severity: &str,
    host_id: Option<Uuid>,
    vm_id: Option<Uuid>,
    actor: Option<&str>,
    summary: &str,
    ecs: Value,
    raw_ref: Value,
    dedupe_key: Option<&str>,
) -> anyhow::Result<bool> {
    let r = sqlx::query(
        "INSERT INTO soc_events (id, occurred_at, source, category, severity, host_id, vm_id, actor, summary, ecs_json, raw_ref, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(occurred_at)
    .bind(source)
    .bind(category)
    .bind(severity)
    .bind(host_id)
    .bind(vm_id)
    .bind(actor)
    .bind(summary)
    .bind(ecs)
    .bind(raw_ref)
    .bind(dedupe_key)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

async fn ingest_firewall_timeline(pool: &SqlitePool) -> anyhow::Result<usize> {
    let since = watermark(pool, "firewall_timeline").await?;
    let rows: Vec<(
        String,
        Uuid,
        String,
        String,
        Option<String>,
        DateTime<Utc>,
        Value,
    )> = sqlx::query_as(
        "SELECT target_kind, target_id, kind, summary, actor,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at, detail_json
         FROM firewall_timeline WHERE strftime('%Y-%m-%dT%H:%M:%SZ', created_at) > ? ORDER BY created_at ASC LIMIT 2000",
    )
    .bind(since)
    .fetch_all(pool)
    .await?;

    let mut n = 0usize;
    let mut max_ts = since;
    for (target_kind, target_id, kind, summary, actor, created_at, detail) in rows {
        max_ts = max_ts.max(created_at);
        let severity = firewall_severity(&kind, &detail);
        let host_id = if target_kind == "host" {
            Some(target_id)
        } else {
            None
        };
        let dedupe = format!("fw:{}:{}:{}", target_id, kind, created_at.timestamp());
        let ecs = json!({
            "@timestamp": created_at.to_rfc3339(),
            "event.dataset": "machina.firewall",
            "event.category": ["network"],
            "event.action": kind,
            "event.severity": severity_to_ecs(&severity),
            "message": summary,
            "machina.target.kind": target_kind,
            "machina.target.id": target_id.to_string(),
        });
        if insert_event(
            pool,
            created_at,
            "firewall",
            "firewall",
            &severity,
            host_id,
            None,
            actor.as_deref(),
            &summary,
            ecs,
            json!({ "target_kind": target_kind, "target_id": target_id, "detail": detail }),
            Some(&dedupe),
        )
        .await?
        {
            n += 1;
        }
    }
    if max_ts > since {
        advance_watermark(pool, "firewall_timeline", max_ts).await?;
    }
    Ok(n)
}

fn firewall_severity(kind: &str, detail: &Value) -> String {
    let k = kind.to_lowercase();
    if k.contains("deny") || k.contains("block") {
        return "high".into();
    }
    if detail
        .get("severity")
        .and_then(|v| v.as_str())
        .is_some_and(|s| s == "critical" || s == "high")
    {
        return "high".into();
    }
    if k.contains("warn") {
        return "medium".into();
    }
    "low".into()
}

async fn ingest_audit_logs(pool: &SqlitePool) -> anyhow::Result<usize> {
    let since = watermark(pool, "audit_logs").await?;
    let rows: Vec<(
        Uuid,
        String,
        String,
        Option<String>,
        Option<Uuid>,
        Value,
        DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT id, actor, action, resource_type, resource_id, detail,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
             FROM audit_logs WHERE strftime('%Y-%m-%dT%H:%M:%SZ', created_at) > ? ORDER BY created_at ASC LIMIT 2000",
    )
    .bind(since)
    .fetch_all(pool)
    .await?;

    let mut n = 0usize;
    let mut max_ts = since;
    for (id, actor, action, resource_type, resource_id, detail, created_at) in rows {
        max_ts = max_ts.max(created_at);
        let severity = audit_severity(&action);
        let dedupe = format!("audit:{}", id);
        let ecs = json!({
            "@timestamp": created_at.to_rfc3339(),
            "event.dataset": "machina.audit",
            "event.category": ["authentication", "iam"],
            "event.action": action,
            "event.severity": severity_to_ecs(&severity),
            "user.name": actor,
            "message": format!("{actor} {action}"),
        });
        if insert_event(
            pool,
            created_at,
            "audit",
            "iam",
            &severity,
            None,
            resource_type.as_deref().and_then(|_| resource_id),
            Some(&actor),
            &format!("{actor} {action}"),
            ecs,
            json!({ "audit_id": id, "resource_type": resource_type, "detail": detail }),
            Some(&dedupe),
        )
        .await?
        {
            n += 1;
        }
    }
    if max_ts > since {
        advance_watermark(pool, "audit_logs", max_ts).await?;
    }
    Ok(n)
}

fn audit_severity(action: &str) -> String {
    let a = action.to_lowercase();
    if a.contains("fail") || a.contains("denied") {
        "high".into()
    } else if a.contains("delete") || a.contains("fence") {
        "medium".into()
    } else {
        "low".into()
    }
}

async fn ingest_platform_events(pool: &SqlitePool) -> anyhow::Result<usize> {
    let since = watermark(pool, "platform_events").await?;
    let rows: Vec<(
        Uuid,
        String,
        Option<String>,
        Option<Uuid>,
        String,
        Value,
        DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT id, kind, resource_type, resource_id, message, payload,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
             FROM events WHERE strftime('%Y-%m-%dT%H:%M:%SZ', created_at) > ? ORDER BY created_at ASC LIMIT 1000",
    )
    .bind(since)
    .fetch_all(pool)
    .await?;

    let mut n = 0usize;
    let mut max_ts = since;
    for (id, kind, resource_type, resource_id, message, payload, created_at) in rows {
        max_ts = max_ts.max(created_at);
        let severity = if kind.contains("error") || kind.contains("fail") {
            "high"
        } else {
            "low"
        };
        let dedupe = format!("evt:{}", id);
        let ecs = json!({
            "@timestamp": created_at.to_rfc3339(),
            "event.dataset": "machina.platform",
            "event.action": kind,
            "message": message,
        });
        if insert_event(
            pool,
            created_at,
            "platform",
            "operations",
            severity,
            None,
            resource_type.as_deref().and_then(|_| resource_id),
            None,
            &message,
            ecs,
            json!({ "event_id": id, "payload": payload }),
            Some(&dedupe),
        )
        .await?
        {
            n += 1;
        }
    }
    if max_ts > since {
        advance_watermark(pool, "platform_events", max_ts).await?;
    }
    Ok(n)
}

async fn ingest_packetwolf(pool: &SqlitePool, cfg: &ControllerConfig) -> anyhow::Result<usize> {
    if !cfg.packetwolf_enabled {
        return Ok(0);
    }
    let pw = packetwolf_bridge::fetch_anomalies(cfg).await;
    let anomalies = pw
        .get("anomalies")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut n = 0usize;
    let now = Utc::now();
    for a in anomalies {
        let summary = a
            .get("description")
            .or_else(|| a.get("summary"))
            .and_then(|v| v.as_str())
            .unwrap_or("PacketWolf anomaly");
        let severity = a
            .get("severity")
            .and_then(|v| v.as_str())
            .unwrap_or("medium");
        let host_id = a
            .get("host_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());
        let anomaly_type = a
            .get("anomaly_type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let anomaly_id = a
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let dedupe = if !anomaly_id.is_empty() {
            format!("pw:id:{anomaly_id}")
        } else {
            format!(
                "pw:{}:{}",
                anomaly_type,
                a.get("detected_at").and_then(|v| v.as_str()).unwrap_or("")
            )
        };
        let source_ns = a.get("source_namespace").and_then(|v| v.as_str());
        let source_pod = a.get("source_pod").and_then(|v| v.as_str());
        let ecs = json!({
            "@timestamp": a.get("detected_at").and_then(|v| v.as_str()).unwrap_or(&now.to_rfc3339()),
            "event.dataset": "machina.packetwolf",
            "event.category": ["intrusion_detection"],
            "event.kind": "alert",
            "event.severity": severity_to_ecs(severity),
            "message": summary,
            "machina.packetwolf.anomaly_type": anomaly_type,
            "machina.packetwolf.anomaly_id": anomaly_id,
            "kubernetes.namespace": source_ns,
            "kubernetes.pod.name": source_pod,
            "source.ip": a.get("source_ip"),
        });
        if insert_event(
            pool,
            now,
            "packetwolf",
            "intrusion_detection",
            severity,
            host_id,
            None,
            None,
            summary,
            ecs,
            a.clone(),
            Some(&dedupe),
        )
        .await?
        {
            n += 1;
        }
    }
    advance_watermark(pool, "packetwolf", now).await?;
    Ok(n)
}

fn severity_to_ecs(severity: &str) -> i32 {
    match severity.to_lowercase().as_str() {
        "critical" => 90,
        "high" => 70,
        "medium" => 50,
        "low" => 30,
        _ => 10,
    }
}

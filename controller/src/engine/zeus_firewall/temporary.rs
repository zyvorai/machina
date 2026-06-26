// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
pub struct TemporaryRuleRequest {
    pub target_kind: String,
    pub target_id: Uuid,
    pub source_cidr: String,
    pub dest_port: i32,
    #[serde(default = "default_proto")]
    pub protocol: String,
    pub reason: String,
    pub duration_hours: i32,
    pub owner: Option<String>,
}

fn default_proto() -> String {
    "tcp".into()
}

#[derive(Debug, Clone, Serialize)]
pub struct TemporaryRule {
    pub id: Uuid,
    pub source_cidr: String,
    pub dest_port: i32,
    pub protocol: String,
    pub reason: String,
    pub expires_at: String,
    pub owner: Option<String>,
}

pub async fn create_temporary_rule(
    pool: &SqlitePool,
    req: TemporaryRuleRequest,
) -> anyhow::Result<TemporaryRule> {
    let expires = Utc::now() + Duration::hours(req.duration_hours as i64);
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO firewall_temporary_rules
         (id, target_kind, target_id, source_cidr, dest_port, protocol, reason, owner, expires_at, applied)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)",
    )
    .bind(id)
    .bind(&req.target_kind)
    .bind(req.target_id)
    .bind(&req.source_cidr)
    .bind(req.dest_port)
    .bind(&req.protocol)
    .bind(&req.reason)
    .bind(&req.owner)
    .bind(expires)
    .execute(pool)
    .await?;

    let _ = sqlx::query(
        "INSERT INTO firewall_timeline (id, target_kind, target_id, kind, summary, detail_json, actor) VALUES (?, ?, ?, 'temporary_rule', ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(&req.target_kind)
    .bind(req.target_id)
    .bind(format!(
        "Temporary {} {}:{} for {}h",
        req.protocol, req.source_cidr, req.dest_port, req.duration_hours
    ))
    .bind(serde_json::json!({ "reason": req.reason, "expires_at": expires.to_rfc3339() }))
    .bind(req.owner.as_deref().unwrap_or("system"))
    .execute(pool)
    .await;

    Ok(TemporaryRule {
        id,
        source_cidr: req.source_cidr,
        dest_port: req.dest_port,
        protocol: req.protocol,
        reason: req.reason,
        expires_at: expires.to_rfc3339(),
        owner: req.owner,
    })
}

pub async fn list_temporary_rules(
    pool: &SqlitePool,
    target_id: Uuid,
) -> anyhow::Result<Vec<TemporaryRule>> {
    let rows: Vec<(
        Uuid,
        String,
        i32,
        String,
        String,
        chrono::DateTime<Utc>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT id, source_cidr, dest_port, protocol, reason, expires_at, owner
             FROM firewall_temporary_rules
             WHERE target_id = ? AND applied = true AND expires_at > datetime('now')
             ORDER BY expires_at",
    )
    .bind(target_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, source_cidr, dest_port, protocol, reason, expires_at, owner)| TemporaryRule {
                id,
                source_cidr,
                dest_port,
                protocol,
                reason,
                expires_at: expires_at.to_rfc3339(),
                owner,
            },
        )
        .collect())
}

pub async fn expire_temporary_rules(pool: &SqlitePool) -> anyhow::Result<u64> {
    let rows = sqlx::query(
        "UPDATE firewall_temporary_rules SET applied = false
         WHERE applied = true AND expires_at <= datetime('now')",
    )
    .execute(pool)
    .await?;
    Ok(rows.rows_affected())
}

pub async fn timeline(
    pool: &SqlitePool,
    target_kind: &str,
    target_id: Uuid,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let rows: Vec<(
        String,
        String,
        serde_json::Value,
        Option<String>,
        chrono::DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT kind, summary, detail_json, actor,
                strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at
             FROM firewall_timeline
             WHERE target_kind = ? AND target_id = ?
             ORDER BY created_at DESC LIMIT 100",
    )
    .bind(target_kind)
    .bind(target_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(kind, summary, detail, actor, created_at)| {
            serde_json::json!({
                "kind": kind,
                "summary": summary,
                "detail": detail,
                "actor": actor,
                "created_at": created_at.to_rfc3339(),
            })
        })
        .collect())
}

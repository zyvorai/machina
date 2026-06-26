// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

pub mod elastic_bulk;
pub mod qradar_rest;
pub mod sentinel_dcr;
pub mod splunk_hec;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::SqlitePool;
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
pub struct IntegrationRow {
    pub id: Uuid,
    pub integration_type: String,
    pub name: String,
    pub enabled: bool,
    pub config_json: Value,
}

pub async fn forward_all_integrations(pool: &SqlitePool, controller_id: &str) -> anyhow::Result<usize> {
    let rows: Vec<IntegrationRow> = sqlx::query_as(
        "SELECT id, integration_type, name, enabled, config_json FROM soc_integrations WHERE enabled = TRUE",
    )
    .fetch_all(pool)
    .await?;

    let mut total = 0usize;
    for row in rows {
        let n = match row.integration_type.as_str() {
            "splunk_hec" => splunk_hec::forward(pool, &row, controller_id).await?,
            "elastic_bulk" => elastic_bulk::forward(pool, &row, controller_id).await?,
            "sentinel_dcr" => sentinel_dcr::forward(pool, &row, controller_id).await?,
            "qradar_rest" => qradar_rest::forward(pool, &row, controller_id).await?,
            other => {
                tracing::warn!("unknown soc integration type: {other}");
                0
            }
        };
        total += n;
    }
    Ok(total)
}

pub async fn forward_replay(
    pool: &SqlitePool,
    hours: i32,
    controller_id: &str,
) -> anyhow::Result<usize> {
    let since = Utc::now() - chrono::Duration::hours(hours as i64);
    let _ = sqlx::query("DELETE FROM soc_event_exports WHERE exported_at < ?")
        .bind(since)
        .execute(pool)
        .await;
    forward_all_integrations(pool, controller_id).await
}

pub(crate) async fn fetch_unexported_events(
    pool: &SqlitePool,
    integration_id: Uuid,
    limit: i64,
) -> anyhow::Result<Vec<EventRow>> {
    let rows: Vec<EventRow> = sqlx::query_as(
        "SELECT e.id, e.occurred_at, e.source, e.severity, e.summary, e.ecs_json
         FROM soc_events e
         WHERE NOT EXISTS (
           SELECT 1 FROM soc_event_exports x
           WHERE x.resource_id = e.id AND x.integration_id = ? AND x.resource_type = 'event'
         )
         ORDER BY e.occurred_at ASC
         LIMIT ?",
    )
    .bind(integration_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub(crate) async fn mark_exported(
    pool: &SqlitePool,
    integration_id: Uuid,
    resource_type: &str,
    resource_ids: &[Uuid],
) -> anyhow::Result<()> {
    for id in resource_ids {
        sqlx::query(
            "INSERT INTO soc_event_exports (integration_id, resource_type, resource_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(integration_id)
        .bind(resource_type)
        .bind(id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub(crate) async fn integration_ok(pool: &SqlitePool, id: Uuid) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE soc_integrations SET last_success_at = datetime('now'), last_error = NULL, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub(crate) async fn integration_err(pool: &SqlitePool, id: Uuid, err: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE soc_integrations SET last_error = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(id)
        .bind(err.chars().take(2000).collect::<String>())
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct EventRow {
    pub id: Uuid,
    pub occurred_at: DateTime<Utc>,
    pub source: String,
    pub severity: String,
    pub summary: String,
    pub ecs_json: Value,
}

pub(crate) async fn fetch_unexported_alerts(
    pool: &SqlitePool,
    integration_id: Uuid,
    limit: i64,
) -> anyhow::Result<Vec<AlertRow>> {
    let rows: Vec<AlertRow> = sqlx::query_as(
        "SELECT a.id, a.title, a.severity, a.status, strftime('%Y-%m-%dT%H:%M:%SZ', a.first_seen) AS first_seen, strftime('%Y-%m-%dT%H:%M:%SZ', a.last_seen) AS last_seen, a.detail_json
         FROM soc_alerts a
         WHERE a.last_seen > datetime('now', '-7 days')
         AND NOT EXISTS (
           SELECT 1 FROM soc_event_exports x
           WHERE x.resource_id = a.id AND x.integration_id = ? AND x.resource_type = 'alert'
         )
         ORDER BY a.last_seen ASC
         LIMIT ?",
    )
    .bind(integration_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct AlertRow {
    pub id: Uuid,
    pub title: String,
    pub severity: String,
    pub status: String,
    pub first_seen: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub detail_json: Value,
}

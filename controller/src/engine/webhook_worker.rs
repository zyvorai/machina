// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::time::Duration;

use sqlx::SqlitePool;

use crate::leader::LeaderHandle;

pub fn spawn(pool: SqlitePool, leader: LeaderHandle) {
    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("webhook worker: failed to build HTTP client: {e:#}");
                return;
            }
        };
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            if !leader.is_leader() {
                continue;
            }
            if let Err(e) = process_batch(&pool, &client).await {
                tracing::warn!("webhook worker: {e:#}");
            }
        }
    });
}

async fn process_batch(pool: &SqlitePool, client: &reqwest::Client) -> anyhow::Result<()> {
    let rows: Vec<(uuid::Uuid, String, String, serde_json::Value, i32, i32)> = sqlx::query_as(
        "SELECT id, url, secret, body, attempts, max_attempts FROM webhook_deliveries
         WHERE status = 'pending' AND next_retry_at <= datetime('now')
         ORDER BY next_retry_at LIMIT 20",
    )
    .fetch_all(pool)
    .await?;

    for (id, url, secret, body, attempts, max_attempts) in rows {
        let body_str = body.to_string();
        let mut req = client.post(&url).header("Content-Type", "application/json");
        if !secret.is_empty() {
            if let Some(sig) = crate::engine::webhooks::sign_payload(&secret, &body_str) {
                req = req.header("X-Machina-Signature", format!("sha256={sig}"));
            }
        }
        match req.body(body_str).send().await {
            Ok(resp) if resp.status().is_success() => {
                sqlx::query(
                    "UPDATE webhook_deliveries SET status = 'delivered', last_error = '', attempts = attempts + 1 WHERE id = ?",
                )
                .bind(id)
                .execute(pool)
                .await?;
            }
            Ok(resp) => {
                let err = format!("HTTP {}", resp.status());
                mark_retry(pool, id, attempts, max_attempts, &err).await?;
            }
            Err(e) => {
                mark_retry(pool, id, attempts, max_attempts, &e.to_string()).await?;
            }
        }
    }
    Ok(())
}

async fn mark_retry(
    pool: &SqlitePool,
    id: uuid::Uuid,
    attempts: i32,
    max_attempts: i32,
    err: &str,
) -> anyhow::Result<()> {
    let next = attempts + 1;
    if next >= max_attempts {
        sqlx::query(
            "UPDATE webhook_deliveries SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?",
        )
        .bind(next)
        .bind(err)
        .bind(id)
        .execute(pool)
        .await?;
    } else {
        let backoff_secs = 2_i32.saturating_pow(next as u32).min(300);
        sqlx::query(
            "UPDATE webhook_deliveries SET attempts = ?, last_error = ?,
             next_retry_at = datetime('now', '+' || ? || ' seconds') WHERE id = ?",
        )
        .bind(next)
        .bind(err)
        .bind(backoff_secs)
        .bind(id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

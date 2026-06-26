// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::SqlitePool;
use uuid::Uuid;

pub async fn dispatch_webhooks(pool: &SqlitePool, event_kind: &str, payload: serde_json::Value) {
    let rows: Vec<(Uuid, String, String, sqlx::types::Json<Vec<String>>)> =
        match sqlx::query_as("SELECT id, url, secret, events FROM webhooks WHERE enabled = TRUE")
            .fetch_all(pool)
            .await
        {
            Ok(r) => r,
            Err(_) => return,
        };

    let body = serde_json::json!({
        "kind": event_kind,
        "payload": payload,
    });

    for (webhook_id, url, secret, events) in rows {
        if !events.is_empty() && !events.iter().any(|e| event_matches(e, event_kind)) {
            continue;
        }
        let _ = sqlx::query(
            "INSERT INTO webhook_deliveries (id, webhook_id, url, secret, body, event_kind)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(webhook_id)
        .bind(&url)
        .bind(&secret)
        .bind(&body)
        .bind(event_kind)
        .execute(pool)
        .await;
    }

    let _ = sqlx::query("INSERT INTO notification_outbox (id, kind, payload) VALUES (?, ?, ?)")
        .bind(Uuid::new_v4())
        .bind(event_kind)
        .bind(&payload)
        .execute(pool)
        .await;
}

pub fn event_matches(filter: &str, kind: &str) -> bool {
    filter == "*" || filter == kind || kind.starts_with(filter.trim_end_matches('*'))
}

pub fn sign_payload(secret: &str, body: &str) -> Option<String> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(body.as_bytes());
    Some(hex::encode(mac.finalize().into_bytes()))
}

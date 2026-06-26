// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sqlx::SqlitePool;

#[derive(Clone)]
pub struct LeaderHandle {
    is_leader: Arc<AtomicBool>,
}

impl LeaderHandle {
    pub fn is_leader(&self) -> bool {
        self.is_leader.load(Ordering::Relaxed)
    }
}

pub fn spawn(pool: SqlitePool, controller_id: String) -> LeaderHandle {
    let is_leader = Arc::new(AtomicBool::new(false));
    let handle = LeaderHandle {
        is_leader: is_leader.clone(),
    };
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            match renew_lease(&pool, &controller_id).await {
                Ok(true) => is_leader.store(true, Ordering::Relaxed),
                Ok(false) => is_leader.store(false, Ordering::Relaxed),
                Err(e) => {
                    tracing::warn!("leader election: {e:#}");
                    is_leader.store(false, Ordering::Relaxed);
                }
            }
        }
    });
    handle
}

async fn renew_lease(pool: &SqlitePool, holder_id: &str) -> anyhow::Result<bool> {
    let acquired: bool = sqlx::query_scalar(
        "UPDATE controller_leadership SET holder_id = ?, lease_until = datetime('now', '+15 seconds'),
         updated_at = datetime('now')
         WHERE id = 1 AND (lease_until < datetime('now') OR holder_id = ? OR holder_id = '')
         RETURNING TRUE",
    )
    .bind(holder_id)
    .bind(holder_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or(false);

    if acquired {
        return Ok(true);
    }

    let current: Option<String> =
        sqlx::query_scalar("SELECT holder_id FROM controller_leadership WHERE id = 1")
            .fetch_optional(pool)
            .await?;
    Ok(current.as_deref() == Some(holder_id))
}

// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::time::Duration;

use uuid::Uuid;

use crate::state::AppState;
use crate::tasks::enqueue::enqueue_task;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            if !state.leader.is_leader() {
                continue;
            }
            if let Err(e) = run_due(&state).await {
                tracing::warn!("maintenance scheduler: {e:#}");
            }
        }
    });
}

async fn run_due(state: &AppState) -> anyhow::Result<()> {
    let due: Vec<(Uuid, Uuid, String, bool)> = sqlx::query_as(
        "SELECT id, host_id, action, evacuate FROM maintenance_schedules
         WHERE status = 'pending' AND run_at <= datetime('now') LIMIT 100",
    )
    .fetch_all(&state.pool)
    .await?;

    for (id, host_id, action, evacuate) in due {
        match enqueue_task(
            state,
            "host.maintenance",
            serde_json::json!({
                "host_id": host_id.to_string(),
                "action": action,
                "evacuate": evacuate,
            }),
            Some("host"),
            Some(host_id),
            Some(host_id),
        )
        .await
        {
            Ok(_) => {
                sqlx::query("UPDATE maintenance_schedules SET status = 'queued' WHERE id = ?")
                    .bind(id)
                    .execute(&state.pool)
                    .await?;
            }
            Err(e) => {
                tracing::warn!(schedule_id = %id, "maintenance task enqueue failed, will retry next tick: {}", e.message);
            }
        }
    }
    Ok(())
}

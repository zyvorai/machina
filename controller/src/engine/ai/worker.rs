// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::time::Duration;

use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::auth::AuthUser;
use crate::state::AppState;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        loop {
            if !state.leader.is_leader() {
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue;
            }

            let interval_secs = match get_autopilot_interval_secs(&state.pool).await {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!("ai autopilot worker: {e:#}");
                    0
                }
            };

            if interval_secs <= 0 {
                tokio::time::sleep(Duration::from_secs(60)).await;
                continue;
            }

            if should_run(&state.pool, interval_secs).await {
                run_scheduled_batch(&state).await;
            }

            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

async fn get_autopilot_interval_secs(pool: &SqlitePool) -> anyhow::Result<i32> {
    let v: i32 = sqlx::query_scalar(
        "SELECT ai_autopilot_interval_secs FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_one(pool)
    .await?;
    Ok(v)
}

async fn should_run(pool: &SqlitePool, interval_secs: i32) -> bool {
    let settings = match super::settings::get_ai_settings(pool).await {
        Ok(s) => s,
        Err(_) => return false,
    };
    if settings.mode != "autopilot" {
        return false;
    }

    let last: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT strftime('%Y-%m-%dT%H:%M:%SZ', ai_autopilot_last_run) FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_one(pool)
    .await
    .ok()
    .flatten();

    match last {
        None => true,
        Some(t) => Utc::now().signed_duration_since(t).num_seconds() >= interval_secs as i64,
    }
}

async fn run_scheduled_batch(state: &AppState) {
    let actor = AuthUser {
        username: "autopilot-scheduler".into(),
        role: "operator".into(),
        auth_source: None,
    };

    let max_actions = super::settings::autopilot_max_actions(&state.pool)
        .await
        .unwrap_or(5);

    match super::autopilot::run_safe_batch(state, &actor, None, max_actions).await {
        Ok(result) => {
            tracing::info!(
                "ai autopilot scheduled run: executed {} skipped {}",
                result.executed_count,
                result.skipped_count
            );
            if let Err(e) = sqlx::query("UPDATE clusters SET ai_autopilot_last_run = datetime('now')")
                .execute(&state.pool)
                .await
            {
                tracing::warn!("ai autopilot last_run update: {e:#}");
            }
        }
        Err(e) => {
            tracing::warn!("ai autopilot scheduled run failed: {}", e.message);
        }
    }
}

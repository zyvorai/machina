// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! Shared helpers for engine unit tests: an `AppState` backed by a fresh
//! in-memory SQLite database and an in-memory task bus. Keep the returned
//! receiver alive for the duration of the test — dropping it makes every
//! `enqueue_task` publish fail (useful for exercising enqueue-failure paths).

use std::sync::Arc;

use sqlx::sqlite::SqlitePoolOptions;
use tokio::sync::mpsc::UnboundedReceiver;
use uuid::Uuid;

use crate::config::ControllerConfig;
use crate::leader::LeaderHandle;
use crate::state::AppState;
use crate::tasks::{bus::InMemoryTaskBus, TaskBus, TaskMessage};

/// A fresh, migrated database for one test. Every DB test should start here so the backend a test runs on is chosen in one place.
pub(crate) async fn test_pool() -> crate::db::DbPool {
    // max_connections(1) is load-bearing: sqlx opens `sqlite::memory:` with a
    // PRIVATE cache, so every pooled connection is a separate empty database —
    // only the first one ever sees the migrated schema.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::db::migrate(&pool).await.expect("migrate failed");
    pool
}

pub(crate) async fn test_state() -> (AppState, UnboundedReceiver<TaskMessage>) {
    let pool = test_pool().await;
    let config = Arc::new(ControllerConfig::default());
    let (task_bus, rx) = InMemoryTaskBus::new();
    let task_bus = task_bus as Arc<dyn TaskBus>;
    (
        AppState::new(pool, config, task_bus, LeaderHandle::disconnected()),
        rx,
    )
}

/// Seed one online host and return its id. Keep the INSERT here so every engine
/// test survives hosts-schema changes by editing a single place.
pub(crate) async fn seed_host(pool: &crate::db::DbPool, id: Uuid) -> Uuid {
    crate::db::query("INSERT INTO hosts (id, hostname, state) VALUES (?, 'h1', 'online')")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    id
}

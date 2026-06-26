// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;
use std::time::Duration;
use uuid::Uuid;

pub async fn connect(database_url: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .pragma("foreign_keys", "ON")
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;

    Ok(pool)
}

pub async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::migrate!().run(pool).await?;
    Ok(())
}

pub async fn ensure_bootstrap(
    pool: &SqlitePool,
    admin_user: &str,
    admin_password: &str,
) -> anyhow::Result<()> {
    let cluster_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clusters")
        .fetch_one(pool)
        .await?;
    if cluster_count == 0 {
        let cluster_id = Uuid::new_v4();
        sqlx::query("INSERT INTO clusters (id, name) VALUES (?, ?)")
            .bind(cluster_id)
            .bind("default")
            .execute(pool)
            .await?;
    }

    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;
    if user_count == 0 {
        let hash = bcrypt::hash(admin_password, bcrypt::DEFAULT_COST)?;
        sqlx::query("INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)")
            .bind(Uuid::new_v4())
            .bind(admin_user)
            .bind(hash)
            .bind("admin")
            .execute(pool)
            .await?;
    }

    let host_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hosts")
        .fetch_one(pool)
        .await?;
    if host_count == 0 {
        let cluster_id: Uuid =
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM clusters LIMIT 1")
                .fetch_one(pool)
                .await?;
        sqlx::query(
            "INSERT INTO hosts (id, cluster_id, hostname, address, state, agent_grpc_addr)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(cluster_id)
        .bind("localhost")
        .bind("127.0.0.1")
        .bind("online")
        .bind(
            std::env::var("MACHINA_AGENT_ADDR")
                .unwrap_or_else(|_| "127.0.0.1:50051".into()),
        )
        .execute(pool)
        .await?;
    }

    crate::engine::template_catalog::ensure_default_templates(pool).await?;

    Ok(())
}

pub async fn ensure_machina_db_ownership() -> anyhow::Result<()> {
    Ok(())
}

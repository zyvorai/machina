// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! A fresh, fully migrated database for one test, on whichever backend this build uses. Not part of the public API: it is `pub`
//! only so the integration tests in `controller/tests` can use it too.
//!
//! SQLite: a private in-memory database. PostgreSQL: a new schema in the server named by `TEST_DATABASE_URL`, so tests run in
//! parallel without seeing each other (schemas are left behind; drop them with `scripts/db/pg-test-clean.sh`).

use super::DbPool;

#[cfg(feature = "sqlite")]
pub async fn pool() -> DbPool {
    // max_connections(1) is load-bearing: sqlx opens `sqlite::memory:` with a PRIVATE cache, so every pooled connection is a
    // separate empty database and only the first one would ever see the migrated schema.
    let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    super::migrate(&pool).await.expect("migrate failed");
    pool
}

#[cfg(feature = "postgres")]
pub async fn pool() -> DbPool {
    use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
    use std::str::FromStr;
    let url = std::env::var("TEST_DATABASE_URL")
        .expect("the PostgreSQL build's tests need TEST_DATABASE_URL, for example postgres://machina:machina@127.0.0.1:5432/machina_test");
    let schema = format!("t_{}", uuid::Uuid::new_v4().simple());
    let admin = PgPoolOptions::new().max_connections(1).connect(&url).await.expect("cannot reach TEST_DATABASE_URL");
    sqlx::query(&format!("CREATE SCHEMA {schema}")).execute(&admin).await.unwrap();
    admin.close().await;
    let options = PgConnectOptions::from_str(&url).unwrap().options([("search_path", schema.as_str())]);
    let pool = PgPoolOptions::new().max_connections(4).connect_with(options).await.unwrap();
    super::migrate(&pool).await.expect("migrate failed");
    pool
}

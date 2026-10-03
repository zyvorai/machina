// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

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
        // WAL already gives durability at checkpoint boundaries, so the extra
        // fsync FULL does on every commit is unneeded belt-and-suspenders here
        // and was a real contributor to write-lock hold time under the
        // concurrent writers below (reconcile, channel_worker, webhook_worker,
        // leader election, per-request trace spans, ...).
        .pragma("synchronous", "NORMAL")
        .busy_timeout(Duration::from_secs(5));

    // Deliberately small: SQLite allows exactly one writer no matter how many
    // connections the pool hands out, so a bigger pool doesn't add write
    // throughput — it only admits more simultaneous contenders for that one
    // writer lock. Tried raising this to 16 to help concurrent readers and it
    // made things much worse (queries observed up to 69s): with 16 slots, up
    // to 16 writers (reconcile, channel_worker, webhook_worker, leader
    // election, per-request trace spans, ...) can pile onto the lock at once,
    // and once enough of those are individually stuck in their own 5s
    // busy_timeout, the pool itself saturates — new requests, including plain
    // SELECTs, then queue for a *pool connection* behind a stack of blocked
    // writers. The small pool was accidentally acting as admission control;
    // keep it small until write contention is reduced some other way (see
    // observability::record_trace's prune throttling).
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
    // Reap tasks left 'running' by a worker that died or was restarted mid-task.
    // Nothing else transitions running->failed, so without this they stay
    // 'running' forever (never retried, since a re-publish only matches 'pending')
    // and block reconcile from healing the affected VM.
    //
    // When a STABLE controller id is configured (MACHINA_CONTROLLER_ID), reap only
    // OUR own orphans (+ legacy NULL-owner rows) so we never fail a peer
    // controller's in-flight task in a multi-controller deployment.
    //
    // Without a configured id, this process's own id (`config.controller_id`) is a
    // fresh random value each boot (see config.rs), so claimed_by-scoping would
    // never match our OWN prior-run tasks either — we can't tell "my own orphan"
    // from "a peer's live task" by identity alone in that case. Nothing enforces
    // that MACHINA_CONTROLLER_ID is set in every multi-controller deployment, so
    // do NOT assume "unset" means "single controller, safe to fail every running
    // row": if a peer happens to also be unset, that would fail its in-flight
    // work every time any one of them restarts. Fall back to a staleness check
    // instead: only reap rows that have had no progress in a long time (or were
    // never claimed at all). A live task's `updated_at` is refreshed at claim
    // time and again by any progress update, so a peer's genuinely in-flight task
    // stays well inside the window; a truly orphaned task (worker died, no peer
    // owns it) eventually crosses it and gets recovered on a later restart. The
    // threshold is intentionally generous (some operations — backup/clone of a
    // large disk — may run a long time between progress updates) to bias toward
    // never killing live work over reaping instantly.
    // Select (rather than blind-UPDATE) so each reaped row can be run through
    // finalize_terminal_task_failure below: a task reaped here was 'running',
    // meaning it may already have taken side effects (e.g. ha.recover writing
    // the VM's new host_id) before the controller crashed. A bare status
    // write, as this used to do, skipped set_vm_error/ha.recover's host_id
    // revert/webhook dispatch entirely, leaving that state stranded forever
    // since nothing else ever transitions a 'running' row.
    let reap_rows: Vec<(Uuid, String, serde_json::Value)> =
        if let Some(id) = std::env::var("MACHINA_CONTROLLER_ID").ok().filter(|s| !s.is_empty()) {
            sqlx::query_as(
                "SELECT id, operation, payload FROM tasks \
                 WHERE status = 'running' AND (claimed_by = ? OR claimed_by IS NULL)",
            )
            .bind(id)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as(
                "SELECT id, operation, payload FROM tasks \
                 WHERE status = 'running' \
                   AND (claimed_by IS NULL OR updated_at < datetime('now', '-60 minutes'))",
            )
            .fetch_all(pool)
            .await?
        };
    if !reap_rows.is_empty() {
        tracing::warn!(
            "reaping {} task(s) left in 'running' state after restart",
            reap_rows.len()
        );
        for (task_id, operation, payload) in reap_rows {
            let msg = crate::tasks::TaskMessage {
                task_id,
                operation,
                payload,
            };
            crate::tasks::worker::finalize_terminal_task_failure(
                pool,
                &msg,
                "controller restarted while task was running",
            )
            .await;
        }
    }

    // These three "check count == 0, then insert" blocks are check-then-act:
    // in a multi-controller deployment sharing one DB (see the reaper's
    // MACHINA_CONTROLLER_ID handling above), two controllers can both boot
    // against an empty DB and both observe count == 0 before either commits
    // its insert. clusters.name, users.username, and hosts(cluster_id,
    // hostname) are all UNIQUE, so a plain INSERT would make the loser crash
    // the whole ensure_bootstrap (and thus startup) on a constraint
    // violation instead of just no-op'ing. Use INSERT OR IGNORE so the loser
    // of the race silently defers to whichever controller won it, instead of
    // failing to start.
    let cluster_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clusters")
        .fetch_one(pool)
        .await?;
    if cluster_count == 0 {
        let cluster_id = Uuid::new_v4();
        sqlx::query("INSERT OR IGNORE INTO clusters (id, name) VALUES (?, ?)")
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
        sqlx::query(
            "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
        )
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
            "INSERT OR IGNORE INTO hosts (id, cluster_id, hostname, address, state, agent_grpc_addr)
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

    ensure_native_projects(pool).await?;

    Ok(())
}

/// Backfills a real `projects` row for every distinct project name already in use
/// across `vms.project` / `project_quotas.project` (see migration 020). Existing
/// free-text project filtering elsewhere is untouched — this only gives those same
/// names a stable id for the new project-registry endpoints (`api::projects`) to
/// build membership/roles on top of. Runs every boot (INSERT OR IGNORE), matching
/// `ensure_default_templates`, so a project name introduced later via the legacy
/// free-text path gets backfilled on the next restart.
async fn ensure_native_projects(pool: &SqlitePool) -> anyhow::Result<()> {
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT name FROM (
            SELECT COALESCE(NULLIF(project, ''), 'default') AS name FROM vms
            UNION
            SELECT COALESCE(NULLIF(project, ''), 'default') AS name FROM project_quotas
            UNION
            SELECT 'default' AS name
        )",
    )
    .fetch_all(pool)
    .await?;

    for name in names {
        sqlx::query("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)")
            .bind(Uuid::new_v4())
            .bind(&name)
            .execute(pool)
            .await?;
    }

    Ok(())
}

pub async fn ensure_machina_db_ownership() -> anyhow::Result<()> {
    Ok(())
}

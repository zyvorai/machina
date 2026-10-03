// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sqlx::SqlitePool;

/// Lease duration granted by the DB (`datetime('now','+15 seconds')`).
const LEASE_SECS: i64 = 15;
const RENEW_SECS: u64 = 5;
/// Self-demote this many seconds BEFORE the DB lease actually expires. A challenger
/// can only acquire the lease at `lease_until` (see renew_lease's WHERE clause), so
/// a holder that stops calling itself leader at `lease_until - guard` is guaranteed
/// to have stepped down strictly before anyone else can step up — closing the
/// two-active-leaders window that a cached-only flag left open when the renewal
/// task stalled (GC pause, DB stall) past the lease.
const DEMOTE_GUARD_SECS: i64 = 3;

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Clone)]
pub struct LeaderHandle {
    is_leader: Arc<AtomicBool>,
    /// Unix seconds when our current lease expires (0 = not held).
    lease_until_unix: Arc<AtomicI64>,
}

impl LeaderHandle {
    /// Inert handle for unit tests: no election task, no DB traffic, never leader.
    /// The engine loops gate on leadership in their spawn() wrappers, not in the
    /// per-tick functions tests call directly, so tests never consult this.
    #[cfg(test)]
    pub(crate) fn disconnected() -> Self {
        Self {
            is_leader: Arc::new(AtomicBool::new(false)),
            lease_until_unix: Arc::new(AtomicI64::new(0)),
        }
    }

    /// True only if we hold the lease AND it hasn't (nearly) expired. The clock
    /// check means a stalled renewal task can't leave us falsely believing we're
    /// still leader past the lease.
    pub fn is_leader(&self) -> bool {
        holds_lease(
            self.is_leader.load(Ordering::Relaxed),
            now_unix(),
            self.lease_until_unix.load(Ordering::Relaxed),
        )
    }
}

/// Pure deadline check: we're leader only if the flag is set and we're still
/// safely inside the lease (with the demote guard).
fn holds_lease(flag: bool, now: i64, lease_until: i64) -> bool {
    flag && now < lease_until - DEMOTE_GUARD_SECS
}

pub fn spawn(pool: SqlitePool, controller_id: String) -> LeaderHandle {
    let is_leader = Arc::new(AtomicBool::new(false));
    let lease_until_unix = Arc::new(AtomicI64::new(0));
    let handle = LeaderHandle {
        is_leader: is_leader.clone(),
        lease_until_unix: lease_until_unix.clone(),
    };
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(RENEW_SECS));
        loop {
            interval.tick().await;
            // Capture the time BEFORE the DB round-trip so lease_until is never
            // later than the DB's own `datetime('now','+15s')` (a slow query only
            // makes our deadline more conservative, never less).
            let attempt_at = now_unix();
            match renew_lease(&pool, &controller_id).await {
                Ok(true) => {
                    lease_until_unix.store(attempt_at + LEASE_SECS, Ordering::Relaxed);
                    is_leader.store(true, Ordering::Relaxed);
                }
                Ok(false) => {
                    is_leader.store(false, Ordering::Relaxed);
                    lease_until_unix.store(0, Ordering::Relaxed);
                }
                Err(e) => {
                    tracing::warn!("leader election: {e:#}");
                    is_leader.store(false, Ordering::Relaxed);
                    lease_until_unix.store(0, Ordering::Relaxed);
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

#[cfg(test)]
mod tests {
    use super::{holds_lease, DEMOTE_GUARD_SECS, LEASE_SECS};

    #[test]
    fn not_leader_without_flag() {
        assert!(!holds_lease(false, 1000, 1000 + LEASE_SECS));
    }

    #[test]
    fn leader_within_lease() {
        let now = 1000;
        // Just renewed: lease_until = now + 15, well inside the guard.
        assert!(holds_lease(true, now, now + LEASE_SECS));
    }

    #[test]
    fn self_demotes_before_lease_expiry() {
        let lease_until = 1000;
        // At exactly lease_until we must NOT still claim leadership — a challenger
        // could acquire now. And we step down a guard-window early.
        assert!(!holds_lease(true, lease_until, lease_until));
        assert!(!holds_lease(true, lease_until - DEMOTE_GUARD_SECS, lease_until));
        // A moment before the guard boundary we're still leader.
        assert!(holds_lease(true, lease_until - DEMOTE_GUARD_SECS - 1, lease_until));
    }

    #[test]
    fn stalled_renewal_expires_leadership() {
        // Flag still true (renewal task hung) but the clock has moved past the lease
        // → is_leader must be false, preventing a second active leader.
        let lease_until = 1000;
        assert!(!holds_lease(true, lease_until + 100, lease_until));
    }
}

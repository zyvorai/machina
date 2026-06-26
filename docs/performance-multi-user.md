# Multi-User Performance Guide

This document describes how Machina behaves under concurrent load, known bottlenecks, optimizations implemented in-tree, and deployment guidance for **100+ simultaneous users** on the full stack (daemon + controller + agents + web UI).

## Architecture and load model

```
100+ Browser Sessions
        │
        ├─► Web UI (React)
        │     • /ws/v1/watch (VM state)
        │     • /api/v1/events/stream (SSE)
        │     • REST polling (dashboard, platform shell)
        │
        ├─► machina-daemon (:5092)
        │     • libvirt (single Connect per URI, mutex-guarded)
        │     • In-memory sessions + JSON file auth
        │
        └─► machina-controller (:5093)
              • SQLite (dev) or PostgreSQL (production)
              • Task worker pool → machina-agent (gRPC)
```

Under heavy load, cost scales with:

| Source | Approximate steady load (100 platform tabs) |
|--------|---------------------------------------------|
| WS VM watch (before coordinator) | ~50 `list_all_vms`/sec |
| WS VM watch (after coordinator) | ~0.5 `list_all_vms`/sec |
| Fleet desktop polls (before provider) | ~400 API pairs/min |
| Fleet desktop polls (after provider) | ~100 API pairs/min |

## Service level objectives (100+ users)

| Surface | Metric | Target |
|---------|--------|--------|
| Daemon REST (list VMs) | p95 latency | < 500 ms |
| Controller REST (list VMs/hosts) | p95 latency | < 800 ms |
| WS watch time-to-change | p95 | < 3 s |
| User-initiated task queue wait | p95 | < 10 s |
| Error rate (5xx, pool timeout) | — | < 0.1% |

Validate with the load harness in [`scripts/load-test/`](../scripts/load-test/README.md).

## Implemented optimizations

Week 1 quick wins (landed):

### Daemon

| Change | Module | Effect |
|--------|--------|--------|
| **VmWatchCoordinator** | `daemon/src/vm_watch.rs` | One libvirt poll loop shared by all `/ws/v1/watch` clients; skips polling when zero subscribers |
| **API token cache** | `core/src/libvirt/automation.rs` | 30s TTL + mtime invalidation; avoids disk read on every Bearer request |
| **Session RwLock** | `daemon/src/auth.rs` | Read lock on session validation hot path |
| **Arc config Extension** | `daemon/src/server.rs` | Config loaded once at startup, injected via `Extension<Arc<MachinaConfig>>` |

### Controller

| Change | Module | Effect |
|--------|--------|--------|
| **Configurable DB pool** | `controller/src/db/mod.rs` | `MACHINA_DB_MAX_CONNECTIONS` (default 4 SQLite, 32 Postgres URL) |
| **Parallel task workers** | `controller/src/tasks/worker.rs` | `MACHINA_TASK_WORKERS` (default 4) concurrent task execution |
| **gRPC agent pool** | `controller/src/agent_pool.rs` | Reuses channels per agent address |
| **Trace sampling** | `controller/src/api/observability_middleware.rs` | Records ~10% of requests by default |
| **Deferred API key touch** | `controller/src/api/apikeys.rs` | `last_used_at` update is fire-and-forget |
| **Async bcrypt** | `controller/src/auth.rs` | Basic auth verify on blocking thread pool |
| **Leader-gated loops** | zeus_firewall, operations, vault, fleet_snapshot workers | Passive HA replicas skip periodic work |

### Web frontend

| Change | Module | Effect |
|--------|--------|--------|
| **FleetDesktopProvider** | `web/src/contexts/FleetDesktopContext.tsx` | Single 75s poll for platform shell chrome (~4× reduction) |
| **Mission Control cleanup** | `useMissionControlFleet.ts` | Removed unused parallel fetches |
| **Context memoization** | `WebSocketContext`, `AuthContext` | Fewer subtree re-renders |
| **Dashboard poll** | `Dashboard.tsx` | 30s interval (was 10s) |

## Deployment recommendations (100+ users)

### Database

Use PostgreSQL for production multi-user deployments:

```bash
export DATABASE_URL="postgres://machina:secret@localhost/machina"
export MACHINA_DB_MAX_CONNECTIONS=48
```

SQLite remains the default for single-node dev (`max_connections=4`).

### Controller

```bash
export MACHINA_TASK_WORKERS=8
export MACHINA_RATE_LIMIT_PER_MIN=600
export MACHINA_JWT_SECRET="<64+ char secret>"
```

### Daemon (systemd)

Raise task limits for many concurrent WebSocket/console sessions:

```ini
# /etc/systemd/system/machina-daemon.service.d/performance.conf
[Service]
TasksMax=1024
LimitNOFILE=65535
```

Optional admission control:

```bash
export MACHINA_DAEMON_RATE_LIMIT_PER_MIN=600
export MACHINA_MAX_WS_WATCH=500
```

### Web

Production builds serve static assets from daemon `:5092`. No per-user server state in the frontend — load reduction is achieved by deduplicating polls and centralizing VM watch on the daemon.

## Remaining work (roadmap)

These items are planned but not yet fully implemented:

1. **TanStack React Query** — shared cache and in-flight deduplication for list endpoints
2. **Typed SSE routing** — narrow `refreshKey` fan-out in `PlatformInfoContext`
3. **Batch VM tags API** — eliminate N+1 tag fetches on `VMList`
4. **Postgres migration validation** — audit dialect-specific SQL in handlers
5. **Daemon rate limiting layer** — per-IP/per-user token bucket on HTTP routes
6. **NATS HA task deduplication** — shared DB + leader-only consumption when NATS enabled

## Monitoring checklist

- Daemon HTTP metrics endpoint (p50/p95 latency)
- Controller pool acquire wait time
- Task queue depth and oldest pending task age
- Active WS watch subscribers (`VmWatchCoordinator::receiver_count`)
- libvirt mutex wait time (if instrumented)
- SQLite `database is locked` / Postgres connection errors in logs

## Related docs

- [Platform architecture](platform.md)
- [Fleet HA](fleet-ha.md)
- [Runbook](runbook.md)

---

## Implementation guide (for developers)

The sections below describe exact changes to land the Week 1 quick wins. **Switch to Agent mode** in Cursor to apply these edits (Plan mode allows markdown only).

### 1. Daemon — `VmWatchCoordinator`

**New file:** `daemon/src/vm_watch.rs`

- Single background task polls `list_all_vms()` every 2s via `spawn_blocking`
- Skips polling when `broadcast::Sender::receiver_count() == 0`
- Diffs VM states; emits JSON `{ event: "heartbeat" }` or `{ event: "changes", changes: [...] }`
- Register module in `daemon/src/main.rs`: `mod vm_watch;`

**Modify:** `daemon/src/routes/ws.rs`

- Replace per-client poll loop in `handle_socket` with subscribe-only handler
- WS handler takes `Extension<VmWatchCoordinator>` instead of `State(LibvirtManager)`
- Forward `broadcast::Receiver` messages to WebSocket; handle `RecvError::Lagged`

**Modify:** `daemon/src/server.rs`

```rust
let vm_watch = VmWatchCoordinator::spawn(manager.clone());
// ...
let ws = routes::websocket_routes()
    .layer(Extension(vm_watch))
    // ... existing layers
```

### 2. Daemon — API token cache

**Modify:** `core/src/libvirt/automation.rs`

- Add `TOKEN_CACHE` static with 30s TTL + file mtime check
- `validate_api_token()` uses cache; `save_tokens()` / `create_api_token()` / `delete_api_token()` invalidate cache

### 3. Daemon — session read lock

**Modify:** `daemon/src/auth.rs`

- Change `sessions: Arc<Mutex<HashMap>>` → `Arc<RwLock<HashMap>>`
- `validate_session`: read lock only (no write on successful validation)
- Expired session removal: defer to `create_session` purge or explicit write lock

### 4. Controller — configurable pool + parallel tasks

**Modify:** `controller/src/db/mod.rs`

```rust
let max_connections = std::env::var("MACHINA_DB_MAX_CONNECTIONS")
    .ok()
    .and_then(|v| v.parse().ok())
    .unwrap_or_else(|| {
        if database_url.starts_with("postgres") { 32 } else { 4 }
    });
```

**Modify:** `controller/src/tasks/worker.rs`

```rust
let workers = std::env::var("MACHINA_TASK_WORKERS").ok()
    .and_then(|v| v.parse().ok()).unwrap_or(4);
let sem = Arc::new(Semaphore::new(workers.max(1)));
// spawn process_one inside sem.acquire() per message
```

### 5. Controller — gRPC agent pool

**New file:** `controller/src/agent_pool.rs`

- `Arc<RwLock<HashMap<String, HostAgentClient<Channel>>>>` keyed by normalized agent addr
- Idle timeout 5 min; `get_client(addr)` reuses or reconnects
- Update `agent_client.rs` convenience fns to use pool via `AppState`

### 6. Web — `FleetDesktopProvider`

**New file:** `web/src/contexts/FleetDesktopContext.tsx`

- Single 75s poll interval calling `getFleetDesktop()` + `getFleetLinuxHealth()`
- Export `useFleetDesktopContext()` hook

**Modify:** `web/src/layouts/PlatformLayout.tsx`

```tsx
<FleetDesktopProvider>
  <MissionControlProvider>...</MissionControlProvider>
</FleetDesktopProvider>
```

**Modify:** six consumers to use context instead of `useFleetDesktop()` hook with independent timers:

- `PlatformDynamicIsland.tsx`, `PlatformContextBar.tsx`, `PlatformMacDock.tsx`
- `PlatformJarvisBriefing.tsx`, `MissionControlOverlay.tsx`, `PlatformControlCenter.tsx`

Keep `useFleetDesktop.ts` as thin wrapper over context for backward compatibility.

### 7. Web — quick fixes

- `useMissionControlFleet.ts`: remove unused `listPlatformTasks` / `listMissingTemplateImages` from `Promise.all`
- `Dashboard.tsx`: change poll interval 10s → 30s
- `WebSocketContext.tsx` / `AuthContext.tsx`: wrap provider `value` in `useMemo`

### 8. Load test harness

**New:** `scripts/load-test/README.md` + `scripts/load-test/smoke.js` (k6)

Scenarios: login, GET `/api/v1/vms`, platform fleet-desktop proxy, hold WS watch connection.

### Verification

```bash
# Web (macOS)
cd web && npm run build && npm test

# Rust (Linux host only)
make test
make lint
```

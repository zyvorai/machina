# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Build & Development Commands

**Do not build Rust locally on macOS** — the workspace depends on Linux libvirt headers. Build on a Linux host or via remote deploy.

### Rust workspace (Linux only)
```bash
make build          # debug build (all workspace members)
make release        # optimized release build
make test           # run all Rust tests (cargo test --workspace)
make lint           # clippy with -D warnings
make fmt            # rustfmt all crates
make fmt-check      # check formatting (CI gate)
cargo test -p machina-controller   # single crate
cargo test -p machina-daemon       # single crate
```

### Web frontend (works on macOS)
```bash
cd web && npm run dev       # hot-reload dev server on port 3000
cd web && npm run build     # typecheck + production bundle (web/dist/)
cd web && npm test          # vitest unit tests
cd web && npm run test:e2e  # Playwright smoke tests
```

### Deploy & run
```bash
./machinactl deploy          # build + install + start (recommended)
./machinactl reinstall       # rebuild + reinstall + verify
make && sudo make deploy     # manual equivalent
./scripts/deploy-remote.sh user@host --remote-build   # build on remote Linux host
```

### Dev mode (no install, Linux only)
```bash
./target/debug/machina-daemon    # daemon on :5092
./target/debug/machina-tui       # TUI client
cd web && npm run dev             # UI dev server on :3000, proxied to :5092
```

---

## Architecture Overview

This is a **two-layer platform**: a hypervisor daemon layer and an enterprise control plane.

### Process diagram
```
Web UI (React, :3000 dev / :5092 prod)
    │
    ├─► machina-daemon (:5092)      ← REST + WebSocket, libvirt, PAM auth
    │       │
    │       └─► libvirt / QEMU/KVM (same host)
    │
    └─► machina-controller (:5093)  ← Fleet control plane, Postgres, NATS
            │
            └─► machina-agent (:50051 gRPC)  ← per-host gRPC agent
                    │
                    └─► libvirt / QEMU/KVM (remote host)
```

**`machina-daemon`** is the single-host hypervisor manager (the original product). It owns the REST API at `/api/v1`, handles VNC/SPICE/serial/SSH console proxying, PAM+RBAC auth, and speaks directly to libvirt.

**`machina-controller`** is the multi-host enterprise control plane. It persists state in Postgres (via SQLx), distributes tasks via an in-memory or NATS bus, and communicates with hypervisor hosts through `machina-agent` over gRPC (TLS).

**`machina-agent`** runs on each managed hypervisor. It exposes a gRPC service (`spec/` proto), executes libvirt operations, and provides console WebSocket proxying.

The **web UI** proxies all `/api/...` and `/ws/...` requests to `machina-daemon` in development (see `web/vite.config.ts`). Platform (controller) calls go through `/api/v1/platform/controller` on the daemon, which reverse-proxies to the controller at `:5093`.

---

## Workspace Crates

| Crate | Binary | Role |
|-------|--------|------|
| `core` | — | Shared types: VM/host/config structs, libvirt helpers, XML builders, audit, fleet placement |
| `daemon` | `machina-daemon` | Single-host REST+WS API server (Axum/Tokio), auth, console proxies |
| `controller` | `machina-controller` | Multi-host control plane: fleet, HA, DRS, AI engine, SQLite embedded, NATS tasks |
| `agent` | `machina-agent` | Per-host gRPC agent (tonic) executing libvirt ops for the controller |
| `tui` | `machina-tui` / `machina` | Terminal UI (ratatui) |
| `spec` | — | Declarative VM/cluster spec types (Serde structs mirroring the gRPC proto) |
| `translate` | — | libvirt domain XML → internal type translation, QEMU command helpers |
| `rvb` | — | RVB (reverse bridge) helpers |
| `guac-bridge` | — | Apache Guacamole JSON-auth token library |
| `virt-image-build` | — | virt-builder / Packer golden image job runner |

---

## Controller Architecture

`controller/src/` layout:

- **`api/`** — Axum route handlers; one file per feature area (e.g. `api/vms.rs`, `api/fleet.rs`, `api/ai.rs`). All routes are assembled in `api/mod.rs`.
- **`engine/`** — Background engine modules: `ha.rs` (HA failover), `drs.rs` (distributed resource scheduling), `reconcile.rs` (desired-state reconciliation), `scheduler.rs`, `webhook_worker.rs`. The AI sub-engine lives in `engine/ai/` with dozens of specialized modules (`llm.rs`, `agents.rs`, `actions.rs`, `providers.rs`, etc.).
- **`db/`** — SQLx Postgres queries, migrations, bootstrap.
- **`tasks/`** — Async task bus abstraction: `InMemoryTaskBus` + optional `NatsTaskBus`; `worker.rs` processes tasks; `nats_subscriber.rs` bridges NATS → local bus.
- **`state.rs`** — `AppState` holds config, DB pool, task bus, and agent client.
- **`agent_client.rs`** — gRPC client to `machina-agent`.
- **`consolehub.rs`** — Console session management (Guacamole or built-in proxy).
- **`auth.rs`**, **`jwt.rs`** — JWT-based auth for the controller (separate from daemon PAM auth).
- **`sync.rs`** — Periodic sync loops (KubeVirt inventory, storage, etc.).

### Controller config (env vars)
```
DATABASE_URL          sqlite:///var/lib/machina/controller.db   (embedded, no PostgreSQL needed)
NATS_URL              nats://127.0.0.1:4222   (optional, enables NATS task fan-out)
MACHINA_AGENT_ADDR    http://127.0.0.1:50051
MACHINA_JWT_SECRET    change-me
MACHINA_PUBLIC_URL    http://127.0.0.1:5093
MACHINA_WEB_URL       http://127.0.0.1:5173
GUESTKIT_ENABLED      true
PACKETWOLF_ENABLED    false
```

---

## Web Frontend Structure

`web/src/`:

- **`pages/`** — One file per route. Classic daemon-backed pages (e.g. `VMList.tsx`, `Dashboard.tsx`) live at the top level. Platform (controller) pages live in `pages/platform/` and are prefixed `Platform*`. OpenStack pages are prefixed `OpenStack*`.
- **`components/`** — Shared UI components. Glass design system components (`GlassCard`, `GlassButton`, `GlassModal`, `GlassInput`, `GlassTabs`) are in `components/glass/`. AI/Zeus components are in `components/ai/`. Platform shell components are in `components/consolehub/`.
- **`api/`** — One TypeScript module per API domain. `client.ts` is the base fetch wrapper. `platform.ts` sets the controller proxy base URL. Files prefixed `platform*` call the controller; others call the daemon.
- **`contexts/`** — React contexts: `AuthContext`, `ThemeContext`, `WebSocketContext` (WS live updates), `AiContext`, `PlatformInfoContext`, `ToastContext`.
- **`hooks/`** — Custom hooks for keyboard shortcuts, fleet settings, console access policy, SSH, K8s context, etc.

### Route structure
- `/` and `/vms/*` — Classic daemon-backed hypervisor UI
- `/platform/*` — Enterprise platform shell (controller-backed); uses `PlatformLayout` with its own sidebar/nav
- `/openstack/*` — OpenStack management pages
- `/fleet` — Multi-host fleet overview

### Dev proxy
In `npm run dev` mode, Vite proxies `/api` and `/ws` to `https://localhost:5092` (daemon). Platform API calls flow through `/api/v1/platform/controller` on the daemon, which reverse-proxies to the controller at `:5093`.

---

## Daemon Config

Config resolution order: `--config` CLI flag → `/etc/machina/config.toml` → `~/.machina/config.toml` → built-in defaults.

Key sections: `[daemon]` (host/port), `[libvirt]` (URI), `[auth]` (PAM service, OIDC, SAML, LDAP, run-as-user), `[tls]`, `[backup]`, `[fleet]` (peer list), `[metrics_history]`, `[observability.otlp]`.

Default port: **5092** (daemon), **5093** (controller), **50051** (agent gRPC).

---

## Design System

The UI uses **Liquid Glass** — inspired by macOS Tahoe. Dark theme applies translucent glass tokens by default. Reusable primitives are in `web/src/components/glass/`. The login page uses `PremiumLoginShell` with `variant="macos"`. Framer Motion handles spring animations on modals/toasts.

Platform desktop has three density tiers (Normal / Power User / Advanced), switchable via Settings → Appearance. The `usePlatformDesktopTier` hook reads the current tier.

---

## Testing

- **Rust unit tests**: `cargo test --workspace` or `cargo test -p <crate>`
- **Web unit tests**: `cd web && npm test` (vitest)
- **Web E2E**: `cd web && npm run test:e2e` (Playwright; requires a running daemon)
- **API smoke test**: `./machinactl verify` or `VSPASS=… ./scripts/e2e-test.sh https://HOST:5092 USER`
- **30-step API demo**: `sudo ./scripts/demo.sh`

---

## Adding a New Platform Page

Three steps are always required:

**Step 1** — Create `web/src/pages/platform/PlatformFoo.tsx`.

**Step 2** — Lazy-import and register the route in `web/src/App.tsx`:
```tsx
const PlatformFoo = lazy(() => import('./pages/platform/PlatformFoo'))
// inside AuthenticatedShellRoutes:
<Route path="/platform/foo" element={<PlatformFoo />} />
```

**Step 3** — Add a nav entry and breadcrumb label in `web/src/utils/routes.ts`:
```ts
// in navGroups, under the appropriate section:
{ to: '/platform/foo', icon: <SomeIcon className="w-4 h-4" />, label: 'Foo' }

// in routeLabels:
'/platform/foo': 'Foo',
```

Classic daemon pages follow the same pattern but live in `web/src/pages/` (no `Platform` prefix) and use non-`/platform/*` routes.

---

## Web API Patterns

**Helper functions** (`web/src/api/client.ts`):
- `apiGet<T>(path)`, `apiPost<T>(path, body)`, `apiPut`, `apiPatch`, `apiDelete`
- `readJsonArray<T>(path)` — response is a JSON array
- `readJsonItemsList<T>(path)` — response is `{ items: T[] }`

**Daemon vs platform routing**:
- Daemon calls — `apiGet('/api/v1/vms')` (dev proxy routes to `:5092`)
- Platform/controller calls — prefix with `PLATFORM_CONTROLLER_PROXY = '/api/v1/platform/controller'` from `web/src/api/platform.ts`. Never call `:5093` directly.

**Error handling**: wrap thrown errors with `formatUserError(e)` (`web/src/utils/apiError.ts`) before passing to `toast.error()`. This extracts `error_code`/`remediation` from JSON error bodies and handles HTML proxy error pages gracefully.

**Toasts**: `const toast = useToastContext()` → `toast.success(msg)` / `toast.error(msg)` / `toast.warning(msg)`. Already wired in `App.tsx`.

---

## Controller Handler Pattern

All handlers live in `controller/src/api/<feature>.rs` and are registered in `controller/src/api/mod.rs`.

**Signature**:
```rust
pub async fn my_handler(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,  // omit if public
    Path(id): Path<Uuid>,                   // or Query(q): Query<MyQuery>
    Json(req): Json<MyRequest>,             // omit for GET/DELETE
) -> Result<Json<MyResponse>, ApiError> {
    // sqlx query, task dispatch, etc.
    Ok(Json(response))
}
```

**Error builders** (`controller/src/api/error.rs`):
```rust
ApiError::not_found("vm not found")
ApiError::bad_request("invalid field")
ApiError::conflict("already exists", "delete it first")
ApiError::internal("unexpected failure")
// chain: .with_code("my_code").with_remediation("try X")
```
`sqlx::Error::RowNotFound` auto-converts to 404; pg unique-constraint violation (23505) auto-converts to 409.

**Async tasks** — for long-running operations return a task instead of blocking:
```rust
let task = enqueue_task(&state, "vm.migrate", Some(vm_id), json!({"target": host_id})).await?;
Ok(Json(task))  // TaskResponse { task_id, status, operation }
```
Frontend polls `/api/v1/tasks/{task_id}`.

---

## Extra Environment Variables

**Controller**:
- `MACHINA_SKIP_AUTH=1` — disables JWT auth (dev only)
- `MACHINA_CONTROLLER_ID` — unique instance ID
- `MACHINA_DAEMON_URL` — URL the controller uses to reach the daemon
- `MACHINA_GUACAMOLE_JSON_SECRET_HEX` — Guacamole JSON-auth token secret
- `MACHINA_API_KEY_MASTER_KEY` — 64-char hex (32 bytes) AES-256-GCM master key for encrypting LLM provider API keys at rest. Unset = plaintext (dev/legacy). Generate: `openssl rand -hex 32`

**Web (Vite)**:
- `VITE_MACHINA_CONTROLLER_URL` — point the web UI directly at the controller (bypasses daemon proxy; useful for standalone web dev)

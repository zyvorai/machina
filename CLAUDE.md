# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

New to the project? Start with [docs/ENGINEERING_ONBOARDING.md](docs/ENGINEERING_ONBOARDING.md) — a day-by-day plan from repo access to a verified first deploy.

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

### Live regression (CDP page sweep + API; needs deployed host)
```bash
make regression-setup
export MACHINA_BASE_URL=https://HOST:5092 MACHINA_USER=sus MACHINA_PASS=max
./scripts/regression/chrome-launch.sh &   # CDP :9222
make regression-api LOOPS=1               # no Chrome needed
make regression-ops                       # power / screenshot / volumes
make regression-mission                   # fleet activity / reports / Atlas
make regression-catalog                   # guest-health / network CRUD / HA
make regression-pages LOOPS=1             # needs CDP
# continuous: cd scripts/regression && node page-sweep.js --forever
# see scripts/regression/README.md
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
| `spec` | — | Declarative VM/cluster spec types (Serde structs mirroring the gRPC proto) |
| `translate` | — | libvirt domain XML → internal type translation, QEMU command helpers |
| `rvb` | — | RVB (reverse bridge) helpers |
| `virt-image-build` | — | virt-builder / Packer golden image job runner |
| `vessel-core` | — | Podman/Docker container engine (bollard + Podman libpod API) |

---

## Controller Architecture

`controller/src/` layout:

- **`api/`** — Axum route handlers; one file per feature area (e.g. `api/vms.rs`, `api/fleet.rs`, `api/ai.rs`). All routes are assembled in `api/mod.rs`.
- **`engine/`** — Background engine modules: `ha.rs` (HA failover), `drs.rs` (distributed resource scheduling), `reconcile.rs` (desired-state reconciliation), `scheduler.rs`, `webhook_worker.rs`. The AI sub-engine lives in `engine/ai/` with dozens of specialized modules (`llm.rs`, `agents.rs`, `actions.rs`, `providers.rs`, etc.).
- **`db/`** — SQLx Postgres queries, migrations, bootstrap.
- **`tasks/`** — Async task bus abstraction: `InMemoryTaskBus` + optional `NatsTaskBus`; `worker.rs` processes tasks; `nats_subscriber.rs` bridges NATS → local bus.
- **`state.rs`** — `AppState` holds config, DB pool, task bus, and agent client.
- **`agent_client.rs`** — gRPC client to `machina-agent`.
- **`consolehub.rs`** — Console session management (native VNC/SPICE/serial proxies).
- **`auth.rs`**, **`jwt.rs`** — JWT-based auth for the controller (separate from daemon PAM auth).
- **`sync.rs`** — Periodic sync loops (KubeVirt inventory, storage, etc.).

### Controller config (env vars)
```
DATABASE_URL          sqlite:///var/lib/machina/controller.db   (embedded, no PostgreSQL needed)
NATS_URL              nats://127.0.0.1:4222   (optional, enables NATS task fan-out)
MACHINA_AGENT_ADDR    http://127.0.0.1:50051
MACHINA_JWT_SECRET    (random per-process secret if unset; controller refuses to boot on the well-known dev literal unless MACHINA_ALLOW_DEV_SECRETS=1)
MACHINA_PUBLIC_URL    http://127.0.0.1:5093
MACHINA_WEB_URL       http://127.0.0.1:5173
GUESTKIT_ENABLED      true
PACKETWOLF_ENABLED    false
```

---

## Web Frontend Structure

`web/src/`:

- **`pages/`** — One file per route. Classic daemon-backed pages (e.g. `VMList.tsx`, `Dashboard.tsx`) live at the top level. Platform (controller) pages live in `pages/platform/` and are prefixed `Platform*`. Fleet Cloud pages live at `/fleet-cloud/*` and are prefixed `FleetCloud*` (e.g. `FleetCloudInstances.tsx`). The legacy external-cloud client integration this used to gate on has been fully removed — Fleet Cloud is entirely native now, backed by the controller's own APIs.
- **`components/`** — Shared UI components. Glass design system components (`GlassCard`, `GlassButton`, `GlassModal`, `GlassInput`, `GlassTabs`) are in `components/glass/`. AI/Zeus components are in `components/ai/`. Platform shell components (`GlobalBar`, `SideNav`, `ChapterBar`) are in `components/nav/`; `components/consolehub/` holds the console UI (`CinemaShell`, `ConsoleHubShell`, etc.), not the shell chrome.
- **`api/`** — One TypeScript module per API domain. `client.ts` is the base fetch wrapper. `platform.ts` sets the controller proxy base URL. Files prefixed `platform*` call the controller; others call the daemon.
- **`contexts/`** — React contexts: `AuthContext`, `ThemeContext`, `WebSocketContext` (WS live updates), `AiContext`, `PlatformInfoContext`, `ToastContext`, `BreadcrumbNameContext` (per-page breadcrumb label override).
- **`hooks/`** — Custom hooks for keyboard shortcuts, fleet settings, console access policy, SSH, K8s context, etc.

### Route structure
- `/` and `/vms/*` — Classic daemon-backed hypervisor UI
- `/containers` and `/containers/pods` — Local Podman/Docker containers and Podman pods (Vessel)
- `/platform/*` — Enterprise platform shell (controller-backed); uses `PlatformLayout` with its own sidebar/nav
- `/fleet-cloud/*` — "Fleet Cloud" UI (renamed from its old route; no redirect — old links 404). Backed entirely by Machina's own native controller APIs for every page: flavors, images/templates, instances/VMs, volumes, security groups, stacks, projects, server groups, floating IPs via port-forwards, keypairs, and load balancers (`controller/src/api/load_balancers.rs` + `controller/src/engine/load_balancer.rs` — a weighted round-robin iptables rule set pushed to the owning host's agent, no amphora VM). The legacy external-cloud client integration (compute/image/network/identity management, disk push/pull) has been fully removed from core and daemon.
- `/fleet` — Multi-host fleet overview

### Dev proxy
In `npm run dev` mode, Vite proxies `/api` and `/ws` to `https://localhost:5092` (daemon). Platform API calls flow through `/api/v1/platform/controller` on the daemon, which reverse-proxies to the controller at `:5093`.

---

## Daemon Config

Config resolution order: `--config` CLI flag → `/etc/machina/config.toml` → `~/.machina/config.toml` → built-in defaults.

Key sections: `[daemon]` (host/port), `[libvirt]` (URI), `[auth]` (PAM service, OIDC, SAML, LDAP, run-as-user), `[tls]`, `[backup]`, `[fleet]` (peer list), `[vessel]` (Podman/Docker socket), `[metrics_history]`, `[observability.otlp]`.

**Golden Forge** (`POST /api/v1/jobs/packer-golden-build`): Linux guest ids run `contrib/packer/build-linux-image.sh`. Windows `win10` / `win11` run `contrib/packer/build-windows-dockur.sh` (Podman + KVM) only when `[libvirt] dockur_windows_allowed = true`. See `contrib/packer/windows-dockur/README.md` and `docs/handbook/admin-configuration.md`.

Default port: **5092** (daemon), **5093** (controller), **50051** (agent gRPC).

---

## Design System

The UI follows **apple.com / Zeus OS** contracts — see [docs/design/APPLE-UX-CONTRACT.md](docs/design/APPLE-UX-CONTRACT.md) and [docs/design/DAYLIGHT-CONTRACT.md](docs/design/DAYLIGHT-CONTRACT.md).

- **Shell:** `GlobalBar` (top bar with product flyouts) + `SideNav` + `ChapterBar` in `layouts/PlatformLayout.tsx`; the Mac menubar, icon rail and dock are gone. Default theme: **Apple light** (`tahoe-light`). The current look lives in `web/src/styles/netra-look.css` (loaded last; namespace new tokens `--nl-*`). Audit UI changes with `node web/scripts/ux-audit.mjs` (see `docs/design/APPLE-UX-CONTRACT.md`).
- **Story / Browse / Work** tiers: `apple-story-stack`, `TahoeToolbar`, `.tahoe-glass-card`; VM detail leads with [`VmConsoleHeroPreview`](web/src/components/vm/VmConsoleHeroPreview.tsx).
- **Interactive blue:** apple.com `#0071e3` (CTAs, links, focus, sidebar active). Dark links `#2997ff`.
- **Box fonts:** Apple shop `.form-selector` 1:1 — `--text-primary/secondary/muted` (`#1d1d1f` / `#6e6e73` / `#86868b` light; `#f5f5f7` / `#a1a1a6` / `#86868b` dark) in `zeus-parity.css`.
- **Story type:** AirPods-scale `.apple-display` / `.apple-lede` (SF Pro Display).
- **Login:** [`PremiumLoginShell`](web/src/components/PremiumLoginShell.tsx) + [`zyvor-premium-login.css`](web/src/styles/zyvor-premium-login.css) — one centered composition, hero wordmark **machina**.
- Glass primitives remain in `web/src/components/glass/`. Framer Motion handles spring animations on modals/toasts.

Platform desktop has three density tiers (Normal / Power User / Advanced), switchable via Settings → Appearance. The `usePlatformDesktopTier` hook reads the current tier.

---

## Testing

- **Rust unit tests**: `cargo test --workspace` or `cargo test -p <crate>`
- **Web unit tests**: `cd web && npm test` (vitest)
- **Web E2E**: `cd web && npm run test:e2e` (Playwright; requires a running daemon)
- **API smoke test**: `./machinactl verify` or `VSPASS=… ./scripts/e2e-test.sh https://HOST:5092 USER`
- **Media / guest-tools features**: `./scripts/feature-test.sh HOST USER PASS` — ISO upload+download jobs, CD-ROM lifecycle, guest-agent channel, console plan. Default VM is `win10-msedge` (`os_hint=windows`); for Linux smoke VMs set `VM=chrome-e2e-vm` or `VM=iw-e2e-1` (`os_hint=linux`). CD-ROM auto-target must be unoccupied (virtio-root Linux often gets free SATA `sda`). Asserts each feature's failure mode too, not just the happy path.
- **GuestKit live matrix**: `./scripts/guestkit-live-matrix.sh` (suites A–F; `--with-offline` for G; `--case ID` to retest). Auth via SSH + `https://127.0.0.1:5092` on the host. Report: `/tmp/guestkit-matrix.md`.
- **Customer site readiness**: [docs/CUSTOMER_SITE_READINESS.md](docs/CUSTOMER_SITE_READINESS.md) — pilot gate, checklist, acceptance tests.
- **Live regression RESULTS**: [scripts/regression/RESULTS.md](scripts/regression/RESULTS.md)
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
- `MACHINA_API_KEY_MASTER_KEY` — 64-char hex (32 bytes) AES-256-GCM master key for encrypting LLM provider API keys at rest. Unset = plaintext (dev/legacy). Generate: `openssl rand -hex 32`

**PacketWolf integration** (controller ↔ `../packetwolf`'s real Rust `web-api`; TC egress allowlist enforcement (`tc_allow`/`allow_port` policies), SIEM export, network intelligence — confirmed wire-compatible with `packetwolf_bridge.rs`/`packetwolf_enforcement.rs` with **zero Machina code changes**: `PACKETWOLF_ENABLED=1` + `PACKETWOLF_BASE_URL` pointed at a running instance is auto-detected via `production_enforcement_mode()`'s `/api/v1/anomalies` probe):
- `PACKETWOLF_ENABLED=1`, `PACKETWOLF_BASE_URL` (default `http://127.0.0.1:9091`; the real service's own default port is `9191` — set explicitly), `PACKETWOLF_API_KEY`, `PACKETWOLF_INSECURE_TLS=1` — same fields as always, just now confirmed against a real backend rather than a fabric that didn't exist anywhere.
- Deploying `../packetwolf`'s `web-api` needs: `JWT_SECRET` (32+ chars), a reachable Redis (`REDIS_URL`), and **`/var/lib/packetwolf` to exist and be writable** by the service user — its rules-PUT handler snapshots there unconditionally and 500s if the directory is missing (not created for you). `NETPRED_ENFORCE_BPF_PATH` (built via `cargo +nightly build --manifest-path netpred-ebpf/Cargo.toml --release --target bpfel-unknown-none -Z build-std=core`, needs `bpf-linker` — the prebuilt `*-unknown-linux-musl` release binary from GitHub avoids the system-LLVM version-matching pain `cargo install bpf-linker` runs into) is required for `attach`/apply to do anything real.
- **Verified live**: status/create/list/delete for a `tc_allow` policy through Machina's own API against a real running instance — the rule round-trips exactly (`dstIpv4`/`dstPort`/`defaultDeny` camelCase match). **Deliberately not verified**: calling `attach` (`POST /api/v1/runtime/enforcement/attach`) against a real network interface — with `defaultDeny: true` and no allow rules yet approved, the compiled eBPF program (`netpred-ebpf/src/enforce.rs`) drops every non-allowed IPv4 TCP/UDP egress packet on whichever interface it's attached to; on a shared host with only a physical uplink (no per-cgroup scoping like Netra has), that's a real risk of severing the host's own connectivity, not a lab-safe action to demonstrate blind.
- The `MachinaClient` in `../packetwolf`'s `web-api/src/services/machina.rs` expects Machina to expose `GET /api/v1/vms`, `POST /api/v1/hostfw/apply {host,kind,name,ruleset}`, `POST /api/v1/hostfw/remove`, `GET /api/v1/hostfw/status` for host-backend (nftables/nwfilter) enforcement — **none of these routes exist yet**. `core/src/firewall/adapters/nftables.rs`/`metal.rs` are inventory/planning only, not a live rule-application backend, so this is new work (shelling out to `nft` or equivalent), not just route wiring — not attempted in this pass.

**Atlas storage integration** (controller ↔ `../atlas` Zyvor storage control plane; VM disks as Ceph/NFS/ZFS volumes, snapshot/backup/restore via Atlas):
- `ATLAS_ENABLED=1` — enable the Atlas integration (default off). Surfaces the Platform → **Storage (Atlas)** page and `/api/v1/atlas/*`.
- `ATLAS_BASE_URL` — Atlas gateway URL (default `http://127.0.0.1:5110`)
- `ATLAS_TOKEN` — service-account JWT (Atlas `POST /auth/tokens`), sent as bearer when Atlas runs with `ATLAS_AUTH_REQUIRED=1`
- `ATLAS_INSECURE_TLS=1` — accept a self-signed Atlas gateway cert
- `ATLAS_TENANT_ID` (default `machina`), `ATLAS_DEFAULT_POLICY` (default `general`) — recorded on VM volumes / intent→placement
- `ATLAS_BACKUP_BUCKET_ID` — default bound RGW bucket for VM backups
- `ATLAS_RBD_MON_HOSTS` (comma `host:port`), `ATLAS_RBD_AUTH_USER`, `ATLAS_RBD_SECRET_UUID` — Ceph connection params used to attach an Atlas RBD volume as a libvirt network disk. Atlas supplies the per-volume `pool/image`; these supply the monitors + cephx secret (a libvirt `ceph` secret). Empty = rely on the hypervisor's `ceph.conf`/keyring. Create a VM on Atlas storage by passing `atlas_root_disk: true` (+ optional `atlas_policy`) to `POST /api/v1/vms`.

**Netra integration** (controller ↔ `../netra` standalone eBPF network enforcement; real kernel-level IP/CIDR deny rules and a leased enforce/observe kill-switch, via netrad's own REST API — Netra and PacketWolf are separate products with no shared API, see `packetwolf_enforcement.rs`):
- `NETRA_ENABLED=1` — enable the Netra integration (default off). Backs the `deny_ip` runtime-enforcement policy kind (`/api/v1/zeus-security/enforcement/*`) with real live rules instead of the Tetragon-simulated local store.
- `NETRA_BASE_URL` — netrad base URL (default `http://127.0.0.1:30870`)
- `NETRA_API_KEY` — bearer token for netrad (matches `NETRA_API_KEY` on the netrad/netra-agent side; see `~/.netra/env` from a `netractl install`/standalone deploy)
- `NETRA_INSECURE_TLS=1` — accept a self-signed netrad cert
- `NETRA_ENFORCE_LEASE` (default `15m`) — lease duration requested when a `deny_ip` policy is applied (`PUT /api/v1/ebpf/mode?lease=`); Netra clamps to [1m, 24h] and auto-reverts to `observe` (fail-open) when the lease expires, regardless of controller state.

**Web (Vite)**:
- `VITE_MACHINA_CONTROLLER_URL` — point the web UI directly at the controller (bypasses daemon proxy; useful for standalone web dev)

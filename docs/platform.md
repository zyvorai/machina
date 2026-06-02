# Machina Platform Control Plane

vCenter-style centralized management for libvirt/KVM. libvirt remains the engine; operators interact with a declarative API and UI, never raw domain XML.

## Architecture

```text
Web UI (/platform/*)  →  machina-controller  →  gRPC  →  machina-agent  →  libvirt
                              ↓
                         PostgreSQL
```

## Crates

| Crate | Role |
|-------|------|
| `spec` | Declarative VM/cluster types (`virt.zyvor.dev/v1`) |
| `translate` | Spec → libvirt domain XML |
| `agent` | Per-host gRPC executor + VNC console proxy |
| `controller` | Central API, inventory, task orchestration |

## Feature status

| Feature | Status |
|---------|--------|
| Declarative VM spec + XML translation | Done |
| Host agent (gRPC + console proxy :50052) | Done |
| Controller REST API + PostgreSQL | Done |
| Task engine (create/power/delete/migrate/clone/maintenance) | Done |
| Host enrollment tokens + `install.sh` | Done |
| Templates, storage pools, networks (API + DB) | Done |
| Console proxy (controller WS → agent WS → VNC) | Done |
| Web UI (`/platform/*`) | Done |
| Templates + linked-clone deploy | Done |
| Migration pre-checks | Done |
| HA engine (host failure → VM recover) | Done |
| DRS placement recommendations | Done |
| Optional mTLS (agent gRPC) | Done |
| DRS auto-balancing (unattended migrate) | Done |
| Agent-side migration pre-checks (CPU compat) | Done |
| Host fencing (`MACHINA_FENCE_COMMAND`) | Done |
| Cloud-init on template deploy | Done |
| Task list/cancel, audit log, cluster summary | Done |
| Host detail/patch/delete, sync-all | Done |
| VM spec API, HA read, fence/anti-affinity | Done |
| Migration/fence history APIs | Done |
| Snapshot/backup queue APIs + UI | Done |
| Platform Storage/Networks/Tasks/Events UI | Done |
| Agent snapshot/backup execution | Done |
| RBAC users, API keys, webhooks | Done |
| Prometheus metrics, capacity reports | Done |
| Maintenance schedules, task retry | Done |
| Snapshot revert, backup restore | Done |
| Webhook HMAC signing, event filters | Done |
| OIDC settings stub, CPU compat matrix | Done |
| VM/host tags, notification outbox UI | Done |
| NATS task fan-out, packed placement | Done |
| OIDC login + JWT, controller leader election | Done |
| IPMI fencing, webhook delivery retries | Done |
| NATS task consumer, tag placement, rate limits | Done |
| Webhook delivery API/UI, snapshot clone | Done |
| OIDC JWKS validation, non-destructive snap clone | Done |
| Leader-gated sync, cluster leadership API | Done |
| Configurable sync interval, ES256 JWKS, snap clone migrate | Done |

See [`platform-slices.md`](platform-slices.md) (batch 5), [`platform-slices-batch6.md`](platform-slices-batch6.md) (batch 6), [`platform-slices-batch7.md`](platform-slices-batch7.md) (batch 7), [`platform-batch8.md`](platform-batch8.md) (OIDC, leader election, IPMI, webhook retries), [`platform-slices-batch9.md`](platform-slices-batch9.md) (NATS consumer, deliveries, tags, rate limits), [`platform-slices-batch10.md`](platform-slices-batch10.md) (JWKS, snap clone, leadership API), and [`platform-slices-batch11.md`](platform-slices-batch11.md) (sync interval, ES256, cross-host clone).

## Quick start

**PostgreSQL**

```bash
export DATABASE_URL=postgres://machina:machina@127.0.0.1:5432/machina
```

**Host agent** (each KVM node)

```bash
cargo run -p machina-agent -- --listen 0.0.0.0:50051 --console-listen 0.0.0.0:50052
```

**Controller**

```bash
export MACHINA_SKIP_AUTH=1   # dev only
cargo run -p machina-controller
```

**Web UI** — open the daemon UI at `https://HOST:5092/` or `/login`, sign in with PAM (or OIDC when enabled), then use the **Platform** nav group; set controller URL `http://127.0.0.1:5093` (or set `VITE_MACHINA_CONTROLLER_URL` at build time).

## Host enrollment

1. In UI: **Platform → Enroll Host** → generate token
2. On the KVM node:

```bash
curl -fsSL http://127.0.0.1:5093/install.sh | sudo bash -s -- \
  --controller http://127.0.0.1:5093 --token join-XXXX
```

Or:

```bash
machina-agent join --controller http://127.0.0.1:5093 --token join-XXXX
```

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Liveness (+ DB check) |
| GET | `/api/v1/cluster` | Cluster summary |
| GET/PATCH | `/api/v1/cluster/settings` | DRS + HA cluster settings |
| GET | `/api/v1/tasks` | List tasks (`?status=`) |
| POST | `/api/v1/tasks/{id}/cancel` | Cancel pending task |
| GET | `/api/v1/events` | Event stream (`?kind=`) |
| GET | `/api/v1/audit` | Audit log |
| GET | `/api/v1/migrations` | Migration job history |
| GET | `/api/v1/fence/events` | Host fence events |
| GET | `/api/v1/enrollment/tokens` | List join tokens |
| POST | `/api/v1/enrollment/tokens` | Create join token |
| POST | `/api/v1/hosts/join` | Register host (public, token) |
| GET/POST | `/api/v1/hosts` | List / add host |
| GET/PATCH/DELETE | `/api/v1/hosts/{id}` | Host CRUD |
| GET | `/api/v1/hosts/{id}/detail` | Extended host info |
| POST | `/api/v1/hosts/sync-all` | Sync all host inventories |
| POST | `/api/v1/hosts/{id}/sync` | Sync one host |
| POST | `/api/v1/hosts/{id}/maintenance` | Enter/exit maintenance + evacuate |
| GET/POST | `/api/v1/vms` | List (`?project=`, `?host_id=`) / create VM |
| GET | `/api/v1/vms/{id}/spec` | VM declarative spec JSON |
| GET/POST | `/api/v1/vms/{id}/ha` | Read / set HA policy |
| POST | `/api/v1/tasks/{id}/retry` | Retry failed task |
| PATCH | `/api/v1/vms/{id}` | Patch desired_state / project |
| GET | `/api/v1/vms/{id}/disks` | VM disk inventory |
| DELETE | `/api/v1/vms/{id}/snapshots/{name}` | Delete snapshot |
| POST | `/api/v1/hosts/{id}/fence` | Manual host fence |
| GET/POST/DELETE | `/api/v1/maintenance/schedules` | Scheduled maintenance |
| GET/POST/DELETE | `/api/v1/users` | Platform users (admin) |
| GET | `/api/v1/users/me` | Current user |
| GET/POST/DELETE | `/api/v1/api-keys` | API key tokens |
| GET/POST/DELETE | `/api/v1/webhooks` | Event webhooks |
| POST | `/api/v1/webhooks/{id}/toggle` | Enable/disable webhook |
| GET | `/api/v1/projects` | VM project groups |
| GET | `/api/v1/reports/capacity` | Capacity report |
| GET | `/api/v1/metrics/prometheus` | Prometheus metrics |
| GET | `/api/v1/health/ready` | Readiness probe |
| GET | `/api/v1/openapi.json` | OpenAPI stub |
| DELETE | `/api/v1/enrollment/tokens/{token}` | Revoke join token |
| GET/POST | `/api/v1/vms/{id}/snapshots` | Snapshot queue |
| GET/POST | `/api/v1/vms/{id}/backups` | Backup queue |
| GET | `/api/v1/vms/{id}/migrations` | VM migration history |
| DELETE | `/api/v1/templates/{name}/{version}` | Remove template |
| DELETE | `/api/v1/storage/pools/{id}` | Remove storage pool |
| DELETE | `/api/v1/networks/{id}` | Remove network |
| POST | `/api/v1/vms/from-template` | Deploy linked-clone from template |
| POST | `/api/v1/vms/{id}/migrate/precheck` | Migration pre-check |
| POST | `/api/v1/vms/{id}/migrate` | Live migration |
| POST | `/api/v1/vms/{id}/ha` | Enable/disable HA policy |
| POST | `/api/v1/vms/{id}/clone` | Full clone |
| GET | `/api/v1/placement/recommendations` | DRS-style recommendations |
| GET/PATCH | `/api/v1/cluster/settings` | DRS auto-migrate + thresholds |
| GET | `/api/v1/ha/status` | HA dashboard |
| GET | `/api/v1/vms/{id}/console` | Console info + WS path |
| GET/POST | `/api/v1/templates` | Template library |
| GET/POST | `/api/v1/storage/pools` | Storage classes |
| GET/POST | `/api/v1/networks` | Network inventory |
| GET | `/install.sh` | Host enrollment script |

WebSocket console: `GET /ws/v1/platform/vnc/{vm_id}?token=...`

## mTLS (optional)

Agent server:

```bash
export MACHINA_AGENT_TLS_CERT=/etc/machina/agent.crt
export MACHINA_AGENT_TLS_KEY=/etc/machina/agent.key
```

Controller client:

```bash
export MACHINA_AGENT_CA=/etc/machina/ca.crt
export MACHINA_AGENT_CLIENT_CERT=/etc/machina/controller.crt
export MACHINA_AGENT_CLIENT_KEY=/etc/machina/controller.key
```

## Host fencing

When a host stops heartbeating and any HA-enabled VM on that host has `fence_on_failure`, the controller invokes the agent `FenceHost` RPC. Configure a shell command on each agent:

```bash
export MACHINA_FENCE_COMMAND='ipmitool -H {hostname} -U admin -P secret power off'
```

Events are recorded in `fence_events`; the host is marked `fenced = true` on success.

## Desired vs observed state

The controller stores **desired** state separately from **observed** state. The task worker reconciles via the host agent — Kubernetes-style reliability without Kubernetes.

## Remote deploy + E2E

Deploy the daemon plus platform stack to a remote KVM host:

```bash
VSPASS='…' ./scripts/deploy-remote.sh sus 212.8.252.194 \
  --quick --platform --e2e --bind 0.0.0.0 --open-firewall
```

This rsyncs sources, runs `make release web` on the server, installs **machina-daemon** (`:5092`), then `scripts/install-platform.sh` (PostgreSQL + **machina-controller** `:5093` + **machina-agent**).

With `--platform --e2e`, deploy runs the **full E2E suite** (`e2e-full-test-remote.sh`): daemon libvirt/OpenStack checks, host checklist (no nbd SMART noise), UI platform proxy via `/api/v1/platform/controller`, read-only controller smoke, and VM lifecycle on `:5093`.

### Full E2E (recommended after platform work)

From your laptop:

```bash
VSPASS='…' ./scripts/e2e-full-test-remote.sh sus 212.8.252.194
```

Platform-only (skip libvirt/OpenStack daemon tests):

```bash
VSPASS='…' ./scripts/e2e-full-test-remote.sh sus 212.8.252.194 --platform-only
```

Phases (each skippable via flags on `e2e-full-test.sh`):

1. **Install smoke** — `systemctl` + controller health on the remote host
2. **Daemon E2E** — PAM login, libvirt VM lifecycle, OpenStack when configured
3. **Host health** — `/api/v1/health/problems` and linux-observability exclude nbd SMART
4. **UI platform proxy** — authenticated calls through daemon to controller (browser path)
5. **Platform controller** — read-only API smoke + VM create/snapshot lifecycle

Env vars:

- `VSPASS` — PAM password for daemon login (`:5092`)
- `E2E_PLATFORM_USER` / `E2E_PLATFORM_PASS` — controller Basic auth when `MACHINA_SKIP_AUTH` is off (default `admin`/`admin`)

### Individual scripts

```bash
# Controller only (direct :5093)
./scripts/e2e-platform-test-remote.sh sus 212.8.252.194

# Daemon only (:5092)
VSPASS='…' ./scripts/e2e-test-remote.sh sus 212.8.252.194

# Post-install service check on remote
./scripts/e2e-platform-install-smoke-remote.sh sus 212.8.252.194
```

Services: `machina-controller`, `machina-agent`, `postgresql`. Config: `/etc/default/machina-platform`. Dev E2E sets `MACHINA_SKIP_AUTH=1`; use `--require-auth` on install for production.

## Batches 12–16 (vCenter-class hardening)

See [`platform-roadmap.md`](platform-roadmap.md), [`platform-runbooks.md`](platform-runbooks.md), and [`platform-cert-matrix.md`](platform-cert-matrix.md).

Highlights:

- **Batch 12:** VM `lifecycle_phase`, structured API errors with remediation, host join validation, reconcile loop, live migrate after snap clone
- **Batch 13:** Task drawer, command palette platform search, dashboard → platform link, structured error banners
- **Batch 14:** Agent storage/network provisioning (`storage.pool.provision`, `network.provision`)
- **Batch 15:** Policy rules, project quotas, support bundle, upgrade manager, task-failure alerts
- **Batch 16:** [`scripts/platformctl`](../scripts/platformctl), Terraform stub under `terraform/machina/`, chaos/soak scripts

### Controller HA (3 nodes)

Run three controller instances with unique `MACHINA_CONTROLLER_ID`; use Patroni or managed HA for PostgreSQL. Leader election ensures only one node runs reconcile, HA, DRS, and periodic sync. Web UI uses the daemon same-origin proxy (`/api/v1/platform/controller`) so operators need not configure a separate controller URL on co-located deploys.

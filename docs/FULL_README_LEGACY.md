# Machina

**Enterprise Linux Hypervisor Management Platform** for bare-metal worker nodes — unified control plane for VMs, networks, storage, snapshots, and day-two operations from a single dashboard and REST API.

**Docs:** [Index](docs/README.md) · [User stories](docs/USER_STORIES.md) · **Product stack:** **Machina** is the physical infrastructure OS (hosts, hypervisors, BMC, patching, Mission Control). **Zeus OS** is the cloud layer on top (Kubernetes, KubeVirt, applications). See [`docs/machina-infrastructure-vision.md`](docs/machina-infrastructure-vision.md).

Built on **libvirt** with QEMU/KVM. Optional **Kubernetes** integration via YAML workflows and `kubectl`/`virtctl` helpers allows libvirt guests to participate in **KubeVirt** clusters and migrations. See [docs/kubevirt-migration.md](docs/kubevirt-migration.md). **OpenStack** Nova/Glance management and native qcow2 ↔ Glance migration are built into the daemon (optional **hyper2kvm** for advanced VM push) — see [docs/openstack.md](docs/openstack.md) and [docs/openstack-migration.md](docs/openstack-migration.md).

A **Rust daemon** exposes REST and WebSocket APIs; a **web UI** delivers VNC, SPICE, serial, and SSH consoles; a **terminal UI** covers keyboard-first workflows. PAM authentication with RBAC, live metrics, Prometheus, alerts, webhooks, scheduled actions, and more run through that single daemon.

**Perfect for:** Infrastructure teams managing bare-metal hypervisors, edge computing, private data centers, and organizations wanting unified VM management without vendor lock-in.

---

## Why Machina?

| | |
|---|---|
| 🎯 **Unified Management** | VMs, networks, storage, snapshots, host info — all from one dashboard and REST API |
| 🔐 **Enterprise Security** | PAM authentication, RBAC roles, API tokens, session management, optional TLS |
| 🖥️ **Multiple Interfaces** | Web UI with console access, Terminal UI (vim-style), REST API + webhooks, or raw libvirt commands |
| ⚡ **Live Operations** | Real-time metrics, console proxies (VNC/SPICE/Serial/SSH), batch operations, job timelines |
| 📊 **Observability** | Prometheus, OTLP export, alerts/webhooks, PSI/cgroups/auditd, fleet metrics — see [docs/guides/observability.md](docs/guides/observability.md) |
| 🚀 **Automation Ready** | Scheduled actions, cron-based operations, API-first design, `machinactl` CLI for remote ops |
| 🔗 **Kubernetes-Ready** | Optional KubeVirt integration, YAML bundles, `kubectl` support for cluster migration |

---

## Architecture

```
  ┌─────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
  │   machina Web UI  │   │   machina TUI      │   │  API / Automation    │
  │  (React + noVNC +   │   │  (ratatui terminal)  │   │  (curl / scripts /   │
  │   SPICE + xterm.js) │   │                      │   │   Bearer tokens)     │
  └─────────┬───────────┘   └──────────┬───────────┘   └──────────┬───────────┘
            │                          │                          │
            └────────┬─────────────────┼──────────────────────────┘
                     │  HTTP / WebSocket (optional TLS)
            ┌────────┴─────────────────┐
            │    machina-daemon      │
            │  PAM auth + RBAC + API   │
            │  tokens + cookie sessions│
            │  VNC/SPICE/Serial/SSH    │
            │  console proxies         │
            └──┬────────┬──────────┬───┘
               │        │          │
     libvirt API    host cmds    iptables
               │        │          │
  ┌────────────┴──┐  ┌──┴───┐  ┌──┴──────────┐
  │  QEMU / KVM  │  │ Host │  │ Networking   │
  │  Virtual     │  │ mgmt │  │ port-forward │
  │  Machines    │  │      │  │ firewall     │
  └──────────────┘  └──────┘  └──────────────┘
```

Machina provides **built-in** noVNC/SPICE (and serial/SSH) consoles over the daemon; libvirt remains the source of truth for VMs. If you prefer a separate HTML5 gateway (e.g. **RDP for Windows**, or Apache’s connection model), see [docs/guacamole-integration.md](docs/guacamole-integration.md)—Guacamole sits in front of guest RDP/VNC/SSH and does **not** replace libvirt or machina lifecycle APIs.

### Workspace Layout

```
machina/   # git checkout directory name
├── core/               Shared library — types, config, libvirt bindings, validation, XML helpers
├── daemon/             REST + WebSocket server (axum), VNC proxy, noVNC serving, Prometheus metrics
├── tui/                Terminal UI client (ratatui) with sidebar + content panel layout
├── web/                Web frontend (React 19 + TypeScript + Tailwind + Recharts + xterm.js)
├── contrib/            Systemd units, default config
├── demo-screenshots/   Screenshots, presentation PDFs, and PDF generators
├── docs/               Optional integration notes (e.g. Apache Guacamole)
├── guac-bridge/        Apache Guacamole JSON-auth library + optional standalone `libvirt-guac-bridge` binary (daemon integrates `GET …/guacamole-auth`)
├── examples/           Example user configuration
├── scripts/            deploy-remote.sh, package-binary-remote.sh (client tarball), demo, status, backup, bulk
├── machinactl        Management CLI (deploy, verify, health, backup, upgrade, tls)
├── install.sh          Automated installer (Fedora/RHEL/Ubuntu/Debian/openSUSE/Arch)
└── Makefile            Build, install, deploy, manage targets
```

---

## Features

### Authentication & Security
- **PAM authentication** — login with system credentials, persistent cookie sessions
- **LDAP / Active Directory** — optional bind + `memberOf` group → role mapping ([docs/ldap-auth.md](docs/ldap-auth.md))
- **RBAC** — role-based access control with admin, operator, and readonly roles
- **API tokens** — Bearer token authentication with optional **scopes** (`vms:write`, `fleet:proxy`, `audit:read`, `*`)
- **WebSocket token authentication** — short-lived token-based auth for all console/VNC/SSH WebSocket connections
- **Session TTL with max session limits** — 24-hour session expiry, max 1000 total sessions, max 10 sessions per user
- **HTTPS by default** — packaged install enables `[tls]` with self-signed certs (`install.sh` generates `/etc/machina/ssl/`); replace with your CA as needed
- **Same-origin only** — no CORS (prevents cross-site attacks)

### Fleet, RDP, and packaging
- **Fleet** — multi-host peer list, merged VM inventory, API proxy ([docs/fleet.md](docs/fleet.md), [docs/fleet-ha.md](docs/fleet-ha.md))
- **Built-in RDP** — guest endpoint discovery, `.rdp` download, WebSocket TCP proxy ([docs/builtin-rdp.md](docs/builtin-rdp.md))
- **Customer tarball** — `scripts/package-binary-remote.sh --from-deploy --fetch` ([docs/PACKAGE_BINARY_REMOTE.md](docs/PACKAGE_BINARY_REMOTE.md))
- **Operator runbook** — [docs/runbook.md](docs/runbook.md) · **Hardening** — [docs/compliance-hardening.md](docs/compliance-hardening.md)

### Web UI (https://localhost:5092)

#### Liquid Glass design (macOS Tahoe)

The Machina web UI uses a **Liquid Glass** design system inspired by macOS Tahoe: translucent panels, strong backdrop blur, heavy rounding (22–28px), specular highlights, and spring animations on modals and toasts.

- **Dark theme = Liquid Glass** — the default `dark` theme applies glass tokens across daemon pages and the platform desktop shell
- **Platform desktop tiers** — **Normal** (dock-first, minimal), **Power user** (ops toolkit), **Advanced** (full fleet surface); switch in **Settings → Appearance** or **View → Desktop density**
- **Reusable components** — `GlassCard`, `GlassButton`, `GlassModal`, `GlassInput`, `GlassTabs` in `web/src/components/glass/`
- **Steel / Aurora** themes remain available via the navbar theme picker

- **Machina login page** — macOS Tahoe liquid-glass split layout ([`PremiumLoginShell`](web/src/components/PremiumLoginShell.tsx) `variant="macos"`), libvirt/OpenStack hero copy; entry at `/` or `/login`; after sign-in the URL normalizes to `/` (dashboard)
- **Command palette** — `Ctrl+K` / `Cmd+K` to search VMs, networks, storage pools, snapshots, navigate pages, and run quick actions with keyboard navigation
- **Notification bell** — global notification center in navbar with badge count, showing real-time VM state changes, additions, and removals
- **Breadcrumb navigation** — auto-generated from route path on every page
- **Keyboard shortcuts** — `g d` (dashboard), `g v` (VMs), `g n` (networks), `g s` (storage), `g c` (create), `g j` (jobs), `?` (help overlay)
- **Dashboard** — VM stats, host memory gauge, VM list with inline quick actions (start/shutdown/console), metric charts, real-time activity feed
- **Batch VM operations** — multi-select VMs with checkboxes, floating action bar for batch start/shutdown/stop/delete
- **VM Management** — start, stop, shutdown, reboot, pause, resume, delete with confirmation dialogs
- **VM Details** — tabbed view (Overview, Disks, Network, Snapshots, Devices, XML, Logs) with live metrics, disk-only snapshots, confirmation dialogs, XML download, save-as-template dialog
- **VM list views** — toggle between table and card grid layouts with localStorage persistence
- **Create VM** — Cockpit-style install sources (ISO, URL, PXE, curated **virt-install --install os=…** presets); **Golden Forge** runs a local Packer golden qcow2 as a **Jobs** task with live logs and a step timeline; clone-from-golden flows
- **Jobs** — background work (virt-image-build, Golden Forge / Packer, VM create with SSE logs) with timelines and `/jobs/{id}` detail
- **Disk images** — scanned pool images; start **virt-image-build** (virt-builder) on the host with the same job + timeline pattern as Create VM
- **Import VM** — convert and import VMDK/VDI/VHD disk images to qcow2
- **VNC Console** — in-browser VM display via noVNC RFB client (dynamically loaded from server)
- **SPICE Console** — in-browser SPICE display via spice-html5
- **Serial Console** — xterm.js terminal connected directly to VM's serial PTY via async I/O
- **SSH Console** — browser-based SSH: authenticated `POST /api/v1/terminal/sessions` yields a short-lived `session_id`; xterm.js talks to `/ws/v1/terminal/{session_id}` with JSON resize/input and binary PTY output; daemon runs the system `ssh` inside `portable-pty` (OpenSSH config, keys, and `StrictHostKeyChecking=accept-new`)
- **Host Networking** — visual network topology (SVG graph), port forwarding, bridge management, per-VM firewall rules, DHCP lease viewer
- **Host SSH** — Infrastructure menu opens `/host-ssh`: SSH session to the hypervisor using the browser hostname (no manual IP); VM details SSH still opens a guest shell with guest IP auto-filled when agent/DHCP lists an address
- **Networks** — list, start/stop, toggle autostart, delete
- **Storage** — pool cards with capacity bars and autostart toggle, volume browser with create/resize/clone/delete
- **Snapshots** — list all across VMs, revert, delete; disk-only snapshot option for faster snapshots without memory state
- **Secrets** — libvirt secrets management (list, view XML, delete)
- **Host Info** — hypervisor, CPU model/cores/threads, memory, libvirt version, DMI hardware details (vendor, product, BIOS)
- **Systemd Services** — browse and manage host systemd services
- **System Logs** — journald log browser
- **Audit Log** — view all operation history with timestamps
- **Per-VM log viewer** — Logs tab in VM Details showing QEMU logs for the selected VM
- **Data export** — CSV and JSON export buttons on VM list, audit log, and live metrics pages
- **Recently viewed VMs** — last 5 recently viewed VMs shown on Dashboard and command palette
- **Favorites / pin VMs** — star or pin VMs to sort them to the top of the VM list
- **Settings** — RBAC role management, API tokens, alert rules, webhooks, scheduled actions, notification channels
- **ISO/Disk Browser** — browse available ISO images and disk images on the host
- **API Docs** — built-in OpenAPI documentation with interactive API playground (try endpoints in-browser)
- **Live Metrics** — real-time per-VM time-series metrics charts (memory, disk I/O, network I/O)
- **PCI/IOMMU Devices** — PCI device listing with IOMMU group info
- **Toast notifications** — success/error/warning/info feedback for all actions, progress toasts for long-running operations (backup, restore, migration)
- **WebSocket live updates** — dashboard auto-refreshes when VM state changes
- **Page skeleton loaders** — shimmer loading states during lazy page loads
- **Responsive** — works on desktop and mobile with collapsible nav
- **Dark/light theme** — toggle between dark and light themes with unified slate palette
- **Page animations** — fade-in transitions on all pages, hover effects on dashboard cards

### VM Management
- **Create** from parameters or templates with auto-generated qcow2 disk, VNC graphics, virtio devices, q35 machine type
- **Create from existing disk** — use an existing qcow2/raw/vmdk disk image instead of creating a new one
- **UEFI firmware** — select UEFI boot with auto-detected OVMF paths
- **Cloud-init** — generate cloud-init ISO with hostname, user, password, SSH key
- **Import VM** — convert VMDK/VDI/VHD disk images to qcow2 and create a VM
- **Interactive creation dialog** — form-based VM creation with template dropdown, field validation, Tab navigation (`n` key)
- **Lifecycle** — start, stop (force), shutdown (graceful), reboot, pause, resume, delete with confirmation dialogs
- **Clone** with automatic UUID regeneration and unique MAC addresses
- **Live resize** — edit vCPUs and memory on running VMs (live hotplug)
- **Resize** vCPUs and memory (also applies on next boot for stopped VMs)
- **Memory balloon** — live memory balloon adjustment for running VMs
- **Rename** VMs (requires shutoff state)
- **Edit boot order** — configure boot device priority (hd, cdrom, network, etc.)
- **Autostart** toggle per VM, network, and storage pool
- **Disk management** — hot attach/detach disks to running or stopped VMs, with resize support
- **NIC attach/detach** — add or remove network interfaces on VMs
- **CD-ROM insert/eject** — auto-detects existing cdrom device, creates new if needed
- **USB passthrough** — attach/detach USB devices by vendor:product ID
- **VM tags/labels** — tag VMs with filtering support
- **Save as template** — save a VM configuration as a reusable template
- **Snapshots with descriptions** — create, delete, revert snapshots with optional descriptions
- **Migrate** — live or offline P2P migration to a validated `qemu://` / `qemu+ssh://` (etc.) URI; optional JSON **`parameters`** maps to libvirt **`MigrateParameters`** (bandwidth, compression, **`migrate_disks`**, destination XML, and other `migrate_to_uri3` fields)
- **Migration tuning** — read or set migration **max bandwidth** (MiB/s) and **max downtime** (nanoseconds) on the domain while tuning live migration
- **NUMA memory tuning** — get or set per-domain NUMA parameters (**`node_set`**, **`mode`**) where the hypervisor supports it
- **Emulator CPU affinity** — pin QEMU emulator threads to host logical CPUs via a boolean CPU map
- **Domain job telemetry** — JSON **job info** and **job stats** for long-running domain operations (for example live migration progress)
- **Console access** — VNC, SPICE, serial, and SSH in browser; also virt-viewer and virsh console

### Live Metrics & Monitoring
- **Memory usage** with Unicode block bar graphs (`▁▂▃▄▅▆▇█`)
- **Sparkline trends** — mini sparkline of last 20 metric readings per VM
- **CPU time**, disk I/O (read/write), network I/O (RX/TX)
- **Prometheus endpoint** (`/api/v1/prometheus`) for Grafana integration
- **State transition highlights** — rows flash when a VM changes state

### Snapshots, Networks, Storage
- **Snapshots** — list, create, delete, revert across all VMs; disk-only option for faster snapshots without memory state
- **Networks** — create, delete, start, stop, toggle autostart for virtual networks (NAT with DHCP)
- **Storage** — browse pools with capacity/usage, start/stop/refresh pools, toggle autostart, volume browser

### Host Networking
- **Network topology** — visual SVG graph of bridges, networks, and VMs
- **Bridge creation** — auto-detects nmcli vs netplan vs ip (distro-aware: netplan for Ubuntu, nmcli for RHEL/Fedora)
- **Port forwarding** — iptables DNAT rules for exposing VM services
- **Per-VM firewall rules** — iptables FORWARD chain rules per VM
- **DHCP lease viewer** — see active DHCP leases across networks

### Automation
- **Alerts** — configurable CPU/memory/disk threshold alerts
- **Webhooks** — HTTP POST notifications on VM events
- **Scheduled actions** — daily VM start/stop/shutdown on schedule
- **Snapshot scheduler** — automatic snapshots with configurable retention
- **Notifications** — send alerts via Slack, email, Telegram, or webhook

### Host Management
- **Systemd service manager** — browse and control host systemd services
- **System logs** — journald log browser with filtering
- **Host shutdown/reboot** — trigger from the dashboard
- **Hostname/timezone** — configure from the web UI
- **PCI/IOMMU listing** — enumerate PCI devices and IOMMU groups
- **USB device listing** — list connected USB devices for passthrough
- **DMI hardware info** — vendor, product, BIOS version, CPU model details

### TUI Experience
- **vSphere-style sidebar + content layout** — left inventory tree with collapsible categories
- **Sub-tabs per object** — Summary, Monitor, Configure tabs for VMs
- **Fuzzy search** — scored character-by-character matching
- **Multi-select** — batch operations on multiple VMs
- **Sorting** — by name, state, CPU, or memory
- **Command mode** — vim-style `:command` interface
- **Mouse support** — click, scroll, select
- **Audit trail** — persistent log at `~/.machina/audit.log`

### Backup & Restore
- **Full or per-VM backup** — XML configs and optionally disk images
- **NFS backup target** — auto-mount NFS, backup, unmount
- **Incremental backup** — rsync with hardlinks for unchanged disk files
- **SHA-256 checksums** — generated after every backup, verifiable via API
- **Retention policy** — keep last N backups, auto-prune older ones
- **Download** — download any backup as tar.gz from the web UI
- **Scheduled backups** — systemd timer (daily 2 AM), enable/disable from web UI
- **Status tracking** — live progress percentage during backup
- **Restore** — redefine VMs, networks, storage pools, and optionally restore disk images
- **Per-VM backup button** — one-click backup from VM details page

### Infrastructure
- **PAM authentication** — system user login with persistent cookie sessions
- **RBAC** — admin/operator/readonly roles with granular permissions
- **API tokens** — Bearer authentication for automation scripts
- **TLS** — optional HTTPS with configurable cert/key paths
- **WebSocket** — real-time VM state change notifications with token-based authentication
- **Session management** — 24-hour TTL, max 1000 sessions, max 10 per user
- **VNC WebSocket proxy** — built-in TCP-to-WebSocket proxy for VNC, no external websockify needed
- **SPICE WebSocket proxy** — built-in proxy for SPICE console
- **Serial console proxy** — direct async PTY I/O over WebSocket (no socat dependency)
- **SSH proxy** — browser SSH via spawned ssh process with PTY WebSocket
- **noVNC serving** — auto-discovers system noVNC installation and serves at `/novnc/`
- **Connection resilience** — auto-reconnects to libvirt if connection drops
- **Systemd service** — hardened unit file with security restrictions
- **Config hierarchy** — `/etc/machina/config.toml` then `~/.machina/config.toml`, then defaults; CLI overrides file values
- **Input validation** — VM names, vCPU counts, memory, disk size bounds checked; XML-escaped user inputs
- **Security hardened** — migration URI validation (SSRF prevention), ISO/import path canonicalization with symlink resolution, webhook URL validation, email header injection prevention, PTY path validation, integer overflow protection, no CORS (same-origin only), RBAC defaults to ReadOnly for unknown users; browser SSH uses server-issued **terminal sessions** (no raw host in the WebSocket URL), rejects API tokens for session creation, optional **named targets** in `[ssh_terminal].targets`, and disables legacy `/ws/v1/ssh/{host}` unless explicitly enabled
- **Audit logging** — all operations logged with timestamps
- **Graceful shutdown** — daemon handles SIGTERM/SIGINT cleanly
- **Distro support** — installer supports Fedora, RHEL, Ubuntu, Debian, openSUSE, Arch Linux

---

## Quick Start

### One-Command Deployment (recommended)

```bash
git clone https://github.com/ssahani/machina.git
cd machina
./machinactl deploy    # Installs deps, builds, installs, starts, and auto-verifies
```

No `sudo` needed — the script auto-escalates when required. After deployment, you'll see:

```
── Post-Install Verification ──
✓ Service is running
✓ API responding (HTTP 200)
✓ VM list: 5 VM(s)
✓ libvirt: 0 running, 1 total
✓ All verification checks passed
```

Open **https://localhost:5092** or run `machina` for the TUI.

### Step-by-Step

```bash
./machinactl deps            # Install dependencies (auto-sudo)
./machinactl build           # Build everything
./machinactl test            # Run tests
./machinactl install         # Install to system (auto-sudo)
./machinactl start           # Start the service (auto-sudo)
./machinactl verify          # Post-install smoke test
```

### Management Commands

```bash
./machinactl status          # Check service status
./machinactl verify          # Post-install smoke test (API, VMs, libvirt)
VSPASS=… ./scripts/e2e-test.sh https://HOST:5092 USER  # Full E2E: health, libvirt VM, OpenStack API
./machinactl health          # Deep health check (disk, libvirt, timers)
./machinactl logs            # Follow logs
./machinactl restart         # Restart service (auto-sudo)
./machinactl reinstall       # Rebuild + reinstall + auto-verify (auto-sudo)
./machinactl upgrade         # Git pull + reinstall (auto-sudo)
./machinactl uninstall       # Remove everything (auto-sudo)
./machinactl doctor          # System readiness check
./machinactl tls             # Generate self-signed TLS certificate
```

### Backup Commands

```bash
./machinactl backup now      # Run backup immediately
./machinactl backup enable   # Enable daily backup timer (2:00 AM)
./machinactl backup disable  # Disable backup timer
./machinactl backup status   # Show timer state + storage info
./machinactl backup logs     # Follow backup logs
```

### Alternative: Make (manual)

```bash
make                           # Build everything
sudo make deploy               # Install and start
```

### Alternative: install.sh

Supports Fedora, RHEL, Ubuntu, Debian, openSUSE, and Arch Linux.

```bash
sudo ./install.sh                          # Full automated install
sudo ./install.sh --bind 0.0.0.0           # Bind to all interfaces
sudo ./install.sh --open-firewall          # Open port in firewalld/ufw
sudo ./install.sh --remote user@host       # Remote install via SSH
sudo ./install.sh --deps-only              # Install dependencies only
sudo ./install.sh --no-start               # Install without starting service
sudo ./install.sh --uninstall              # Remove everything
```

Full install runs **dependencies and Rust**, then **builds the workspace and web UI**, then **starts libvirt** (`libvirtd`) and installs files—so compile errors appear in the log **before** the “Enabling libvirt” step.

### Remote Deploy

Sources are **rsync’d** to `~/.deployment/machina` on the host; **Rust and npm build only on the server** (not on your laptop). **Do not run `cargo build` or `make` on macOS** — the workspace requires Linux libvirt; see [docs/macos-build.md](docs/macos-build.md). Arguments are always **`USER` then `HOST`** (or `USER@HOST`).

```bash
./scripts/deploy-remote.sh user@host --bind 0.0.0.0 --open-firewall   # keys or SSHPASS
./scripts/deploy-remote.sh check user@host                             # systemd + /health
./scripts/deploy-remote.sh user@host --remote-check                    # after rsync: `make check` on server (fast compile smoke)
./scripts/deploy-remote.sh user@host --remote-build                    # after rsync: `make release` on server (no full install.sh)
sudo ./install.sh --remote user@host                                   # alternative (install.sh drives SSH itself)
```

`--remote-check` / `--remote-build` set `PATH` for cargo and a **LIBCLANG_PATH** hint (Alma/RHEL-style) so **pam-sys** can link; run `sudo ./install.sh --deps-only` once on the host if cargo is missing.

### Client tarball (no deploy scripts on client machine)

```bash
./scripts/package-binary-remote.sh HOST USER --fetch
./scripts/package-binary-remote.sh HOST USER --reuse-build --fetch   # skip make if already built on server
```

See **[docs/PACKAGE_BINARY_REMOTE.md](docs/PACKAGE_BINARY_REMOTE.md)**.

### What `make deploy` does

1. Installs `machina-daemon` → `/usr/local/bin/machina-daemon`
2. Installs `machina` (TUI) → `/usr/local/bin/machina`
3. Installs web UI → `/usr/local/share/machina/web/`
4. Installs config → `/etc/machina/config.toml`
5. Installs systemd units → `machina-daemon.service`, `machina-backup.service`, `machina-backup.timer`
6. Installs backup script → `/usr/local/share/machina/scripts/backup.sh`
7. Installs backup config → `/etc/machina/backup.conf`
8. Reloads systemd and starts the daemon

### Service Management

```bash
sudo make start     # start the daemon
sudo make stop      # stop the daemon
sudo make restart   # restart after changes
sudo make status    # check if running
sudo make uninstall # stop + remove everything
```

### Development Mode (no install)

**Linux hypervisor only** for Rust binaries. On **macOS**, do not compile the Machina Rust workspace locally — use [docs/macos-build.md](docs/macos-build.md) and `./scripts/deploy-remote.sh USER@HOST --remote-build`.

On a Linux dev host with libvirt dev packages installed:

```bash
make build                          # debug build
./target/debug/machina-daemon     # run daemon
./target/debug/machina-tui        # run TUI
cd web && npm run dev               # web UI dev server with hot reload (port 3000)
```

On **macOS**, limit local work to the web app:

```bash
cd web && npm run dev               # UI against remote daemon/controller
cd web && npm run build             # typecheck + production bundle
```

---

## Web UI Pages

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | `/` | Stats cards, memory gauge, VM list with quick actions, metric charts, activity feed |
| VM List | `/vms` | Table/grid view with search, tag filtering, batch operations, state badges, lifecycle actions |
| VM Details | `/vms/{name}` | 7 tabs (Overview, Disks, Network, Snapshots, Devices, XML, Logs), confirmation dialogs, XML download, save-as-template dialog |
| Create VM | `/create` | Install from media (ISO / URL / PXE / curated virt-install OS), golden-image clone, **Golden Forge** (Packer qcow2 job + logs), templates, UEFI, cloud-init |
| Import VM | `/import` | Convert and import VMDK/VDI/VHD disk images |
| Disk images | `/disk-images` | Scanned images; **virt-image-build** job from UI + folder picker |
| Jobs | `/jobs` | virt-image-build, Golden Forge, VM-create jobs with logs and timelines |
| Console | `/vms/{name}/console` | Auto-detect VNC/Serial, in-browser display via noVNC or xterm.js |
| SSH Console | `/ssh`, `/ssh/:host` | Opens session API then PTY-backed `ssh` over `/ws/v1/terminal/{session_id}`; query form `/ssh?host=…&user=…` |
| Host Networking | `/host-networking` | SVG network topology, port forwarding, bridges, firewall |
| Host SSH | `/host-ssh` | SSH to the hypervisor host (browser hostname → session + PTY `ssh`); enter SSH user only |
| Networks | `/networks` | Start/stop, autostart toggle, DHCP leases, delete |
| Storage | `/storage` | Pool cards with create/delete, volume browser with resize/clone |
| Snapshots | `/snapshots` | List all, revert, delete |
| Secrets | `/secrets` | Libvirt secrets management (list, view XML, delete) |
| Host Info | `/node` | Hypervisor, CPU, memory, libvirt version, DMI hardware |
| Services | `/services` | Systemd service browser and manager |
| System Logs | `/logs` | Journald log browser with priority/unit filtering |
| Audit Log | `/audit` | Searchable operation history with timestamps |
| Settings | `/settings` | RBAC roles, API tokens, alerts, webhooks, schedules, notifications |
| Live Metrics | `/events` | Real-time per-VM memory/disk/network metrics table |
| Capabilities | `/capabilities` | Hypervisor capabilities, guest types, SMBIOS sysinfo |
| Node Devices | `/devices` | PCI, USB, SCSI, network device inventory with XML viewer |
| Network Filters | `/nwfilters` | List/delete libvirt network filters |
| Backups | `/backups` | Backup/restore, download, verify, schedule timer, per-VM |
| API Docs | `/api-docs` | OpenAPI documentation with search and interactive API playground |

### Console Access

Four console types are supported, auto-selected based on VM graphics configuration:

**VNC** — connects directly through the daemon (no external websockify or noVNC server needed):
```
Browser → noVNC (served at /novnc/) → WebSocket (/ws/v1/vnc/{name}) → daemon TCP proxy → QEMU VNC
```

**SPICE** — for VMs with SPICE graphics:
```
Browser → spice-html5 → WebSocket (/ws/v1/spice/{name}) → daemon TCP proxy → QEMU SPICE
```

**Serial** — connects directly to the VM's PTY (no socat needed):
```
Browser → xterm.js → WebSocket (/ws/v1/console/{name}) → async PTY I/O → VM PTY (/dev/pts/X)
```

**SSH** — browser-based SSH access (session id in the WebSocket path, not the target host):
```
Browser → xterm.js → POST /api/v1/terminal/sessions → WebSocket (/ws/v1/terminal/{session_id}?token=…) → PTY + system ssh user@host
```

> **Note:** New VMs created through machina use VNC by default. The console page auto-detects the graphics type and selects VNC or SPICE accordingly. The serial console requires `console=ttyS0` in the guest OS kernel cmdline.

### Web UI Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` / `Cmd+K` | Open command palette (search VMs, pages, actions) |
| `g` then `d` | Go to Dashboard |
| `g` then `v` | Go to Virtual Machines |
| `g` then `n` | Go to Networks |
| `g` then `s` | Go to Storage |
| `g` then `c` | Create VM |
| `g` then `e` | Go to Live Metrics |
| `g` then `b` | Go to Backups |
| `?` | Show keyboard shortcuts help overlay |

The command palette supports fuzzy search across all pages and VMs, with inline actions (start, stop, shutdown, open console) and full keyboard navigation (arrow keys + Enter).

---

## Configuration

Config resolution:

1. CLI arguments (highest priority — including `machina-daemon --config /path`)
2. Config file load order when using `MachinaConfig::load()` (no `--config`): **`/etc/machina/config.toml`** first, then **`~/.machina/config.toml`** if the system file is missing
3. Built-in defaults when no file exists

The installer and systemd unit install **`/etc/machina/config.toml`** and start the daemon with **`--config /etc/machina/config.toml`**.

```toml
[general]
refresh_interval_secs = 5    # TUI polling interval

[daemon]
host = "0.0.0.0"             # Bind address (all interfaces)
port = 5092                  # Bind port

[libvirt]
uri = "qemu:///system"       # Libvirt connection URI

[auth]
pam_service = "sshd"         # /etc/pam.d/<name> — use sshd so web login matches SSH password rules

[tls]
enabled = true                              # Enable HTTPS
cert_path = "/etc/machina/cert.pem"       # TLS certificate
key_path = "/etc/machina/key.pem"         # TLS private key

[backup]
backup_dir = "/var/lib/machina/backups"  # Where backups are stored
# nfs_target = "192.168.1.100:/backups"    # NFS target (optional)
with_disks = false                          # Include disk images by default
retain = 7                                  # Keep last 7 backups
```

Generate a self-signed TLS certificate:
```bash
./machinactl tls    # Generates cert.pem and key.pem in /etc/machina/
```

See [`examples/config.toml`](examples/config.toml) for the full annotated configuration.

### CLI Options

**Daemon:**

```bash
machina-daemon                                    # defaults
machina-daemon --port 9090 --host 127.0.0.1        # localhost only
machina-daemon --libvirt-uri qemu:///session       # user session
machina-daemon --config /path/to/config.toml      # custom config
RUST_LOG=tower_http=debug machina-daemon          # enable request tracing
```

**TUI:**

```bash
machina                                           # defaults
machina --url https://192.168.1.10:5092            # remote daemon
machina --refresh 10                              # 10s refresh interval
machina --config /path/to/config.toml             # custom config
```

---

## TUI Keyboard Reference

### Panel Navigation

| Key | Action |
|-----|--------|
| `h` / `←` | Focus sidebar panel |
| `l` / `→` | Focus content panel (`l` on a VM opens logs instead) |
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `g` / `G` | Jump to top / bottom |
| `PageUp` / `PageDown` | Jump 10 items |
| `Tab` / `BackTab` | Cycle sub-tabs (Summary, Monitor, Configure) |
| `1` / `2` / `3` | Jump to sub-tab directly |

### VM Actions

| Key | Action |
|-----|--------|
| `s` | Start |
| `x` | Stop (force) |
| `H` | Shutdown (graceful) |
| `b` | Reboot |
| `p` | Pause |
| `u` | Resume |
| `d` | Delete (modal confirmation) |
| `t` | Toggle autostart |
| `n` | New VM (interactive dialog) |
| `o` | Clone (shows command hint) |
| `y` | View raw XML |
| `l` | View VM logs |
| `v` | Launch virt-viewer |
| `V` | Open noVNC in browser |
| `c` | Open virsh console |
| `e` | SSH to VM |
| `Space` | Multi-select toggle |
| `A` | Select all VMs |
| `Ctrl+Space` | Context menu |
| `/` | Fuzzy search |
| `:` | Command mode |
| `?` | Help overlay |

### Commands

| Command | Action |
|---------|--------|
| `:create` | Open VM creation dialog |
| `:create <name>` | Create VM with defaults |
| `:template <tmpl> <name>` | Create from template |
| `:clone <source> <new>` | Clone a VM |
| `:snap <vm> <name>` | Create a snapshot |
| `:rename <old> <new>` | Rename a VM |
| `:resize <name> vcpus <n>` | Set vCPU count |
| `:resize <name> memory <mb>` | Set memory |
| `:netcreate <name>` | Create a NAT network |
| `:backups` | Browse backups |
| `:backup run` | Backup all VMs |
| `:backup run <vm>` | Backup single VM |
| `:backup restore <id>` | Restore from backup |
| `:backup delete <id>` | Delete a backup |
| `:vms` `:net` `:storage` `:snap` `:events` `:node` | Switch view |

---

## REST API

All endpoints are prefixed with `/api/v1`. Responses are JSON unless noted. XML endpoints (`/xml`, `/sysinfo`) return `Content-Type: text/xml`.

### VMs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/vms` | List all VMs |
| `POST` | `/vms` | Create VM |
| `GET` | `/vms/{name}` | VM details |
| `DELETE` | `/vms/{name}` | Delete VM |
| `GET` | `/vms/{name}/xml` | Raw XML |
| `POST` | `/vms/{name}/start` | Start |
| `POST` | `/vms/{name}/stop` | Force stop |
| `POST` | `/vms/{name}/shutdown` | Graceful shutdown |
| `POST` | `/vms/{name}/reboot` | Reboot |
| `POST` | `/vms/{name}/pause` | Suspend |
| `POST` | `/vms/{name}/resume` | Resume |
| `POST` | `/vms/{name}/clone` | Clone |
| `POST` | `/vms/{name}/autostart/{enabled}` | Set autostart |
| `POST` | `/vms/{name}/vcpus/{count}` | Set vCPUs |
| `POST` | `/vms/{name}/memory/{mb}` | Set memory |
| `POST` | `/vms/{name}/rename` | Rename |
| `POST` | `/vms/{name}/disk/attach` | Attach disk |
| `POST` | `/vms/{name}/disk/detach/{target}` | Detach disk |
| `GET` | `/vms/console-info/{name}` | Console info |
| `GET` | `/vms/{name}/interfaces` | Guest IP addresses (DHCP/agent) |
| `GET` | `/vms/{name}/hostname` | Guest hostname |
| `POST` | `/vms/{name}/cdrom/insert` | Insert ISO (`{"iso_path": "...", "target": "sda"}`) |
| `POST` | `/vms/{name}/cdrom/eject/{target}` | Eject CD-ROM |
| `POST` | `/vms/{name}/managed-save` | Hibernate (managed save) |
| `DELETE` | `/vms/{name}/managed-save` | Remove saved state |
| `GET` | `/vms/{name}/managed-save/status` | Check if saved |
| `GET` | `/vms/{name}/boot` | Boot config (devices, firmware, UEFI) |
| `POST` | `/vms/{name}/boot` | Set boot order (`{"devices": ["hd", "cdrom"]}`) |
| `POST` | `/vms/{name}/migrate` | Migrate (`{"dest_uri": "qemu+ssh://...", "live": true, "parameters": {...}?}`) — optional **`parameters`** matches libvirt migration tuning (e.g. **`bandwidth`**, **`compression`**, **`migrate_disks`**, **`parallel_connections`**) |
| `GET` | `/vms/{name}/migrate/max-bandwidth` | Current migration max speed (MiB/s) |
| `POST` | `/vms/{name}/migrate/max-bandwidth` | Set migration max speed (`{"mib_per_sec": 500}`) |
| `POST` | `/vms/{name}/migrate/max-downtime` | Set live migration max downtime (`{"downtime_ns": 30000000000}`) |
| `GET` | `/vms/{name}/numa` | NUMA memory parameters (`node_set`, `mode`) |
| `POST` | `/vms/{name}/numa` | Set NUMA parameters (partial body merged with current; **`node_set`** / **`mode`** optional) |
| `POST` | `/vms/{name}/emulator/pin` | Pin emulator threads (`{"cpus": [true, false, ...]}` — one entry per host logical CPU, `true` = allowed) |
| `GET` | `/vms/{name}/job` | Domain job summary (JSON; same shape as stats where populated) |
| `GET` | `/vms/{name}/job/stats` | Domain job stats (`?flags=0` — libvirt **`virDomainGetJobStatsFlags`**) |
| `POST` | `/vms/{name}/balloon/{mb}` | Live memory balloon |
| `POST` | `/vms/{name}/disk/resize/{target}` | Resize attached disk |
| `POST` | `/vms/{name}/nic/attach` | Attach network interface |
| `POST` | `/vms/{name}/nic/detach/{mac}` | Detach network interface by MAC |
| `POST` | `/vms/{name}/usb/attach` | USB passthrough attach (`{"vendor_id":"...", "product_id":"..."}`) |
| `POST` | `/vms/{name}/usb/detach` | USB passthrough detach |
| `POST` | `/vms/{name}/live/vcpus/{n}` | Live vCPU hotplug |
| `POST` | `/vms/{name}/live/memory/{mb}` | Live memory hotplug |
| `GET` | `/vms/{name}/tags` | Get VM tags |
| `POST` | `/vms/{name}/tags` | Set VM tags |
| `POST` | `/vms/{name}/save-template` | Save VM as reusable template |
| `GET` | `/vms/{name}/logs` | Get per-VM QEMU logs |

### Jobs (background tasks)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/jobs` | List recent jobs (newest first; in-memory until daemon restart) |
| `POST` | `/jobs/virt-image-build` | Start **virt-image-build** / virt-builder (`BuildDiskRequest` body) |
| `POST` | `/jobs/packer-golden-build` | Start **Golden Forge** Packer golden image (`{"guest":"ubuntu2404"}` — ids match `contrib/packer/build-linux-image.sh`) |
| `GET` | `/jobs/{id}` | Job summary, error, target path, and captured log lines |
| `GET` | `/jobs/{id}/stream` | **SSE** log stream; terminal `complete` / `error` events |

### Snapshots

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/snapshots` | All snapshots |
| `GET` | `/vms/{vm}/snapshots` | VM snapshots |
| `POST` | `/vms/{vm}/snapshots` | Create |
| `DELETE` | `/vms/{vm}/snapshots/{snap}` | Delete |
| `POST` | `/vms/{vm}/snapshots/{snap}/revert` | Revert |

### Networks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/networks` | List |
| `POST` | `/networks` | Create |
| `DELETE` | `/networks/{name}` | Delete |
| `POST` | `/networks/{name}/start` | Start |
| `POST` | `/networks/{name}/stop` | Stop |
| `GET` | `/networks/{name}/xml` | XML |
| `POST` | `/networks/{name}/autostart/{enabled}` | Autostart |

### Storage

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/storage/pools` | List pools |
| `POST` | `/storage/pools/{name}/start` | Start pool |
| `POST` | `/storage/pools/{name}/stop` | Stop pool |
| `POST` | `/storage/pools/{name}/refresh` | Refresh |
| `POST` | `/storage/pools/{name}/autostart/{enabled}` | Autostart |
| `GET` | `/storage/pools/{pool}/volumes` | List volumes |
| `POST` | `/storage/pools/{pool}/volumes` | Create volume |
| `DELETE` | `/storage/pools/{pool}/volumes/{vol}` | Delete volume |
| `POST` | `/storage/pools` | Create pool (`{"name": "...", "pool_type": "dir", "target_path": "/path"}`) |
| `DELETE` | `/storage/pools/{name}` | Delete pool |
| `GET` | `/storage/pools/{name}/xml` | Pool XML |
| `POST` | `/storage/pools/{pool}/volumes/{vol}/resize` | Resize (`{"capacity_gb": 20}`) |
| `POST` | `/storage/pools/{pool}/volumes/{vol}/clone` | Clone (`{"new_name": "..."}`) |

### Backups

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/backups` | List all backups with status, size, checksums |
| `POST` | `/backups` | Trigger backup (`{"vm_name":"...", "with_disks":true, "incremental":true, "retain":7}`) |
| `GET` | `/backups/{id}/status` | Live backup progress and status |
| `POST` | `/backups/{id}/verify` | Verify SHA-256 checksums |
| `GET` | `/backups/{id}/download` | Download backup as tar.gz |
| `POST` | `/backups/restore` | Restore from backup (`{"backup_id":"..."}`) |
| `DELETE` | `/backups/{id}` | Delete a backup |
| `GET` | `/backups/schedule` | Get systemd timer status |
| `POST` | `/backups/schedule` | Enable/disable timer (`{"enabled":true}`) |

### Host & Infrastructure

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/capabilities` | Hypervisor capabilities (arch, CPU, guest types) |
| `POST` | `/cpu/compare` | Compare guest **CPU XML** to this host (`{"cpu_xml": "<cpu>...</cpu>", "flags": 0}`) — returns **`code`** and **`label`** (`identical`, `superset`, `incompatible`, `unknown`); **`flags`** are **`virConnectCompareCPUFlags`** (often `0`) |
| `GET` | `/sysinfo` | SMBIOS system info XML |
| `GET` | `/devices` | List all node devices (`?capability=pci\|net\|usb`) |
| `GET` | `/devices/{name}` | Device XML |
| `GET` | `/nwfilters` | List network filters |
| `GET` | `/nwfilters/{name}` | Filter XML |
| `DELETE` | `/nwfilters/{name}` | Delete filter |
| `GET` | `/secrets` | List libvirt secrets |
| `GET` | `/secrets/{uuid}` | Secret XML |
| `DELETE` | `/secrets/{uuid}` | Delete secret |
| `GET` | `/host/interfaces` | List host network interfaces |
| `GET` | `/host/bridges` | List host bridges |
| `GET` | `/host/stats` | Host resource statistics |
| `GET` | `/host/pci` | PCI device listing |
| `GET` | `/host/iommu-groups` | IOMMU group listing |
| `GET` | `/host/usb` | USB device listing |
| `GET` | `/host/system-info` | DMI hardware details (vendor, product, BIOS) |
| `GET` | `/host/backends` | Available backend capabilities |
| `POST` | `/host/shutdown` | Shut down the host |
| `POST` | `/host/reboot` | Reboot the host |
| `POST` | `/host/hostname` | Set hostname |
| `POST` | `/host/timezone` | Set timezone |

### Browsing & Import

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/browse/isos` | List available ISO images |
| `GET` | `/browse/disks` | List available disk images |
| `POST` | `/cloud-init` | Generate cloud-init ISO |
| `POST` | `/import/disk` | Import and convert VMDK/VDI/VHD to qcow2 |

### Networking & Firewall

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/portforward` | List port forwarding rules |
| `POST` | `/portforward` | Create port forwarding rule |
| `GET` | `/firewall` | List firewall rules |
| `POST` | `/firewall` | Create firewall rule |
| `GET` | `/dhcp-leases` | List DHCP leases |
| `GET` | `/tags` | List all tags across VMs |

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/login` | Login with PAM credentials |
| `POST` | `/api/v1/auth/logout` | Logout and clear session |
| `GET` | `/api/v1/auth/session` | Get current session info (`username`, `session_id` for admin revoke) |

**Browser UI:** open `https://HOST:5092/` or `https://HOST:5092/login` when unauthenticated. Both show the Machina login form. After PAM or OIDC success the SPA replaces `/login` with `/` so the authenticated shell never 404s on a stale login path.

| `POST` | `/api/v1/ws-token` | Get short-lived WebSocket authentication token |
| `GET` | `/terminal/targets` | List configured SSH terminal targets (`id`, `host`, `default_ssh_user`) |
| `POST` | `/terminal/sessions` | Create one-time SSH terminal session (`target_id` **or** ad-hoc `host` + `ssh_user`); returns `session_id` for `/ws/v1/terminal/{session_id}` (browser sessions only — API tokens rejected) |

### Web sessions (root only, browser login)

Lists in-memory cookie sessions for this daemon process. **API bearer tokens are not listed.** Revoking a session removes its cookie token (user must sign in again).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/sessions` | List sessions (`sessions`, `total_sessions`, `users_logged_in`, `sessions_per_username`) |
| `DELETE` | `/admin/sessions/{session_id}` | Revoke session by opaque `session_id` from the list or from `GET /auth/session` |

### RBAC & Tokens

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/roles` | List roles |
| `POST` | `/roles` | Create/update role |
| `GET` | `/tokens` | List API tokens |
| `POST` | `/tokens` | Create API token |

### Host OS users (PAM)

Requires **browser session** (not API tokens). The signed-in UNIX user must be **root** or in **`wheel`**, **`sudo`**, or **`admin`**. The daemon runs `useradd` / `chpasswd` on the host (typically as **root** via systemd).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/system/os-users/capability` | Whether the session may create users; includes **`libvirtGroupAvailable`** / **`libvirtGroupName`** for the host `libvirt` group |
| `POST` | `/system/os-users` | JSON `{ "username", "password", "add_to_libvirt_group"?: true }` — create local UNIX account; default adds user to **`libvirt`** (`usermod -aG`) for `qemu:///system` |

### Automation & Monitoring

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/alert-rules` | List alert rules |
| `POST` | `/alert-rules` | Create/update alert rule |
| `GET` | `/alerts` | List triggered alerts |
| `GET` | `/webhooks` | List webhooks |
| `POST` | `/webhooks` | Create webhook |
| `GET` | `/schedules` | List scheduled actions |
| `POST` | `/schedules` | Create scheduled action |
| `GET` | `/snapshot-schedules` | List snapshot schedules |
| `POST` | `/snapshot-schedules` | Create snapshot schedule |
| `GET` | `/notifications` | List notification channels |
| `POST` | `/notifications` | Create notification channel (Slack/email/Telegram/webhook) |

### Services & Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/services` | List systemd services |
| `POST` | `/services/{name}/{action}` | Control service (start/stop/restart/enable/disable) |
| `GET` | `/logs` | Query journald logs |
| `GET` | `/audit` | View audit log |

### WebSocket

| Path | Description |
|------|-------------|
| `/ws/v1/watch` | Real-time VM state changes |
| `/ws/v1/console/{name}` | Serial console (PTY bridge) |
| `/ws/v1/vnc/{name}` | VNC display proxy |
| `/ws/v1/spice/{name}` | SPICE display proxy |
| `/ws/v1/terminal/{session_id}` | Browser SSH after `POST /api/v1/terminal/sessions` — JSON `input` / `resize` / `ping`; binary frames carry raw PTY output; server runs OpenSSH in a PTY (`portable-pty`). Requires `?token=` from `POST /api/v1/ws-token`. |
| `/ws/v1/ssh/{host}` | **Legacy** raw WebSocket ↔ stdin/stdout SSH (disabled by default; set `ssh_terminal.legacy_plain_host_websocket = true` to enable) |

### Other

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/node` | Host info |
| `GET` | `/templates` | VM templates |
| `GET` | `/prometheus` | Prometheus metrics |
| `GET` | `/health` | Health check |

### API Examples

```bash
# List VMs
curl -sk https://localhost:5092/api/v1/vms | jq

# Create a VM
curl -sk -X POST https://localhost:5092/api/v1/vms \
  -H 'Content-Type: application/json' \
  -d '{"name": "test-vm", "vcpus": 2, "memory_mb": 2048, "disk_gb": 20}' | jq

# Start a VM
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/start | jq

# Get VM metrics
curl -sk https://localhost:5092/api/v1/metrics/test-vm | jq

# Create a snapshot
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/snapshots \
  -H 'Content-Type: application/json' \
  -d '{"name": "snap1", "description": "test snapshot"}' | jq

# Clone a VM
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/clone \
  -H 'Content-Type: application/json' \
  -d '{"new_name": "test-vm-clone"}' | jq

# Host info
curl -sk https://localhost:5092/api/v1/node | jq

# Prometheus metrics
curl -sk https://localhost:5092/api/v1/prometheus

# Trigger a backup (all VMs)
curl -sk -X POST https://localhost:5092/api/v1/backups \
  -H 'Content-Type: application/json' \
  -d '{"retain": 7}' | jq

# Backup a single VM with disks
curl -sk -X POST https://localhost:5092/api/v1/backups \
  -H 'Content-Type: application/json' \
  -d '{"vm_name": "test-vm", "with_disks": true}' | jq

# List backups
curl -sk https://localhost:5092/api/v1/backups | jq

# Verify backup checksums
curl -sk -X POST https://localhost:5092/api/v1/backups/20260324-020000/verify | jq

# Download backup as tar.gz
curl -skO https://localhost:5092/api/v1/backups/20260324-020000/download

# Restore from backup
curl -sk -X POST https://localhost:5092/api/v1/backups/restore \
  -H 'Content-Type: application/json' \
  -d '{"backup_id": "20260324-020000"}' | jq

# Enable scheduled backups
curl -sk -X POST https://localhost:5092/api/v1/backups/schedule \
  -H 'Content-Type: application/json' \
  -d '{"enabled": true}' | jq

# Login (PAM authentication)
curl -sk -X POST https://localhost:5092/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "admin", "password": "secret"}' -c cookies.txt | jq

# Use API token (Bearer auth; new tokens use `mach_` + hex, legacy installs may still have `vs_` + hex until rotated)
curl -sk https://localhost:5092/api/v1/vms \
  -H 'Authorization: Bearer mach_<hex-from-settings>' | jq

# Live resize vCPUs on running VM
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/live/vcpus/4 | jq

# Tag a VM
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/tags \
  -H 'Content-Type: application/json' \
  -d '{"tags": ["production", "web"]}' | jq

# USB passthrough
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/usb/attach \
  -H 'Content-Type: application/json' \
  -d '{"vendor_id": "0x1234", "product_id": "0x5678"}' | jq

# Live migration with optional libvirt MigrateParameters (e.g. bandwidth MiB/s, disk list)
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/migrate \
  -H 'Content-Type: application/json' \
  -d '{"dest_uri": "qemu+ssh://user@remote/system", "live": true, "parameters": {"bandwidth": 500}}' | jq

# Migration max bandwidth (MiB/s)
curl -sk https://localhost:5092/api/v1/vms/test-vm/migrate/max-bandwidth | jq
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/migrate/max-bandwidth \
  -H 'Content-Type: application/json' \
  -d '{"mib_per_sec": 800}' | jq

# Live migration max downtime (nanoseconds)
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/migrate/max-downtime \
  -H 'Content-Type: application/json' \
  -d '{"downtime_ns": 15000000000}' | jq

# NUMA tuning (partial update merges with current domain state)
curl -sk https://localhost:5092/api/v1/vms/test-vm/numa | jq
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/numa \
  -H 'Content-Type: application/json' \
  -d '{"mode": 1}' | jq

# Emulator thread pinning (bools index host logical CPUs)
curl -sk -X POST https://localhost:5092/api/v1/vms/test-vm/emulator/pin \
  -H 'Content-Type: application/json' \
  -d '{"cpus": [true, true, false, false]}' | jq

# Job info / stats (e.g. during migration)
curl -sk https://localhost:5092/api/v1/vms/test-vm/job | jq
curl -sk 'https://localhost:5092/api/v1/vms/test-vm/job/stats?flags=0' | jq

# Compare a guest CPU definition to this host
curl -sk -X POST https://localhost:5092/api/v1/cpu/compare \
  -H 'Content-Type: application/json' \
  -d '{"cpu_xml": "<cpu mode=\"host-passthrough\"/>", "flags": 0}' | jq

# Create port forwarding rule
curl -sk -X POST https://localhost:5092/api/v1/portforward \
  -H 'Content-Type: application/json' \
  -d '{"host_port": 9443, "vm_ip": "192.168.122.10", "vm_port": 8443, "protocol": "tcp"}' | jq

# Create alert rule
curl -sk -X POST https://localhost:5092/api/v1/alert-rules \
  -H 'Content-Type: application/json' \
  -d '{"metric": "cpu", "threshold": 90, "duration_secs": 300}' | jq

# Generate cloud-init ISO
curl -sk -X POST https://localhost:5092/api/v1/cloud-init \
  -H 'Content-Type: application/json' \
  -d '{"hostname": "myvm", "user": "admin", "ssh_key": "ssh-rsa AAAA..."}' | jq
```

---

## Makefile Targets

```
make help       # Show all targets
```

| Target | Description |
|--------|-------------|
| `make` | Build everything (Rust release + web frontend) |
| `sudo make deploy` | Install and start daemon (one command) |
| `sudo make start` | Start the daemon service |
| `sudo make stop` | Stop the daemon service |
| `sudo make restart` | Restart the daemon service |
| `sudo make status` | Show daemon service status |
| `sudo make install` | Install binaries, web UI, config, systemd unit |
| `sudo make uninstall` | Stop, disable, and remove everything |
| `make release` | Build optimized Rust binaries only |
| `make web` | Build web frontend only |
| `make build` | Build in debug mode |
| `make test` | Run all Rust tests |
| `make lint` | Run clippy |
| `make fmt` | Format code |
| `make run-daemon` | Run daemon in debug mode |
| `make run-tui` | Run TUI in debug mode |
| `make clean` | Remove all build artifacts |

### Typical Workflows

```bash
# First time setup
make && sudo make deploy

# After code changes
make && sudo make restart

# Full cleanup
sudo make uninstall && make clean
```

---

## Systemd Service

```bash
sudo make install
sudo systemctl enable --now machina-daemon
sudo systemctl status machina-daemon
sudo journalctl -u machina-daemon -f
```

Security hardening: `ProtectSystem=strict`, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectKernelTunables/Modules/Logs=true`, `RestrictAddressFamilies`, `SystemCallArchitectures=native`.

---

## Troubleshooting

### Daemon won't start

```bash
sudo systemctl status libvirtd              # Is libvirtd running?
virsh -c qemu:///system list --all          # Can you connect?
journalctl -u machina-daemon -e           # Check logs
RUST_LOG=debug machina-daemon             # Debug logging
```

### Web UI shows blank page

```bash
ls /usr/local/share/machina/web/index.html   # Is web UI installed?
make web && sudo make install                   # Rebuild and reinstall
```

### Navbar stuck on "Connecting" or "Offline" (no "Live")

The **Live** badge means the browser has an open WebSocket to **`/ws/v1/watch`**. It needs a successful **`POST /api/v1/ws-token`** (session cookie) then **`wss://<same-host>/ws/v1/watch?token=...`**.

- **Reverse proxy / ingress** must allow WebSocket upgrades on the same host and path prefix as the UI. For **nginx**, pass through `Upgrade` and `Connection`:

```nginx
location / {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_pass https://127.0.0.1:5092;
}
# map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

- **Corporate proxies** sometimes block WebSockets entirely.
- If **`ws-token`** returns **401**, refresh after sign-in; the UI will show **Offline** after repeated token failures.

### VNC console won't connect

```bash
virsh vncdisplay <vm-name>                  # Is VNC port assigned?
curl -sk https://localhost:5092/api/v1/vms/console-info/<vm-name> | jq   # Check port
# VNC only works on running VMs with graphics configured
```

### Serial console shows "Connected" but nothing appears

The guest OS needs serial console enabled in its kernel cmdline:
```bash
# Inside the VM, add to /etc/default/grub:
GRUB_CMDLINE_LINUX="console=ttyS0,115200"
# Then: sudo grub2-mkconfig -o /boot/grub2/grub.cfg && reboot
```

### VNC shows "Not Available"

The VM uses SPICE graphics instead of VNC. Switch to VNC:
```bash
sudo virsh edit <vm-name>
# Change: <graphics type='spice' ...>
# To:     <graphics type='vnc' port='-1' autoport='yes' listen='127.0.0.1'/>
# Restart the VM
```

### Permission denied

```bash
sudo usermod -aG libvirt $USER && newgrp libvirt
# Or: machina-daemon --libvirt-uri qemu:///session
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | [Rust](https://www.rust-lang.org/) |
| Daemon | [Axum](https://github.com/tokio-rs/axum) + [Tokio](https://tokio.rs) |
| PTY (browser SSH) | [portable-pty](https://docs.rs/portable-pty) + system OpenSSH client |
| Terminal UI | [Ratatui](https://ratatui.rs) |
| Web UI | [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org/) + [Tailwind CSS 4](https://tailwindcss.com) |
| Charts | [Recharts](https://recharts.org) |
| VNC Console | [noVNC](https://novnc.com) (served from system install) |
| SPICE Console | [spice-html5](https://gitlab.freedesktop.org/niclas/spice-html5) |
| Serial/SSH Console | [xterm.js](https://xtermjs.org) + direct PTY I/O |
| Libvirt | [virt](https://crates.io/crates/virt) crate |
| HTTP client | [Reqwest](https://crates.io/crates/reqwest) |
| Serialization | [Serde](https://serde.rs) |
| CLI | [Clap](https://clap.rs) |

---

## Utility Scripts

### Status Overview

```bash
./scripts/status.sh
```

Single-screen dashboard showing host info, all VMs with state/vCPUs/memory, live metrics (memory %, disk I/O, network I/O), networks, storage pools with usage bars, snapshots, and service status.

### Backup & Restore

```bash
./scripts/backup.sh                          # Backup all VM/network/pool XML configs
./scripts/backup.sh --vm myvm               # Backup a single VM
./scripts/backup.sh --with-disks            # Also copy disk images
./scripts/backup.sh --incremental           # Incremental: hardlink unchanged disk files
./scripts/backup.sh --nfs 192.168.1.10:/bk  # Backup to NFS share
./scripts/backup.sh --retain 7             # Keep only last 7 backups
./scripts/backup.sh --list                  # Preview what would be backed up
./scripts/backup.sh --restore /var/lib/machina/backups/20260323-123456
./scripts/backup.sh --verify /var/lib/machina/backups/20260323-123456
```

Backups are saved to `/var/lib/machina/backups/<timestamp>/` with VM/network/pool XML, JSON summaries, SHA-256 checksums, and optionally disk images. Use `--restore` to redefine VMs, networks, and storage pools (and optionally copy disk images back).

**Scheduled backups** via systemd timer:
```bash
sudo systemctl enable --now machina-backup.timer   # Daily at 2 AM
sudo systemctl list-timers machina-backup           # Check schedule
journalctl -u machina-backup.service                # View logs
```

**Config file:** `/etc/machina/backup.conf` — set backup_dir, nfs_target, retention, etc.

### Bulk Operations

```bash
./scripts/bulk.sh status                     # Quick VM status table
./scripts/bulk.sh start                      # Start all stopped VMs
./scripts/bulk.sh shutdown                   # Graceful shutdown all running VMs
./scripts/bulk.sh stop                       # Force stop all running VMs
./scripts/bulk.sh pause                      # Pause all running VMs
./scripts/bulk.sh resume                     # Resume all paused VMs
./scripts/bulk.sh snapshot                   # Auto-timestamped snapshot of all running VMs
./scripts/bulk.sh snapshot-clean             # Delete all auto-* snapshots
./scripts/bulk.sh start vm1 vm2              # Target specific VMs
```

### API Demo

```bash
sudo ./scripts/demo.sh                      # 30-step API demo (creates/tests/deletes a VM)
```

Exercises a broad set of REST API endpoints including VM lifecycle, snapshots, networks, storage, capabilities, devices, network filters, Prometheus metrics, and security validation tests.

---

## Documentation

PDF documentation is available in `demo-screenshots/`:

| Document | Description |
|----------|-------------|
| [machina-demo.pdf](demo-screenshots/machina-demo.pdf) | Client presentation — features, architecture, 10 live screenshots, security |
| [machina-quickstart.pdf](demo-screenshots/machina-quickstart.pdf) | Quick Start Guide — prerequisites, build, install, access, TUI shortcuts, config, troubleshooting |
| [machina-api-reference.pdf](demo-screenshots/machina-api-reference.pdf) | Complete API reference — REST endpoints, curl examples, response formats, automation scripts |
| [machina-security-architecture.pdf](demo-screenshots/machina-security-architecture.pdf) | Security & Architecture — system diagram, input validation, SSRF prevention, comparison table |
| [machina-demo-scripts-guide.pdf](demo-screenshots/machina-demo-scripts-guide.pdf) | Demo & Scripts Guide — 30-step demo walkthrough, status/backup/bulk scripts reference |

Regenerate PDFs:
```bash
python3 demo-screenshots/generate_pdf.py              # demo deck
python3 demo-screenshots/generate_quickstart_pdf.py    # quickstart guide
python3 demo-screenshots/generate_api_pdf.py           # API reference
python3 demo-screenshots/generate_security_pdf.py      # security & architecture
python3 demo-screenshots/generate_demo_guide_pdf.py    # demo & scripts guide
```

---

## Contributing

```bash
git clone https://github.com/ssahani/machina.git
cd machina
make build && make test && make lint && make fmt-check
```

---

## License

**HyperSDK Proprietary** — All rights reserved. See [LICENSE](LICENSE) for details.

This software is the proprietary property of HyperSDK. Pricing to be determined. Contact HyperSDK for licensing options.

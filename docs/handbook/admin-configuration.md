# Machina — Administration & Configuration

*Part of the [Machina Handbook](README.md) · see also
[Product Guide](product-guide.md) · [FAQ](faq.md) ·
[Troubleshooting](troubleshooting.md)*

---

## 1. Deployment & run models

> **Build on Linux only.** The Rust workspace depends on Linux libvirt headers;
> do not `cargo build` on macOS. Build on a Linux host or use remote deploy.

### A. Single host with `machinactl` (recommended)

```bash
git clone https://github.com/zyvorailabs/machina.git && cd machina
./machinactl deploy      # deps → build → install → start → verify
./machinactl status      # systemctl status machina-daemon
./machinactl health      # deep health check (exit 0 healthy / 1 degraded / 2 critical)
```

`machinactl deploy` installs dependencies, builds `--release`, runs
`make install`, starts the `machina-daemon` service, and smoke-tests the API on
`https://127.0.0.1:5092`.

### B. Remote deploy from a workstation

`deploy-remote.sh` rsyncs sources to the remote host and compiles/installs there
(nothing is built locally — you only need `rsync` + `ssh`).

```bash
./scripts/deploy-remote.sh USER@HOST --remote-build
./scripts/deploy-remote.sh USER@HOST --platform      # also controller + agent
./scripts/deploy-remote.sh USER@HOST --open-firewall
```

Useful env vars: `SSH_PORT` (22), `REMOTE_DIR` (`~/.deployment/machina`),
`REMOTE_CARGO_BUILD_JOBS` (1), `HEALTH_URL`
(`https://127.0.0.1:5092/api/v1/health`), `SSHPASS`. There is also a friendly
wrapper: `./scripts/deploy remote USER@HOST [flags]`, `deploy check`,
`deploy status`.

### C. Multi-host platform (controller + agent)

Installed with `INSTALL_PLATFORM=1 make install` or
`scripts/install-platform.sh` (run as root after building). This adds the
`machina-controller` (:5093) and `machina-agent` (:50051 / :50052) systemd
services. Flags: `--bind ADDR`, `--public-url URL`, `--require-auth`,
`--open-firewall`. `MACHINA_SKIP_AUTH=1` writes a dev bypass into
`/etc/default/machina-platform`.

### D. Kubernetes (daemon only)

A Helm chart lives at `contrib/k8s/machina/` (chart `machina`, appVersion
`0.1.0`). It deploys **only** `machina-daemon` on :5092 (`ClusterIP`,
containerPort named `https`); auth (PAM/LDAP/OIDC/SAML) is rendered into a
Secret mounted at `/etc/machina` (`templates/secret.yaml`) — it holds the
JWT signing secret and the OIDC client secret, so it is a Secret rather than
a ConfigMap. Env: `MACHINA_JWT_SECRET`,
`MACHINA_DAEMON_SKIP_AUTH`.

> The controller/agent tier is **systemd-only** — there are no k8s manifests for
> it. The image `ghcr.io/zyvorailabs/machina-daemon` is referenced by the chart but
> the repo contains no Dockerfile that builds it.

### E. Package for handoff

```bash
./scripts/package-binary-remote.sh USER@HOST --fetch
```

Builds `make release web` on a remote Linux host and tarballs
daemon + TUI + `web/dist` into `./dist/` for client handoff.

### Where things install (via `make install`)

| Artifact | Path |
|----------|------|
| Daemon binary | `/usr/local/bin/machina-daemon` |
| Controller / agent (if `INSTALL_PLATFORM=1`) | `/usr/local/bin/machina-controller`, `/usr/local/bin/machina-agent` |
| Config | `/etc/machina/config.toml` |
| Daemon env file | `/etc/default/machina-daemon` |
| Platform env file | `/etc/default/machina-platform` |
| systemd units | `/usr/lib/systemd/system/machina-*.service` |
| Web UI | `/usr/local/share/machina/web/` |
| State (backups, roles, audit, metrics) | `/var/lib/machina/` |
| Runtime | `/run/machina/` |

### systemd units

| Unit | ExecStart | Notes |
|------|-----------|-------|
| `machina-daemon.service` | `/usr/local/bin/machina-daemon --config /etc/machina/config.toml` | `User=root`, `Restart=always`, `Requires=libvirtd`, `MemoryMax=2G`, `RUST_LOG=info`, reads `-/etc/default/machina-daemon` |
| `machina-controller.service` | `/usr/local/bin/machina-controller --host 0.0.0.0 --port 5093` | reads `-/etc/default/machina-platform` |
| `machina-agent.service` | `/usr/local/bin/machina-agent --listen 127.0.0.1:50051 --console-listen 127.0.0.1:50052` | `Environment=MACHINA_LIBVIRT_URI=qemu:///system`, starts libvirtd first |
| `machina-backup.service` / `.timer` | `backup.sh --config /etc/machina/backup.conf` | oneshot, daily 2 AM |

---

## 2. Ports

| Port | Component | Bind default | How to change |
|------|-----------|--------------|---------------|
| **5092** | `machina-daemon` (HTTPS) | `0.0.0.0:5092` | `[daemon] host/port`, `--host/--port`, Helm `daemon.port` |
| **5093** | `machina-controller` | `0.0.0.0:5093` | `machina-controller --host --port` |
| **50051** | `machina-agent` gRPC | `127.0.0.1:50051` | `machina-agent --listen` |
| **50052** | `machina-agent` console | `127.0.0.1:50052` | `machina-agent --console-listen` |
| **3000** | Vite dev server | dev only | `web/vite.config.ts` |

---

## 3. Daemon configuration (`config.toml`)

**Resolution order** (`daemon/src/main.rs`, `MachinaConfig::load()`):

1. `--config <path>` if given (read directly, no fallback), else
2. `/etc/machina/config.toml`, then `~/.machina/config.toml` (first that
   exists/parses wins), else built-in defaults.
3. CLI `--host` / `--port` / `--libvirt_uri` override the loaded values.

Every section uses `#[serde(default)]`, so any omitted field falls back to the
default below. The shipped template is `contrib/machina.toml`.

### `[daemon]`
| Field | Type | Default |
|-------|------|---------|
| `host` | string | `"0.0.0.0"` |
| `port` | u16 | `5092` |

### `[libvirt]`
| Field | Type | Default |
|-------|------|---------|
| `uri` | string | `"qemu:///system"` |
| `create_backend` | `virt_install` \| `libvirt_xml` | `virt_install` |
| `guest_agent_by_default` | bool | `true` |
| `guestkit_agent_binary` | string | `"/usr/local/bin/guestkit"` |
| `dual_connection` | bool | `false` (connect both system + session) |
| `extra_uris` | list | `[]` |
| `mkosi_allowed` | bool | `true` |
| `virt_builder_allowed` | bool | `false` |
| `virt_builder_update` | bool | `true` |
| `virt_builder_default_packages` | list | `[]` |
| `virt_image_build_max_concurrent` | usize | `2` |
| `virt_image_build_timeout_secs` | u64 | `0` (unlimited) |
| `virt_image_build_min_free_parent_bytes` | u64 | `536870912` (512 MiB) |
| `virt_image_build_min_free_tmp_bytes` | u64 | `268435456` (256 MiB) |
| `dockur_windows_allowed` | bool | `false` |
| `dockur_disk_size` | string | `""` (script default `64G`) |
| `dockur_ram_size` | string | `""` (script default `4G`) |
| `dockur_cpu_cores` | string | `""` (script default `2`) |

Golden Forge Windows (`win10`, `win11`) uses [dockur/windows](https://github.com/dockur/windows) in Podman. Enable `dockur_windows_allowed`, ensure Podman and `/dev/kvm` are available, then `POST /api/v1/jobs/packer-golden-build` with `{"guest":"win11"}`. On success Machina:

1. Keeps the job artifact under `/var/lib/machina/packer-builds/{job-id}/work/output-{guest}/{guest}.qcow2`
2. Copies to the marketplace path `/var/lib/libvirt/images/{guest}.qcow2`
3. Writes a saved daemon template `/var/lib/machina/templates/{guest}.json` (`base_image` set)
4. Platform catalog templates `win10` / `win11` resolve that same `source_disk`

**Vessel (Containers):** `POST /api/v1/vessel/windows-dockur` with `{"guest":"win11"}` starts `dockurr/windows` via Podman (preferred) or Docker, reusing the golden qcow2 when present. UI: Containers → Windows 11 / Windows 10. Viewer `http://127.0.0.1:8006`, RDP `127.0.0.1:3389`.

**KubeVirt:** `GET /api/v1/kubevirt/qcow2-bundle?qcow2_path=/var/lib/libvirt/images/win11.qcow2&guest_os=windows` emits EFI + TPM + virtio + RDP so dockur goldens can boot on KubeVirt. See `contrib/packer/windows-dockur/README.md`.

### `[auth]`
| Field | Type | Default |
|-------|------|---------|
| `pam_service` | string | `"sshd"` (i.e. `/etc/pam.d/sshd`) |
| `max_sessions_global` | usize | `1000` |
| `max_sessions_per_user` | usize | `0` (unlimited) |

Sub-tables:

- **`[auth.oidc]`** — `enabled=false`, `issuer_url`, `client_id`,
  `client_secret`, `redirect_url`, `scopes=["openid","profile","email"]`,
  `username_claim="preferred_username"`, `groups_claim="groups"`,
  `linux_username_claim="preferred_username"`, `admin_groups=[]`,
  `operator_groups=[]`, `default_role="read_only"`,
  `button_label="Sign in with SSO"`, `require_local_user_for_session_libvirt=false`.
- **`[auth.ldap]`** — `enabled=false`, `url`, `base_dn`,
  `user_filter="(uid={username})"`, `bind_dn`, `bind_password`,
  `user_dn_template`, `username_attribute="uid"`, `use_tls=false`,
  `insecure_tls=false`, `member_attribute="memberOf"`,
  `admin_group_substrings=[]`, `operator_group_substrings=[]`,
  `readonly_group_substrings=[]`.
- **`[auth.saml]`** — config-only (login not wired): `enabled=false`,
  `sp_entity_id`, `sp_acs_url`, `idp_entity_id`, `idp_metadata_url`,
  `idp_metadata_xml`, `default_role="read_only"`.
- **`[auth.run_as_user]`** — `enabled=false`, `mode` (`disabled`/`sudo`/
  `polkit`/`setuid_helper`), `setuid_helper_path=
  "/usr/local/libexec/machina-run-as-user"`.

### `[tls]`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | bool | `false` (installer sets `true`) |
| `cert_path` | string | `""` → `/etc/machina/ssl/cert.pem` |
| `key_path` | string | `""` → `/etc/machina/ssl/key.pem` |

TLS is active only when `enabled=true` **and** both paths are non-empty.

### `[backup]`
| Field | Type | Default |
|-------|------|---------|
| `backup_dir` | string | `"/var/lib/machina/backups"` |
| `nfs_target` | string | `""` |
| `with_disks` | bool | `false` |
| `retain` | u32 | `7` |

### `[fleet]`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | bool | `false` |
| `primary_peer` / `standby_peer` | string | `""` |
| `peers` | list of `{ name, url, api_token, insecure_tls }` | `[]` |

### `[metrics_history]`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | bool | `true` |
| `interval_secs` | u64 | `30` (min 15) |
| `max_points` | usize | `120` |
| `persist` | bool | `true` (→ `/var/lib/machina/metrics-history.jsonl`) |
| `max_file_mb` | u64 | `32` |
| `remote_write_url` / `remote_write_authorization` | string | `""` |

### `[observability.otlp]`
| Field | Type | Default |
|-------|------|---------|
| `enabled` | bool | `false` |
| `endpoint` | string | `""` (e.g. `http://127.0.0.1:4318`) |
| `interval_secs` | u64 | `60` |
| `export_metrics` / `export_logs` / `export_traces` | bool | `true` |
| `authorization` | string | `""` |

`[observability.linux_audit]` — `enabled=true`, `max_events=200`,
`health_avc_threshold=0`.

### Other sections
- `[general]` — `refresh_interval_secs=5`, `default_project_tag=""`.
- `[audit]` — `max_file_mb=64`, `rotate_keep=5`, `syslog_enabled=false`,
  `http_webhook_url`, `webhook_authorization`, `sign_lines=false`
  (log: `/var/lib/machina/audit.log`).
- `[inventory_history]` — `enabled=true`, `interval_secs=3600`, `max_file_mb=64`.
- `[ssh_terminal]` — `session_ttl_secs=120` (30–3600), `allow_adhoc_hosts=true`.
- `[vessel]` — local Podman/Docker container engine (Vessel). `enabled=true`
  by default; daemon connects fail-soft if the socket is missing. Optional
  `socket` (unix path or `unix://…`); `auto_discover=true` searches common
  Podman/Docker socket locations when `socket` is empty. REST:
  `/api/v1/vessel/*`; WebSocket stats/logs under `/ws/v1/vessel/…`.
- `[kubevirt]`, `[hypersdk]`, `[guestkit]`, `[packetwolf]` —
  integration blocks, all `enabled=false` by default (see
  [Product Guide → Integrations](product-guide.md#integrations)).

---

## 4. Environment variables

### Daemon (`machina-daemon`)
| Variable | Effect | Default |
|----------|--------|---------|
| `RUST_LOG` | Log filter; if unset, forced to `info,rustls::msgs::handshake=error` | — |
| `MACHINA_JWT_SECRET` | HMAC secret to validate platform-controller JWTs | unset → a random secret is generated per process start (sessions won't survive a restart); explicitly setting the literal `machina-dev-jwt-secret-change-me` is detected and ignored in favor of the same random fallback |
| `MACHINA_DAEMON_SKIP_AUTH` | `=1` bypasses auth (dev only — every request is admin) | unset |
| `MACHINA_DEFAULT_SSH_USER` | Default SSH user for terminal targets | `ubuntu` |
| `MACHINA_PLATFORM_CONTROLLER_URL` | Upstream controller URL for the reverse proxy | — |
| `MACHINA_PLATFORM_AUTH` | Credentials for the controller proxy | — |
| `MACHINA_H2KVM_NO_SUDO` | Run hyper2kvm without sudo | unset |
| `CONSOLEHUB_REQUIRE_OIDC` | Gate ConsoleHub behind OIDC | unset |
| `CONSOLEHUB_SESSION_TTL_SECS` | ConsoleHub session TTL override | — |
| `KUBECONFIG` / `HOME` | Kubeconfig resolution | — |
| `NOTIFY_SOCKET` / `WATCHDOG_USEC` | systemd readiness + watchdog | set by systemd |

### Controller (`machina-controller`)
| Variable | Effect | Default |
|----------|--------|---------|
| `DATABASE_URL` | State store | `sqlite:///var/lib/machina/controller.db` (embedded; Postgres via SQLx also supported) |
| `NATS_URL` | Enables NATS task fan-out | `nats://127.0.0.1:4222` (optional) |
| `MACHINA_AGENT_ADDR` | gRPC agent address | `http://127.0.0.1:50051` |
| `MACHINA_JWT_SECRET` | JWT signing secret | unset → a random secret is generated per process start (sessions won't survive a restart); explicitly set to the literal `machina-dev-jwt-secret-change-me` and the controller **refuses to start** unless `MACHINA_ALLOW_DEV_SECRETS=1`/`MACHINA_SKIP_AUTH=1` |
| `MACHINA_PUBLIC_URL` | Public controller URL | `http://127.0.0.1:5093` |
| `MACHINA_WEB_URL` | Web UI URL | `http://127.0.0.1:5173` |
| `MACHINA_SKIP_AUTH` | `=1` disables JWT auth (dev only) | unset |
| `MACHINA_CONTROLLER_ID` | Unique instance ID | — |
| `MACHINA_DAEMON_URL` | URL the controller uses to reach the daemon | — |
| `MACHINA_API_KEY_MASTER_KEY` | 64-char hex AES-256-GCM key encrypting LLM provider keys at rest (`openssl rand -hex 32`) | unset = plaintext |
| `GUESTKIT_ENABLED` / `PACKETWOLF_ENABLED` | Integration toggles | `true` / `false` |

### Web (Vite, dev)
| Variable | Effect |
|----------|--------|
| `VITE_MACHINA_CONTROLLER_URL` | Point the UI directly at the controller (bypass daemon proxy) |

---

## 5. Authentication & RBAC

**Login flow** — the web UI and API sign in against **Linux host accounts via
PAM** (service `[auth].pam_service`, default `sshd`). If `[auth.ldap]` is
enabled, LDAP is tried first, then PAM. OIDC browser SSO is available via
`/auth/oidc/login`. Auth sources: `Pam`, `Ldap`, `Oidc`, `ApiToken`.

**Sessions** — on login the daemon sets an `HttpOnly; SameSite=Strict` cookie
named **`machina_session`** holding a 32-byte random token; server-side session
TTL is **24h**. The cookie also carries `Secure` whenever TLS is actually
serving the daemon (`TlsConfig::is_effectively_enabled()` — true by default,
since HTTPS is on out of the box; see §6), so browsers won't leak it over a
plaintext fallback listener. Logout clears it with matching attributes.
Admins can list/revoke via `GET /admin/sessions` and
`DELETE /admin/sessions/{id}`. WebSocket connections use a single-use token
from `POST /api/v1/ws-token` passed as `?token=`.

**RBAC roles** — `Admin`, `Operator`, `ReadOnly`:

| Capability | Admin | Operator | ReadOnly |
|-----------|:-----:|:--------:|:--------:|
| Read / view | ✅ | ✅ | ✅ |
| Write (start/stop/create) | ✅ | ✅ | ❌ |
| Delete / destroy VM | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |
| Browse host paths | ✅ | ❌ | ❌ |
| USB / PCI passthrough | ✅ | ✅ | ❌ |

Role sources: `/var/lib/machina/roles.json` (username → role map; **if empty or
missing, users default to `Admin`**), OIDC `admin_groups`/`operator_groups`
mapping, and API tokens (`/var/lib/machina/api-tokens.json`, prefixes `mach_` /
`vs_`, scope-limited; API-token actors are blocked from host-insight endpoints).

> **Production:** populate `roles.json` (an empty file grants everyone admin),
> set a strong `MACHINA_JWT_SECRET`, and never set `MACHINA_DAEMON_SKIP_AUTH=1`.

See also [../guides/ad-integration-zyvorai.md](../guides/ad-integration-zyvorai.md)
for Active Directory / LDAP.

---

## 6. TLS / certificates

HTTPS on :5092 is enabled by default. The installer (`install.sh
ensure_tls_for_https`, or `machinactl tls`) generates a self-signed cert:

```bash
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -subj "/CN=<hostname>/O=machina" \
  -addext "subjectAltName=DNS:<hostname>,DNS:localhost,IP:127.0.0.1"
# → /etc/machina/ssl/cert.pem (644), /etc/machina/ssl/key.pem (600)
```

and appends the `[tls]` block to `/etc/machina/config.toml`. To use a real cert,
replace the two files and keep the paths (or point `[tls] cert_path/key_path`
elsewhere). Because the default cert is self-signed, CLI tools use `curl -sk` /
`insecure_tls`. Regenerate any time with `./machinactl tls`.

---

## 7. Building from source

```bash
make build          # debug (all workspace members)
make release        # optimized release
make web            # cd web && npm install && npm run build
make test           # cargo test --workspace + web vitest
make lint           # clippy -D warnings
make fmt            # rustfmt all crates
make install        # install binaries + units + web (add INSTALL_PLATFORM=1 for controller/agent)
```

Build prerequisites (installed by `machinactl deps`): libvirt + `qemu-kvm` +
`virt-install`, gcc/make/pkg-config, OpenSSL/systemd/PAM dev headers,
clang/llvm (`pam-sys` bindgen needs `libclang` — set `LIBCLANG_PATH` if
autodetect fails), Rust toolchain, Node.js/npm. `machinactl doctor` checks
readiness (`/dev/kvm`, systemd, `virsh`, `qemu-img`, etc.).

---

## 8. Production checklist

- [ ] `./machinactl doctor` passes (KVM enabled, libvirtd running, deps present).
- [ ] Replace the self-signed TLS cert with a CA-signed one (keep
      `/etc/machina/ssl/` paths).
- [ ] Populate `/var/lib/machina/roles.json` — **an empty file makes everyone an
      admin.**
- [ ] Choose an auth backend: PAM service, or enable `[auth.ldap]` / `[auth.oidc]`.
- [ ] Set a strong `MACHINA_JWT_SECRET` (and `MACHINA_API_KEY_MASTER_KEY` on the
      controller) in `/etc/default/machina-daemon` / `machina-platform`.
- [ ] Never set `MACHINA_DAEMON_SKIP_AUTH=1` / `MACHINA_SKIP_AUTH=1` in prod.
- [ ] Bind carefully: `[daemon] host` is `0.0.0.0` by default — front with a
      firewall or reverse proxy.
- [ ] Enable backups: `./machinactl backup enable` (daily timer); point
      `[backup].nfs_target` off-box.
- [ ] Wire observability: `[metrics_history]` persist, `/prometheus` scrape,
      `[observability.otlp]` export.
- [ ] Configure audit shipping (`[audit].http_webhook_url` /
      `syslog_enabled` / `sign_lines`) and verify with `machinactl audit verify`.
- [ ] Run `./machinactl verify` and `./machinactl health` post-deploy.

---

*Next: [FAQ](faq.md) · [Troubleshooting](troubleshooting.md)*

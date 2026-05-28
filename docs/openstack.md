# OpenStack in Machina

Machina manages OpenStack Nova instances and Glance images from the same UI as libvirt VMs—without Horizon. Credentials stay on the daemon host (`clouds.yaml`, config file, or `OS_*`); they are never stored in the browser.

## First-boot checklist

1. Install or finish OpenStack on the host (Packstack, RDO, DevStack, etc.) and confirm Keystone answers on port 5000.
2. Wire Machina to the cloud (Packstack-partial / minimal: use the all-in-one bootstrap — see [openstack-minimal.md](openstack-minimal.md)):
   ```bash
   sudo /usr/local/share/machina/scripts/openstack-bootstrap-machina.sh /root/keystonerc_admin <CONTROLLER_IP>
   ```
   Or wire only:
   ```bash
   sudo /usr/local/share/machina/scripts/openstack-wire-cloud.sh /root/keystonerc_admin packstack
   sudo systemctl restart machina-daemon
   ```
3. In the Machina UI: **Settings → OpenStack connection → Test connection** (or `POST /api/v1/openstack/test-connection`). Status must show **reachable=yes**.
4. Open **OpenStack → Instances**. The nav group is always visible; instance APIs work only when **configured + reachable** (Keystone up).
5. Optional: set `[openstack] upload_enabled = true` for **Disk images → Upload to OpenStack** (native Glance upload in machina-daemon).

### UI states

| State | `platform-info` | `GET /openstack/status` | What you see |
|-------|-----------------|-------------------------|--------------|
| Off | `enabled=false` | — | Wire OpenStack setup panel |
| Needs wire | `enabled=true`, `configured=false` | — | Wire script instructions |
| Unreachable | configured | `reachable=false` | Diagnose panel (Keystone down, wrong creds, etc.) |
| Live | configured | `reachable=true` | Instances, Glance, create wizard |

Smoke on the host:

```bash
source /root/keystonerc_admin && openstack server list
curl -sk https://127.0.0.1:5092/api/v1/openstack/status
```

## HyperSDK / OpenStack CLI compatibility

Machina uses the same Keystone v3 mental model as HyperSDK and `openstack` CLI:

| Machina `[openstack]` | HyperSDK / `OS_*` |
|----------------------|-------------------|
| `auth_url` | `OS_AUTH_URL` |
| `username` | `OS_USERNAME` |
| `password` | `OS_PASSWORD` |
| `project_name` (alias **`tenant`**) | `OS_PROJECT_NAME` / `OS_TENANT_NAME` |
| `domain_name` | `OS_USER_DOMAIN_NAME` |
| `region` | `OS_REGION_NAME` |
| `cloud_name` + `clouds_yaml_path` | `clouds.yaml` cloud entry |
| `default_os_cloud` | default cloud when `cloud_name` is empty |

After Packstack or any OpenStack install, run on the host:

```bash
sudo ./scripts/openstack-wire-cloud.sh /root/keystonerc_admin packstack
```

That writes `/etc/openstack/clouds.yaml`, `/etc/machina/openstackrc`, and updates `[openstack]` in machina config. The daemon loads `EnvironmentFile=-/etc/machina/openstackrc` (see `contrib/machina-daemon.service`).

## Connection

Enable management in `/etc/machina/config.toml` (or `~/.machina/config.toml`):

```toml
[openstack]
enabled = true
cloud_name = "mycloud"
clouds_yaml_path = "~/.config/openstack/clouds.yaml"
connect_timeout_secs = 30

# Or inline Keystone v3 (do not commit passwords):
# auth_url = "https://controller:5000/v3"
# username = "admin"
# password = "secret"
# project_name = "demo"
# domain_name = "Default"

# Or use openrc / OS_* on the daemon host:
# use_env_auth = true
```

**Settings → OpenStack connection** runs `POST /api/v1/openstack/test-connection` to validate auth.

| API | Purpose |
|-----|---------|
| `GET /api/v1/openstack/status` | configured, cloud name, reachable, last error |
| `POST /api/v1/openstack/test-connection` | validate credentials |

## Instance UI

| Nav | Path |
|-----|------|
| OpenStack | `/openstack/instances` — list, search, start/stop/reboot (nav when configured) |
| Instance detail | `/openstack/instances/{id}` — lifecycle, console, FIPs, Cinder attach/detach, resize, security groups, export |
| Instance interfaces | `/openstack/instances/{id}/interfaces` — attach/detach NICs |
| Embedded console | `/openstack/instances/{id}/console?type=novnc` — iframe to Nova remote console URL |
| Create wizard | `/openstack/create` — Glance image, existing Cinder boot volume, or new volume from image; flavor, network, keypair |
| Glance images | `/openstack/images` — pull to hypervisor, import as libvirt |
| Glance image detail | `/openstack/images/{id}` |
| Security groups | `/openstack/security-groups` — list, create group, add/delete rules |
| Security group detail | `/openstack/security-groups/{id}` |
| Cinder volumes | `/openstack/volumes` — create, extend, snapshot, delete |
| Volume detail | `/openstack/volumes/{id}` — bootable toggle, upload to Glance |
| Volume snapshots | `/openstack/volume-snapshots` — list, restore, delete |
| Volume snapshot detail | `/openstack/volume-snapshots/{id}` |
| Volume transfer detail | `/openstack/volume-transfers/{id}` — auth key copy |
| Floating IPs | `/openstack/floating-ips` — allocate, associate, release |
| Floating IP detail | `/openstack/floating-ips/{id}` |
| Networking | `/openstack/networking` — lab create (network/subnet/router/port/FIP) + topology lists |
| Network topology (SVG) | `/openstack/topology` — Neutron graph (networks, subnets, routers, ports, FIPs, instances) |
| Heat stacks | `/openstack/heat` — list, create (template), delete · detail `/openstack/heat/{name}/{id}` |
| Octavia load balancers | `/openstack/load-balancers` — list, create, delete · detail `/openstack/load-balancers/{id}` |
| Identity (read-only) | `/openstack/identity` — Keystone projects and users |
| Network / subnet / router / port detail | `/openstack/networks/{id}` · `/openstack/subnets/{id}` · `/openstack/routers/{id}` · `/openstack/ports/{id}` |
| Flavors / server groups | `/openstack/flavors/{id}` · `/openstack/server-groups/{id}` · `/openstack/hypervisors/{id}` |
| SSH keypairs | `/openstack/keypairs` — list, create/import, delete |
| Bulk migrations | `/openstack/migrations` — HyperSDK proxy (when `[hypersdk] enabled`) |

Lifecycle APIs:

- `GET /api/v1/openstack/instances` — query `search`, `status`, `limit` (default 25 when paginating), `marker` (Nova server UUID for next page); returns `next_marker`, `has_more`, and `search_truncated` when name search scans more than 500 matches; omit `limit`/`marker` for full project list with `total`
- `GET /api/v1/openstack/instances/{id}`
- `POST .../start`, `.../stop`, `.../reboot` — body `{ "reboot_type": "soft" \| "hard" }`
- `POST .../pause`, `.../unpause`, `.../suspend`, `.../resume`
- `POST .../resize` — body `{ "flavor": "<flavor id or name>", "auto_confirm": true }` (default confirms; set `false` for VERIFY_RESIZE workflow)
- `POST .../confirm-resize` · `POST .../revert-resize`
- `GET .../console-output?lines=100` — serial console log tail
- `GET .../console?type=novnc` — remote console URL (`novnc`, `spice`, `serial`, `rdp`); UI embeds via `/openstack/instances/{id}/console`
- `POST .../rebuild` — body `{ "image": "<glance id>", "name": "..." }` (optional name)
- `POST .../metadata` — body `{ "metadata": { "key": "value" } }`
- `POST .../snapshot` — body `{ "image_name": "..." }` (Nova createImage → Glance)
- `POST .../export` — body `{ "image_name", "auto_pull", "dest_path", "wait_for_active" }` — snapshot; with `auto_pull` streams Glance image to hypervisor
- `DELETE .../instances/{id}`

Volumes & networking:

- `GET /api/v1/openstack/volumes` — Cinder volumes (attach picker)
- `POST /api/v1/openstack/volumes` — body `{ "size_gb": N, "name": "...", "description": "..." }`
- `DELETE /api/v1/openstack/volumes/{id}`
- `GET /api/v1/openstack/security-groups` — Neutron security groups + rules (list)
- `GET /api/v1/openstack/security-groups/{id}`
- `GET .../instances/{id}/volumes` — attachments for one instance
- `POST .../instances/{id}/volumes/attach` — body `{ "volume_id": "..." }`
- `DELETE .../instances/{id}/volumes/{volume_id}`
- `GET|POST /api/v1/openstack/floating-ips` — list or allocate on `floating_network_id` · `DELETE .../floating-ips/{id}` — release
- `GET .../instances/{id}/floating-ips`
- `POST .../instances/{id}/floating-ips` — body `{ "floating_network": "..." }` or `{ "floating_ip_id": "..." }`
- `POST /api/v1/openstack/floating-ips/{id}/dissociate`
- `POST .../security-groups` — body `{ "name": "..." }`
- `POST .../security-groups/remove` — body `{ "name": "..." }`

Catalog APIs for the create wizard:

- `GET /api/v1/openstack/flavors`
- `GET /api/v1/openstack/networks`
- `GET /api/v1/openstack/images`
- `POST /api/v1/openstack/images/{id}/pull` — download image file to hypervisor path
- `DELETE /api/v1/openstack/images/{id}` — Glance image delete
- `GET /api/v1/vms/{name}/openstack-push/preview` — libvirt VM push preview
- `POST /api/v1/vms/{name}/openstack-push` — upload VM root disk (native or hyper2kvm)
- `GET /api/v1/openstack/keypairs`
- `POST /api/v1/openstack/instances` — create instance; boot from **one of**: `image`, `boot_volume_id`, `boot_volume_image` + `boot_volume_size_gb`, or UI flow that creates a volume from a Cinder snapshot first; optional `networks[]`, `server_group`, `availability_zone`, `security_groups`, `user_data`
- `GET /api/v1/openstack/quotas` — Nova/Cinder/Neutron limits summary (read-only)
- `GET /api/v1/openstack/clouds` · `POST /api/v1/openstack/cloud` — list/select `clouds.yaml` entry (session override)
- `GET /api/v1/openstack/subnets` · `POST /api/v1/openstack/subnets` · `GET /api/v1/openstack/routers` · `POST /api/v1/openstack/routers` · `GET|POST /api/v1/openstack/ports` · `DELETE .../ports/{id}`
- `GET /api/v1/openstack/volume-snapshots` · `DELETE /api/v1/openstack/volume-snapshots/{id}` · `POST /api/v1/openstack/volumes/from-snapshot` · `POST /api/v1/openstack/volumes/{id}/retype`
- `POST /api/v1/openstack/images/{id}/visibility` · `POST /api/v1/openstack/routers/add-interface` · `POST /api/v1/openstack/routers/remove-interface`
- `GET /api/v1/openstack/availability-zones` · `GET .../hypervisors` · `GET .../compute-services` · `GET .../neutron-agents` · `GET .../aggregates`
- `GET /api/v1/openstack/flavors/{id}` · `GET .../images/{id}` · `GET .../networks/{id}` · `GET .../volumes/{id}`
- `GET .../subnets/{id}` · `GET .../routers/{id}` · `GET .../ports/{id}`
- `DELETE .../networks/{id}` · `DELETE .../subnets/{id}` · `DELETE .../routers/{id}` · `DELETE .../server-groups/{id}` · `DELETE .../volume-transfers/{id}`
- `POST /api/v1/openstack/volumes/clone` · `POST .../volumes/from-image` · `PUT .../volumes/{id}` · `POST .../volumes/{id}/bootable`
- `GET|POST .../volume-transfers` · `POST .../volume-transfers/accept`
- `POST .../instances/{id}/rename|lock|unlock|reset-state|force-delete` · `GET|POST .../server-groups`
- `PUT .../subnets/{id}` — rename, gateway, `enable_dhcp` · `PUT .../routers/{id}` — rename, external gateway set/clear
- `POST .../volumes/{id}/upload-image` — Cinder volume → Glance image (`image_name`, optional `disk_format`, `force`)
- `PUT /api/v1/openstack/quotas` — update Nova/Cinder/Neutron project quotas (admin)
- `POST|DELETE /api/v1/openstack/flavors` · `POST /openstack/aggregates` · `PUT .../aggregates/{id}`
- `POST .../aggregates/{id}/add-host|remove-host` · `POST .../compute-services/enable|disable`
- `PUT .../neutron-agents/{id}` · `PUT .../hypervisors/{id}` — maintenance `{ "maintenance": true|false }`
- `PUT .../networks/{id}` · `PUT .../ports/{id}` · `GET|POST /api/v1/openstack/clouds` · `POST .../cloud` (session cloud switch)

Heat, Octavia, Identity, topology:

- `GET /api/v1/openstack/heat/reachable` · `GET|POST .../heat/stacks` · `GET|PATCH|DELETE .../heat/stacks/{name}/{id}`
- `GET .../heat/stacks/{name}/{id}/resources|events|template`
- `GET .../octavia/reachable` · `GET|POST .../load-balancers` · `GET|DELETE .../load-balancers/{id}`
- `GET|POST .../load-balancers/{id}/listeners` · `GET|POST .../load-balancers/pools` · members and health-monitors under pools
- `GET|POST .../identity/projects` · `GET .../identity/projects/{id}` · `GET|POST .../identity/users` · `PUT .../identity/users/{id}`
- `GET .../identity/roles` · `GET|PUT .../identity/role-assignments` · `POST .../identity/role-assignments/revoke`
- `GET .../network-topology` — `{ "graph": { "nodes", "edges" } }` for the topology SVG page

Phases **441–520** (OpenStack depth): Heat stack **resources/events/template/outputs** and **PATCH update**; Octavia **listeners/pools/members/health monitors**; Keystone **roles**, **role assignments**, **project/user create**, user enable/disable; bash E2E catalog GET for Heat/Octavia/identity/topology; TUI `heat-stacks|heat-events|heat-resources|lb-listeners|identity-roles|identity-assignments`.

Phases **291–340** (Tier 1 polish): port/transfer detail pages; instance **locked** badge; Neutron quota panel; dedicated SG/FIP/snapshot detail routes; router subnet interface UX on router detail; Neutron project id fallback for quotas; TUI migrate/backup/rebuild/shelve/rescue/interfaces/vol-upload/subnet-update; OpenAPI sweep for routes 141–340.

Phases **341–390** (Tier 1 follow-up): subnet **DHCP** toggle on subnet detail; port **admin down** on port detail and networking list; volume **upload-to-Glance** progress polling with link to image detail; instance list **client pagination** (25 per page); instance detail **shelve/unshelve** toolbar actions; Nova list uses one GET per server for **locked** (no duplicate fetch); TUI `port-update`.

Phases **391–440** (Tier 2 admin writes): **quota editing** (`PUT /openstack/quotas`); **flavor create/delete**; **host aggregate** create/rename/add-host/remove-host; **compute service** enable/disable; **Neutron agent** admin up/down; **hypervisor maintenance** mode; admin panel + quotas panel UI; TUI `flavor-create|delete`, `quota-set`, `svc-enable|disable`, `agent-admin`, `hv-maintenance`, `aggregate-*`.

Phases **41–140** (operator UX): GET detail APIs for volumes/network/subnet/router/port; Glance image detail page; clouds.yaml cloud picker in nav; Neutron network/port rename; volume transfer cancel; extended TUI.

Phases **141–240**: GET floating IP / volume snapshot / volume transfer / hypervisor; dedicated **Floating IPs** page; **volume detail** route; router rename; port admin-up; hypervisor detail in admin panel; TUI `:openstack fip|snapshot|hypervisor`.
- `GET .../floating-ips/{id}` · `GET .../volume-snapshots/{id}` · `GET .../volume-transfers/{id}` · `GET .../hypervisors/{id}`
- `PUT .../routers/{id}` (rename)

Phases **241–290**: Neutron **network/subnet/router detail** pages; **flavor** and **server group detail** routes; dedicated **volume snapshots** page; `GET .../server-groups/{id}`; TUI `:openstack network|subnet|router|port|server-group`.
- `POST /api/v1/openstack/keypairs` · `DELETE /api/v1/openstack/keypairs/{name}`
- `POST /api/v1/openstack/security-groups` · `POST .../security-groups/{id}/rules` · `DELETE /api/v1/openstack/security-group-rules/{id}`
- `POST /api/v1/openstack/volumes/{id}/extend` · `POST .../volumes/{id}/snapshot`
- `POST .../instances/{id}/shelve|unshelve|migrate|rescue|unrescue|backup`
- `GET|POST .../instances/{id}/interfaces` · `DELETE .../interfaces/{port}`
- `GET .../instances/{id}/console/tunnel` — proxied console path for same-origin embed (`?tunnel=1` in UI)
- `POST /api/v1/openstack/images/{id}/metadata` · `GET|POST .../images/{id}/members`

Audit events: `openstack.instance.*`, `openstack.image.upload`, `openstack.image.delete`.

## Disk migration (libvirt ↔ cloud)

See [openstack-migration.md](openstack-migration.md) for full API tables.

| Direction | API / UI |
|-----------|----------|
| qcow2 → Glance | `POST /api/v1/openstack/images/upload` — **Disk images** modal |
| libvirt VM → Glance (+ optional Nova) | `POST /api/v1/vms/{name}/openstack-push` — **VM detail → Push to OpenStack** |
| Glance → qcow2 on host | `POST /api/v1/openstack/images/{id}/pull` — **Glance images** pull modal |
| qcow2 → libvirt domain | `/import?disk=…` or **Create VM** with existing disk |

Optional `use_hyper2kvm` on VM push delegates to hyper2kvm for guest-fix and deploy parity with hyper2kvm CLI.

**HyperSDK proxy** (optional `[hypersdk]` in config): `GET /api/v1/hypersdk/status`, `.../providers/list`, `.../providers/vms`, `POST .../migrations/submit`, `GET .../migrations/jobs`, `GET .../migrations/jobs/{id}`, `GET|POST .../hypersdk/proxy?path=/api/...` — forwards to hypervisord for bulk pipelines. UI: **OpenStack → OS Migrations** (providers, VM picker, job detail).

## What stays in Horizon / `osc` (advanced / not in Machina)

- Heat nested-stack drill-down and environment-file CRUD
- Octavia L7 policies/rules and amphora diagnostics
- Keystone domain/group/SAML federation admin
- Full HyperSDK dashboard (Machina proxies list/submit/jobs/detail; advanced flows use hypervisord UI)

Identity **writes** (create project/user, role grant/revoke) require admin-scoped `[openstack]` credentials on the daemon host.

TUI commands (`:` prefix): `openstack` / `os` (status), `openstack list`, `openstack start|stop|delete <id>`, `openstack quotas|snapshots`, `openstack attach|detach <inst> <vol>`, `openstack fips`, `openstack fip-allocate <net>`, `openstack fip-release <id>`, `openstack port-delete <id>`, `openstack migrate|migrate-live|backup|rebuild`, `openstack shelve|unshelve|rescue|unrescue`, `openstack interfaces|interface-attach|interface-detach`, `openstack vol-upload-image <vol> <name>`, `openstack subnet-update <id> <field> <value>`, `openstack port-update <id> <field> <value>`, `openstack flavor-create <name> <vcpus> <ram_mb> <disk_gb>`, `openstack flavor-delete <id>`, `openstack quota-set <compute|cinder|neutron> <key> <limit>`, `openstack svc-enable|svc-disable <binary> <host>`, `openstack agent-admin <id> <up|down>`, `openstack hv-maintenance <id> <on|off>`, `openstack aggregate-create <name> [az]`, `openstack aggregate-add-host|aggregate-remove-host <id> <host>`, `openstack heat-stacks`, `openstack heat-events|heat-resources <name> <id>`, `openstack lb-listeners <lb_id>`, `openstack identity-roles`, `openstack identity-assignments <project_id>`, `openstack network|subnet|router|port|fip|volume|image|server-group <id>`, `openstack confirm-resize|revert-resize`, `openstack lock|unlock|force-delete`, `openstack clouds|cloud <name>`.

## Packaging

- Rust `openstack` crate (Nova/Glance/Neutron) in `machina-core`; no extra system packages beyond HTTPS.
- Optional: `python3-openstackclient` on the host for debugging; Glance upload uses machina-core when `[openstack] upload_enabled = true`.

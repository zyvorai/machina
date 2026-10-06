# Claims ledger

Every public statement about Machina (README, site, decks, buyer pack) must trace to a row here. Status:

- **verified**: run on a real host (the lab host, throwaway guests only) and recorded below.
- **unit-tested**: covered by tests that run in CI (see `docs/guides/features.json`), not yet run on a real host.
- **planned**: not built; never present it as available.

Before you quote a claim, check its row. When a live run changes a status, update this file in the same change.

| Id | Claim | Status | Evidence |
|---|---|---|---|
| C01 | Security groups are enforced in the datapath per instance, with replies to allowed connections passing | verified | Live: allowed port reachable, denied port blocked, group-less guest untouched; `docs/guides/security-groups.md` |
| C02 | Enforcement status reports what the hosts say, and drops to `auditing` after a `machina-bpfd` restart, then recovers by itself | verified | Live: bpfd restart re-asserted by the controller within one tick |
| C03 | Several instances in one call, with a minimum count | verified | Live run-instances (`name-1`, `name-2`) |
| C04 | Instance type can be changed after launch | verified | Live change-type to a smaller flavor queued and applied |
| C05 | User data runs at first boot (cloud-init NoCloud) | verified | Live cirros guest ran the script and served the port |
| C06 | Volumes attach with live I/O limits and delete with the instance | verified | Live attach, `iotune`, delete-on-termination |
| C07 | A reserved network-interface address is handed to the guest by DHCP | verified | Live: second NIC received exactly the pinned address |
| C08 | Alarms scale an instance group | verified | Live alarm-driven scaling of a group (alarm samples fix pending in `fix-metric-subjects`) |
| C09 | Groups and launch templates can be deleted | verified | Live |
| C10 | Private images can only be launched by their project or its shares | verified | Live: 403 `image_not_shared` |
| C11 | awscli/boto3 work against `POST /ec2` (SigV4) | verified | Live boto3 RunInstances, DescribeInstances by tag, TerminateInstances |
| C12 | Terminated instances stay visible for an hour | verified | Live |
| C13 | Elastic IPs map a public address 1:1 to an instance | verified | Live: allocate, associate (host confirms), DNAT reaches the right guest only, one per instance, release, and alias and rules removed after the pool is deleted (needed the alias-parse fix, #70) |
| C14 | NAT gateway for private subnets | verified | Live: without NAT the guest cannot reach the uplink gateway; with it pings succeed and the masquerade counter moves; disabling removes the rule |
| C15 | Instance metadata service at 169.254.169.254 | verified | Live: instance-id, hostname, local-ipv4, user-data, public key and the dated cirros path answer; an unknown address gets 404 |
| C16 | Project-scoped API keys | verified | Live: scoped key lists only its projects, is refused on global APIs (403 `key_scope_forbidden`) and cannot create machines through the plain API |
| C17 | Load balancer health checks take failing members out of rotation | verified | Live: a member whose listener was gone turned `unhealthy` and left the rule set while the other stayed (needed the save fix, #66). Recovery back to healthy is unit-tested, not yet confirmed live |
| C18 | Subnet and VPC delete with libvirt teardown | verified | Live: refused while in use, succeeds once empty, libvirt network gone, empty VPC deletes |
| C19 | Pilot-ready for a guided single-site Linux KVM deployment | verified | `docs/CUSTOMER_SITE_READINESS.md` (full lab test-all, UI sweep 130/130) |
| C20 | Four Rust services, embedded SQLite, no SQL cluster or message queue required | verified | Architecture in `CLAUDE.md`/README; NATS is optional |
| C23 | Disks from other hypervisors import and boot (VMDK, VDI, raw) | verified | Live: made from a cirros image, imported through `/api/v1/import/disk`, VMs created from them booted, got DHCP and answered ping; negative cases refused. VHD/`.img` fixed in #72, pending a live re-check |
| C24 | The controller builds for PostgreSQL and its whole unit-test suite passes on PostgreSQL 16 | unit-tested | Lab host: `cargo test -p machina-controller --no-default-features --features postgres` (255 unit + 8 integration tests, the integration run includes a GET against every route; CI job `controller-postgres`); not yet run as a live controller |
| C25 | Installer choice of database, managed Postgres pod, data move from SQLite | planned | Not built; see `docs/guides/database.md` |
| C21 | Multi-host HA failover under real host loss | planned | Needs a customer host-loss drill (`CUSTOMER_SITE_READINESS.md`) |
| C22 | Cross-host VPC, IGW/route-table datapath, real Rivora load balancer | planned | Not built; see `docs/cloud-ec2-semantics.md` |

Never claim: benchmark numbers we have not measured, named customers, or pricing outside `SUBSCRIPTION-MODEL.md`.

# Fleet Cloud: EC2 semantics

What behaves like EC2 today, what is enforced, and what is not. Everything here is available through the controller
API (`/api/v1/...`) and the Fleet Cloud pages.

## Tags and ids
- `GET|PUT|DELETE /api/v1/tags/{resource_type}/{id}` stores key/value tags (≤ 50 per resource, keys ≤ 128, values ≤ 256).
  `GET /api/v1/tags?key=&value=` lists resources by tag. `GET /api/v1/vms?tag_key=&tag_value=` filters instances.
- Every taggable resource has an EC2-style id (`i-`, `vol-`, `snap-`, `sg-`, `key-`, `ami-`, `eni-`, `vpc-`, `subnet-`,
  `asg-`, `lt-` + 17 hex characters), derived from its UUID, so it never changes. `GET /api/v1/ids/{ec2_id}` resolves one;
  routes that take an instance id also accept the EC2 id.

## Instance types
`POST /api/v1/vms/{id}/change-type {flavor_id}` shuts the instance down cleanly, sets vCPUs and memory to the flavor's,
starts it again if it was running, and records `vms.flavor_id`. It is a task with events. The disk size is not changed.
Refused: a flavor with no usable size, a type the instance already has, an instance managed by an instance group (change
the launch template instead), and a change that would exceed the project's vCPU/memory quota.

## User data
`cloud_init_user_data` (≤ 16 KB) on instance create and launch templates is written verbatim as the NoCloud `user-data`
in the seed ISO (merged with the user/ssh key vendor data) and is never logged. There is no 169.254.169.254 metadata
service yet; the seed ISO is the delivery path.

## Security groups
Groups are **advisory** (`mode: audit`, the default for every existing group) until you switch them:
`PUT /api/v1/security-groups/{id}/mode {"mode":"enforce"}`.

- Attach to instances with `PUT|DELETE /api/v1/vms/{id}/security-groups/{sg_id}`; list with `GET .../security-groups`.
- Rules: ingress/egress, protocol tcp/udp/icmp/icmpv6/all, port or range, peer = CIDR **or** another group
  (`remote_sg_id`: every instance carrying that group). New groups get an allow-all egress rule, as in EC2.
- An enforcing instance gets one managed policy `sg-<instance name>` on the VM edge. Rules of all its groups are unioned
  (allow-only). Both directions are default-deny, so an enforcing group with no ingress rules accepts nothing, and one
  with no egress rule sends nothing. Replies to allowed connections pass (connection tracking).
- `enforcement.state` is what the hosts say, not what was requested: `advisory` (audit mode), `pending` (no instance
  attached), `enforced`, `auditing` (the host's VM edge is not enforcing), `failed` (a host did not answer).
- Enforcement is lease-gated and fails open: the controller re-asserts enforce mode and a fresh lease every 30 s
  (`MACHINA_BPF_ENFORCE_LEASE_SECS`); if the controller or `machina-bpfd` stops, the host drops back to observe and the
  state shows `auditing` until the next tick. Enforce mode is per host, so any other VM network policy on a host with an
  enforcing group is enforced too.
- Refused: enforcing while an attached instance has no known address (traffic could not be told from spoofed traffic).
- Not covered yet: groups per network interface (they attach per instance), a lockout check against the controller and
  console paths (allow the paths you need explicitly), a dry-run diff before the first enforce.

## Volumes: delete on termination and I/O limits
- `delete_on_termination` (create body, attach body, or `PUT /api/v1/volumes/{id}/delete-on-termination {"value":true}`):
  when the instance is deleted, flagged volumes attached to it are deleted too. If a backend delete fails the volume is
  kept (detached) and the failure is logged; the instance delete still succeeds.
- `PUT /api/v1/volumes/{id}/iotune {read_iops, write_iops, read_bps, write_bps}`: `0` removes a limit, an omitted field is
  unchanged. On an attached volume the limits are applied to the disk through the agent (`virsh blkdeviotune`, live and
  persistent); the values are stored either way. They are not re-applied on a later attach yet.

## Key pairs by name
Instance create (from template, ISO or image) accepts `key_name`: the saved key pair's public key is injected through
cloud-init, like EC2's `KeyName`. Giving both `key_name` and `cloud_init_ssh_pubkey` is rejected, and an unknown name fails
with `keypair_not_found`. Machina still stores public keys only: there is no create-and-return-the-private-key call, so
generate keys with `ssh-keygen` and register the public half.

## Run several instances (RunInstances)
`POST /api/v1/vms/run-instances` takes the same body as `from-template` plus `count` (1–20) and optional `min_count`
(default `count`). With `count > 1` the machines are named `name-1 … name-N`. They are created one after another; if
fewer than `min_count` could be created the call returns 409 `run_instances_min_count` and lists the ones already
created, which are left in place (no rollback). Quota and placement are checked per instance, so a project quota that
fits only some of them yields a partial result when `min_count` allows it.

## Ids and tag filters beyond instances
Volumes, security groups and key pairs now return `ec2_id` (`vol-…`, `sg-…`, `key-…`). `GET /api/v1/volumes?tag_key=&tag_value=`
filters volumes by tag like the instance list does.

## Image visibility and sharing (AMI-style)
Images (templates) are `public` by default, as before. `PUT /api/v1/templates/{name}/{version}/visibility {"visibility":"private"}`
makes one visible only to its owning project and the projects it is shared with
(`PUT|DELETE .../shares/{project}`, `GET .../shares`). `GET /api/v1/templates?project=<name>` returns what that project
may see; without `project` you get everything (the operator view). Images return `ec2_id` (`ami-…`).

**Limit:** this controls listing only. Creating an instance from a private image by its name is not blocked yet, so
treat it as hiding, not as access control.

## Volume from snapshot
`POST /api/v1/volume-snapshots/{id}/create-volume {"name"}` creates a new volume (same size, class and project as the
source) cloned from the snapshot through Atlas. Snapshots exist only for Atlas-backed volumes, so this needs
`ATLAS_ENABLED=1`; local-pool volumes have no snapshots yet.

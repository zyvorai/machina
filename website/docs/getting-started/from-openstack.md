---
sidebar_position: 4
title: Replacing OpenStack
description: Which Machina component takes the place of each OpenStack service, how to move, and what Machina does not cover.
---

# Replacing OpenStack

![Replace OpenStack, service by service](/readme-replace-openstack.jpg)

Machina covers the private-cloud primitives most OpenStack deployments use, with four Rust services instead of nine or more plus
Galera, RabbitMQ and Memcached. It is **not a drop-in**: there is no Nova or Neutron API, so tools move to Machina's REST API or its
[EC2-compatible API](../core-concepts/ec2-api.md), and guests move as disk images.

![Nine OpenStack services collapse into four](/anim/openstack-vs-machina.svg)

| OpenStack | Machina |
|---|---|
| Keystone | PAM, OIDC, SAML, LDAP, RBAC, project-scoped API keys |
| Nova, Placement | `machina-daemon` and `machina-agent` on libvirt/KVM; the controller schedules, with live migration, HA and DRS |
| Neutron | Native eBPF VM edge and network policy, VPC objects, NAT, Elastic IPs, WireGuard overlay between hosts |
| Glance | Images and templates, Golden Forge builds |
| Cinder | Volumes with I/O limits and snapshots; Atlas for Ceph, NFS or ZFS |
| Heat | Stacks with dry run, approval and drift repair |
| Octavia | Native layer-4 balancer on the host, no amphora VM |
| Horizon | The web UI, with browser consoles |
| Masakari, Watcher | HA failover and DRS in the controller |
| Ceilometer, Aodh | Metrics history, alarms with scaling actions, Prometheus and OTLP |
| MariaDB, RabbitMQ | [SQLite or PostgreSQL](database.md); in-memory task bus, NATS optional |

## Moving a workload

1. Check the gaps below against what you depend on.
2. Stand up Machina next to OpenStack on spare hosts ([Quickstart](quickstart.md)).
3. Re-create projects, instance types, security groups and networks through the web UI, the REST API, or Terraform's `aws` provider.
4. Move each guest as a disk image: export it from OpenStack in qcow2 or raw, bring it in as a Machina image or volume, and launch from it. There is **no OpenStack importer**, and this path has not been run end to end on a real OpenStack cloud.
5. Cut traffic over, then drain the old hosts and add them to Machina.

## Gaps

- Thousands of tenants and Neutron-grade SDN breadth (provider networks, VXLAN/OVN, BGP) are out of scope.
- The OpenStack client tools and Terraform's `openstack` provider do not work against Machina, and ecosystem projects (Trove, Manila and so on) have no counterpart.
- What has run on a real host and what is unit-tested only: [claims ledger](https://github.com/zyvorai/zyvor-machina/blob/main/docs/claims.md).

The full map, including a concept table (project, flavor, floating IP and so on): [from-openstack.md](https://github.com/zyvorai/zyvor-machina/blob/main/docs/migration/from-openstack.md).

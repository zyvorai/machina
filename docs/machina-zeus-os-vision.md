# Machina Zeus OS — AI-Native Infrastructure Operating System

**Machina** manages physical infrastructure (hosts, VMs, storage, BMC). **Zeus OS** runs the cloud layer (K8s, KubeVirt, apps). **Zeus AI** is the intelligent operating layer across both — assistant, SRE forecast, Mission Control, Jarvis briefing.

**Scope:** Machina Intelligence vs Zeus OS boundaries are documented in [`machina-infrastructure-vision.md`](machina-infrastructure-vision.md). Zeus Firewall, K8s workloads, and app fabric are Zeus-owned; host geography, Living Server cards, and fleet patching are Machina-owned.

**Status (main):** Layers 1–9 shipping in batches **AI-88–AI-137**. See [`platform-roadmap.md`](platform-roadmap.md).

---

## Layer highlights (shipped)

| Layer | Capabilities |
|-------|----------------|
| Copilot / Intent | NL environments (plan + execute), mission stack, Spotlight |
| Autonomous ops | SRE forecast + remediations, root cause, memory recall |
| Digital Twin | Shutdown, migrate, network isolate, storage drain simulation |
| Fleet | Heat map, rebalance, GPU placement, power optimizer |
| Security | Graph, attack paths, compliance frameworks + remediations |
| FinOps | Prediction, attribution, chargeback CSV, budget guard |
| Knowledge | Search, NL diagnose, runbook generation |
| Bare metal | Inventory, BMC power, PXE provision preview |
| Guest / migration | GuestKit offline doctor, migrate-plan, worker jobs (LGPL) |
| Service fabric | Service graph, blast-radius impact |

---

## API surface (GuestKit / migration)

- `GET /api/v1/guestkit/status` — library version + worker reachability
- `POST /api/v1/guestkit/doctor` — offline boot probability (`image_path`, `target`)
- `POST /api/v1/guestkit/migrate-plan` — hypervisor-aware migration score
- `GET /api/v1/guestkit/vms/{id}/doctor` — resolve VM disk and run doctor
- `POST /api/v1/guestkit/jobs` — submit inspect job to GuestKit worker
- `GET /api/v1/migrations/advisor?disk_path=…` — blends heuristic + GuestKit scores

## Zeus Firewall (machine protection)

Zeus Firewall unifies host firewalls (firewalld, UFW, nftables, iptables) and **PacketWolf eBPF security fabric** into one macOS-like control center under **Machine Security**.

See [`packetwolf-zeus-fabric.md`](packetwolf-zeus-fabric.md) for the full Security Center architecture (Tetragon ingest, ClickHouse, process graph, AI copilot).

- `GET /api/v1/zeus-firewall/status` — feature readiness (AI-142)
- `GET /api/v1/zeus-firewall/overview` — fleet posture cards
- `GET /api/v1/zeus-firewall/targets/{id}/ports` — open port exposure scanner
- `GET /api/v1/zeus-firewall/k8s/status` — K8s NP/Cilium readiness (AI-172)
- `POST /api/v1/zeus-firewall/k8s/apply` — apply Zeus profile as NetworkPolicy
- `GET /api/v1/zeus-firewall/cloud/overview` — AWS/Azure/GCP security groups (AI-212)
- `GET /api/v1/zeus-firewall/vms/{id}/guest-ports` — in-guest QEMU-agent ports (AI-232)
- `POST /api/v1/zeus-firewall/connectivity` — connectivity matrix simulation (AI-252)
- `GET /api/v1/zeus-firewall/compliance/{kind}/export.pdf` — PDF compliance export (AI-272)
- `GET /api/v1/zeus-firewall/baremetal/overview` — bare-metal firewall fleet slice (AI-317)
- `POST /api/v1/zeus-firewall/baremetal/{id}/scan` — BMC/PXE exposure scan (AI-315)
- `POST /api/v1/zeus-firewall/baremetal/{id}/temporary` — PXE/BMC temporary allow (AI-319/323)
- `POST /api/v1/ai/firewall/secure-plan` — AI safe-machine plan
- `POST /api/v1/zeus-firewall/targets/{id}/lockdown` — Emergency Isolation

UI: `/platform/zeus/security/firewall` and related Machine Security views.

**macOS-like UX (AI-372–391, UX-49–56):** System Settings firewall pane per host (`MacToggle`, stealth segmented control, profile preview sheet), fleet Launchpad overview, VM Security tab (guest ports), Settings hub Network/Firewall pane, Control Center 3.0 module grid. See [`zeus-os-ai-372-391.md`](zeus-os-ai-372-391.md).

**Bare metal firewall (AI-312–331):** `bare_metal` targets in Zeus overview, metal profiles, exposure scan, policy-only apply. See [`zeus-os-ai-312-331.md`](zeus-os-ai-312-331.md).

Daemon: `GET /api/v1/guestkit/status` proxies worker health when `[guestkit]` enabled in `config.toml`.

## API surface (phase 14)

- `GET /api/v1/ai/remediate/hub` — unified SRE, compliance, and fleet power remediation queue
- `POST /api/v1/ai/knowledge/runbook` — NL diagnose + operator runbook steps
- `GET /api/v1/ai/cost/budget` — monthly budget vs spend alerts
- `GET /api/v1/ai/mission/stack/status` — track GPU and environment stack VMs
- `POST /api/v1/ai/twin/impact` — storage pool drain blast-radius (target_kind `storage`)

## API surface (phase 13)

- `POST /api/v1/ai/intent/environment/execute` — preview or enqueue environment VMs
- `GET /api/v1/ai/sre/remediate` — proactive fixes from SRE forecasts
- `GET /api/v1/ai/compliance/remediate` — framework control remediations
- `GET /api/v1/ai/zeus/summary` — unified OS health strip
- `GET /api/v1/ai/fleet/power/optimize` — power waste / consolidation savings
- `GET /api/v1/baremetal/servers/{id}/provision` — PXE provision workflow preview

Phase 9–12 APIs documented in prior roadmap batches.

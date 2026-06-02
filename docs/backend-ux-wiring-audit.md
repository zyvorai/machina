# Backend ↔ UX wiring audit

Last updated: 2026-05-30

This document is an honest inventory of how much controller/daemon surface area is reachable from the **Platform desktop** (`/platform/*`) versus legacy or separate UIs.

## Summary

| Layer | Approx. count | Wired to UX |
|-------|---------------|-------------|
| Controller HTTP routes | ~292 | API Console tab + ~174 import-graph page hits |
| Daemon HTTP routes | ~423 | Host API Console tab + Classic pages |
| WebSocket routes | ~10 | Documented in OpenAPI (`x-machina-transport: websocket`) |
| TypeScript API clients | ~400+ exports | Import-graph tracked in coverage JSON |

**Your intuition is directionally correct:** most backend code exists for power users, agents, and future surfaces. The Platform desktop intentionally shows a **small Normal tier**; Advanced exposes more but still does not mirror every route.

## What is wired today

### Platform desktop (Normal tier — default for new users)

- Dashboard, VMs, Hosts, Storage, Backups, Settings, Support, Notifications
- **Apps & Integrations** hub → OpenStack, K8s, HyperSDK, GuestKit, classic UI (when daemon flags enable them)
- Dock-first layout; sidebar collapsed/hidden

### Platform desktop (Power / Advanced)

- Everything in Normal plus networks, Zeus, tasks, migration, firewall modules, policy, observability, fleet settings strips, etc.
- See [machina-infrastructure-vision.md](./machina-infrastructure-vision.md) API ↔ UI map

### Separate shells (not missing — different entry point)

| UI | Path | Backend |
|----|------|---------|
| OpenStack operator | `/openstack/*` | OpenStack API proxy + Heat, Neutron, Nova pages |
| Kubernetes / KubeVirt | `/k8s/*` | KubeVirt exec API |
| Classic Machina | `/`, `/vms`, `/storage`, … | Daemon REST (original UI) |

OpenStack was never deleted; it was **not linked from Platform** until the Integrations hub. Enable `openstack.enabled` in daemon config to see it on `/platform/integrations`.

## Major gaps (next wiring phases)

### P6 — Integrations bridge (shipped)

- [x] `/platform/integrations` hub
- [x] Sidebar / Go menu / Control Center links when capabilities enabled
- [x] Live OpenStack + K8s preview panels on Integrations (inventory stats + recent instances)
- [x] Single sign-on context banner when leaving Platform shell — Integrations “Leaving the desktop” panel

### P7 — Classic → Platform parity

Routes heavily used in classic UI but thin in Platform:

- [x] Node/host deep tools (`/node/*`, libvirt filters, NW filters) — Integrations hub + host detail classic tools
- [x] Import wizard (`/import`) — Integrations + Migration radar source cards
- [x] Marketplace / plugins — Templates plugins tab + Integrations link
- [x] Full backup timeline vs Platform backups page — `listBackupTimeline()` on Platform Backups + classic link

### P8 — Controller domains with clients but no page

Run `rg "platformFetch" web/src/api` vs `rg "from '../../api" web/src/pages/platform` to find orphans. Known clusters:

- [x] Developer / Terraform schema (`/api/v1/developer/*`) — `/platform/developer`
- [x] HA status aggregate — `/platform/placement`
- [x] Fence events detail beyond Activity — Placement + Activity/Compliance cross-links
- [x] Full ops runbook execute flows (partial on Reports) — `/platform/reports?tab=runbooks`
- [x] Packetwolf / SIEM deep dives — Compliance page (Packetwolf + SIEM export)

### P9 — OpenStack ↔ Platform cross-links

- [x] Platform host/VM rows → OpenStack instance when linked — VM detail OpenStack link (name/metadata match)
- [x] Platform networks → Neutron network detail — network cards link to `/openstack/networks/:id`
- [x] Migration radar → OpenStack migrations tab — migration hub cards + source routing

### P10 — Full API ↔ UX parity (shipped)

- [x] Platform core wiring, Zeus Firewall, migration depth, Classic parity (see git history `b915846`)
- [x] Initial API Console on `/platform/developer`

### P11 — Console-first full backend catalog (shipped)

- [x] `scripts/generate-openapi.mjs` — controller + daemon + WebSocket routes → `docs/openapi-*.json`
- [x] Runtime OpenAPI: controller `GET /api/v1/openapi.json`, daemon `GET /api/v1/openapi.json` (public)
- [x] **Unified API Console** — Controller | Host tabs on `/platform/developer` (Advanced tier)
- [x] Classic `/api-docs` loads runtime daemon spec; Integrations cross-links
- [x] Honest coverage gate: `npm run api-ux-coverage:check` — controller + daemon + ws (725 routes, import-graph + OpenAPI console classification)

```bash
node scripts/generate-openapi.mjs          # regenerate specs
cd web && npm run generate-openapi:check   # CI drift gate
cd web && npm run api-ux-coverage:check    # 0 unmapped
```

**Policy:** daily operator flows stay on Platform/Classic pages; every other HTTP route is reachable via API Console or `/api-docs`. Agent install, Prometheus scrape, and WebSocket routes are **documented** (copy-ready commands), not browser try-it.

### P12 — Live UX → API proof (shipped)

Static coverage (P11) proves wiring *intent*; live verification proves *runtime* behavior.

- [x] [`docs/ux-wiring-live-manifest.json`](ux-wiring-live-manifest.json) — full nav matrix + safe tab/button actions
- [x] [`scripts/generate-ux-live-manifest.mjs`](../scripts/generate-ux-live-manifest.mjs) — regenerate manifest from `platformNav.ts`
- [x] Playwright [`web/e2e/live-ux-wiring.spec.ts`](../web/e2e/live-ux-wiring.spec.ts) — authenticated remote run, API response watch (fail on 5xx / HTML-on-API)
- [x] [`scripts/e2e-live-ux-remote.sh`](../scripts/e2e-live-ux-remote.sh) + deploy-remote `--e2e` Phase B (`--skip-live-ux` to opt out)
- [x] Report artifact: [`docs/ux-wiring-live-report.json`](ux-wiring-live-report.json)

```bash
VSPASS='…' ./scripts/e2e-live-ux-remote.sh sus 212.8.252.194
# or after deploy:
VSPASS='…' ./scripts/deploy-remote.sh sus 212.8.252.194 --quick --e2e
```

### P13 — Integrations preview + JSON humanization (shipped)

- [x] [`useIntegrationPreviewStats`](../web/src/hooks/useIntegrationPreviewStats.ts) — live OpenStack instance/network/image counts + K8s cluster overview on `/platform/integrations`
- [x] [`PlatformIntegrationEmbeds`](../web/src/components/platform/PlatformIntegrationEmbeds.tsx) — refreshable preview panels with recent Nova instances
- [x] JsonInspector on firewall policy simulation + air-gap bundle manifests in Settings → Security

### P14 — Overall UX polish (all shells, shipped)

**Wave 1 — Loading & empty states**

- [x] Platform high-traffic pages: [`PageSkeleton`](../web/src/components/PageSkeleton.tsx) + [`PlatformEmptyState`](../web/src/components/platform/PlatformEmptyState.tsx) on Networks, ZeusOs, HostDetail, Templates, Maintenance, Topology, Reports
- [x] Classic: Storage, NodeInfo, Fleet, Backups — initial skeleton; Storage empty pools [`EmptyState`](../web/src/components/EmptyState.tsx)
- [x] OpenStack: Networking, Volumes, Instance/LB detail — skeleton on fetch/tab switch
- [x] K8s: Overview node empty state; Workloads tab skeleton

**Wave 2 — JSON humanization**

- [x] [`K8sWorkloads`](../web/src/pages/K8sWorkloads.tsx) — Helm/RBAC/apply/explorer panels via JsonInspector (logs stay text)
- [x] [`PlatformFirewallTargetDetail`](../web/src/pages/platform/security/PlatformFirewallTargetDetail.tsx) — structured cards + JsonInspector toggle
- [x] [`PlatformVmDetail`](../web/src/pages/platform/PlatformVmDetail.tsx) — spec tab human-first
- [x] [`K8sOverview`](../web/src/pages/K8sOverview.tsx) — inventory history table + JsonInspector
- [x] [`PlatformFirewallK8s`](../web/src/pages/platform/security/PlatformFirewallK8s.tsx) — manifest copy + empty collapse
- [x] [`PlatformDeveloper`](../web/src/pages/platform/PlatformDeveloper.tsx) — SDK snippet CopyButton
- [x] VMDetails block jobs / Jobs log panels already structured (timeline + text log, not JSON-first)

**Wave 3 — Actionable errors & QA**

- [x] [`hostErrorPresentation`](../web/src/utils/hostErrorPresentation.ts) + enroll/node links on [`PlatformHostDetail`](../web/src/pages/platform/PlatformHostDetail.tsx)
- [x] [`storageErrorPresentation`](../web/src/utils/storageErrorPresentation.ts) + host/node links on [`PlatformStorage`](../web/src/pages/platform/PlatformStorage.tsx)
- [x] [`PlatformZeusOs`](../web/src/pages/platform/PlatformZeusOs.tsx) — `formatUserError` on all catches
- [x] Classic [`Storage`](../web/src/pages/Storage.tsx) / [`NodeInfo`](../web/src/pages/NodeInfo.tsx) — libvirt hints
- [x] [`PlatformMigration`](../web/src/pages/platform/PlatformMigration.tsx) — [`OpenStackUnreachablePanel`](../web/src/components/OpenStackUnreachablePanel.tsx) when OpenStack enabled but not live
- [x] Playwright [`shell-bridge.spec.ts`](../web/e2e/shell-bridge.spec.ts) — Platform ↔ K8s bridge + classic Storage empty state

```bash
cd web && npm test
cd web && npm run build && npm run test:e2e -- e2e/platform-full.spec.ts e2e/shell-bridge.spec.ts
```

### P15 — Auth shell routing (shipped)

- [x] [`App.tsx`](../web/src/App.tsx) — `AiProvider` inside `BrowserRouter` (fixes post-login white screen from `useLocation` outside router)
- [x] [`AuthContext.tsx`](../web/src/contexts/AuthContext.tsx) + authenticated `/login` → `/` [`Navigate`](../web/src/App.tsx) (fixes 404 when signing in at `/login`)
- [x] Machina macOS login — [`Login.tsx`](../web/src/pages/Login.tsx), [`zyvor-macos-login.css`](../web/src/styles/zyvor-macos-login.css), optional [`variant="secure"`](../web/src/styles/zyvor-secure-login.css)
- [x] Playwright [`smoke.spec.ts`](../web/e2e/smoke.spec.ts) — `authenticated /login redirects to dashboard`

## How to measure progress

```bash
# Controller routes
rg -c '\.route\(' controller/src/api/mod.rs

# API exports never imported (rough)
comm -23 \
  <(rg -o "export (const|function|type) \w+" web/src/api --no-filename | sort -u) \
  <(rg -o "from ['\"].*api" web/src -N | sort -u)
```

Target for “good enough”: **every controller domain** has at least one of: Platform page, Integrations card, Classic page, or documented “API-only / agent”.

## Tier policy (user-facing)

1. **Normal** — simple desktop, dock, Integrations hub (default for first visit)
2. **Power** — operations sidebar subset
3. **Advanced** — full sidebar + firewall + developer routes

Users upgrade in **Settings → Appearance → Desktop density**.

## Related docs

- [next-big-sweep.md](./next-big-sweep.md) — planned cross-shell consistency sweep (batch 57)
- [machina-infrastructure-vision.md](./machina-infrastructure-vision.md) — Mission Control, geography, parity phases 0–5
- [machina-macos-os-manager-roadmap.md](./machina-macos-os-manager-roadmap.md) — shell UX roadmap

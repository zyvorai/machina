# Machina macOS OS Manager — phased roadmap (Phases 38–237)

> **Product frame:** Machina is the **macOS for your private cloud**. Hypervisors are Macs, VMs are apps, the fleet is the desktop, and Zeus AI is Intelligence.

Phases **1–37** shipped the shell (Control Center, Mission Control, System Settings on hosts, Activity Monitor, fleet desktop). Phases **38–237** complete the metaphor across every macOS surface — **10 phases per macOS layer × 20 layers = 200 horizon phases** (AI batches **582–2581**, 10 IDs per phase).

Each phase ships: **backend aggregator or agent lift → Mac UI pane → Spotlight intent → E2E + `platformctl` + doc stub**.

---

## Layer map (20 × 10 phases)

| Layer | macOS metaphor | Machina fleet equivalent | Phases | AI range |
|-------|----------------|-------------------------|--------|----------|
| 1 | Menu bar & desktop shell | Status strip, dock, desktop widgets | 35–44 | 552–641 |
| 2 | System Settings | Host + fleet settings hub | 45–54 | 642–731 |
| 3 | Finder | VM/host browse, tags, smart folders | 55–64 | 732–821 |
| 4 | Activity Monitor | CPU/mem/PSI/noisy neighbor | 37, 65–74 | 572–581, 822–911 |
| 5 | **Time Machine** | Backup + snapshot timeline, restore | **38**, 75–84 | **582–591**, 912–1001 |
| 6 | Network | Segments, Lens, host systemd | 33, 85–94 | 532–541, 1002–1091 |
| 7 | Security & Privacy | Zeus Firewall, audit, stealth | 28–32, 95–104 | 432–531, 1092–1181 |
| 8 | Console.app | Audit + task + agent logs | 105–114 | 1182–1271 |
| 9 | App Store / Software Update | Templates marketplace, host patches | 115–124 | 1272–1361 |
| 10 | Users & Groups | RBAC, tenants, workspaces | 125–134 | 1362–1451 |
| 11 | Spotlight | ⌘Space NL commands | 34, 135–144 | 542–551, 1452–1541 |
| 12 | Siri / Intelligence | Copilot, Doctor, Autopilot | 136–154 | 1542–1631 |
| 13 | Mission Control & Spaces | Fleet overview, workspace switcher | 35, 155–164 | 552–561, 1632–1721 |
| 14 | Dock & Launchpad | Quick apps, template launch grid | 165–174 | 1722–1811 |
| 15 | Shortcuts & Automator | Blueprints, runbooks, GitOps | 175–184 | 1812–1901 |
| 16 | Keychain Access | Vault/secrets inventory UI | 185–194 | 1902–1991 |
| 17 | Disk Utility | Pools, tiers, SMART, trim | 195–204 | 1992–2081 |
| 18 | Terminal | VM console, host SSH, AI suggest | 205–214 | 2082–2171 |
| 19 | Migration Assistant | VMware/HyperSDK, live migrate UX | 215–224 | 2172–2261 |
| 20 | Time Machine + Archive (enterprise) | DR sites, air-gap, compliance export | 225–237 | 2262–2581 |

**Bold** = shipped or in progress on `main`. Layer 1 phases 35–37 and layer 4 phase 37 are **Shipped (v1)**.

---

## Next 10 phases (38–47) — immediate queue

| Phase | AI | macOS app | Ship target |
|-------|-----|-----------|-------------|
| **38** | 582–591 | **Time Machine** — fleet backup rollup + restore strip | **Shipped (v1)** |
| **39** | 592–601 | **Finder** — smart folders + tag sidebar | **Shipped (v1)** |
| **40** | 602–611 | **Network** — System Settings + Network Lens tab | **Shipped (v1)** |
| **41** | 612–621 | **Disk Utility** — pool health rings + SMART rollup | **Shipped (v1)** |
| **42** | 622–631 | **Console** — unified fleet log tail | **Shipped (v1)** |
| **43** | 632–641 | **Software Update** — host patch catalog | **Shipped (v1)** |
| **44** | 642–651 | **Keychain** — secrets inventory Mac pane | **Shipped (v1)** |
| **45** | 652–661 | **Users & Groups** — tenant switcher menu bar | **Shipped (v1)** |
| **46** | 662–671 | **Shortcuts** — blueprint Launchpad grid | **Shipped (v1)** |
| **47** | 672–681 | **Stage Manager** — workspace spaces strip | **Shipped (v1)** |
| **48** | 682–691 | **General** — fleet desktop prefs + dock editor | **Shipped (v1)** |

---

## Phase 48 — General (682–691)

| Item | Detail |
|------|--------|
| Backend | `GET /api/v1/fleet/general` |
| UI | Settings → General — wallpaper, dock editor, fleet summary |
| Spotlight | `general settings`, `customize dock` |
| Doc | [`zeus-os-ai-682-691.md`](zeus-os-ai-682-691.md) |

## Phase acceptance checklist (every phase)

1. Controller route under `/api/v1/fleet/*` or contextual `/hosts|vms/*`
2. `platform.ts` fetcher + Mac UI (`MacGlassPanel` / `MacSettingsPane`)
3. Menu bar or Control Center tile when fleet-visible
4. Spotlight intent in `intent_router.rs`
5. E2E block in `e2e-platform-smoke.sh`
6. `platformctl` subcommand
7. `docs/zeus-os-ai-XXX-YYY.md` + roadmap row

---

## Explicit non-goals (stay macOS-*like*, not macOS clone)

- No in-browser APFS manager; use libvirt pool abstractions
- No live WebAuthn on `main` until enterprise backlog lifts — Keychain phases stay **inventory + link-out**
- Kernel route mutation stays read-only in platform UI (Network pane shows diag + deep links)

See [`platform-ux-vision.md`](platform-ux-vision.md), [`machina-fleet-desktop-vision.md`](machina-fleet-desktop-vision.md), [`machina-infrastructure-vision.md`](machina-infrastructure-vision.md), [`enterprise-backlog.md`](enterprise-backlog.md).

---

## Layer 0 — Machina Infrastructure OS (Phases 49–58)

Physical infrastructure shell and Mission Control — complements the macOS metaphor layers above.

| Phase | macOS / product metaphor | Ship target |
|-------|--------------------------|-------------|
| **49** | **Jarvis landing** — morning briefing on `/platform` | **Shipped (v1)** |
| **50** | **Dynamic Island** — menubar health pill + expand sheet | **Shipped (v1)** |
| **51** | **Mission Control Earth** — site/rack/host 2.5D overlay | **Shipped (v1)** |
| **52** | **Infrastructure dock** — Machines/VMs/Storage/Network/GPU/Terminal | **Shipped (v1)** |
| 53 | Machine Finder root — DC→Rack→Host→VM tree | **Shipped (v1)** |
| 54 | GPU Command Center — MIG, vGPU, CUDA placement | **Shipped (v1)** |
| 55 | Maintenance Mission — guided 7-step patch timeline | **Shipped (v1)** |
| 56 | Infrastructure DNA — fleet health score 0–100 | **Shipped (v1)** |
| 57 | Full Jarvis — intent-first shell (minimal menus) | **Shipped (v1)** |
| 58 | 3D Infrastructure Earth (WebGL) | **Shipped (canvas v2)** — site legend + Finder; full WebGL deferred |

API: `GET /api/v1/fleet/mission`, host `site`/`rack`/`rack_u`. Doc: [`machina-infrastructure-vision.md`](machina-infrastructure-vision.md).

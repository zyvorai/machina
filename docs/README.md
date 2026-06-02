# Documentation

## Client Presentations

**6 HTML+PDF presentation decks** covering business value, architecture, security, technical deep dives, and quick-start guides — organized for different audiences.

> 📊 **All presentations available as interactive HTML** (viewable in any browser) **and PDF** (printable/shareable). Download or view online: [`client-presentations/`](client-presentations/)

### Presentation Index

| # | Title | Use Case | Audience |
|---|-------|----------|----------|
| 01 | Business Value | Market value, ROI, key differentiation | C-suite, VP Infrastructure |
| 02 | Pricing & Licensing | TCO, cost comparison vs alternatives | Finance, Procurement |
| 03 | Technical Architecture | Full platform stack, Rust daemon, libvirt integration | Architects, DevOps |
| 04 | Quickstart Guide | Installation, initial setup, POC workflow | New users, solutions architects |
| 05 | Security & Compliance | PAM auth, RBAC, session management, audit trails | Security, compliance teams |
| 06 | ROI Calculator | Financial justification tool, cost-benefit analysis | Finance, project managers |

[**→ Full Presentation Library**](client-presentations/) with descriptions and generation instructions

---

## Getting Started

| Document | Description |
|----------|-------------|
| [README](../README.md) | Project overview, architecture, key features |
| [Installation](../install.sh) | Automated installer for Fedora/RHEL/Ubuntu/Debian/openSUSE/Arch |
| [KubeVirt Migration](kubevirt-migration.md) | Optional Kubernetes integration guide |
| [Guacamole Integration](guacamole-integration.md) | HTML5 gateway integration (optional) |
| [OIDC & local Linux user](oidc-effective-linux-user.md) | Session vs NSS mapping, defaults, run-as-user boundary |
| [UX wiring & QA](ux.md) | Cross-shell UX, login variants, manual QA matrix, E2E pointers |
| [Operator runbook](runbook.md) | Health, backup, remote access, web login troubleshooting |

---

## API & Automation

- **REST API** — 50+ endpoints for VM lifecycle, storage, networking, metrics
- **WebSocket** — Console proxies (VNC, SPICE, serial, SSH) and live metrics
- **CLI** — `machinactl` for remote deployment, health checks, backups, upgrades
- **Webhooks** — Event-driven automations (VM state change, alert triggers)
- **Prometheus** — Native metrics export (`/metrics`)

---

## Support & Contributing

- **Issues** — Report bugs or request features via GitHub Issues
- **Contributing** — See [CONTRIBUTING.md](../CONTRIBUTING.md)
- **Community** — Join discussions and ask questions in GitHub Discussions

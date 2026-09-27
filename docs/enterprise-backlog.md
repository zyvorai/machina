# Enterprise backlog (explicit non-goals today)

Machina targets single-host and small fleet KVM operations. The items below are **not implemented** on `main`; track here for product planning — not as missing bugs.

| Area | Status | Notes |
|------|--------|-------|
| HashiCorp Vault (or similar) for secrets | Not implemented | No Vault integration exists — the previous simulated inventory in `enterprise_security.rs` was removed rather than kept as a stub. libvirt secrets API + config file remain the real mechanism today; see [compliance-hardening.md](compliance-hardening.md) |
| WebAuthn / MFA / SCIM | Not implemented | No MFA enrollment/policy engine exists — the previous simulated inventory in `enterprise_security.rs` was removed rather than kept as a stub. PAM, LDAP, and OIDC browser SSO are the real, live auth paths today |
| SAML | Config-only | `core/src/config.rs` stores `[auth.saml]` config but the login flow doesn't use it yet (`docs/handbook/admin-configuration.md`) |
| FIPS-validated crypto modules | Not planned on `main` | TLS via system/OpenSSL; no FIPS module selection |
| Fleet automatic leader election / VIP | Not planned on `main` | Manual DNS or load balancer failover — [fleet-ha.md](fleet-ha.md) |
| Built-in license / entitlement server | Not planned on `main` | Open-source deployment model |
| In-browser RDP decoder (WASM) | Not planned on `main` | WebSocket tunnel + `.rdp` download — [builtin-rdp.md](builtin-rdp.md) |
| Multi-tenant isolation beyond RBAC | Not planned on `main` | Single hypervisor trust boundary |
| `extra_uris` write lifecycle | Not planned on `main` | Federated VM list is read-only — [ux.md](ux.md) |

When prioritizing new work, prefer gaps in [ROADMAP.md](ROADMAP.md) follow-ups and partial rollouts (session libvirt coverage, operator UX) over this list unless your organization requires compliance features above.

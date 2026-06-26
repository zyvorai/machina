# Active Directory — zyvorai.local lab

Integrate Machina, Zeus OS, and the HyperSDK suite with the **zyvorai.local** domain controller.

| Field | Value |
|-------|--------|
| Domain | `zyvorai.local` |
| DC host | `45.82.66.172` |
| LDAP URL | `ldap://45.82.66.172:389` |
| Base DN | `DC=zyvorai,DC=local` |
| Test UPN | `sshant@zyvorai.local` |

Do **not** commit domain passwords to git. Use the UI test bind or a secrets manager.

## Machina (hypervisor UI)

1. Open **Settings → Active Directory / LDAP** (admin role).
2. Click **Apply zyvorai.local preset**.
3. Enable LDAP login → **Save AD settings**.
4. **Test LDAP** with `sshant@zyvorai.local` and the lab password.
5. Sign out and log in on `/login` with the same UPN.

Equivalent `config.toml`:

```toml
[auth.ldap]
enabled = true
url = "ldap://45.82.66.172:389"
base_dn = "DC=zyvorai,DC=local"
user_filter = "(|(sAMAccountName={username})(userPrincipalName={username}))"
member_attribute = "memberOf"
username_attribute = "sAMAccountName"
admin_group_substrings = ["Domain Admins", "Machina-Admins"]
operator_group_substrings = ["Machina-Operators"]
readonly_group_substrings = ["Domain Users"]
```

UPN login (`user@domain`) uses direct AD bind when no service account is configured.

See also: [LDAP / Active Directory login](../ldap-auth.md).

## E2E and deploy (auth mode)

When LDAP is enabled on the daemon, PAM login for the SSH user (`sus`) no longer works on `:5092`. Pass **`--auth ldap`** (or set `E2E_AUTH_MODE=ldap`) and LDAP credentials:

```bash
export E2E_AUTH_MODE=ldap
export E2E_LDAP_USER='sshant@zyvorai.local'
export E2E_LDAP_PASS='…'
VSPASS=max ./scripts/e2e-full-test-remote.sh sus 212.8.252.194 --auth ldap

# Deploy + post-deploy E2E
VSPASS=max ./scripts/deploy-remote.sh sus 212.8.252.194 --quick --platform --e2e --e2e-auth ldap
```

| Mode | Flag / env | Credentials |
|------|------------|-------------|
| PAM (default when LDAP off) | `--auth pam` | `E2E_USER` / `VSPASS` |
| LDAP / AD | `--auth ldap` | `E2E_LDAP_USER` / `E2E_LDAP_PASS` (UPN) |
| OIDC / SSO | `--auth oidc` | Browser SSO only (password E2E skipped) |
| Auto | `--auth auto` (default) | Detect from `/api/v1/auth/providers`; prefers LDAP when enabled and UPN creds are set |

Playwright live tests use the same env: `PLAYWRIGHT_LIVE_AUTH`, `PLAYWRIGHT_LIVE_LDAP_USER`, `PLAYWRIGHT_LIVE_LDAP_PASS`.

## Zeus OS (v9s)

Set on the Zeus OS API deployment:

```bash
export ZEUS_OS_AUTH=ldap
export ZEUS_OS_LDAP_URL=ldap://45.82.66.172:389
export ZEUS_OS_LDAP_BASE_DN=DC=zyvorai,DC=local
export ZEUS_OS_LDAP_BIND_DN_TEMPLATE={}@zyvorai.local
```

Sign in on the Zeus login page with `sshant@zyvorai.local`.

See: [Enterprise auth and tenancy](../../v9s/docs/ENTERPRISE_AUTH_TENANCY.md) (sibling repo).

## HyperSDK web

Marketing and client decks reference suite-wide LDAP/AD under Machina + Zeus OS identity. Run `npm run presentations:sync -- --product=machina` in hypersdk-web after updating machina decks.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Invalid username characters | Machina ≥ current build allows `@` when LDAP is enabled |
| LDAP bind failed | Firewall 389/tcp to `45.82.66.172`, clock skew, password |
| User not found | Base DN / user filter; try full UPN |
| Readonly role only | `memberOf` / group substring mapping in LDAP settings |

#!/usr/bin/env bash
# e2e-test.sh — unified Machina E2E: preflight, libvirt VMs, OpenStack API
#
# Usage:
#   ./scripts/e2e-test.sh [BASE_URL] [USER] [PASS]
#
# Examples:
#   VSPASS=max ./scripts/e2e-test.sh https://185.165.240.5:5092 sus
#   ./scripts/e2e-test.sh --skip-libvirt https://localhost:5092 sus
#
# Flags:
#   --skip-preflight         Skip health / platform-info
#   --skip-libvirt           Skip libvirt VM lifecycle
#   --skip-openstack         Skip OpenStack API tests
#   --libvirt-only           Same as --skip-openstack --skip-preflight
#   --require-openstack-ssh  Fail if guest ping/SSH does not work
#   --openstack-flavor NAME  Default m1.tiny
#   --openstack-image NAME   Default cirros-test
#   --openstack-network NAME Default private
#   --ssh-host HOST          Hypervisor for virsh/SSH (default: host from BASE_URL)
#   --skip-dhcp-check        Skip libvirt 90s DHCP/guest-IP poll (blank-disk smoke VMs)
#   --auth pam|ldap|oidc|auto  Login auth mode (default auto — detect from /auth/providers)
#
# Env: VSPASS, E2E_SSH_HOST, E2E_OPENSTACK_REQUIRE_SSH=1
#      E2E_AUTH_MODE, E2E_LDAP_USER, E2E_LDAP_PASS (LDAP / UPN login)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/e2e-common.sh
source "${SCRIPT_DIR}/lib/e2e-common.sh"
# shellcheck source=lib/e2e-libvirt.sh
source "${SCRIPT_DIR}/lib/e2e-libvirt.sh"
# shellcheck source=lib/e2e-openstack.sh
source "${SCRIPT_DIR}/lib/e2e-openstack.sh"
# shellcheck source=lib/e2e-host-health.sh
source "${SCRIPT_DIR}/lib/e2e-host-health.sh"

E2E_BASE="https://localhost:5092"
E2E_USER="sus"
E2E_PASSWORD="${VSPASS:-}"
E2E_CURL="curl -sk"
E2E_FAIL=0
E2E_PASS=0
SKIP_PREFLIGHT=0
SKIP_LIBVIRT=0
SKIP_OPENSTACK=0
E2E_OPENSTACK_REQUIRE_SSH="${E2E_OPENSTACK_REQUIRE_SSH:-0}"
E2E_OS_FLAVOR="m1.tiny"
E2E_OS_IMAGE="cirros-test"
E2E_OS_NETWORK="private"
E2E_SSH_HOST="${E2E_SSH_HOST:-}"
E2E_OPENSTACK_CONFIGURED=0
E2E_SKIP_DHCP_CHECK=0
E2E_AUTH_MODE="${E2E_AUTH_MODE:-auto}"

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
}

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    --skip-libvirt) SKIP_LIBVIRT=1 ;;
    --skip-openstack) SKIP_OPENSTACK=1 ;;
    --libvirt-only) SKIP_OPENSTACK=1; SKIP_PREFLIGHT=1 ;;
    --require-openstack-ssh) E2E_OPENSTACK_REQUIRE_SSH=1 ;;
    --openstack-flavor) E2E_OS_FLAVOR="${2:?}"; shift ;;
    --openstack-image) E2E_OS_IMAGE="${2:?}"; shift ;;
    --openstack-network) E2E_OS_NETWORK="${2:?}"; shift ;;
    --ssh-host) E2E_SSH_HOST="${2:?}"; shift ;;
    --skip-dhcp-check) E2E_SKIP_DHCP_CHECK=1 ;;
    --auth) E2E_AUTH_MODE="${2:?}"; shift ;;
    --) shift; break ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
    *) POSITIONAL+=("$1") ;;
  esac
  shift
done
while [[ $# -gt 0 ]]; do POSITIONAL+=("$1"); shift; done

if [[ ${#POSITIONAL[@]} -ge 1 ]]; then E2E_BASE="${POSITIONAL[0]}"; fi
if [[ ${#POSITIONAL[@]} -ge 2 ]]; then E2E_USER="${POSITIONAL[1]}"; fi
if [[ ${#POSITIONAL[@]} -ge 3 ]]; then E2E_PASSWORD="${POSITIONAL[2]}"; fi

if [[ -z "${E2E_PASSWORD}" ]]; then
  read -rsp "Password for ${E2E_USER}@${E2E_BASE}: " E2E_PASSWORD
  echo
fi
export E2E_PASSWORD
export E2E_AUTH_MODE

[[ -z "${E2E_SSH_HOST}" ]] && E2E_SSH_HOST="$(e2e_host_from_base)"

e2e_init_cookie
trap e2e_cleanup EXIT

echo "Machina E2E → ${E2E_BASE} (user ${E2E_USER}, ssh ${E2E_SSH_HOST})"
e2e_auth_banner_line

if [[ "$SKIP_PREFLIGHT" -eq 0 ]]; then
  e2e_hdr "PREFLIGHT: HEALTH"
  http="$(${E2E_CURL} -o /dev/null -w "%{http_code}" "${E2E_BASE}/api/v1/health" --max-time 10)"
  e2e_assert_http "$http" "200" "health"
fi

if ! e2e_login; then
  e2e_summary
  exit 1
fi

if [[ "$SKIP_PREFLIGHT" -eq 0 ]]; then
  e2e_host_health_run || true
fi

if [[ "$SKIP_PREFLIGHT" -eq 0 ]]; then
  e2e_hdr "PREFLIGHT: PLATFORM-INFO"
  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/system/platform-info")"
  http="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/system/platform-info")"
  if [[ "$http" == "200" ]]; then
    e2e_ok "platform-info HTTP 200"
    if echo "$r" | python3 -c 'import sys,json; o=json.load(sys.stdin).get("openstack") or {}; exit(0 if o.get("enabled") else 1)' 2>/dev/null; then
      e2e_ok "openstack enabled in platform-info"
      if echo "$r" | python3 -c 'import sys,json; o=json.load(sys.stdin).get("openstack") or {}; exit(0 if o.get("configured") else 1)' 2>/dev/null; then
        E2E_OPENSTACK_CONFIGURED=1
        e2e_ok "openstack configured"
      else
        e2e_warn "openstack enabled but not configured — skipping OpenStack tests"
        SKIP_OPENSTACK=1
      fi
    else
      SKIP_OPENSTACK=1
      e2e_warn "openstack not enabled — skipping OpenStack tests"
    fi
  else
    e2e_warn "platform-info HTTP $http"
    (( E2E_PASS++ )) || true
  fi
fi

if [[ "$SKIP_LIBVIRT" -eq 0 ]]; then
  e2e_libvirt_run || true
fi

if [[ "$SKIP_OPENSTACK" -eq 0 ]]; then
  if [[ "$E2E_OPENSTACK_CONFIGURED" -eq 0 && "$SKIP_PREFLIGHT" -eq 1 ]]; then
    r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/status")"
    if echo "$r" | grep -qE '"enabled"[[:space:]]*:[[:space:]]*true'; then
      E2E_OPENSTACK_CONFIGURED=1
    else
      e2e_warn "OpenStack not enabled — skipping OpenStack block"
      SKIP_OPENSTACK=1
    fi
  fi
  if [[ "$SKIP_OPENSTACK" -eq 0 ]]; then
    e2e_openstack_run || true
  fi
fi

if e2e_summary; then
  exit 0
fi
exit 1

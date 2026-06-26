#!/usr/bin/env bash
# e2e-packetwolf-remote.sh — run PacketWolf Zeus + runtime tiers against a deployed host.
#
# When PacketWolf runs in-cluster (no host :9443), tests run on the SSH host against
# localhost:9191 via the packetwolf-api-port-forward systemd unit (see install-platform.sh).
#
# Usage:
#   PACKETWOLF_VERIFY_API_KEY='Admin@321' ./scripts/e2e-packetwolf-remote.sh USER HOST
#   PACKETWOLF_TEST_TIERS=zeus,runtime ./scripts/e2e-packetwolf-remote.sh sus 212.8.252.194
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
USER="${1:?usage: $0 USER HOST}"
HOST="${2:?usage: $0 USER HOST}"
PW_SRC="$(cd "$REPO/.." && pwd)/packetwolf"

if [[ ! -d "$PW_SRC/scripts" ]]; then
  echo "⚠️  No sibling ../packetwolf — skip PacketWolf E2E" >&2
  exit 0
fi

export PACKETWOLF_VERIFY_API_KEY="${PACKETWOLF_VERIFY_API_KEY:-${PACKETWOLF_ADMIN_API_KEY:-Admin@321}}"
export PACKETWOLF_TEST_TIERS="${PACKETWOLF_TEST_TIERS:-zeus,runtime,tetragon}"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)
REMOTE="${USER}@${HOST}"

tier_script() {
  case "$1" in
    runtime) echo e2e-runtime-enforce-verify.sh ;;
    zeus) echo e2e-zeus-ai-verify.sh ;;
    tetragon) echo e2e-tetragon-verify.sh ;;
    *) return 1 ;;
  esac
}

run_on_host_via_k8s_bridge() {
  local tiers=() tier script rel
  IFS=',' read -ra tiers <<< "$PACKETWOLF_TEST_TIERS"
  for tier in "${tiers[@]}"; do
    script="$(tier_script "$tier" || true)"
    [[ -n "$script" ]] || continue
    rel+=("$script")
  done
  [[ ${#rel[@]} -gt 0 ]] || { echo "⚠️  No runnable tiers in PACKETWOLF_TEST_TIERS=${PACKETWOLF_TEST_TIERS}"; return 0; }

  echo "ℹ️  External https://${HOST}:9443 unreachable — on-host tiers via http://127.0.0.1:9191 (k8s port-forward)"
  rsync -az -e "ssh ${SSH_OPTS[*]}" \
    "${rel[@]/#/${PW_SRC}/scripts/}" \
    "${REMOTE}:/tmp/packetwolf-e2e/" >/dev/null

  ssh "${SSH_OPTS[@]}" "$REMOTE" env PACKETWOLF_VERIFY_API_KEY="$PACKETWOLF_VERIFY_API_KEY" bash -s "${rel[@]}" <<'REMOTE'
set -euo pipefail
export PACKETWOLF_E2E_BASE=http://127.0.0.1:9191
export PACKETWOLF_VERIFY_API_KEY="${PACKETWOLF_VERIFY_API_KEY:?}"
if ! curl -sf --connect-timeout 3 "http://127.0.0.1:9191/api/v1/anomalies?limit=1" >/dev/null 2>&1; then
  if [[ -x /usr/local/bin/kubectl ]] && [[ -f /etc/packetwolf/k3s.yaml ]]; then
    ns="$(/usr/local/bin/kubectl --kubeconfig=/etc/packetwolf/k3s.yaml get svc -A -o jsonpath='{range .items[?(@.metadata.name=="packetwolf-api")]}{.metadata.namespace}{"\n"}{end}' 2>/dev/null | head -1)"
    if [[ -n "$ns" ]]; then
      sudo systemctl restart packetwolf-api-port-forward 2>/dev/null || true
      sleep 3
    fi
  fi
fi
FAIL=0
for script in "$@"; do
  echo ""
  echo "=== Tier: ${script%.sh} ==="
  extra=()
  if [[ "$script" == "e2e-tetragon-verify.sh" ]]; then
    extra=(--allow-fail)
  fi
  if bash "/tmp/packetwolf-e2e/${script}" "${extra[@]}" "$PACKETWOLF_E2E_BASE"; then
    echo "✅ ${script}"
  else
    echo "❌ ${script}"
    FAIL=$((FAIL + 1))
  fi
done
exit "$FAIL"
REMOTE
}

echo "🐺 PacketWolf post-deploy E2E → ${REMOTE} (tiers: ${PACKETWOLF_TEST_TIERS})"
if curl -sfk --connect-timeout 5 "https://${HOST}:9443/health" >/dev/null 2>&1; then
  export DEPLOY_HOST="$HOST"
  export DEPLOY_USER="$USER"
  exec "$PW_SRC/scripts/test-all-features-remote.sh" "$HOST" "$USER"
fi

run_on_host_via_k8s_bridge

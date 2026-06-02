#!/usr/bin/env bash
# Post-deploy / manual sweep: sync inventory, remove stale e2e VMs, restart agent, start shutoff VMs.
set -euo pipefail

CONTROLLER="${MACHINA_CONTROLLER_URL:-http://127.0.0.1:5093}"
AUTH="${MACHINA_PLATFORM_AUTH:-admin:admin}"

info() { echo "ℹ️  $*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

curl_api() {
  curl -sf -u "$AUTH" -H 'Content-Type: application/json' "$@"
}

info "Platform sweep on $(hostname)"

systemctl enable machina-agent machina-controller postgresql 2>/dev/null || true
systemctl start libvirtd 2>/dev/null || true
systemctl restart machina-agent 2>/dev/null || warn "machina-agent restart failed"
sleep 2

curl_api -X POST "$CONTROLLER/api/v1/hosts/sync-all" -d '{}' >/dev/null || warn "sync-all failed"

# Remove libvirt e2e-* domains first (E2E leftovers).
while read -r dom; do
  [ -n "$dom" ] || continue
  [[ "$dom" == e2e-* ]] || [[ "$dom" == e2e_* ]] || continue
  warn "Undefining libvirt domain: $dom"
  sudo virsh destroy "$dom" 2>/dev/null || true
  sudo virsh undefine "$dom" --nvram --managed-save --snapshots-metadata --remove-all-storage 2>/dev/null \
    || sudo virsh undefine "$dom" 2>/dev/null || true
done < <(sudo virsh list --all --name 2>/dev/null | grep -E '^e2e[-_]' || true)

# Delete managed e2e-* platform VM records.
while read -r id name; do
  [ -n "$id" ] || continue
  warn "Removing e2e VM record: $name ($id)"
  curl_api -X POST "$CONTROLLER/api/v1/vms/${id}/delete" -d '{"confirmed":true}' >/dev/null 2>&1 || true
done < <(curl_api "$CONTROLLER/api/v1/vms" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for v in d:
    n = v.get('name') or ''
    if n.startswith('e2e-') or n.startswith('e2e_'):
        print(v['id'], n)
" 2>/dev/null || true)

sleep 5
curl_api -X POST "$CONTROLLER/api/v1/hosts/sync-all" -d '{}' >/dev/null 2>&1 || true
sleep 2

curl_api -X POST "$CONTROLLER/api/v1/vms/prune-missing" -d '{}' >/dev/null 2>&1 || true
curl_api -X POST "$CONTROLLER/api/v1/hosts/sync-all" -d '{}' >/dev/null || true

while read -r dom; do
  [ -n "$dom" ] || continue
  [[ "$dom" == e2e-* ]] && continue
  st=$(sudo virsh domstate "$dom" 2>/dev/null || echo unknown)
  if [ "$st" = 'shut off' ]; then
    sudo virsh autostart "$dom" 2>/dev/null || true
    sudo virsh start "$dom" 2>/dev/null || true
  fi
done < <(sudo virsh list --all --name 2>/dev/null | grep -v '^$' || true)

sleep 2
curl_api -X POST "$CONTROLLER/api/v1/hosts/sync-all" -d '{}' >/dev/null || true

ok "Sweep complete"
curl_api "$CONTROLLER/api/v1/vms" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'  VMs: {len(d)}')
for v in d:
    err = (v.get('last_error') or '')[:40]
    print(f\"    {v.get('name')}: {v.get('observed_state')} / {v.get('lifecycle_phase')} {err}\")
" 2>/dev/null || true

curl_api "$CONTROLLER/api/v1/hosts" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for h in d:
    print(f\"  Host {h.get('hostname')}: {h.get('state')}\")
" 2>/dev/null || true

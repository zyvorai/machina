#!/usr/bin/env bash
# Wipe platform + libvirt VMs on a remote host, then deploy ubuntu-desktop via Machina platform API.
#
# Usage:
#   ./scripts/reset-and-deploy-ubuntu-remote.sh sus 212.8.252.194
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/e2e-platform-common.sh
source "${SCRIPT_DIR}/lib/e2e-platform-common.sh"

USER="${1:?usage: $0 USER HOST}"
HOST="${2:?usage: $0 USER HOST}"
E2E_PLATFORM_BASE="http://${HOST}:5093"
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no ${USER}@${HOST}"

info() { echo "== $*"; }

platform_curl() {
  e2e_platform_curl "$@"
}

info "Platform API → ${E2E_PLATFORM_BASE}"

vms_json="$(platform_curl "${E2E_PLATFORM_BASE}/api/v1/vms")"

while read -r vid name managed; do
  [[ -z "$vid" ]] && continue
  info "Deleting platform VM ${name} (${vid}, managed=${managed})"
  platform_curl -X POST "${E2E_PLATFORM_BASE}/api/v1/vms/${vid}/delete" >/dev/null || true
  for _ in $(seq 1 60); do
    st="$(platform_curl "${E2E_PLATFORM_BASE}/api/v1/tasks?operation=vm.delete&limit=1" | python3 -c "
import json, sys
t = json.load(sys.stdin)
print(t[0]['status'] if t else 'done')
" 2>/dev/null || echo done)"
    [[ "$st" == "completed" || "$st" == "failed" || "$st" == "done" ]] && break
    sleep 2
  done
done < <(echo "$vms_json" | python3 -c "
import json, sys
for v in json.load(sys.stdin):
    print(v.get('id', ''), v.get('name', ''), v.get('managed', True))
")

info "Purging leftover libvirt domains on host"
$SSH 'for n in $(sudo virsh list --all --name 2>/dev/null); do
  [ -z "$n" ] && continue
  sudo virsh destroy "$n" 2>/dev/null || true
  sudo virsh undefine "$n" --remove-all-storage 2>/dev/null || sudo virsh undefine "$n" 2>/dev/null || true
done'

info "Prune stale missing VM records"
platform_curl -X POST "${E2E_PLATFORM_BASE}/api/v1/vms/prune-missing" >/dev/null || true

info "Sync host inventory"
platform_curl -X POST "${E2E_PLATFORM_BASE}/api/v1/hosts/sync-all" >/dev/null || true
sleep 5

info "Creating ubuntu-desktop (2 vCPU, 4 GiB, running)"
create_resp="$(platform_curl -X POST -H "Content-Type: application/json" \
  "${E2E_PLATFORM_BASE}/api/v1/vms" \
  -d '{
    "api_version": "virt.zyvor.dev/v1",
    "kind": "VirtualMachine",
    "metadata": { "name": "ubuntu-desktop", "project": "default" },
    "spec": {
      "cpu": { "sockets": 1, "cores": 2 },
      "memory": "4Gi",
      "storage": [{ "name": "root", "size": "32Gi", "class": "silver" }],
      "network": [{ "network": "default", "ip_mode": "dhcp" }],
      "firmware": "bios",
      "graphics": { "type": "vnc", "listen": "127.0.0.1" }
    },
    "tags": [],
    "desired_state": "running"
  }')"
echo "$create_resp"
task_id="$(echo "$create_resp" | python3 -c "import json,sys; print(json.load(sys.stdin).get('task_id',''))")"
if [[ -z "$task_id" ]]; then
  err="$(echo "$create_resp" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',''))" 2>/dev/null || true)"
  echo "❌ VM create failed: ${err:-$create_resp}"
  exit 1
fi

info "Waiting for vm.apply task ${task_id}"
for _ in $(seq 1 90); do
  task="$(platform_curl "${E2E_PLATFORM_BASE}/api/v1/tasks/${task_id}")"
  st="$(echo "$task" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))")"
  msg="$(echo "$task" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message',''))")"
  echo "  task: ${st} — ${msg}"
  [[ "$st" == "completed" ]] && break
  [[ "$st" == "failed" ]] && { echo "❌ vm.apply failed: $task"; exit 1; }
  sleep 3
done

vm_row="$(platform_curl "${E2E_PLATFORM_BASE}/api/v1/vms" | python3 -c "
import json, sys
for v in json.load(sys.stdin):
    if v.get('name') == 'ubuntu-desktop':
        print(json.dumps(v))
        break
")"

[[ -n "$vm_row" ]] || { echo "❌ ubuntu-desktop not found in platform inventory"; exit 1; }

echo "$vm_row" | python3 -c "
import json, sys
v = json.load(sys.stdin)
err = v.get('last_error') or ''
phase = v.get('lifecycle_phase') or ''
obs = v.get('observed_state') or ''
des = v.get('desired_state') or ''
print(f'  name={v.get(\"name\")} managed={v.get(\"managed\")} desired={des} observed={obs} phase={phase}')
if err:
    print(f'❌ last_error: {err}')
    sys.exit(1)
if obs != 'running' or phase == 'error':
    print(f'❌ VM not healthy: observed={obs} phase={phase}')
    sys.exit(1)
print('✅ ubuntu-desktop deployed with zero errors')
"

info "Done — https://${HOST}:5092/platform/vms"

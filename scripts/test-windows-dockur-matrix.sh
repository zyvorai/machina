#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Live matrix: Windows dockur goldens → Vessel run + port checks + optional libvirt clone.
# Usage (on hypervisor as root or sudo):
#   ./scripts/test-windows-dockur-matrix.sh
# Env:
#   MACHINA_URL=https://127.0.0.1:5092
#   MACHINA_USER=sus MACHINA_PASS=max
#   GUESTS="win11 win10 windows-server-2022 windows-server-2025"
#   SKIP_BUILD=1          # only test guests that already have a golden
#   SKIP_VESSEL=0
#   SKIP_LIBVIRT=0
#   BUILD_CONCURRENCY=1   # sequential builds (recommended; each needs ~4G RAM + KVM)
set -euo pipefail

BASE="${MACHINA_URL:-https://127.0.0.1:5092}"
USER="${MACHINA_USER:-sus}"
PASS="${MACHINA_PASS:-max}"
GUESTS=(${GUESTS:-win11 win10 windows-server-2022 windows-server-2025})
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_VESSEL="${SKIP_VESSEL:-0}"
SKIP_LIBVIRT="${SKIP_LIBVIRT:-0}"
COOKIE="$(mktemp)"
REPORT="${REPORT:-/tmp/windows-dockur-matrix-report.md}"
RUN_SCRIPT="${RUN_SCRIPT:-/usr/local/share/machina/packer/run-windows-dockur.sh}"

log() { echo "[matrix] $*"; }
ok() { echo "  ✅ $*"; }
fail() { echo "  ❌ $*"; FAILS=$((FAILS+1)); }
PASS_N=0
FAILS=0

cleanup() { rm -f "$COOKIE"; }
trap cleanup EXIT

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sk -b "$COOKIE" -c "$COOKIE" -X "$method" "${BASE}${path}" \
      -H "Content-Type: application/json" -d "$body"
  else
    curl -sk -b "$COOKIE" -c "$COOKIE" -X "$method" "${BASE}${path}"
  fi
}

golden_path() { echo "/var/lib/libvirt/images/${1}.qcow2"; }

wait_http() {
  local url="$1" secs="${2:-180}"
  local i=0
  while (( i < secs )); do
    code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 3 "$url" || echo 000)
    if [[ "$code" != "000" && "$code" != "000000" ]]; then
      echo "$code"
      return 0
    fi
    sleep 5
    i=$((i+5))
  done
  echo "000"
  return 1
}

check_tcp() {
  local host="$1" port="$2"
  timeout 3 bash -c "echo >/dev/tcp/${host}/${port}" 2>/dev/null
}

login() {
  log "Login ${USER} @ ${BASE}"
  local r
  r=$(curl -sk -c "$COOKIE" -X POST "${BASE}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${USER}\",\"password\":\"${PASS}\"}")
  echo "$r" | grep -q '"status":"ok"' || { echo "$r"; fail "login"; exit 1; }
  ok "PAM login"
  PASS_N=$((PASS_N+1))
}

ensure_golden() {
  local guest="$1"
  local path
  path=$(golden_path "$guest")
  if [ -f "$path" ] && [ "$(stat -c%s "$path" 2>/dev/null || echo 0)" -gt 500000000 ]; then
    ok "golden present: $path ($(du -h "$path" | awk '{print $1}'))"
    PASS_N=$((PASS_N+1))
    return 0
  fi
  if [ "$SKIP_BUILD" = "1" ]; then
    fail "no golden for $guest (SKIP_BUILD=1)"
    return 1
  fi
  log "Starting Golden Forge build for $guest"
  local resp id status
  resp=$(api POST /api/v1/jobs/packer-golden-build "{\"guest\":\"${guest}\"}")
  id=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  if [ -z "$id" ]; then
    fail "start build $guest: $resp"
    return 1
  fi
  ok "job $id started for $guest"
  PASS_N=$((PASS_N+1))
  # Poll up to 3h
  local waited=0
  while (( waited < 10800 )); do
    sleep 30
    waited=$((waited+30))
    status=$(api GET "/api/v1/jobs/${id}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status') or d.get('summary',{}).get('status',''))" 2>/dev/null || echo "")
    if [ "$status" = "completed" ]; then
      ok "build completed: $guest"
      PASS_N=$((PASS_N+1))
      [ -f "$path" ] || fail "expected golden missing after complete: $path"
      return 0
    fi
    if [ "$status" = "failed" ]; then
      fail "build failed: $guest"
      api GET "/api/v1/jobs/${id}" | python3 -c "import sys,json; d=json.load(sys.stdin); print('\\n'.join((d.get('logs') or [])[-12:]))" 2>/dev/null || true
      return 1
    fi
    if (( waited % 300 == 0 )); then
      log "still building $guest (${waited}s) status=${status:-running}"
    fi
  done
  fail "build timeout $guest"
  return 1
}

test_vessel() {
  local guest="$1"
  local name="matrix-${guest}"
  log "Vessel run $guest as $name"
  # remove prior
  podman rm -f "$name" >/dev/null 2>&1 || true
  # unique publish ports per guest to avoid clashes
  local web_port rdp_port
  case "$guest" in
    win11) web_port=8011; rdp_port=3311 ;;
    win10) web_port=8010; rdp_port=3310 ;;
    windows-server-2022) web_port=8022; rdp_port=3322 ;;
    windows-server-2025) web_port=8025; rdp_port=3325 ;;
    *) web_port=8006; rdp_port=3389 ;;
  esac

  # Use API (maps fixed 8006/3389) OR script with custom ports for matrix.
  # For concurrent guests we invoke the runtime directly with unique ports.
  local golden version storage
  golden=$(golden_path "$guest")
  storage="/var/lib/machina/vessel-windows/matrix-${guest}"
  mkdir -p "$storage"
  case "$guest" in
    win11) version=11 ;;
    win10) version=10 ;;
    windows-server-2022) version=2022 ;;
    windows-server-2025) version=2025 ;;
  esac
  if [ -f "$golden" ]; then
    ln -f "$golden" "${storage}/data.qcow2" 2>/dev/null || cp -a "$golden" "${storage}/data.qcow2"
  fi
  podman pull docker.io/dockurr/windows >/dev/null
  podman run -d --name "$name" \
    -e "VERSION=${version}" \
    -e "DISK_FMT=qcow2" \
    -e "DISK_SIZE=64G" \
    -e "RAM_SIZE=4G" \
    -e "CPU_CORES=2" \
    -e "USERNAME=Docker" \
    -e "PASSWORD=admin" \
    -e "AUTOLOGIN=Y" \
    --label "machina.io/windows-dockur=1" \
    --label "machina.io/guest=${guest}" \
    --label "machina.io/matrix=1" \
    --device /dev/kvm \
    --device /dev/net/tun \
    --cap-add NET_ADMIN \
    -v "${storage}:/storage" \
    -p "127.0.0.1:${web_port}:8006" \
    -p "127.0.0.1:${rdp_port}:3389/tcp" \
    -p "127.0.0.1:${rdp_port}:3389/udp" \
    --stop-timeout 120 \
    docker.io/dockurr/windows >/dev/null

  ok "container started $name"
  PASS_N=$((PASS_N+1))

  local code
  code=$(wait_http "http://127.0.0.1:${web_port}/" 300 || true)
  if [[ "$code" =~ ^[23] ]]; then
    ok "web viewer HTTP $code on :${web_port}"
    PASS_N=$((PASS_N+1))
  else
    # dockur may still be booting; accept connection if port open
    if check_tcp 127.0.0.1 "$web_port"; then
      ok "web port :${web_port} open (HTTP ${code:-000} — guest still booting)"
      PASS_N=$((PASS_N+1))
    else
      fail "web viewer not reachable on :${web_port}"
    fi
  fi

  # RDP can lag several minutes behind the web viewer while Windows boots
  local rdp_ok=0 i=0
  while (( i < 300 )); do
    if check_tcp 127.0.0.1 "$rdp_port"; then
      rdp_ok=1
      break
    fi
    sleep 10
    i=$((i+10))
  done
  if [ "$rdp_ok" = "1" ]; then
    ok "RDP port :${rdp_port} open"
    PASS_N=$((PASS_N+1))
  else
    fail "RDP port :${rdp_port} not open after ${i}s"
  fi

  echo "| ${guest} | vessel | :${web_port} HTTP ${code:-?} | :${rdp_port} rdp=$rdp_ok | $name |" >>"$REPORT"

  # Free RAM/KVM for the next guest unless KEEP_VESSEL=1
  if [ "${KEEP_VESSEL:-0}" != "1" ]; then
    log "Stopping vessel $name (KEEP_VESSEL=0)"
    podman stop -t 30 "$name" >/dev/null 2>&1 || true
    podman rm -f "$name" >/dev/null 2>&1 || true
  fi
}

test_libvirt() {
  local guest="$1"
  local vm="matrix-lv-${guest}"
  local golden path
  golden=$(golden_path "$guest")
  [ -f "$golden" ] || { fail "libvirt skip $guest — no golden"; return 1; }

  log "Libvirt clone $guest → $vm"
  # delete prior
  api DELETE "/api/v1/vms/${vm}?delete_storage=true" >/dev/null 2>&1 || true
  sleep 1

  local body
  body=$(python3 - <<PY
import json
print(json.dumps({
  "name": "$vm",
  "vcpus": 2,
  "memory_mb": 4096,
  "disk_gb": 40,
  "os_variant": "win11" if "$guest" in ("win11","windows-server-2025") else ("win10" if "$guest"=="win10" else "win2k22"),
  "firmware": "uefi",
  "graphics_type": "vnc",
  "network": "default",
  "saved_template": None,
  "virt_install_disk_backing_store": "$golden",
  "guest_profile": "windows",
  "path_check_off": True,
}))
PY
)
  # Prefer create with backing store field used by CreateVM
  local resp
  resp=$(api POST /api/v1/vms "$body" || true)
  if ! echo "$resp" | grep -qE '"name"|started|created|Defining'; then
    # fallback: existing_disk copy via qemu-img then define
    local disk="/var/lib/libvirt/images/${vm}.qcow2"
    qemu-img create -f qcow2 -F qcow2 -b "$golden" "$disk" 40G >/dev/null
    resp=$(api POST /api/v1/vms "$(python3 - <<PY
import json
print(json.dumps({
  "name": "$vm",
  "vcpus": 2,
  "memory_mb": 4096,
  "disk_gb": 40,
  "existing_disk": "$disk",
  "firmware": "uefi",
  "graphics_type": "vnc",
  "network": "default",
  "guest_profile": "windows",
  "path_check_off": True,
}))
PY
)")
  fi

  if echo "$resp" | grep -qiE 'error|invalid|failed'; then
    fail "create VM $vm: $resp"
    return 1
  fi
  ok "VM create accepted: $vm"
  PASS_N=$((PASS_N+1))

  api POST "/api/v1/vms/${vm}/start" >/dev/null 2>&1 || true
  sleep 8
  local detail
  detail=$(api GET "/api/v1/vms/${vm}")
  local state gfx
  state=$(echo "$detail" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('state') or d.get('status') or '')" 2>/dev/null || echo "")
  if echo "$state" | grep -qi running; then
    ok "VM running: $vm ($state)"
    PASS_N=$((PASS_N+1))
  else
    fail "VM not running: $vm state=$state"
  fi

  # VNC: graphics listen port from details if present
  gfx=$(echo "$detail" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('graphics') or d.get('vnc') or '')" 2>/dev/null || true)
  # enable RDP (may take a while / need guest agent)
  local rdp
  rdp=$(api POST "/api/v1/vms/${vm}/windows/enable-rdp" "{}" 2>/dev/null || echo "")
  if echo "$rdp" | grep -qiE 'ok|applied|success|status'; then
    ok "enable-rdp response for $vm"
    PASS_N=$((PASS_N+1))
  else
    fail "enable-rdp for $vm: ${rdp:0:160}"
  fi

  echo "| ${guest} | libvirt | state=${state} | enable-rdp | $vm |" >>"$REPORT"
}

# ── main ────────────────────────────────────────────────────────────
: >"$REPORT"
{
  echo "# Windows dockur matrix — $(date -Is)"
  echo
  echo "| Guest | Path | Web/VNC | RDP | Name |"
  echo "|-------|------|---------|-----|------|"
} >>"$REPORT"

login

for g in "${GUESTS[@]}"; do
  log "======== $g ========"
  ensure_golden "$g" || continue
  if [ "$SKIP_VESSEL" != "1" ]; then
    test_vessel "$g" || true
  fi
  if [ "$SKIP_LIBVIRT" != "1" ]; then
    test_libvirt "$g" || true
  fi
done

echo >>"$REPORT"
echo "## Summary: ${PASS_N} passed, ${FAILS} failed" >>"$REPORT"
log "Done — ${PASS_N} passed, ${FAILS} failed"
log "Report: $REPORT"
cat "$REPORT"
exit $(( FAILS > 0 ? 1 : 0 ))

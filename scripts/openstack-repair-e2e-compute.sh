#!/usr/bin/env bash
# Repair Nova fake compute + Placement for Machina E2E on a single hypervisor.
#
# Fixes common failures after libvirt/fake driver switches or manual DB edits:
#   - nova-compute crash loop (missing /var/lib/nova/compute_id)
#   - Placement 409 / ResourceProviderCreationFailed
#   - "Host is not mapped to any cell"
#
# Usage (on hypervisor as root):
#   sudo ./scripts/openstack-repair-e2e-compute.sh
#   sudo ./scripts/openstack-repair-e2e-compute.sh /root/keystonerc_admin
#
set -euo pipefail

RC_FILE="${1:-/root/keystonerc_admin}"
HOST="$(hostname -s)"

log() { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }
die() { echo "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root"
[[ -f "$RC_FILE" ]] || die "Missing keystonerc: $RC_FILE"

CONF=/etc/nova/nova.conf
[[ -f "$CONF" ]] || die "Missing $CONF"

os_env() {
  # shellcheck disable=SC1090
  source "$RC_FILE"
}

ensure_fake_driver() {
  if grep -q '^compute_driver=fake.FakeDriver' "$CONF" 2>/dev/null; then
    ensure_fake_vif_plugging
    return 0
  fi
  log "Setting compute_driver=fake.FakeDriver (Machina + libvirt coexistence)"
  sed -i 's/^compute_driver=.*/compute_driver=fake.FakeDriver/' "$CONF"
  grep -q '^compute_driver=fake.FakeDriver' "$CONF" \
    || echo 'compute_driver=fake.FakeDriver' >>"$CONF"
  ensure_fake_vif_plugging
}

ensure_fake_vif_plugging() {
  # OVN/linuxbridge port binding fails on fake compute; let builds complete anyway.
  if grep -q '^vif_plugging_is_fatal=' "$CONF" 2>/dev/null; then
    sed -i 's/^vif_plugging_is_fatal=.*/vif_plugging_is_fatal=false/' "$CONF"
  else
    echo 'vif_plugging_is_fatal=false' >>"$CONF"
  fi
  if grep -q '^vif_plugging_timeout=' "$CONF" 2>/dev/null; then
    sed -i 's/^vif_plugging_timeout=.*/vif_plugging_timeout=0/' "$CONF"
  else
    echo 'vif_plugging_timeout=0' >>"$CONF"
  fi
}

ml2_uses_ovn() {
  [[ -f /etc/neutron/plugins/ml2/ml2_conf.ini ]] || return 1
  grep -E '^mechanism_drivers=' /etc/neutron/plugins/ml2/ml2_conf.ini 2>/dev/null | grep -q ovn
}

ensure_ovn_chassis() {
  ml2_uses_ovn || return 0
  command -v ovs-vsctl >/dev/null 2>&1 || return 0
  local ip
  ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
  [[ -n "$ip" ]] || ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "$ip" ]] || return 0
  log "OVN: ensure chassis for $HOST ($ip)"
  ovs-vsctl --may-exist add-br br-int
  ovs-vsctl --may-exist add-br br-ex 2>/dev/null || true
  ip link set br-ex up 2>/dev/null || true
  ovs-vsctl set open . external-ids:system-id="$HOST"
  ovs-vsctl set open . "external-ids:ovn-remote=tcp:${ip}:6642"
  ovs-vsctl set open . external-ids:ovn-remote-probe-interval=60000
  ovs-vsctl set open . external-ids:ovn-encap-type=geneve
  ovs-vsctl set open . "external-ids:ovn-encap-ip=${ip}"
  ovs-vsctl set open . external-ids:ovn-bridge-mappings=physnet1:br-ex
  systemctl restart ovn-controller neutron-ovn-agent neutron-server 2>/dev/null || true
  sleep 3
}

delete_error_instances() {
  os_env
  local ids
  ids="$(openstack server list -f value -c ID --status ERROR 2>/dev/null || true)"
  [[ -z "$ids" ]] && return 0
  log "Deleting ERROR Nova instances"
  while read -r id; do
    [[ -n "$id" ]] || continue
    openstack server delete "$id" 2>/dev/null || true
  done <<<"$ids"
}

delete_placement_rp_by_name() {
  os_env
  local token rp_uuid
  token="$(openstack token issue -f value -c id)"
  rp_uuid="$(
    curl -sf -H "X-Auth-Token: $token" -H "OpenStack-API-Version: placement 1.28" \
      "http://127.0.0.1:8778/resource_providers?name=${HOST}" \
      | python3 -c "
import sys, json
data = json.load(sys.stdin)
for rp in data.get('resource_providers', []):
    if rp.get('name') == '${HOST}':
        print(rp['uuid'])
        break
" 2>/dev/null || true
  )"
  [[ -z "$rp_uuid" ]] && return 0
  log "Removing placement resource provider $rp_uuid ($HOST)"
  curl -sf -X DELETE -H "X-Auth-Token: $token" -H "OpenStack-API-Version: placement 1.28" \
    "http://127.0.0.1:8778/resource_providers/${rp_uuid}" >/dev/null || true
}

reset_nova_compute_state() {
  log "Resetting Nova compute DB rows and local identity"
  systemctl stop openstack-nova-compute 2>/dev/null || true
  mysql nova -e "DELETE FROM compute_nodes;" 2>/dev/null || true
  mysql nova -e "DELETE FROM services WHERE \`binary\`='nova-compute';" 2>/dev/null || true
  rm -f /var/lib/nova/compute_id
  rm -rf /var/lib/nova/instances/compute_nodes
  mkdir -p /var/lib/nova/instances/compute_nodes
  chown nova:nova /var/lib/nova/instances/compute_nodes
}

sync_compute_id_from_db() {
  local cn
  cn="$(mysql nova -N -e "SELECT uuid FROM compute_nodes WHERE hypervisor_hostname='${HOST}' LIMIT 1" 2>/dev/null || true)"
  [[ -n "$cn" ]] || return 0
  echo "$cn" >/var/lib/nova/compute_id
  chown nova:nova /var/lib/nova/compute_id
  chmod 600 /var/lib/nova/compute_id
  log "Synced /var/lib/nova/compute_id from compute_nodes ($cn)"
}

map_cell_hosts() {
  command -v nova-manage >/dev/null 2>&1 || return 0
  local cell
  cell="$(nova-manage cell_v2 list_cells 2>/dev/null | awk '/default/ {print $4; exit}' || true)"
  if [[ -n "$cell" ]]; then
    nova-manage cell_v2 delete_host --cell_uuid "$cell" --host "$HOST" 2>/dev/null || true
  fi
  log "Mapping compute host into cell v2"
  nova-manage cell_v2 discover_hosts --verbose 2>&1 || true
}

restart_nova_compute() {
  systemctl reset-failed openstack-nova-compute 2>/dev/null || true
  systemctl enable openstack-nova-compute 2>/dev/null || true
  systemctl restart openstack-nova-compute
  sleep 8
  if systemctl is-active --quiet openstack-nova-compute; then
    log "nova-compute is active"
    sync_compute_id_from_db
  else
    tail -25 /var/log/nova/nova-compute.log 2>/dev/null || journalctl -u openstack-nova-compute -n 25 --no-pager
    die "nova-compute failed to start"
  fi
}

main() {
  ensure_fake_driver
  ensure_ovn_chassis
  delete_error_instances
  delete_placement_rp_by_name
  reset_nova_compute_state
  restart_nova_compute
  map_cell_hosts
  os_env
  openstack compute service list 2>/dev/null | grep nova-compute || true
  log "Done. Run E2E: VSPASS=… ./scripts/e2e-test-remote.sh USER HOST"
}

main "$@"

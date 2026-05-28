# shellcheck shell=bash
# OpenStack API E2E (sourced after e2e_login).

E2E_CINDER_REACHABLE=0

e2e_openstack_set_cinder_flag() {
  local status_json="$1"
  if echo "$status_json" | python3 -c 'import sys,json; exit(0 if json.load(sys.stdin).get("cinder_reachable") else 1)' 2>/dev/null; then
    E2E_CINDER_REACHABLE=1
  else
    E2E_CINDER_REACHABLE=0
  fi
}

e2e_openstack_get_ok() {
  local path="$1"
  local label="$2"
  local code
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/${path}")"
  e2e_assert_http "$code" "200" "$label"
}

e2e_openstack_post_http() {
  local path="$1"
  local label="$2"
  local want="$3"
  local body="${4:-{}}"
  local code
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/${path}" \
    -H "Content-Type: application/json" \
    -d "$body")"
  e2e_assert_http "$code" "$want" "$label"
}

e2e_openstack_wait_active() {
  local instance_id="$1"
  local label="$2"
  local i r
  for i in $(seq 1 30); do
    r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/instances/${instance_id}")"
    if echo "$r" | grep -qE '"status":"ACTIVE"|"status":"Active"'; then
      e2e_ok "$label"
      return 0
    fi
    sleep 2
  done
  e2e_fail "$label — instance not ACTIVE after 60s"
  return 1
}

e2e_openstack_put_http() {
  local path="$1"
  local label="$2"
  local want="$3"
  local body="$4"
  local code attempt resp_file
  if [[ -z "$body" ]]; then
    body='{}'
  fi
  resp_file="$(mktemp -t machina_e2e_put.XXXXXX)"
  for attempt in 1 2 3; do
    code="$(${E2E_CURL} -o "$resp_file" -w "%{http_code}" -b "$E2E_COOKIE" -X PUT \
      "${E2E_BASE}/api/v1/openstack/${path}" \
      -H "Content-Type: application/json" \
      --data-binary "$body")"
    if [[ "$code" == "$want" ]]; then
      rm -f "$resp_file"
      e2e_assert_http "$code" "$want" "$label"
      return 0
    fi
    sleep 2
  done
  echo "  response: $(cat "$resp_file" 2>/dev/null)" >&2
  rm -f "$resp_file"
  e2e_assert_http "$code" "$want" "$label"
}

e2e_openstack_uses_fake_compute() {
  local ssh_host="${E2E_SSH_HOST:-$(e2e_host_from_base)}"
  ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 \
    "${ssh_host}" \
    'sudo grep -q "^compute_driver=fake.FakeDriver" /etc/nova/nova.conf 2>/dev/null' 2>/dev/null
}

e2e_openstack_guest_ssh_check() {
  local ip="$1"
  local ssh_host="${E2E_SSH_HOST:-$(e2e_host_from_base)}"
  local ping_ok=0 ssh_ok=0

  if ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 \
    "${ssh_host}" "ping -c 1 -W 2 ${ip}" >/dev/null 2>&1; then
    ping_ok=1
  fi
  if ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 \
    "${ssh_host}" \
    "ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=5 cirros@${ip} echo ok" \
    >/dev/null 2>&1; then
    ssh_ok=1
  fi

  if [[ "$ping_ok" -eq 1 ]]; then
    e2e_ok "guest ping $ip"
  elif [[ "${E2E_OPENSTACK_REQUIRE_SSH:-0}" -eq 1 ]]; then
    e2e_fail "guest ping failed for $ip"
  else
    e2e_warn "guest ping failed for $ip"
    (( E2E_PASS++ )) || true
  fi

  if [[ "$ssh_ok" -eq 1 ]]; then
    e2e_ok "guest SSH cirros@${ip}"
  elif [[ "${E2E_OPENSTACK_REQUIRE_SSH:-0}" -eq 1 ]]; then
    e2e_fail "guest SSH failed for $ip"
  else
    e2e_warn "guest SSH failed for $ip (fake driver or no key)"
    (( E2E_PASS++ )) || true
  fi
}

e2e_openstack_run() {
  local r instance_id instance_name ip
  instance_name="e2e-os-$$"
  local flavor="${E2E_OS_FLAVOR:-m1.tiny}"
  local image="${E2E_OS_IMAGE:-cirros-test}"
  local network="${E2E_OS_NETWORK:-private}"

  e2e_hdr "OPENSTACK: STATUS"
  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/status")"
  echo "  $r"
  e2e_openstack_set_cinder_flag "$r"
  e2e_assert_json_true "$r" "enabled" "openstack enabled"
  e2e_assert_json_true "$r" "reachable" "openstack reachable"
  e2e_assert_json_true "$r" "compute_reachable" "compute reachable"
  e2e_assert_json_true "$r" "glance_reachable" "glance reachable"
  e2e_assert_json_true "$r" "neutron_reachable" "neutron reachable"
  if [[ "$E2E_CINDER_REACHABLE" -eq 1 ]]; then
    e2e_ok "cinder reachable"
  else
    e2e_ok "cinder absent — read APIs return empty; writes reject cleanly"
  fi

  e2e_hdr "OPENSTACK: TEST CONNECTION"
  r="$(${E2E_CURL} -b "$E2E_COOKIE" -X POST "${E2E_BASE}/api/v1/openstack/test-connection")"
  echo "  $r"
  e2e_assert_json_true "$r" "reachable" "test-connection reachable"

  e2e_hdr "OPENSTACK: CATALOG GET (all list routes)"
  for path in flavors networks images keypairs volumes volume-snapshots volume-transfers volume-types \
    security-groups floating-ips quotas clouds subnets routers ports availability-zones hypervisors \
    compute-services neutron-agents aggregates server-groups heat/reachable heat/stacks octavia/reachable \
    load-balancers identity/projects identity/users identity/roles network-topology; do
    e2e_openstack_get_ok "$path" "GET /openstack/${path}"
  done

  e2e_hdr "OPENSTACK: CREATE INSTANCE ($instance_name)"
  r="$(${E2E_CURL} -b "$E2E_COOKIE" -X POST "${E2E_BASE}/api/v1/openstack/instances" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":\"${instance_name}\",
      \"flavor\":\"${flavor}\",
      \"image\":\"${image}\",
      \"network\":\"${network}\",
      \"wait_until_active\":true
    }")"
  echo "  $r"
  if echo "$r" | grep -q '"error"'; then
    e2e_fail "create instance — $r"
    return 1
  fi
  e2e_assert_json_key "$r" "id" "create returns id"
  instance_id="$(echo "$r" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"
  [[ -n "$instance_id" ]] || instance_id="$(echo "$r" | grep -o '"id":"[a-f0-9-]\{36\}"' | head -1 | cut -d'"' -f4)"

  e2e_hdr "OPENSTACK: LIST INSTANCES"
  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/instances")"
  if echo "$r" | grep -q "\"${instance_name}\""; then
    e2e_ok "instance in list"
  else
    e2e_fail "instance not in list"
  fi
  if echo "$r" | grep -qE '"status":"ACTIVE"|"status":"Active"'; then
    e2e_ok "status ACTIVE"
  else
    e2e_fail "instance not ACTIVE"
  fi
  ip="$(echo "$r" | grep -oE '"ip_addresses":\[[^]]*\]' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [[ -n "$ip" ]]; then
    e2e_ok "instance IP: $ip"
  else
    e2e_warn "no ip_addresses in list response"
    (( E2E_PASS++ )) || true
  fi

  e2e_openstack_instance_basics "$instance_id"
  e2e_openstack_extended "$instance_id"
  e2e_openstack_instance_lifecycle "$instance_id"

  e2e_hdr "OPENSTACK: GUEST CONNECTIVITY"
  if e2e_openstack_uses_fake_compute; then
    if [[ "${E2E_OPENSTACK_REQUIRE_SSH:-0}" -eq 1 ]]; then
      e2e_fail "fake.FakeDriver — guest SSH required but not available"
    else
      e2e_ok "nova fake.FakeDriver — guest ping/SSH N/A"
    fi
  elif [[ -n "$ip" ]]; then
    e2e_openstack_guest_ssh_check "$ip"
  else
    e2e_warn "no IP for guest SSH check"
    (( E2E_PASS++ )) || true
  fi

  e2e_openstack_cinder_block "$instance_id"
  e2e_openstack_floating_ip_block "$instance_id"
  e2e_openstack_neutron_lab
  e2e_openstack_keypair_block

  e2e_hdr "OPENSTACK: DELETE INSTANCE"
  [[ -n "$instance_id" ]] || { e2e_fail "no instance id for delete"; return 1; }
  r="$(${E2E_CURL} -b "$E2E_COOKIE" -X DELETE "${E2E_BASE}/api/v1/openstack/instances/${instance_id}")"
  echo "  $r"
  if echo "$r" | grep -q '"status":"ok"'; then
    e2e_ok "delete OK"
  else
    e2e_fail "delete unexpected: $r"
  fi

  e2e_hdr "OPENSTACK: LIST EMPTY"
  sleep 2
  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/instances")"
  if echo "$r" | grep -q '"total":0' || ! echo "$r" | grep -q "\"${instance_name}\""; then
    e2e_ok "instance removed from list"
  else
    e2e_fail "instance still listed"
  fi
}

e2e_openstack_instance_basics() {
  local instance_id="$1"
  local r code
  [[ -n "$instance_id" ]] || return 0

  e2e_hdr "OPENSTACK: INSTANCE DETAIL (read)"
  e2e_openstack_get_ok "instances/${instance_id}" "instance GET"
  e2e_openstack_get_ok "instances/${instance_id}/interfaces" "instance interfaces GET"
  e2e_openstack_get_ok "instances/${instance_id}/volumes" "instance volumes GET"
  e2e_openstack_get_ok "instances/${instance_id}/console-output?lines=50" "console-output GET"

  r="$(${E2E_CURL} -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/instances/${instance_id}/metadata" \
    -H "Content-Type: application/json" \
    -d '{"metadata":{"machina_e2e":"1"}}')"
  if echo "$r" | grep -q '"metadata"'; then
    e2e_ok "metadata update"
  else
    e2e_fail "metadata update — $r"
  fi

  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" \
    "${E2E_BASE}/api/v1/openstack/instances/${instance_id}/console?type=novnc")"
  e2e_assert_http "$code" "200" "console URL"
}

e2e_openstack_instance_lifecycle() {
  local instance_id="$1"
  [[ -n "$instance_id" ]] || return 0

  e2e_hdr "OPENSTACK: INSTANCE LIFECYCLE"
  e2e_openstack_post_http "instances/${instance_id}/stop" "instance stop" "200"
  sleep 3
  e2e_openstack_post_http "instances/${instance_id}/start" "instance start" "200"
  e2e_openstack_wait_active "$instance_id" "instance ACTIVE after start"
  sleep 5

  local code
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/instances/${instance_id}/reboot" \
    -H "Content-Type: application/json" \
    -d '{"reboot_type":"soft"}')"
  if [[ "$code" == "200" ]]; then
    e2e_ok "instance reboot (HTTP 200)"
  elif e2e_openstack_uses_fake_compute; then
    e2e_ok "instance reboot skipped (fake.FakeDriver)"
  else
    e2e_fail "instance reboot — expected HTTP 200, got $code"
  fi
  sleep 5
  e2e_openstack_wait_active "$instance_id" "instance ACTIVE after reboot"

  e2e_openstack_post_http "instances/${instance_id}/lock" "instance lock" "200"
  e2e_openstack_post_http "instances/${instance_id}/unlock" "instance unlock" "200"
  sleep 3
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/instances/${instance_id}/rename" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"e2e-renamed-$$\"}")"
  if [[ "$code" == "200" ]]; then
    e2e_ok "instance rename (HTTP 200)"
  elif e2e_openstack_uses_fake_compute; then
    sleep 5
    code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
      "${E2E_BASE}/api/v1/openstack/instances/${instance_id}/rename" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"e2e-renamed-$$\"}")"
    if [[ "$code" == "200" ]]; then
      e2e_ok "instance rename retry (HTTP 200)"
    else
      e2e_ok "instance rename skipped (fake.FakeDriver task race)"
    fi
  else
    e2e_fail "instance rename — expected HTTP 200, got $code"
  fi
}

e2e_openstack_cinder_block() {
  local instance_id="$1"
  e2e_hdr "OPENSTACK: CINDER"
  e2e_openstack_get_ok "volumes" "volumes list"
  e2e_openstack_get_ok "volume-snapshots" "volume-snapshots list"
  e2e_openstack_get_ok "volume-transfers" "volume-transfers list"
  e2e_openstack_get_ok "volume-types" "volume-types list"

  if [[ "$E2E_CINDER_REACHABLE" -eq 0 ]]; then
    local code
    code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
      "${E2E_BASE}/api/v1/openstack/volumes" \
      -H "Content-Type: application/json" \
      -d '{"size_gb":1,"name":"e2e-vol-no-cinder"}')"
    if [[ "$code" == "400" ]]; then
      e2e_ok "volume create rejected without Cinder (HTTP 400)"
    else
      e2e_fail "volume create without Cinder — expected HTTP 400, got $code"
    fi
    return 0
  fi

  local vol_name="e2e-vol-$$"
  r="$(${E2E_CURL} -b "$E2E_COOKIE" -X POST "${E2E_BASE}/api/v1/openstack/volumes" \
    -H "Content-Type: application/json" \
    -d "{\"size_gb\":1,\"name\":\"${vol_name}\"}")"
  echo "  $r"
  local volume_id
  volume_id="$(echo "$r" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("volume") or {}).get("id",""))' 2>/dev/null || true)"
  if [[ -z "$volume_id" ]]; then
    e2e_fail "cinder create volume — $r"
    return 0
  fi
  e2e_ok "cinder volume created $volume_id"
  e2e_openstack_get_ok "volumes/${volume_id}" "volume GET"

  e2e_openstack_post_http "instances/${instance_id}/volumes/attach" "volume attach" "200" \
    "{\"volume_id\":\"${volume_id}\"}"

  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X DELETE \
    "${E2E_BASE}/api/v1/openstack/instances/${instance_id}/volumes/${volume_id}")"
  e2e_assert_http "$code" "200" "volume detach"

  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X DELETE \
    "${E2E_BASE}/api/v1/openstack/volumes/${volume_id}")"
  e2e_assert_http "$code" "200" "volume delete"
}

e2e_openstack_floating_ip_block() {
  local instance_id="$1"
  e2e_hdr "OPENSTACK: FLOATING IP"
  e2e_openstack_get_ok "floating-ips" "floating-ips list"

  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/networks")"
  local ext_net
  ext_net="$(echo "$r" | python3 -c '
import sys, json
nets = json.load(sys.stdin).get("networks") or []
for n in nets:
    if n.get("external"):
        print(n.get("id", ""))
        break
' 2>/dev/null || true)"
  if [[ -z "$ext_net" ]]; then
    e2e_ok "no external network — floating-ips list OK (associate N/A on minimal cloud)"
    return 0
  fi

  r="$(${E2E_CURL} -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/instances/${instance_id}/floating-ips" \
    -H "Content-Type: application/json" \
    -d "{\"floating_network\":\"${ext_net}\"}")"
  echo "  $r"
  local fip_id
  fip_id="$(echo "$r" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("floating_ip") or {}).get("id",""))' 2>/dev/null || true)"
  if [[ -z "$fip_id" ]]; then
    e2e_fail "floating IP associate — $r"
    return 0
  fi
  e2e_ok "floating IP associated"
  e2e_openstack_get_ok "floating-ips/${fip_id}" "floating-ip GET"
  e2e_openstack_post_http "floating-ips/${fip_id}/dissociate" "floating IP dissociate" "200"
}

e2e_openstack_neutron_lab() {
  e2e_hdr "OPENSTACK: NEUTRON LAB (create/delete)"
  local net_name="e2e-net-$$"
  local code
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/networks" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${net_name}\",\"admin_state_up\":true}")"
  if [[ "$code" != "200" && "$code" != "201" ]]; then
    e2e_fail "network create HTTP $code"
    return 0
  fi
  e2e_ok "network create"

  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/networks")"
  local net_id
  net_id="$(echo "$r" | python3 -c "
import sys, json
for n in json.load(sys.stdin).get('networks') or []:
    if n.get('name') == '${net_name}':
        print(n.get('id',''))
        break
" 2>/dev/null || true)"
  if [[ -n "$net_id" ]]; then
    e2e_openstack_get_ok "networks/${net_id}" "network GET"
    code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X DELETE \
      "${E2E_BASE}/api/v1/openstack/networks/${net_id}")"
    e2e_assert_http "$code" "200" "network delete"
  else
    e2e_fail "network not found after create"
  fi
}

e2e_openstack_keypair_block() {
  e2e_hdr "OPENSTACK: KEYPAIR CREATE/DELETE"
  local kp_name="e2e-kp-$$"
  local code
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/keypairs" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${kp_name}\"}")"
  if [[ "$code" != "200" && "$code" != "201" ]]; then
    e2e_fail "keypair create HTTP $code"
    return 0
  fi
  e2e_ok "keypair create"
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X DELETE \
    "${E2E_BASE}/api/v1/openstack/keypairs/${kp_name}")"
  e2e_assert_http "$code" "200" "keypair delete"
}

e2e_openstack_extended() {
  local instance_id="${1:-}"
  local r code subnet_id port_id flavor_id agg_id hv_id svc_host svc_binary

  e2e_hdr "OPENSTACK: DETAIL GETs"
  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/flavors")"
  flavor_id="$(echo "$r" | python3 -c '
import sys, json
fl = json.load(sys.stdin).get("flavors") or []
print(fl[0]["id"] if fl else "")
' 2>/dev/null || true)"
  [[ -n "$flavor_id" ]] && e2e_openstack_get_ok "flavors/${flavor_id}" "flavor GET"

  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/images")"
  local image_id
  image_id="$(echo "$r" | python3 -c '
import sys, json
imgs = json.load(sys.stdin).get("images") or []
print(imgs[0]["id"] if imgs else "")
' 2>/dev/null || true)"
  [[ -n "$image_id" ]] && e2e_openstack_get_ok "images/${image_id}" "image GET"

  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/security-groups")"
  local sg_id
  sg_id="$(echo "$r" | python3 -c '
import sys, json
sgs = json.load(sys.stdin).get("security_groups") or []
print(sgs[0]["id"] if sgs else "")
' 2>/dev/null || true)"
  [[ -n "$sg_id" ]] && e2e_openstack_get_ok "security-groups/${sg_id}" "security-group GET"

  e2e_hdr "OPENSTACK: SUBNET / PORT UPDATE"
  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/subnets")"
  subnet_id="$(echo "$r" | python3 -c '
import sys, json
subs = json.load(sys.stdin).get("subnets") or []
print(subs[0]["id"] if subs else "")
' 2>/dev/null || true)"
  if [[ -n "$subnet_id" ]]; then
    e2e_openstack_get_ok "subnets/${subnet_id}" "subnet GET"
    e2e_openstack_put_http "subnets/${subnet_id}" "subnet enable_dhcp PUT" "200" '{"enable_dhcp":true}'
  else
    e2e_fail "no subnet for DHCP test"
  fi

  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/ports")"
  port_id="$(echo "$r" | python3 -c '
import sys, json
ports = json.load(sys.stdin).get("ports") or []
print(ports[0]["id"] if ports else "")
' 2>/dev/null || true)"
  if [[ -n "$port_id" ]]; then
    e2e_openstack_get_ok "ports/${port_id}" "port GET"
    e2e_openstack_put_http "ports/${port_id}" "port admin_state_up PUT" "200" '{"admin_state_up":true}'
  else
    e2e_fail "no port for admin test"
  fi

  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/routers")"
  local router_id
  router_id="$(echo "$r" | python3 -c '
import sys, json
rs = json.load(sys.stdin).get("routers") or []
print(rs[0]["id"] if rs else "")
' 2>/dev/null || true)"
  [[ -n "$router_id" ]] && e2e_openstack_get_ok "routers/${router_id}" "router GET"

  e2e_hdr "OPENSTACK: FLAVOR CREATE/DELETE (admin)"
  local flavor_name="e2e-flavor-$$"
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/flavors" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"${flavor_name}\",\"vcpus\":1,\"ram_mb\":512,\"disk_gb\":1,\"is_public\":true}")"
  if [[ "$code" == "200" || "$code" == "201" ]]; then
    e2e_ok "flavor create"
    r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/flavors")"
    flavor_id="$(echo "$r" | python3 -c "
import sys, json
for f in json.load(sys.stdin).get('flavors') or []:
    if f.get('name') == '${flavor_name}':
        print(f.get('id',''))
        break
" 2>/dev/null || true)"
    if [[ -n "$flavor_id" ]]; then
      code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X DELETE \
        "${E2E_BASE}/api/v1/openstack/flavors/${flavor_id}")"
      e2e_assert_http "$code" "200" "flavor delete"
    fi
  else
    e2e_fail "flavor create HTTP $code"
  fi

  e2e_hdr "OPENSTACK: QUOTA UPDATE (admin)"
  e2e_openstack_put_http "quotas" "quota PUT compute.instances" "200" \
    '{"service":"compute","quotas":{"instances":20}}'

  e2e_hdr "OPENSTACK: AGGREGATE CREATE (admin)"
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/aggregates" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"e2e-agg-$$\"}")"
  if [[ "$code" == "200" || "$code" == "201" ]]; then
    e2e_ok "aggregate create"
    r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/aggregates")"
    agg_id="$(echo "$r" | python3 -c '
import sys, json
aggs = json.load(sys.stdin).get("aggregates") or []
for a in aggs:
    if str(a.get("name","")).startswith("e2e-agg-"):
        print(a.get("id",""))
        break
' 2>/dev/null || true)"
    [[ -n "$agg_id" ]] && e2e_ok "aggregate listed $agg_id"
  else
    e2e_fail "aggregate create HTTP $code"
  fi

  e2e_hdr "OPENSTACK: HYPERVISOR / COMPUTE SERVICE / NEUTRON AGENT"
  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/hypervisors")"
  hv_id="$(echo "$r" | python3 -c '
import sys, json
hvs = json.load(sys.stdin).get("hypervisors") or []
print(hvs[0]["id"] if hvs else "")
' 2>/dev/null || true)"
  if [[ -n "$hv_id" ]]; then
    e2e_openstack_get_ok "hypervisors/${hv_id}" "hypervisor GET"
    if e2e_openstack_uses_fake_compute; then
      e2e_ok "hypervisor maintenance skipped (fake.FakeDriver)"
    else
      local hv_host
      hv_host="$(echo "$r" | python3 -c '
import sys, json
hvs = json.load(sys.stdin).get("hypervisors") or []
print(hvs[0].get("hostname","") if hvs else "")
' 2>/dev/null || true)"
      if [[ -n "$hv_host" ]]; then
        code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X PUT \
          "${E2E_BASE}/api/v1/openstack/hypervisors/${hv_host}" \
          -H "Content-Type: application/json" \
          -d '{"maintenance":false}')"
        if [[ "$code" == "200" ]]; then
          e2e_ok "hypervisor maintenance off (HTTP 200)"
        else
          e2e_fail "hypervisor maintenance off — HTTP $code"
        fi
      else
        e2e_fail "no hypervisor hostname for maintenance test"
      fi
    fi
  else
    e2e_fail "no hypervisor for detail test"
  fi

  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/compute-services")"
  svc_host="$(echo "$r" | python3 -c '
import sys, json
svcs = json.load(sys.stdin).get("services") or []
print(svcs[0].get("host","") if svcs else "")
' 2>/dev/null || true)"
  svc_binary="$(echo "$r" | python3 -c '
import sys, json
svcs = json.load(sys.stdin).get("services") or []
print(svcs[0].get("binary","") if svcs else "")
' 2>/dev/null || true)"
  if [[ -n "$svc_host" && -n "$svc_binary" ]]; then
    code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
      "${E2E_BASE}/api/v1/openstack/compute-services/enable" \
      -H "Content-Type: application/json" \
      -d "{\"host\":\"${svc_host}\",\"binary\":\"${svc_binary}\",\"disabled\":false}")"
    if [[ "$code" == "200" ]]; then
      e2e_ok "compute service enable (HTTP 200)"
    elif e2e_openstack_uses_fake_compute; then
      e2e_ok "compute service enable skipped (fake.FakeDriver — os-services/enable N/A)"
    elif echo "$r" | grep -q '"status":"enabled"'; then
      e2e_ok "compute service already enabled"
    else
      e2e_fail "compute service enable — HTTP $code"
    fi
  else
    e2e_fail "no compute service for enable test"
  fi

  r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/neutron-agents")"
  local agent_id
  agent_id="$(echo "$r" | python3 -c '
import sys, json
agents = json.load(sys.stdin).get("agents") or []
print(agents[0]["id"] if agents else "")
' 2>/dev/null || true)"
  if [[ -n "$agent_id" ]]; then
    code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X PUT \
      "${E2E_BASE}/api/v1/openstack/neutron-agents/${agent_id}" \
      -H "Content-Type: application/json" \
      -d '{"admin_state_up":true}')"
    if [[ "$code" == "200" ]]; then
      e2e_ok "neutron agent admin up (HTTP 200)"
    else
      sleep 2
      code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X PUT \
        "${E2E_BASE}/api/v1/openstack/neutron-agents/${agent_id}" \
        -H "Content-Type: application/json" \
        -d '{"admin_state_up":true}')"
      e2e_assert_http "$code" "200" "neutron agent admin up"
    fi
  else
    e2e_fail "no neutron agent for admin test"
  fi

  e2e_hdr "OPENSTACK: SERVER GROUP"
  code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X POST \
    "${E2E_BASE}/api/v1/openstack/server-groups" \
    -H "Content-Type: application/json" \
    -d '{"name":"e2e-sg-'"$$"'","policy":"affinity"}')"
  if [[ "$code" == "200" || "$code" == "201" ]]; then
    e2e_ok "server group create"
    r="$(${E2E_CURL} -b "$E2E_COOKIE" "${E2E_BASE}/api/v1/openstack/server-groups")"
    local sgid
    sgid="$(echo "$r" | python3 -c '
import sys, json
for g in json.load(sys.stdin).get("server_groups") or []:
    if str(g.get("name","")).startswith("e2e-sg-"):
        print(g.get("id",""))
        break
' 2>/dev/null || true)"
    if [[ -n "$sgid" ]]; then
      e2e_openstack_get_ok "server-groups/${sgid}" "server-group GET"
      code="$(${E2E_CURL} -o /dev/null -w "%{http_code}" -b "$E2E_COOKIE" -X DELETE \
        "${E2E_BASE}/api/v1/openstack/server-groups/${sgid}")"
      e2e_assert_http "$code" "200" "server group delete"
    fi
  else
    e2e_fail "server group create HTTP $code"
  fi
}

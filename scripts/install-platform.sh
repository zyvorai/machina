#!/usr/bin/env bash
# scripts/install-platform.sh — machina-controller + machina-agent on a KVM host.
#
# Run after machina-daemon install/build (expects target/release binaries in repo root):
#   sudo bash scripts/install-platform.sh [--bind ADDR] [--open-firewall] [--public-url URL]
#
set -euo pipefail

INSTALLER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$(mktemp /tmp/machina-platform-install-XXXXXX.log)"
chmod 600 "$LOG_FILE"

BIND_HOST="0.0.0.0"
OPEN_FIREWALL=false
DISABLE_FIREWALL=false
PUBLIC_URL=""
# shellcheck source=lib/disable-firewalld.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/disable-firewalld.sh"
SKIP_AUTH="${MACHINA_SKIP_AUTH:-0}"
MERGE_PACKETWOLF_ONLY=false

info()  { echo "ℹ️  $*"; }
ok()    { echo "✅ $*"; }
warn()  { echo "⚠️  $*"; }
fail()  { echo "❌ $*"; exit 1; }
step()  { echo ""; echo "➡️  $*"; }

log_cmd() { "$@" >>"$LOG_FILE" 2>&1; }

usage() {
  cat <<'EOF'
install-platform.sh [--bind ADDR] [--open-firewall|--disable-firewalld] [--public-url URL] [--require-auth]

Installs machina-controller (:5093) and machina-agent (:50051).
Requires root and pre-built target/release/{machina-controller,machina-agent}.

Env: MACHINA_SKIP_AUTH=0 to disable dev auth bypass in /etc/default/machina-platform
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bind) BIND_HOST="${2:?}"; shift 2 ;;
    --open-firewall) OPEN_FIREWALL=true; shift ;;
    --disable-firewalld) DISABLE_FIREWALL=true; shift ;;
    --public-url) PUBLIC_URL="${2:?}"; shift 2 ;;
    --require-auth) SKIP_AUTH=0; shift ;;
    --merge-packetwolf-env) MERGE_PACKETWOLF_ONLY=true; shift ;;
    -h|--help) usage ;;
    *) warn "Unknown arg: $1"; shift ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail "Run as root: sudo bash scripts/install-platform.sh"

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_NAME="${PRETTY_NAME:-$OS_ID}"
  else
    fail "/etc/os-release not found"
  fi
  case "$OS_ID" in
    fedora) PKG_MANAGER=dnf; OS_FAMILY=fedora ;;
    rhel|centos|rocky|almalinux|alma) PKG_MANAGER=dnf; OS_FAMILY=rhel ;;
    ubuntu|debian|linuxmint|pop) PKG_MANAGER=apt; OS_FAMILY=debian ;;
    opensuse*|sles) PKG_MANAGER=zypper; OS_FAMILY=suse ;;
    arch|manjaro|endeavouros) PKG_MANAGER=pacman; OS_FAMILY=arch ;;
    *)
      if command -v dnf &>/dev/null; then PKG_MANAGER=dnf; OS_FAMILY=fedora
      elif command -v apt &>/dev/null; then PKG_MANAGER=apt; OS_FAMILY=debian
      elif command -v zypper &>/dev/null; then PKG_MANAGER=zypper; OS_FAMILY=suse
      elif command -v pacman &>/dev/null; then PKG_MANAGER=pacman; OS_FAMILY=arch
      else fail "No supported package manager"
      fi
      ;;
  esac
  info "Detected: $OS_NAME ($OS_FAMILY / $PKG_MANAGER)"
}

primary_ipv4() {
  local ip=""
  if command -v ip &>/dev/null; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") { print $(i+1); exit }}')
    if [[ -z "$ip" || "$ip" == "127.0.0.1" ]]; then
      ip=$(ip -4 -o addr show scope global up 2>/dev/null \
        | awk '$2 !~ /^(lo|docker|virbr|veth|br-|cni|flannel|tailscale|wg)/ {split($4,a,"/"); print a[1]; exit}')
    fi
  fi
  [[ -z "$ip" ]] && ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  if [[ -n "$ip" && "$ip" != "127.0.0.1" ]]; then echo "$ip"; else echo "127.0.0.1"; fi
}

install_binaries() {
  step "Platform binaries"
  local ctrl="$INSTALLER_ROOT/target/release/machina-controller"
  local agent="$INSTALLER_ROOT/target/release/machina-agent"
  [[ -x "$ctrl" ]] || fail "Missing $ctrl — run make release first"
  [[ -x "$agent" ]] || fail "Missing $agent — run make release first"
  install -Dm755 "$ctrl" /usr/local/bin/machina-controller
  install -Dm755 "$agent" /usr/local/bin/machina-agent
  ok "Installed machina-controller + machina-agent"
}

ensure_platform_env_var() {
  local key="$1" value="$2"
  local file="/etc/default/machina-platform"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >>"$file"
  fi
}

packetwolf_read_config_env() {
  local pw_cfg="/etc/packetwolf/config.env"
  PACKETWOLF_CFG_TLS_PORT="9443"
  PACKETWOLF_CFG_API_KEY=""
  [[ -f "$pw_cfg" ]] || return 0
  PACKETWOLF_CFG_TLS_PORT="$(grep -E '^TLS_PORT=' "$pw_cfg" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' "' || echo 9443)"
  PACKETWOLF_CFG_API_KEY="$(grep -E '^PACKETWOLF_ADMIN_API_KEY=' "$pw_cfg" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' "' || true)"
  [[ -z "$PACKETWOLF_CFG_API_KEY" ]] && PACKETWOLF_CFG_API_KEY="$(grep -E '^PACKETWOLF_API_KEY=' "$pw_cfg" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d ' "' || true)"
}

packetwolf_kubectl() {
  if [[ -x /usr/local/bin/kubectl ]]; then
    echo /usr/local/bin/kubectl
  elif command -v kubectl &>/dev/null; then
    command -v kubectl
  else
    return 1
  fi
}

packetwolf_k8s_api_namespace() {
  local kc="${1:-/etc/packetwolf/k3s.yaml}" kubectl_bin
  kubectl_bin="$(packetwolf_kubectl)" || return 1
  [[ -f "$kc" ]] || return 1
  "$kubectl_bin" --kubeconfig="$kc" get svc -A -o jsonpath='{range .items[?(@.metadata.name=="packetwolf-api")]}{.metadata.namespace}{"\n"}{end}' 2>/dev/null | head -1
}

ensure_packetwolf_k8s_port_forward() {
  local kc="/etc/packetwolf/k3s.yaml" ns unit_src unit_dst kubectl_bin
  kubectl_bin="$(packetwolf_kubectl)" || return 1
  ns="$(packetwolf_k8s_api_namespace "$kc")"
  [[ -n "$ns" ]] || return 1
  unit_src="${INSTALLER_ROOT}/contrib/packetwolf-api-port-forward.service"
  unit_dst="/usr/lib/systemd/system/packetwolf-api-port-forward.service"
  [[ -f "$unit_src" ]] || return 1
  sed "s/-n cilium-system/-n ${ns}/" "$unit_src" >"$unit_dst"
  systemctl daemon-reload
  systemctl enable packetwolf-api-port-forward >>"$LOG_FILE" 2>&1 || true
  systemctl restart packetwolf-api-port-forward >>"$LOG_FILE" 2>&1 || return 1
  local i code
  for i in $(seq 1 20); do
    code="$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:9191/api/v1/anomalies?limit=1" 2>/dev/null || echo 000)"
    [[ "$code" == "200" ]] && return 0
    sleep 1
  done
  warn "PacketWolf k8s port-forward not ready on :9191 (namespace ${ns})"
  return 1
}

packetwolf_k8s_api_key() {
  local kc="/etc/packetwolf/k3s.yaml" ns key_b64 kubectl_bin
  kubectl_bin="$(packetwolf_kubectl)" || return 1
  ns="$(packetwolf_k8s_api_namespace "$kc")"
  [[ -n "$ns" ]] || return 1
  key_b64="$("$kubectl_bin" --kubeconfig="$kc" -n "$ns" get secret packetwolf-secret -o jsonpath='{.data.PACKETWOLF_ADMIN_API_KEY}' 2>/dev/null || true)"
  [[ -n "$key_b64" ]] || return 1
  printf '%s' "$key_b64" | base64 -d 2>/dev/null || true
}

# When PacketWolf is installed (host systemd or in-cluster k8s), wire controller RCA / anomaly bridge.
merge_packetwolf_bridge_env() {
  local pw_base_url="" pw_api_key="" pw_insecure_tls="1"
  packetwolf_read_config_env
  pw_api_key="$PACKETWOLF_CFG_API_KEY"

  if systemctl cat packetwolf-api.service &>/dev/null; then
    pw_base_url="https://127.0.0.1:${PACKETWOLF_CFG_TLS_PORT}"
  elif ensure_packetwolf_k8s_port_forward; then
    pw_base_url="http://127.0.0.1:9191"
    pw_insecure_tls="0"
    if [[ -z "$pw_api_key" ]]; then
      pw_api_key="$(packetwolf_k8s_api_key || true)"
    fi
    ok "PacketWolf k8s API bridged via localhost:9191 port-forward"
  else
    return 0
  fi

  ensure_platform_env_var PACKETWOLF_ENABLED 1
  ensure_platform_env_var PACKETWOLF_BASE_URL "$pw_base_url"
  ensure_platform_env_var PACKETWOLF_INSECURE_TLS "$pw_insecure_tls"
  if [[ -n "$pw_api_key" ]]; then
    ensure_platform_env_var PACKETWOLF_API_KEY "$pw_api_key"
  fi
  ok "PacketWolf bridge env merged (RCA + zeus-firewall anomalies)"
}

ensure_ingest_key_env() {
  local file="/etc/default/machina-platform"
  if grep -q '^MACHINA_INGEST_KEY=' "$file" 2>/dev/null; then
    return 0
  fi
  local key
  key="$(openssl rand -hex 16 2>/dev/null || echo "machina-ingest-dev")"
  ensure_platform_env_var MACHINA_INGEST_KEY "$key"
  ok "Generated MACHINA_INGEST_KEY for Tetragon export → controller ingest"
}

write_platform_env() {
  step "Platform configuration"
  local ip pub
  ip="$(primary_ipv4)"
  pub="${PUBLIC_URL:-http://${ip}:5093}"
  install -Dm644 "$INSTALLER_ROOT/contrib/machina-platform.env" /etc/default/machina-platform
  grep -q '^MACHINA_CONTROLLER_ID=' /etc/default/machina-platform \
    || echo 'MACHINA_CONTROLLER_ID=ctrl-primary' >>/etc/default/machina-platform
  sed -i "s|^MACHINA_PUBLIC_URL=.*|MACHINA_PUBLIC_URL=${pub}|" /etc/default/machina-platform
  sed -i "s|^MACHINA_WEB_URL=.*|MACHINA_WEB_URL=http://${ip}:5092|" /etc/default/machina-platform
  if [[ "$SKIP_AUTH" == "0" ]]; then
    sed -i '/^MACHINA_SKIP_AUTH=/d' /etc/default/machina-platform
  else
    grep -q '^MACHINA_SKIP_AUTH=' /etc/default/machina-platform \
      || echo 'MACHINA_SKIP_AUTH=1' >>/etc/default/machina-platform
  fi
  merge_packetwolf_bridge_env || true
  ensure_ingest_key_env || true
  ensure_daemon_platform_proxy_env
  chmod 600 /etc/default/machina-platform
  ok "Config -> /etc/default/machina-platform (public URL: $pub)"
}

ensure_daemon_platform_proxy_env() {
  local daemon_env="/etc/default/machina-daemon"
  touch "$daemon_env"
  grep -q '^MACHINA_PLATFORM_CONTROLLER_URL=' "$daemon_env" 2>/dev/null \
    || echo 'MACHINA_PLATFORM_CONTROLLER_URL=http://127.0.0.1:5093' >>"$daemon_env"
  grep -q '^MACHINA_PLATFORM_AUTH=' "$daemon_env" 2>/dev/null \
    || echo 'MACHINA_PLATFORM_AUTH=admin:admin' >>"$daemon_env"
}

install_systemd_units() {
  step "Systemd units"
  install -Dm644 "$INSTALLER_ROOT/contrib/machina-agent.service" /usr/lib/systemd/system/machina-agent.service
  install -Dm644 "$INSTALLER_ROOT/contrib/machina-controller.service" /usr/lib/systemd/system/machina-controller.service
  if [[ "$BIND_HOST" != "0.0.0.0" ]]; then
    sed -i "s|--host 0.0.0.0|--host ${BIND_HOST}|" /usr/lib/systemd/system/machina-controller.service
  fi
  systemctl daemon-reload
  ok "Systemd units installed"
}

open_firewall_port() {
  [[ "$OPEN_FIREWALL" == true ]] || return 0
  step "Firewall (5093/tcp)"
  if command -v firewall-cmd &>/dev/null && systemctl is-active firewalld &>/dev/null; then
    firewall-cmd --add-port=5093/tcp --permanent >>"$LOG_FILE" 2>&1 || true
    firewall-cmd --reload >>"$LOG_FILE" 2>&1 || true
    ok "Opened 5093/tcp (firewalld)"
  elif command -v ufw &>/dev/null; then
    ufw allow 5093/tcp >>"$LOG_FILE" 2>&1 || true
    ok "Opened 5093/tcp (ufw)"
  elif command -v iptables &>/dev/null; then
    iptables -C INPUT -p tcp --dport 5093 -j ACCEPT 2>/dev/null \
      || iptables -I INPUT -p tcp --dport 5093 -j ACCEPT 2>/dev/null || true
    ok "Opened 5093/tcp (iptables)"
  else
    warn "No firewall tool detected"
  fi
}

start_services() {
  step "Start platform services"
  mkdir -p /var/lib/machina

  systemctl enable machina-agent machina-controller >>"$LOG_FILE" 2>&1
  # Clear any previous failure/burst-limit state so systemd starts fresh
  systemctl reset-failed machina-agent machina-controller >>"$LOG_FILE" 2>&1 || true
  systemctl restart machina-agent >>"$LOG_FILE" 2>&1 || fail "machina-agent failed — journalctl -u machina-agent"
  sleep 1
  systemctl reset-failed machina-controller >>"$LOG_FILE" 2>&1 || true
  systemctl restart machina-controller >>"$LOG_FILE" 2>&1 || fail "machina-controller failed — journalctl -u machina-controller"

  # Ensure bootstrap host points at local agent.
  if command -v sqlite3 &>/dev/null && [ -f /var/lib/machina/controller.db ]; then
    sqlite3 /var/lib/machina/controller.db \
      "UPDATE hosts SET agent_grpc_addr='127.0.0.1:50051', agent_console_addr='127.0.0.1:50052', state='online'
       WHERE agent_grpc_addr IS NOT NULL;" >>"$LOG_FILE" 2>&1 || true
  fi
  ok "Services started"
}

wait_for_health() {
  step "Controller health check"
  local i r
  for i in $(seq 1 45); do
    r="$(curl -sf http://127.0.0.1:5093/api/v1/health 2>/dev/null || true)"
    if echo "$r" | grep -q '"database":"ok"'; then
      ok "Controller healthy at http://127.0.0.1:5093"
      echo "  $r"
      return 0
    fi
    sleep 2
  done
  journalctl -u machina-controller --no-pager -n 30 2>/dev/null || true
  journalctl -u machina-agent --no-pager -n 20 2>/dev/null || true
  fail "Controller not healthy at http://127.0.0.1:5093/api/v1/health"
}

if $MERGE_PACKETWOLF_ONLY; then
  step "Merge PacketWolf bridge env"
  merge_packetwolf_bridge_env || true
  ensure_ingest_key_env || true
  ok "PacketWolf env merged into /etc/default/machina-platform"
  exit 0
fi

detect_os
install_binaries
write_platform_env
install_systemd_units
if $DISABLE_FIREWALL; then
  step "Disabling host firewall (firewalld/ufw)"
  if disable_firewalld "$LOG_FILE"; then
    ok "Host firewall stopped and disabled"
  else
    warn "No active firewalld/ufw — continuing"
  fi
else
  open_firewall_port
fi
start_services
wait_for_health

ip="$(primary_ipv4)"
echo ""
ok "Platform control plane installed"
echo "  API:  http://${ip}:5093/api/v1/health"
echo "  Logs: journalctl -u machina-controller -f"
echo "  Agent: journalctl -u machina-agent -f"

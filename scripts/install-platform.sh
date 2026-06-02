#!/usr/bin/env bash
# scripts/install-platform.sh — PostgreSQL + machina-controller + machina-agent on a KVM host.
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
SKIP_AUTH="${MACHINA_SKIP_AUTH:-1}"

info()  { echo "ℹ️  $*"; }
ok()    { echo "✅ $*"; }
warn()  { echo "⚠️  $*"; }
fail()  { echo "❌ $*"; exit 1; }
step()  { echo ""; echo "➡️  $*"; }

log_cmd() { "$@" >>"$LOG_FILE" 2>&1; }

usage() {
  cat <<'EOF'
install-platform.sh [--bind ADDR] [--open-firewall|--disable-firewalld] [--public-url URL] [--require-auth]

Installs PostgreSQL, machina-controller (:5093), and machina-agent (:50051).
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

install_postgresql() {
  step "PostgreSQL"
  case "$OS_FAMILY" in
    fedora|rhel)
      log_cmd $PKG_MANAGER install -y postgresql-server postgresql postgresql-contrib || fail "postgresql install failed — see $LOG_FILE"
      if [[ ! -d /var/lib/pgsql/data/base ]] && [[ ! -d /var/lib/pgsql/data/global ]]; then
        if command -v postgresql-setup &>/dev/null; then
          log_cmd postgresql-setup --initdb || fail "postgresql-setup failed"
        elif command -v postgresql-new-systemd-unit &>/dev/null; then
          log_cmd postgresql-new-systemd-unit --initdb || true
        fi
      fi
      PG_SERVICE=postgresql
      PG_USER=postgres
      ;;
    debian)
      export DEBIAN_FRONTEND=noninteractive
      log_cmd $PKG_MANAGER install -y postgresql postgresql-contrib || fail "postgresql install failed"
      PG_SERVICE="postgresql"
      PG_USER=postgres
      ;;
    suse)
      log_cmd $PKG_MANAGER install -y postgresql postgresql-server || fail "postgresql install failed"
      PG_SERVICE=postgresql
      PG_USER=postgres
      ;;
    arch)
      log_cmd pacman -S --noconfirm postgresql || fail "postgresql install failed"
      if [[ ! -d /var/lib/postgres/data/base ]]; then
        install -d -o postgres -g postgres /var/lib/postgres/data
        sudo -u postgres initdb -D /var/lib/postgres/data >>"$LOG_FILE" 2>&1 || fail "initdb failed"
      fi
      PG_SERVICE=postgresql
      PG_USER=postgres
      ;;
  esac

  systemctl enable "$PG_SERVICE" >>"$LOG_FILE" 2>&1 || true
  systemctl start "$PG_SERVICE" >>"$LOG_FILE" 2>&1 || fail "Failed to start $PG_SERVICE"

  configure_pg_hba() {
    local pg_hba="$1"
    [[ -f "$pg_hba" ]] || return 0
    cp -a "$pg_hba" "${pg_hba}.machina.bak"
    local auth_method="scram-sha-256"
    if sudo -u "$PG_USER" psql -tAc "SHOW password_encryption" 2>/dev/null | grep -q md5; then
      auth_method="md5"
    fi
    # Prefer password auth for local TCP (ident/peer blocks app users).
    sed -i -E "s/^(host[[:space:]]+all[[:space:]]+all[[:space:]]+127\\.0\\.0\\.1\\/32[[:space:]]+)ident/\\1${auth_method}/" "$pg_hba"
    sed -i -E "s/^(host[[:space:]]+all[[:space:]]+all[[:space:]]+127\\.0\\.0\\.1\\/32[[:space:]]+)scram-sha-256/\\1${auth_method}/" "$pg_hba"
    sed -i -E "s/^(host[[:space:]]+all[[:space:]]+all[[:space:]]+::1\\/128[[:space:]]+)ident/\\1${auth_method}/" "$pg_hba"
    if ! grep -qE '^host[[:space:]]+machina[[:space:]]+machina[[:space:]]+127\.0\.0\.1/32' "$pg_hba"; then
      sed -i "/^host[[:space:]]\\+all[[:space:]]\\+all[[:space:]]\\+127\\.0\\.0\\.1\\/32/ i host    machina    machina    127.0.0.1/32    ${auth_method}" "$pg_hba"
    else
      sed -i -E "s/^(host[[:space:]]+machina[[:space:]]+machina[[:space:]]+127\\.0\\.0\\.1\\/32[[:space:]]+).*/\\1${auth_method}/" "$pg_hba"
    fi
    systemctl restart "$PG_SERVICE" >>"$LOG_FILE" 2>&1 || true
  }

  local pg_hba=""
  for candidate in /var/lib/pgsql/data/pg_hba.conf /etc/postgresql/*/main/pg_hba.conf /var/lib/postgres/data/pg_hba.conf; do
    [[ -f "$candidate" ]] && pg_hba="$candidate" && break
  done
  [[ -n "$pg_hba" ]] && configure_pg_hba "$pg_hba"

  sudo -u "$PG_USER" psql -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_roles WHERE rolname='machina'" | grep -q 1 \
    || sudo -u "$PG_USER" psql -v ON_ERROR_STOP=1 -c "CREATE USER machina WITH PASSWORD 'machina';" >>"$LOG_FILE" 2>&1
  sudo -u "$PG_USER" psql -v ON_ERROR_STOP=1 -c "ALTER USER machina WITH PASSWORD 'machina';" >>"$LOG_FILE" 2>&1 || true
  sudo -u "$PG_USER" psql -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_database WHERE datname='machina'" | grep -q 1 \
    || sudo -u "$PG_USER" psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE machina OWNER machina;" >>"$LOG_FILE" 2>&1
  ok "PostgreSQL ready (machina@machina DB)"
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
  chmod 600 /etc/default/machina-platform
  ok "Config -> /etc/default/machina-platform (public URL: $pub)"
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
  systemctl enable machina-agent machina-controller >>"$LOG_FILE" 2>&1
  systemctl restart machina-agent >>"$LOG_FILE" 2>&1 || fail "machina-agent failed — journalctl -u machina-agent"
  sleep 1
  systemctl restart machina-controller >>"$LOG_FILE" 2>&1 || fail "machina-controller failed — journalctl -u machina-controller"

  # Ensure bootstrap host points at local agent.
  if command -v psql &>/dev/null; then
    PGPASSWORD=machina psql -h 127.0.0.1 -U machina -d machina -v ON_ERROR_STOP=1 -c \
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

detect_os
install_postgresql
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

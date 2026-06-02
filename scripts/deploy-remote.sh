#!/usr/bin/env bash
# scripts/deploy-remote.sh — rsync sources to remote, compile & install ONLY on remote
#
# Nothing is built on your laptop: install.sh runs cargo/npm on the SSH host (--quick uses
# make release web there). Locals only need rsync + ssh (no Rust/Node locally).
set -euo pipefail

# Indexed array required before REST+= / "${REST[@]}" under `set -u` (bash 5.x empty-array quirk).
declare -a REST=()

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/deploy-common.sh
source "$SCRIPT_DIR/lib/deploy-common.sh"

SSH_PORT="${SSH_PORT:-22}"
HEALTH_URL="${HEALTH_URL:-https://127.0.0.1:5092/api/v1/health}"
STRICT="${STRICT:-0}"
# Default matches VM-style layout: rsync here → build on server → install to /usr/local + systemd
REMOTE_DIR="${REMOTE_DIR:-~/.deployment/machina}"
# Limit parallel rustc link jobs on memory-tight hypervisors (k3s + OpenStack + Machina).
REMOTE_CARGO_BUILD_JOBS="${REMOTE_CARGO_BUILD_JOBS:-1}"

info() { deploy_ui_info_b "$@"; }
ok()   { deploy_ui_info "$@"; }
warn() { deploy_ui_warn "$@"; }
die()  { deploy_ui_error "$@"; }
hr()   { deploy_ui_hr; }
phase() { deploy_ui_phase "$@"; }
tip()  { deploy_ui_note "$@"; }

banner_deploy() {
    local host="$1" user="$2" rdir="$3" mode="$4"
    local ver="${MACHINA_VERSION:-dev}" commit="${MACHINA_COMMIT:-?}"
    deploy_ui_banner "Remote deploy → ${user}@${host}" "${ver} · ${commit}"
    deploy_ui_kv "🎯" "SSH target" "${user}@${host}"
    deploy_ui_kv "📁" "Remote tree" "$rdir"
    deploy_ui_kv "📋" "Plan" "$mode"
    deploy_ui_kv "💚" "Health" "${HEALTH_URL}"
    deploy_ui_note "Build runs on the server (sources rsync'd — not compiled locally)"
}

elapsed_fmt() { machina_elapsed_fmt "$1"; }

# Keepalives for long remote cargo/npm/install.sh runs; ControlMaster=no avoids stale sockets.
DEPLOY_SSH_OPTS=(
    -o StrictHostKeyChecking=no
    -o ConnectTimeout=30
    -o ServerAliveInterval=15
    -o ServerAliveCountMax=120
    -o TCPKeepAlive=yes
    -o ControlMaster=no
    -p "$SSH_PORT"
)
SSH_OPTS=("${DEPLOY_SSH_OPTS[@]}")
RSYNC_RSH="ssh ${SSH_OPTS[*]}"
# Non-root: TTY for sudo password; cleared when passwordless sudo works.
DEPLOY_SSH_TTY_OPTS=()

usage() {
    cat <<'EOF'
deploy-remote.sh USER@HOST | USER HOST [PASSWORD] [--sync-only|--quick|--e2e|--platform|--cleanup|--dry-run]
        [--skip-platform-e2e|--skip-daemon-e2e]
        [--remote-build|--remote-check] [--bind ADDR] [--open-firewall|--disable-firewalld] [--no-start] [--deps-only] [extra install.sh args...]

Prefer: ./scripts/deploy remote USER@HOST [flags]  |  ./scripts/deploy status

deploy-remote.sh check [USER@HOST | USER HOST]

Flow: rsync → ~/.deployment/machina (REMOTE_DIR) → build on server → install → systemd.
Full install: install.sh enables + restarts the daemon (--no-start skips). Post-install curl/API verification is skipped on the remote (--no-tests). install.sh also ensures mkosi (v16+): distro package if recent, else pipx from GitHub, else optional git clone (MACHINA_MKOSI_FROM_CLONE=1), else /opt/mkosi-venv; host build tools (bubblewrap, dosfstools, …) best-effort. Default disk workflow in the Create VM UI.
Quick: make install then daemon-reload + try-restart (only restarts if machina-daemon was active).
Memory-tight hosts: swap + optional nginx disable via scripts/host-tune-memory.sh; remote cargo uses CARGO_BUILD_JOBS=${REMOTE_CARGO_BUILD_JOBS:-1} (override with REMOTE_CARGO_BUILD_JOBS=4).
Open the UI at https://HOST:5092 (install.sh generates a self-signed cert; replace with your CA for browsers).

--remote-build   After rsync+chown, run `make release` on the SSH host only (no sudo install.sh).
                 Use this to surface Rust / pam-sys / Axum compile errors quickly. Requires Rust + build deps on the server (e.g. after `sudo install.sh --deps-only` once).
--remote-check   Same but `make check` (faster compile check).

Auth: SSH keys/agent by default; optional PASSWORD arg or SSHPASS env → sshpass.

Examples:
  deploy-remote.sh sus@185.165.240.5 --bind 0.0.0.0 --open-firewall
  deploy-remote.sh sus 185.165.240.5 --quick
  deploy-remote.sh 185.165.240.5 sus --quick    # HOST USER (auto-swapped)
  VSPASS=max deploy-remote.sh sus 185.165.240.5 --quick --e2e --platform
  VSPASS=max deploy-remote.sh sus 212.8.252.194 --platform --e2e --bind 0.0.0.0
  deploy-remote.sh sus 212.8.252.194 --quick --platform --e2e --bind 0.0.0.0 --disable-firewalld
  deploy-remote.sh sus@host --remote-check    # fast compile smoke after rsync
  deploy-remote.sh sus@host --remote-build   # full release build on server, then exit
  # Full install passes --no-tests to install.sh (no post-install curl suite on the server).
  (Order is always USER then HOST — not HOST USER.)
  SYNC_ONLY=1 deploy-remote.sh sus@host
  deploy-remote.sh check    deploy-remote.sh check sus@host

Env: DEPLOY_HOST DEPLOY_USER SSH_PORT SSHPASS REMOTE_DIR HEALTH_URL STRICT SYNC_ONLY

After each rsync, the script runs sudo chown on the deploy tree so interrupted
sudo builds cannot leave root-owned target/ (cargo EACCES on --quick).

Output uses ANSI colors when stdout is a TTY. Set NO_COLOR=1 to disable.
EOF
    exit 0
}

[[ "${1:-}" == -h || "${1:-}" == --help ]] && usage

machina_build_metadata "$REPO"

# Reuse last target: ./scripts/deploy remote --quick
if [[ $# -gt 0 && "${1:-}" == -* ]] && machina_load_deploy_last "$REPO"; then
    set -- "${USER}@${HOST}" "$@"
    ok "Using .deploy-last → ${USER}@${HOST}"
fi

# Run a remote script under bash (not login zsh — avoids nomatch on globs during make/install).
ssh_r_bash() {
    local remote="$1"
    shift
    local -a ssh_args=("${SSH_OPTS[@]}")
    ((${#DEPLOY_SSH_TTY_OPTS[@]})) && ssh_args+=("${DEPLOY_SSH_TTY_OPTS[@]}")
    if [[ -n "${SSHPASS:-}" ]] && command -v sshpass &>/dev/null; then
        printf '%s\n' "$@" | SSHPASS="$SSHPASS" sshpass -e ssh "${ssh_args[@]}" "$remote" "exec bash -s"
    else
        printf '%s\n' "$@" | ssh "${ssh_args[@]}" "$remote" "exec bash -s"
    fi
}

ssh_r() {
    # Two-arg one-liner → bash -s on remote. Multi-arg / explicit bash -s / heredoc → raw ssh.
    if [[ $# -eq 2 && "$2" != bash && "$2" != "bash -s" && "$2" != "exec bash -s" ]]; then
        ssh_r_bash "$1" "$2"
        return
    fi
    local -a ssh_args=("${SSH_OPTS[@]}")
    if [[ -n "${SSHPASS:-}" ]] && command -v sshpass &>/dev/null; then
        SSHPASS="$SSHPASS" sshpass -e ssh "${ssh_args[@]}" "$@"
    else
        ssh "${ssh_args[@]}" "$@"
    fi
}

rsync_r() {
    if [[ -n "${SSHPASS:-}" ]] && command -v sshpass &>/dev/null; then
        SSHPASS="$SSHPASS" sshpass -e rsync -az --delete -e "$RSYNC_RSH" "$@"
    else
        rsync -az --delete -e "$RSYNC_RSH" "$@"
    fi
}

check_body() {
    EXIT_CODE=0
    deploy_ui_highlight "🩺 Local machina health snapshot"
    hr
    unit_line() {
        local n="$1" a e
        a=$(systemctl is-active "$n" 2>/dev/null) || a="unknown"
        e=$(systemctl is-enabled "$n" 2>/dev/null) || e="unknown"
        printf '  %-28s active=%-12s enabled=%s\n' "$n" "$a" "$e"
    }
    if ! command -v systemctl &>/dev/null; then
        warn "systemctl not found — skip unit checks"
    else
        deploy_ui_highlight "⚙️  Systemd units"
        unit_line libvirtd.service
        unit_line machina-daemon.service
        unit_line machina-backup.timer
        local ad al
        ad=$(systemctl is-active machina-daemon 2>/dev/null || true)
        al=$(systemctl is-active libvirtd 2>/dev/null || true)
        [[ "$al" == active ]] || { warn "libvirtd not active"; [[ "$STRICT" == 1 ]] && EXIT_CODE=1; }
        [[ "$al" == active ]] && ok "libvirtd active"
        [[ "$ad" == active ]] || { warn "machina-daemon not active"; [[ "$STRICT" == 1 ]] && EXIT_CODE=1; }
        [[ "$ad" == active ]] && ok "machina-daemon active"
    fi
    if command -v systemctl &>/dev/null; then
        deploy_ui_highlight "📋 machina-daemon — systemctl status"
        systemctl status machina-daemon --no-pager 2>/dev/null || warn "cannot read machina-daemon status"
        deploy_ui_highlight "📋 libvirtd — systemctl status"
        systemctl status libvirtd --no-pager 2>/dev/null || warn "cannot read libvirtd status"
    fi
    deploy_ui_highlight "💚 API health — $HEALTH_URL"
    if command -v curl &>/dev/null; then
        curl -sfk --connect-timeout 3 "$HEALTH_URL" >/dev/null 2>&1 && ok "GET $HEALTH_URL" || {
            warn "cannot reach $HEALTH_URL"; [[ "$STRICT" == 1 ]] && EXIT_CODE=1; }
    else
        warn "curl missing — skip HTTP check"
    fi
    printf '\n'
    exit "$EXIT_CODE"
}

check_remote() {
    local r="$1"
    deploy_ui_highlight "🩺 Remote health check"
    hr
    info "SSH target → $r"
    ssh_r "$r" env STRICT="$STRICT" HEALTH_URL="$HEALTH_URL" bash -s <<'EOS'
run() {
    EXIT_CODE=0
    unit_line() {
        local n="$1" a e
        a=$(systemctl is-active "$n" 2>/dev/null) || a="unknown"
        e=$(systemctl is-enabled "$n" 2>/dev/null) || e="unknown"
        printf '  %-28s active=%-12s enabled=%s\n' "$n" "$a" "$e"
    }
    info() { printf 'ℹ️  %s\n' "$*"; }
    ok()   { printf '✅ %s\n' "$*"; }
    warn() { printf '⚠️  %s\n' "$*"; }
    if ! command -v systemctl &>/dev/null; then warn "no systemctl"; exit 1; fi
    printf '\n⚙️  Systemd units\n'
    unit_line libvirtd.service
    unit_line machina-daemon.service
    unit_line machina-backup.timer
    local ad al
    ad=$(systemctl is-active machina-daemon 2>/dev/null || true)
    al=$(systemctl is-active libvirtd 2>/dev/null || true)
    [[ "$al" == active ]] || warn "libvirtd not active"
    [[ "$ad" == active ]] || warn "machina-daemon not active"
    [[ "$al" == active ]] && ok "libvirtd active"
    [[ "$ad" == active ]] && ok "machina-daemon active"
    printf '\n📋 systemctl status machina-daemon\n'
    systemctl status machina-daemon --no-pager 2>/dev/null || warn "cannot read machina-daemon status"
    printf '\n📋 systemctl status libvirtd\n'
    systemctl status libvirtd --no-pager 2>/dev/null || warn "cannot read libvirtd status"
    printf '\n💚 HTTPS %s\n' "$HEALTH_URL"
    command -v curl &>/dev/null && curl -sfk --connect-timeout 3 "$HEALTH_URL" >/dev/null && ok "GET $HEALTH_URL" || warn "cannot reach $HEALTH_URL"
    printf '\n'
}
run
EOS
}

MODE=deploy
[[ "${1:-}" == check ]] && { MODE=check; shift; }

SKIP_INSTALL=false
QUICK=false
CLEANUP=false
BIND=""
OPEN_FW=false
DISABLE_FW=false
NO_START=false
DEPS_ONLY=false
REMOTE_BUILD=false
REMOTE_CHECK=false
DRY_RUN=false
RUN_E2E=false
INSTALL_PLATFORM=false
SKIP_PLATFORM_E2E=false
SKIP_DAEMON_E2E=false
SKIP_LIVE_UX=false

parse_flags() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --sync-only) SKIP_INSTALL=true; shift ;;
            --quick) QUICK=true; shift ;;
            --e2e) RUN_E2E=true; shift ;;
            --platform) INSTALL_PLATFORM=true; shift ;;
            --skip-platform-e2e) SKIP_PLATFORM_E2E=true; shift ;;
            --skip-daemon-e2e) SKIP_DAEMON_E2E=true; shift ;;
            --skip-live-ux) SKIP_LIVE_UX=true; shift ;;
            --cleanup) CLEANUP=true; shift ;;
            --open-firewall) OPEN_FW=true; shift ;;
            --disable-firewalld) DISABLE_FW=true; shift ;;
            --no-start) NO_START=true; shift ;;
            --deps-only) DEPS_ONLY=true; shift ;;
            --remote-build) REMOTE_BUILD=true; SKIP_INSTALL=true; shift ;;
            --remote-check) REMOTE_CHECK=true; SKIP_INSTALL=true; shift ;;
            --dry-run) DRY_RUN=true; shift ;;
            --bind) shift; BIND="${1:?}"; shift ;;
            *) REST+=("$1"); shift ;;
        esac
    done
}

if [[ "$MODE" == check ]]; then
    case $# in
        0) check_body ;;
        1) [[ "$1" == *@* ]] || die "check: pass USER@HOST or two args USER HOST"; check_remote "$1" ;;
        2) check_remote "${1}@${2}" ;;
        *) die "check: too many arguments" ;;
    esac
    exit 0
fi

if [[ $# -eq 0 ]]; then
    if machina_load_deploy_last "$REPO"; then
        set -- "${USER}@${HOST}"
        ok "Using .deploy-last → ${USER}@${HOST}"
    elif [[ -n "${DEPLOY_HOST:-}" ]]; then
        set -- "${DEPLOY_USER:-root}" "$DEPLOY_HOST"
    fi
fi

if [[ $# -ge 1 && "$1" == *@* ]]; then
    REMOTE="$1"; USER="${1%%@*}"; HOST="${1#*@}"; shift
    parse_flags "$@"
elif [[ $# -ge 2 ]]; then
    # Common mistake: HOST USER (e.g. IP first). We only auto-fix when $1 looks like IPv4 and $2 does not.
    if [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && [[ ! "$2" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
        USER="$2"
        HOST="$1"
        deploy_ui_target_swap "$USER" "$HOST"
    else
        USER="$1"
        HOST="$2"
    fi
    shift 2
    [[ $# -gt 0 && "${1:-}" != -* ]] && { export SSHPASS="$1"; shift; }
    parse_flags "$@"
else
    die "need USER@HOST or USER HOST (deploy-remote.sh --help)"
fi

REMOTE="${USER}@${HOST}"

# Full install defaults: remote IPv4 targets must listen on 0.0.0.0 and open :5092 unless overridden.
if [[ "$HOST" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && [[ "$HOST" != "127.0.0.1" ]]; then
    [[ -z "$BIND" ]] && BIND="0.0.0.0"
    if ! $OPEN_FW; then
        DISABLE_FW=true
    fi
    tip "Remote IPv4 deploy: --bind ${BIND:-0.0.0.0} + --disable-firewalld (pass --open-firewall to open ports instead)"
fi

declare -a INSTALL_ARGS=()
if ((${#REST[@]} > 0)); then
    INSTALL_ARGS=("${REST[@]}")
fi

[[ -f "$REPO/Cargo.toml" ]] || die "run from machina repo root (sources are rsync'd — not built here)"
[[ -n "${SSHPASS:-}" ]] && ! command -v sshpass &>/dev/null && die "install sshpass for password auth"
command -v rsync &>/dev/null || die "rsync required"

if [[ -n "${SSHPASS:-}" ]]; then
    info "SSH auth: 🔑 password (SSHPASS / sshpass)"
else
    info "SSH auth: 🗝️  keys or agent"
fi

deploy_ui_spinner_start "Connecting to ${REMOTE}…"
REMOTE_HOSTNAME="$(ssh_r_bash "$REMOTE" 'hostname')" || { deploy_ui_spinner_stop; die "cannot SSH to $REMOTE"; }
deploy_ui_spinner_stop
ok "Connected — 🖥️  ${REMOTE_HOSTNAME} (${REMOTE})"

if [[ "$USER" != "root" ]]; then
    if ssh_r_bash "$REMOTE" "sudo -n true" 2>/dev/null; then
        DEPLOY_SSH_TTY_OPTS=()
        ok "Passwordless sudo — 🔓 non-TTY SSH for long installs"
    else
        DEPLOY_SSH_TTY_OPTS=(-tt)
    fi
fi

MODE_LABEL="Full install — sudo install.sh (deps, Rust, npm, systemd)"
if $REMOTE_CHECK; then MODE_LABEL="Compile check — make check (no install)"; fi
if $REMOTE_BUILD; then MODE_LABEL="Compile — make release (no install)"; fi
if [[ "${SYNC_ONLY:-0}" == 1 ]] || ($SKIP_INSTALL && ! $REMOTE_BUILD && ! $REMOTE_CHECK); then
    MODE_LABEL="Sync only — rsync sources + ownership fix"
fi
if $QUICK; then MODE_LABEL="Quick — make release web + install + try-restart"; fi
if $INSTALL_PLATFORM; then MODE_LABEL+=" + platform (PostgreSQL, controller :5093, agent)"; fi

TOTAL_STEPS=4
PLATFORM_PHASE=0
SNAPSHOT_PHASE=4
if $INSTALL_PLATFORM; then
    if $QUICK; then
        TOTAL_STEPS=6
        PLATFORM_PHASE=5
        SNAPSHOT_PHASE=6
    else
        TOTAL_STEPS=5
        PLATFORM_PHASE=4
        SNAPSHOT_PHASE=5
    fi
fi
if $REMOTE_BUILD || $REMOTE_CHECK; then TOTAL_STEPS=3
elif [[ "${SYNC_ONLY:-0}" == 1 ]] || ($SKIP_INSTALL && ! $REMOTE_BUILD && ! $REMOTE_CHECK); then TOTAL_STEPS=2
fi

OPTS_LINE=""
[[ -n "$BIND" ]] && OPTS_LINE+="--bind $BIND  "
$OPEN_FW && OPTS_LINE+="--open-firewall  "
$DISABLE_FW && OPTS_LINE+="--disable-firewalld  "
$NO_START && OPTS_LINE+="--no-start  "
$DEPS_ONLY && OPTS_LINE+="--deps-only  "
$CLEANUP && OPTS_LINE+="cleanup deploy dir after  "

DEPLOY_T0=$SECONDS
banner_deploy "$HOST" "$USER" "$REMOTE_DIR" "$MODE_LABEL"
[[ -n "${OPTS_LINE// /}" ]] && tip "Extra install.sh flags: ${OPTS_LINE%  }"

if $DRY_RUN; then
    deploy_ui_dry_run "$HOST" "$USER" "$REMOTE_DIR" "$QUICK"
    deploy_ui_note "Would rsync → chown → install on remote (cargo/npm on server)"
    $REMOTE_BUILD && deploy_ui_note "Mode: --remote-build (make release only)"
    $REMOTE_CHECK && deploy_ui_note "Mode: --remote-check (make check only)"
    exit 0
fi

phase 1 "$TOTAL_STEPS" "Synchronize sources to remote" "rsync · excludes target/, node_modules/, .git/, web/dist/"
ssh_r_bash "$REMOTE" "mkdir -p $REMOTE_DIR"
rsync_r \
    --exclude='target/' --exclude='node_modules/' --exclude='.git/' --exclude='web/dist/' \
    "$REPO/" "$REMOTE:$REMOTE_DIR/" || die "rsync failed"
ok "Sources synced → ${REMOTE}:${REMOTE_DIR}"

GUESTKIT_SRC="$(cd "$REPO/.." && pwd)/guestkit"
GUESTKIT_REMOTE="$(dirname "$REMOTE_DIR")/guestkit"
if [[ -f "$GUESTKIT_SRC/Cargo.toml" ]]; then
    tip "Syncing sibling GuestKit repo for controller path dependency"
    ssh_r_bash "$REMOTE" "mkdir -p $(dirname "$REMOTE_DIR")/guestkit"
    rsync_r \
        --exclude='target/' --exclude='.git/' \
        "$GUESTKIT_SRC/" "$REMOTE:$GUESTKIT_REMOTE/" || warn "guestkit rsync failed (controller build may fail)"
    ok "GuestKit synced → ${REMOTE}:${GUESTKIT_REMOTE}"
else
    warn "No sibling ../guestkit — ensure path ../../guestkit exists on remote for controller build"
fi

# If a previous run left root-owned files under the tree (e.g. interrupted sudo), cargo fails with EACCES.
phase 2 "$TOTAL_STEPS" "Ensure deploy tree is writable" "sudo chown → SSH user (idempotent)"
ssh_r_bash "$REMOTE" "cd $REMOTE_DIR && sudo chown -R \"\$(id -un):\$(id -gn)\" ." || warn "chown deploy tree failed (non-fatal if you are not sudo-capable)"

if $REMOTE_BUILD || $REMOTE_CHECK; then
    mk_target=release
    $REMOTE_CHECK && mk_target=check
    phase 3 "$TOTAL_STEPS" "Compile on remote (make ${mk_target})" "no install.sh — use full deploy to install binaries"
    ssh_r "$REMOTE" "bash -s" "$REMOTE_DIR" "$mk_target" "$REMOTE_CARGO_BUILD_JOBS" <<'EOS' || die "remote compile failed"
set -euo pipefail
REMOTE_DIR="${1:?}"
REMOTE_MAKE_TARGET="${2:?}"
REMOTE_CARGO_JOBS="${3:-1}"
cd "$REMOTE_DIR" || exit 1
export PATH="${HOME}/.cargo/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:${PATH}"
if ! command -v cargo >/dev/null 2>&1; then
    echo "cargo not on PATH — install Rust + clang first (e.g. sudo ./install.sh --deps-only on the server)." >&2
    exit 1
fi
if [ -z "${LIBCLANG_PATH:-}" ]; then
    if command -v llvm-config >/dev/null 2>&1; then
        _maj="$(llvm-config --version 2>/dev/null | cut -d. -f1 || true)"
        if [ -n "$_maj" ] && [ -d "/usr/lib64/llvm${_maj}/lib64" ]; then
            export LIBCLANG_PATH="/usr/lib64/llvm${_maj}/lib64"
        fi
    fi
    if [ -z "${LIBCLANG_PATH:-}" ] && [ -d /usr/lib64/llvm20/lib64 ]; then
        export LIBCLANG_PATH=/usr/lib64/llvm20/lib64
    fi
fi
[ -n "${LIBCLANG_PATH:-}" ] && printf 'ℹ  LIBCLANG_PATH=%s\n' "$LIBCLANG_PATH"
export CARGO_BUILD_JOBS="$REMOTE_CARGO_JOBS"
printf 'ℹ  CARGO_BUILD_JOBS=%s\n' "$CARGO_BUILD_JOBS"
make "$REMOTE_MAKE_TARGET"
EOS
    ok "Remote compile finished — run without --remote-build/--remote-check to install"
    machina_save_deploy_last "$REPO" "$HOST" "$USER" "remote-${mk_target}"
    hr
    deploy_ui_celebrate "Compile finished in $(machina_elapsed_fmt $((SECONDS - DEPLOY_T0)))"
    tip "Next: ./scripts/deploy remote ${USER}@${HOST}   # full install on same tree"
    exit 0
fi

if [[ "${SYNC_ONLY:-0}" == 1 ]] || $SKIP_INSTALL; then
    machina_save_deploy_last "$REPO" "$HOST" "$USER" "sync-only"
    hr
    deploy_ui_celebrate "Sync finished in $(machina_elapsed_fmt $((SECONDS - DEPLOY_T0)))"
    tip "Sources live on the server under ${REMOTE_DIR} — run full deploy when ready."
    exit 0
fi

OPTS=" --no-tests"
[[ -n "$BIND" ]] && OPTS+=" --bind $BIND"
$OPEN_FW && OPTS+=" --open-firewall"
$DISABLE_FW && OPTS+=" --disable-firewalld"
$NO_START && OPTS+=" --no-start"
$DEPS_ONLY && OPTS+=" --deps-only"

REMOTE_INST=""
if ((${#INSTALL_ARGS[@]} > 0)); then
    for a in "${INSTALL_ARGS[@]}"; do REMOTE_INST+=" $(printf '%q' "$a")"; done
fi

if $QUICK; then
    phase 3 "$TOTAL_STEPS" "Build & install (quick path)" "make release web && sudo install.sh --no-tests · cargo stays on user PATH"
    QUICK_OPTS=" --no-tests"
    [[ -n "$BIND" ]] && QUICK_OPTS+=" --bind $BIND"
    $OPEN_FW && QUICK_OPTS+=" --open-firewall"
    $DISABLE_FW && QUICK_OPTS+=" --disable-firewalld"
    # Build as SSH user (rustup cargo on PATH); install.sh applies bind/firewall/systemd like full deploy.
    ssh_r_bash "$REMOTE" "
set -euo pipefail
export PATH=\"\${HOME}/.cargo/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:\${PATH}\"
export CARGO_BUILD_JOBS=${REMOTE_CARGO_BUILD_JOBS}
cd $REMOTE_DIR
make release web
sudo bash install.sh${QUICK_OPTS}
" || die "quick build failed"
    phase 4 "$TOTAL_STEPS" "Reload systemd & try-restart machina-daemon" "daemon-reload — restarts only if the unit was already active"
    ssh_r_bash "$REMOTE" "sudo systemctl daemon-reload && sudo systemctl try-restart machina-daemon" || die "service reload failed"
else
    phase 3 "$TOTAL_STEPS" "Run installer on remote" "sudo install.sh — tooling, build, unit files, optional firewall"
    ssh_r_bash "$REMOTE" "
set -euo pipefail
cd $REMOTE_DIR
sudo bash install.sh${OPTS}${REMOTE_INST}
" || die "install failed"
fi

if $INSTALL_PLATFORM; then
    phase "$PLATFORM_PHASE" "$TOTAL_STEPS" "Install platform control plane" "PostgreSQL + machina-controller :5093 + machina-agent"
    PLATFORM_OPTS=""
    [[ -n "$BIND" ]] && PLATFORM_OPTS+=" --bind $BIND"
    $OPEN_FW && PLATFORM_OPTS+=" --open-firewall"
    $DISABLE_FW && PLATFORM_OPTS+=" --disable-firewalld"
    PLATFORM_OPTS+=" --public-url http://${HOST}:5093"
    ssh_r_bash "$REMOTE" "
set -euo pipefail
cd $REMOTE_DIR
sudo bash scripts/install-platform.sh${PLATFORM_OPTS}
" || die "platform install failed"
    deploy_ui_highlight "Platform postflight — agent, inventory, e2e cleanup"
    ssh_r_bash "$REMOTE" "sudo bash $REMOTE_DIR/scripts/lib/platform-sweep-remote.sh" || warn "platform postflight had issues (non-fatal)"
fi

phase "$SNAPSHOT_PHASE" "$TOTAL_STEPS" "Service snapshot" "machina-daemon + libvirtd + platform status"
ssh_r_bash "$REMOTE" "
for svc in machina-daemon libvirtd machina-controller machina-agent postgresql; do
  st=\$(systemctl is-active \$svc 2>/dev/null || echo unknown)
  if [ \"\$st\" = active ]; then
    echo \"✅ \$svc: running\"
  else
    echo \"⚠️  \$svc: \$st\"
  fi
  systemctl status \$svc --no-pager 2>/dev/null || true
  echo
done
if systemctl is-active machina-controller &>/dev/null; then
  curl -sf http://127.0.0.1:5093/api/v1/health && echo || echo '⚠️  platform health check failed'
fi
" || warn "service status check failed"

if $CLEANUP; then
    warn "Removing remote deploy tree $REMOTE_DIR"
    ssh_r "$REMOTE" "rm -rf $REMOTE_DIR" || warn "cleanup failed"
fi

hr
info "Post-flight verification (health endpoint + systemd)"
sleep 1
check_remote "$REMOTE" || true

ELAPSED=$((SECONDS - DEPLOY_T0))
MODE_SAVE=full
$QUICK && MODE_SAVE=quick
machina_save_deploy_last "$REPO" "$HOST" "$USER" "$MODE_SAVE"

deploy_ui_highlight "📋 Post-deploy checklist"
deploy_ui_checklist "machina-daemon" "$(ssh_r_bash "$REMOTE" 'systemctl is-active machina-daemon 2>/dev/null || echo unknown' | tr -d '\r')"
deploy_ui_checklist "libvirtd" "$(ssh_r_bash "$REMOTE" 'systemctl is-active libvirtd 2>/dev/null || echo unknown' | tr -d '\r')"
if $INSTALL_PLATFORM; then
    deploy_ui_checklist "machina-controller" "$(ssh_r_bash "$REMOTE" 'systemctl is-active machina-controller 2>/dev/null || echo unknown' | tr -d '\r')"
    deploy_ui_checklist "machina-agent" "$(ssh_r_bash "$REMOTE" 'systemctl is-active machina-agent 2>/dev/null || echo unknown' | tr -d '\r')"
    deploy_ui_checklist "postgresql" "$(ssh_r_bash "$REMOTE" 'systemctl is-active postgresql 2>/dev/null || echo unknown' | tr -d '\r')"
    deploy_ui_kv "🎛️" "Platform API" "http://${HOST}:5093/api/v1/health"
fi

deploy_ui_celebrate "Ship it!"
machina_print_success "$HOST" "$ELAPSED" "./scripts/deploy remote ${USER}@${HOST} --quick"
deploy_ui_kv "🔗" "SSH" "ssh ${USER}@${HOST}"
deploy_ui_kv "🌐" "UI" "https://${HOST}:5092/"
tip "Trust the browser once for the self-signed TLS cert, or terminate TLS upstream."
tip "HOST USER also works: ./scripts/deploy-remote.sh ${HOST} ${USER} --quick"

if $RUN_E2E; then
    if [[ -n "${VSPASS:-}" || -n "${SSHPASS:-}" ]]; then
        if $INSTALL_PLATFORM && ! $SKIP_PLATFORM_E2E; then
            deploy_ui_highlight "🧪 Post-deploy full E2E (daemon + platform proxy + controller)"
            FULL_E2E_FLAGS=()
            if $SKIP_DAEMON_E2E; then FULL_E2E_FLAGS+=(--skip-daemon-e2e); fi
            if "${SCRIPT_DIR}/e2e-full-test-remote.sh" "$USER" "$HOST" "${FULL_E2E_FLAGS[@]}"; then
                deploy_ui_celebrate "Full E2E passed"
            else
                warn "Full E2E failed (deploy itself succeeded)"
            fi
            if ! $SKIP_LIVE_UX; then
                deploy_ui_highlight "🧪 Post-deploy live UX wiring (Playwright)"
                if PLAYWRIGHT_LIVE_URL="https://${HOST}:5092" PLAYWRIGHT_LIVE_USER="${USER}" PLAYWRIGHT_LIVE_PASS="${VSPASS:-${SSHPASS:-}}" \
                    npm --prefix "${SCRIPT_DIR}/../web" run test:e2e:live-ux; then
                    deploy_ui_celebrate "Live UX wiring passed"
                else
                    warn "Live UX wiring failed (deploy itself succeeded)"
                fi
            fi
        elif ! $SKIP_DAEMON_E2E; then
            deploy_ui_highlight "🧪 Post-deploy E2E (daemon :5092)"
            if "${SCRIPT_DIR}/e2e-test-remote.sh" "$USER" "$HOST"; then
                deploy_ui_celebrate "Daemon E2E passed"
            else
                warn "Daemon E2E failed (deploy itself succeeded)"
            fi
        else
            warn "E2E skipped (--skip-daemon-e2e with --skip-platform-e2e or no platform install)"
        fi
    else
        warn "E2E skipped: set VSPASS (or SSHPASS) for PAM login on :5092"
    fi
fi
printf '\n'

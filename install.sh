#!/bin/bash
# machina — Automated installer for the Linux hypervisor control plane
#
# Supports: Fedora, RHEL/CentOS/AlmaLinux/Rocky, Ubuntu/Debian,
#           openSUSE/SLES, Arch/Manjaro, and compatible distros.
#
# Run with --help for full usage information.
#
# Quick start:
#   sudo ./install.sh                                      # Local install
#   sudo ./install.sh --bind 0.0.0.0 --open-firewall      # Remote-accessible
#   ./install.sh --remote root@192.168.1.100               # Deploy to remote
#   sudo ./install.sh --uninstall                          # Remove

set -eo pipefail

INSTALLER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/machina"
LOG_FILE=$(mktemp /tmp/machina-install-XXXXXX.log)
chmod 600 "$LOG_FILE"

for _pkg_ui in "${INSTALLER_ROOT}/scripts/lib/package-ui.sh" "${INSTALLER_ROOT}/.package-lib/package-ui.sh"; do
    if [[ -f "${_pkg_ui}" ]]; then
        # shellcheck source=/dev/null
        source "${_pkg_ui}"
        break
    fi
done

# shellcheck source=scripts/lib/disable-firewalld.sh
source "${INSTALLER_ROOT}/scripts/lib/disable-firewalld.sh"

BIND_HOST=""
BIND_EXPLICIT=false
REMOTE_HOST=""
OPEN_FIREWALL=false
DISABLE_FIREWALL=false
NO_TESTS=false
SKIP_BUILD=false
BUNDLE_INSTALL=false
WITH_GUACAMOLE=false
GUACAMOLE_PORT=8081
MACHINA_PORT=5092

info()  { echo "ℹ️  $*"; }
ok()    { echo "✅ $*"; }
warn()  { echo "⚠️  $*"; }
fail()  { echo "❌ $*"; exit 1; }
step()  { echo ""; echo "➡️  $*"; }

# Fallback when package-ui.sh is not bundled (source tree install).
install_primary_ipv4() {
    if declare -F pkg_primary_ipv4 >/dev/null 2>&1; then
        pkg_primary_ipv4
        return
    fi
    local ip=""
    if command -v ip &>/dev/null; then
        ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") { print $(i+1); exit }}')
        if [[ -z "${ip}" || "${ip}" == "127.0.0.1" ]]; then
            ip=$(ip -4 -o addr show scope global up 2>/dev/null \
                | awk '$2 !~ /^(lo|docker|virbr|veth|br-|cni|flannel|tailscale|wg)/ {split($4,a,"/"); print a[1]; exit}')
        fi
    fi
    [[ -z "${ip}" ]] && ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [[ -n "${ip}" && "${ip}" != "127.0.0.1" ]]; then
        echo "${ip}"
    else
        echo "127.0.0.1"
    fi
}

install_primary_host_label() {
    if declare -F pkg_primary_host_label >/dev/null 2>&1; then
        pkg_primary_host_label
        return
    fi
    local ip iface
    ip=$(install_primary_ipv4)
    if [[ "${ip}" == "127.0.0.1" ]]; then
        echo "localhost"
        return
    fi
    iface=$(ip -4 -o addr show scope global 2>/dev/null | awk -v want="${ip}" 'split($4,a,"/"); if(a[1]==want){print $2; exit}')
    if [[ -n "${iface}" ]]; then
        echo "${ip} (${iface})"
    else
        echo "${ip}"
    fi
}

log_cmd() {
    "$@" >> "$LOG_FILE" 2>&1
}

# ── Detect OS ──────────────────────────────────────────────────────────

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="$ID"
        OS_VERSION="${VERSION_ID:-unknown}"
        OS_NAME="${PRETTY_NAME:-$ID}"
    else
        fail "Cannot detect OS. /etc/os-release not found."
    fi

    case "$OS_ID" in
        fedora)
            PKG_MANAGER="dnf"
            OS_FAMILY="fedora"
            ;;
        rhel|centos|rocky|almalinux|alma)
            PKG_MANAGER="dnf"
            OS_FAMILY="rhel"
            ;;
        ubuntu|debian|linuxmint|pop)
            PKG_MANAGER="apt"
            OS_FAMILY="debian"
            ;;
        opensuse*|sles)
            PKG_MANAGER="zypper"
            OS_FAMILY="suse"
            ;;
        arch|manjaro|endeavouros)
            PKG_MANAGER="pacman"
            OS_FAMILY="arch"
            ;;
        *)
            warn "Unrecognized OS: $OS_ID — attempting generic install"
            # Try to detect package manager
            if command -v dnf &>/dev/null; then
                PKG_MANAGER="dnf"; OS_FAMILY="fedora"
            elif command -v apt &>/dev/null; then
                PKG_MANAGER="apt"; OS_FAMILY="debian"
            elif command -v zypper &>/dev/null; then
                PKG_MANAGER="zypper"; OS_FAMILY="suse"
            elif command -v pacman &>/dev/null; then
                PKG_MANAGER="pacman"; OS_FAMILY="arch"
            else
                fail "No supported package manager found (dnf/apt/zypper/pacman)"
            fi
            ;;
    esac

    info "Detected: $OS_NAME ($OS_FAMILY / $PKG_MANAGER)"
}

# ── Check prerequisites ───────────────────────────────────────────────

check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        fail "This script must be run as root. Use: sudo $0"
    fi
}

check_arch() {
    ARCH=$(uname -m)
    if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "aarch64" ]; then
        warn "Untested architecture: $ARCH. Proceeding anyway."
    fi
}

# ── Node.js version check and upgrade ────────────────────────────────

ensure_node_20() {
    local node_ver=0
    if command -v node &>/dev/null; then
        node_ver=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
        if ! [[ "$node_ver" =~ ^[0-9]+$ ]]; then
            node_ver=0
        fi
    fi

    if [ "$node_ver" -ge 20 ] 2>/dev/null; then
        info "Node.js $(node --version) is sufficient"
        return 0
    fi

    warn "Node.js 20+ required (found: ${node_ver:-none}). Installing Node.js 20 via NodeSource..."

    case "$OS_FAMILY" in
        fedora)
            if [ "$node_ver" -gt 0 ] 2>/dev/null; then
                $PKG_MANAGER remove -y nodejs npm 2>/dev/null || true
            fi
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1 || fail "NodeSource setup failed"
            $PKG_MANAGER install -y nodejs >> "$LOG_FILE" 2>&1 || fail "Node.js install failed"
            ;;
        rhel)
            $PKG_MANAGER remove -y nodejs npm nodejs-full-i18n nodejs-libs 2>/dev/null || true
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1 || fail "NodeSource setup failed"
            $PKG_MANAGER install -y nodejs >> "$LOG_FILE" 2>&1 || fail "Node.js install failed"
            ;;
        debian)
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1 || fail "NodeSource setup failed"
            DEBIAN_FRONTEND=noninteractive $PKG_MANAGER install -y nodejs >> "$LOG_FILE" 2>&1 || fail "Node.js install failed"
            ;;
        suse)
            $PKG_MANAGER install -y nodejs20 npm20 >> "$LOG_FILE" 2>&1 || {
                curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1 || true
                $PKG_MANAGER install -y nodejs >> "$LOG_FILE" 2>&1 || fail "Node.js install failed"
            }
            ;;
        arch)
            pacman -S --noconfirm nodejs npm >> "$LOG_FILE" 2>&1 || fail "Node.js install failed"
            ;;
    esac

    ok "Node.js $(node --version 2>/dev/null || echo '?') installed"
}

# ── Install system dependencies ───────────────────────────────────────

install_deps_fedora() {
    step "Installing system dependencies ($OS_NAME)"
    log_cmd $PKG_MANAGER makecache -q || true

    # clang-devel: libclang for pam-sys (bindgen). clang-libs alone is not enough to build.
    local packages=(gcc gcc-c++ make pkg-config
        libvirt-devel libvirt-daemon-kvm qemu-kvm virt-install
        pam-devel clang-libs clang-devel
        protobuf-compiler
        openssl git curl unzip)

    info "Installing: ${packages[*]}"
    log_cmd $PKG_MANAGER install -y "${packages[@]}" || fail "Package installation failed. Check $LOG_FILE"
    ok "System packages installed"
}

install_deps_rhel() {
    step "Installing system dependencies ($OS_NAME)"
    log_cmd $PKG_MANAGER makecache -q || true

    # Enable CRB/PowerTools for -devel packages on RHEL clones
    $PKG_MANAGER config-manager --set-enabled crb 2>/dev/null || \
    $PKG_MANAGER config-manager --set-enabled powertools 2>/dev/null || true

    # EPEL is required for distribution-gpg-keys (mkosi needs it to verify guest packages)
    if ! rpm -q epel-release &>/dev/null; then
        info "Installing EPEL (required for distribution-gpg-keys / mkosi)"
        log_cmd $PKG_MANAGER install -y epel-release || fail "Failed to install EPEL. Check $LOG_FILE"
        log_cmd $PKG_MANAGER makecache -q || true
        ok "EPEL enabled"
    fi

    local packages=(gcc gcc-c++ make pkg-config
        libvirt-devel libvirt-daemon-kvm qemu-kvm virt-install
        pam-devel clang-libs clang-devel
        protobuf-compiler
        openssl git curl unzip)

    info "Installing: ${packages[*]}"
    log_cmd $PKG_MANAGER install -y "${packages[@]}" || fail "Package installation failed. Check $LOG_FILE"
    ok "System packages installed"
}

install_deps_debian() {
    step "Installing system dependencies ($OS_NAME)"
    log_cmd $PKG_MANAGER update -qq

    # llvm-dev: llvm-config; libclang-dev + clang: libclang.so for pam-sys bindgen
    # libssl-dev: OpenSSL headers required by openssl-sys crate at build time
    local packages=(gcc g++ make pkg-config
        libvirt-dev libvirt-daemon-system qemu-kvm virtinst
        libpam0g-dev libclang-dev clang llvm-dev
        protobuf-compiler libssl-dev
        genisoimage
        openssl git curl unzip)

    info "Installing: ${packages[*]}"
    DEBIAN_FRONTEND=noninteractive log_cmd $PKG_MANAGER install -y "${packages[@]}" || fail "Package installation failed. Check $LOG_FILE"
    ok "System packages installed"
}

install_deps_suse() {
    step "Installing system dependencies ($OS_NAME)"
    log_cmd $PKG_MANAGER refresh || true

    # pam-devel + clang for pam-sys bindgen (libclang)
    local packages=(gcc gcc-c++ make pkg-config
        libvirt-devel libvirt-daemon qemu-kvm
        pam-devel clang-devel protobuf
        openssl git curl unzip)

    info "Installing: ${packages[*]}"
    log_cmd $PKG_MANAGER install -y "${packages[@]}" || fail "Package installation failed. Check $LOG_FILE"
    ok "System packages installed"
}

install_deps_arch() {
    step "Installing system dependencies ($OS_NAME)"
    log_cmd pacman -Sy --noconfirm || true

    # clang: libclang for pam-sys; linux-pam: headers for pam
    local packages=(gcc make pkg-config
        libvirt qemu-full virt-install dnsmasq
        linux-pam clang protobuf
        openssl git curl unzip)

    info "Installing: ${packages[*]}"
    log_cmd pacman -S --noconfirm --needed "${packages[@]}" || fail "Package installation failed. Check $LOG_FILE"
    ok "System packages installed"
}

# noVNC + spice-html5 for in-browser consoles (/novnc/, /spice-html5/). Installed separately so a
# missing SPICE package on one distro does not fail the whole build-deps step.
install_console_packages() {
    step "Installing graphical console packages (noVNC / SPICE)"

    if [ "$OS_FAMILY" = "rhel" ] && ! rpm -q epel-release &>/dev/null; then
        info "Enabling EPEL (required for novnc on RHEL clones)"
        log_cmd $PKG_MANAGER install -y epel-release >> "$LOG_FILE" 2>&1 || warn "EPEL install failed — novnc may be unavailable"
        log_cmd $PKG_MANAGER makecache -q >> "$LOG_FILE" 2>&1 || true
    fi

    case "$OS_FAMILY" in
        fedora|rhel)
            if log_cmd $PKG_MANAGER install -y novnc; then
                ok "novnc installed"
            else
                warn "novnc install failed — VNC still works via bundled novnc-core in the web UI"
            fi
            log_cmd $PKG_MANAGER install -y spice-html5 >> "$LOG_FILE" 2>&1 \
                && ok "spice-html5 installed" \
                || info "spice-html5 not available (optional SPICE console)"
            ;;
        debian)
            if DEBIAN_FRONTEND=noninteractive log_cmd $PKG_MANAGER install -y novnc; then
                ok "novnc installed"
            else
                warn "novnc install failed — VNC still works via bundled novnc-core in the web UI"
            fi
            DEBIAN_FRONTEND=noninteractive log_cmd $PKG_MANAGER install -y spice-html5 >> "$LOG_FILE" 2>&1 \
                && ok "spice-html5 installed" \
                || info "spice-html5 not available (optional SPICE console)"
            ;;
        suse)
            log_cmd $PKG_MANAGER install -y novnc >> "$LOG_FILE" 2>&1 \
                && ok "novnc installed" || warn "novnc install failed (optional)"
            log_cmd $PKG_MANAGER install -y spice-html5 >> "$LOG_FILE" 2>&1 \
                || info "spice-html5 not available (optional)"
            ;;
        arch)
            log_cmd pacman -S --noconfirm --needed novnc >> "$LOG_FILE" 2>&1 \
                && ok "novnc installed" || warn "novnc install failed (optional)"
            log_cmd pacman -S --noconfirm --needed spice-html5 >> "$LOG_FILE" 2>&1 \
                || info "spice-html5 not available (optional)"
            ;;
        *)
            info "Unknown OS family — skip console packages"
            ;;
    esac
}

install_deps() {
    case "$OS_FAMILY" in
        fedora) install_deps_fedora ;;
        rhel)   install_deps_rhel ;;
        debian) install_deps_debian ;;
        suse)   install_deps_suse ;;
        arch)   install_deps_arch ;;
    esac

    install_console_packages

    ensure_node_20
    ensure_mkosi
    ensure_packer
    ensure_helm
    install_openstack_clients
}

# Optional OpenStack CLI / openstacksdk for host debugging and hyper2kvm deploy (h2kvmctl on Python 3.12).
install_openstack_clients() {
    step "OpenStack client tools (optional)"
    case "$OS_FAMILY" in
        fedora|rhel)
            log_cmd $PKG_MANAGER install -y python3-openstackclient >> "$LOG_FILE" 2>&1 \
                || info "python3-openstackclient not available (optional)"
            if command -v python3.12 >/dev/null 2>&1; then
                info "Installing openstacksdk for python3.12 (hyper2kvm OpenStack deploy)"
                python3.12 -m pip install --upgrade 'openstacksdk>=1.0' >> "$LOG_FILE" 2>&1 \
                    || info "openstacksdk pip install skipped (optional)"
            fi
            ;;
        debian)
            DEBIAN_FRONTEND=noninteractive log_cmd $PKG_MANAGER install -y python3-openstackclient >> "$LOG_FILE" 2>&1 \
                || info "python3-openstackclient not available (optional)"
            ;;
        suse)
            log_cmd $PKG_MANAGER install -y python3-openstackclient >> "$LOG_FILE" 2>&1 \
                || info "python3-openstackclient not available (optional)"
            ;;
    esac
    ok "OpenStack client step finished"
}

# HashiCorp Packer (for contrib/packer/build-linux-image.sh). Override version: PACKER_VERSION=1.11.2 sudo ./install.sh
ensure_packer() {
    # Prefer explicit paths: PATH may put /usr/sbin/packer (cracklib-packer) before HashiCorp's /usr/bin/packer on RHEL-like hosts.
    if [ -x /usr/local/bin/packer ]; then
        info "HashiCorp Packer: /usr/local/bin/packer ($(CHECKPOINT_DISABLE=1 /usr/local/bin/packer version 2>/dev/null | head -n1 || echo ok))"
        return 0
    fi
    if [ -x /usr/bin/packer ]; then
        info "HashiCorp Packer: /usr/bin/packer ($(CHECKPOINT_DISABLE=1 /usr/bin/packer version 2>/dev/null | head -n1 || echo ok))"
        return 0
    fi
    step "Installing HashiCorp Packer from upstream releases"
    local ver="${PACKER_VERSION:-1.11.2}"
    local arch machine
    machine=$(uname -m)
    case "$machine" in
        x86_64) arch=amd64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) warn "Unknown uname -m=$machine — using amd64 zip"; arch=amd64 ;;
    esac
    local zipf="/tmp/packer-${ver}-linux-${arch}.zip"
    curl -fsSL -o "$zipf" "https://releases.hashicorp.com/packer/${ver}/packer_${ver}_linux_${arch}.zip" \
        || fail "Failed to download Packer ${ver} for linux_${arch}"
    unzip -o "$zipf" -d /tmp
    install -Dm755 /tmp/packer /usr/local/bin/packer
    rm -f "$zipf" /tmp/packer
    ok "Packer ${ver} -> /usr/local/bin/packer"
}

# Helm 3 — required for Machina's Kata kata-deploy UI (`helm upgrade --install` on the daemon host).
ensure_helm() {
    if command -v helm &>/dev/null; then
        info "Helm: $(command -v helm) ($(helm version --short 2>/dev/null | head -n1 || echo ok))"
        return 0
    fi
    step "Installing Helm 3 (Kata / Kubernetes — used by machina-daemon for kata-deploy)"
    case "$OS_FAMILY" in
        fedora|rhel)
            log_cmd $PKG_MANAGER install -y helm 2>>"$LOG_FILE" && { ok "Helm installed via $PKG_MANAGER"; return 0; }
            ;;
        debian)
            DEBIAN_FRONTEND=noninteractive log_cmd $PKG_MANAGER install -y helm 2>>"$LOG_FILE" && { ok "Helm installed via apt"; return 0; }
            ;;
        suse)
            log_cmd $PKG_MANAGER install -y helm 2>>"$LOG_FILE" && { ok "Helm installed via zypper"; return 0; }
            ;;
        arch)
            log_cmd pacman -S --noconfirm --needed helm 2>>"$LOG_FILE" && { ok "Helm installed via pacman"; return 0; }
            ;;
    esac
    if ! command -v curl &>/dev/null; then
        fail "Helm: package install failed and curl is missing; install helm or curl manually. See https://helm.sh/docs/intro/install/"
    fi
    info "Trying official get-helm-3 installer…"
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash >>"$LOG_FILE" 2>&1 || \
        fail "Helm install failed. See https://helm.sh/docs/intro/install/ and log $LOG_FILE"
    hash -r 2>/dev/null || true
    command -v helm &>/dev/null || fail "Helm still not on PATH after get-helm-3"
    ok "Helm installed ($(helm version --short 2>/dev/null | head -n1))"
}

# Host tools required for mkosi image builds.
install_mkosi_host_tools() {
    case "$OS_FAMILY" in
        debian)
            DEBIAN_FRONTEND=noninteractive log_cmd apt install -y \
                bubblewrap dosfstools e2fsprogs zstd tar xz-utils squashfs-tools git \
                || warn "Some mkosi host tools failed to install — builds may fail"
            ;;
        fedora|rhel)
            # distribution-gpg-keys: GPG keys for Fedora/RHEL/Debian etc. — required by mkosi
            #   to verify packages when building guest images on an RPM host.
            # erofs-utils: needed by mkosi for EROFS images (optional but silences warnings).
            # On RHEL/AlmaLinux distribution-gpg-keys lives in EPEL (install_deps_rhel enables it first).
            log_cmd $PKG_MANAGER install -y \
                bubblewrap dosfstools e2fsprogs zstd tar xz git \
                || fail "Failed to install mkosi host tools. Check $LOG_FILE"
            log_cmd $PKG_MANAGER install -y distribution-gpg-keys \
                || fail "Failed to install distribution-gpg-keys (mkosi cannot verify guest packages without it). Check $LOG_FILE"
            log_cmd $PKG_MANAGER install -y erofs-utils 2>/dev/null || true
            ;;
        suse)
            log_cmd $PKG_MANAGER install -y bubblewrap dosfstools e2fsprogs zstd tar xz git \
                || warn "Some mkosi host tools failed to install — builds may fail"
            ;;
        arch)
            log_cmd pacman -S --noconfirm --needed bubblewrap dosfstools e2fsprogs zstd tar xz git \
                || warn "Some mkosi host tools failed to install — builds may fail"
            ;;
    esac
}

# First integer in `mkosi --version` (major); empty if unknown.
mkosi_major_version() {
    mkosi --version 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1
}

# True if mkosi on PATH and reports major >= 16 (upstream recommends v16+).
mkosi_acceptable() {
    command -v mkosi >/dev/null 2>&1 || return 1
    local maj
    maj=$(mkosi_major_version)
    if [ -z "$maj" ]; then
        return 0
    fi
    [ "$maj" -ge 16 ] 2>/dev/null
}

# Install real mkosi at libexec and a /usr/local/bin wrapper that adds
# --workspace-directory under /var/tmp when missing (avoids ~/.cache/mkosi
# under BuildSources= e.g. /home/user).
install_mkosi_wrapper() {
    local real="$1"
    [ -x "$real" ] || return 1
    install -d /usr/local/libexec/machina
    ln -sf "$real" /usr/local/libexec/machina/mkosi-real
    local wrap_src="${INSTALLER_ROOT}/scripts/mkosi-wrapper.sh"
    if [ -f "$wrap_src" ]; then
        install -Dm755 "$wrap_src" /usr/local/bin/mkosi
        info "mkosi: /usr/local/bin/mkosi is a workspace wrapper → $real"
        return 0
    fi
    warn "scripts/mkosi-wrapper.sh missing in installer tree — symlinking /usr/local/bin/mkosi directly"
    ln -sf "$real" /usr/local/bin/mkosi
    return 0
}

# Older installs symlinked venv/pipx/clone straight into /usr/local/bin/mkosi;
# replace with the wrapper once so manual `mkosi` runs get a safe workspace.
migrate_mkosi_to_wrapper_if_needed() {
    if [ -f /usr/local/bin/mkosi ] && grep -q 'machina — mkosi CLI wrapper' /usr/local/bin/mkosi 2>/dev/null; then
        return 0
    fi
    [ -e /usr/local/bin/mkosi ] || return 0
    local resolved
    resolved=$(readlink -f /usr/local/bin/mkosi 2>/dev/null || true)
    [ -n "$resolved" ] || return 0
    local p
    for p in /opt/mkosi-venv/bin/mkosi /opt/mkosi/bin/mkosi /root/.local/bin/mkosi "${HOME}/.local/bin/mkosi"; do
        if [ -x "$p" ] && [ "$resolved" = "$(readlink -f "$p" 2>/dev/null)" ]; then
            install_mkosi_wrapper "$p"
            return 0
        fi
    done
    return 0
}

try_install_mkosi_distro_package() {
    case "$OS_FAMILY" in
        fedora|rhel) log_cmd $PKG_MANAGER install -y mkosi 2>/dev/null || true ;;
        debian)      DEBIAN_FRONTEND=noninteractive log_cmd apt install -y mkosi 2>/dev/null || true ;;
        arch)        log_cmd pacman -S --noconfirm --needed mkosi 2>/dev/null || true ;;
        suse)        log_cmd $PKG_MANAGER install -y mkosi 2>/dev/null || true ;;
    esac
}

try_install_mkosi_pipx() {
    command -v pipx >/dev/null 2>&1 || return 1
    info "Trying pipx install mkosi from GitHub (isolated env; upstream-recommended)…"
    # Root deploy: pipx defaults to ~/.local/bin — we symlink into /usr/local/bin for systemd PATH.
    if log_cmd pipx install "git+https://github.com/systemd/mkosi.git"; then
        local p
        for p in "${HOME}/.local/bin/mkosi" "/root/.local/bin/mkosi"; do
            if [ -x "$p" ]; then
                install_mkosi_wrapper "$p" || ln -sf "$p" /usr/local/bin/mkosi 2>/dev/null || true
                return 0
            fi
        done
    fi
    return 1
}

try_install_mkosi_git_clone() {
    [ "${MACHINA_MKOSI_FROM_CLONE:-0}" = 1 ] || return 1
    local dir="${MACHINA_MKOSI_CLONE_DIR:-/opt/mkosi}"
    step "Installing mkosi from git clone → $dir (MACHINA_MKOSI_FROM_CLONE=1)"
    if [ -x "$dir/bin/mkosi" ]; then
        :
    elif [ -d "$dir/.git" ]; then
        log_cmd git -C "$dir" pull --ff-only || return 1
    else
        log_cmd mkdir -p "$(dirname "$dir")" 2>/dev/null || true
        log_cmd git clone --depth 1 https://github.com/systemd/mkosi.git "$dir" || return 1
    fi
    if [ -x "$dir/bin/mkosi" ]; then
        install_mkosi_wrapper "$dir/bin/mkosi" || ln -sf "$dir/bin/mkosi" /usr/local/bin/mkosi 2>/dev/null || true
        return 0
    fi
    return 1
}

try_install_mkosi_venv() {
    command -v python3 >/dev/null 2>&1 || return 1

    if ! python3 -c "import venv" >/dev/null 2>&1; then
        info "python venv module missing — trying distro python3-venv…"
        case "$OS_FAMILY" in
            debian)
                DEBIAN_FRONTEND=noninteractive log_cmd apt install -y python3-venv python3-pip || true
                ;;
            fedora|rhel)
                log_cmd $PKG_MANAGER install -y python3-pip python3-virtualenv 2>/dev/null || true
                ;;
            suse)
                log_cmd $PKG_MANAGER install -y python3-pip python3-virtualenv 2>/dev/null || true
                ;;
            arch)
                log_cmd pacman -S --noconfirm --needed python-pip 2>/dev/null || true
                ;;
        esac
    fi
    python3 -c "import venv" >/dev/null 2>&1 || return 1

    local venv="/opt/mkosi-venv"
    if [ ! -x "$venv/bin/mkosi" ]; then
        log_cmd python3 -m venv "$venv" || return 1
        log_cmd "$venv/bin/pip" install -U pip setuptools wheel || true
        log_cmd "$venv/bin/pip" install "git+https://github.com/systemd/mkosi.git" || {
            rm -rf "$venv" 2>/dev/null || true
            return 1
        }
    fi
    install_mkosi_wrapper "$venv/bin/mkosi" || ln -sf "$venv/bin/mkosi" /usr/local/bin/mkosi 2>/dev/null || true
    return 0
}

log_mkosi_upstream_hints() {
    cat >>"$LOG_FILE" <<'MKS'

──────── mkosi (systemd/mkosi) — manual install options ────────
Upstream: https://github.com/systemd/mkosi  (v16+ recommended; verify: mkosi --version)

Method 1 — run from a local clone:
  git clone https://github.com/systemd/mkosi /opt/mkosi
  /opt/mkosi/bin/mkosi --workspace-directory /var/tmp/mkosi-ws --version
  # Re-run machina install.sh (or copy scripts/mkosi-wrapper.sh) to put a safe /usr/local/bin/mkosi on PATH.

Method 2 — pipx (isolated; good for interactive admin users):
  pipx install git+https://github.com/systemd/mkosi.git
  # ensure ~/.local/bin on PATH; machina re-runs install.sh to add the workspace wrapper under /usr/local/bin

Method 3 — Python venv (what machina falls back to):
  python3 -m venv /opt/mkosi-venv
  /opt/mkosi-venv/bin/pip install "git+https://github.com/systemd/mkosi.git"
  # re-run machina install.sh --deps-only to install the mkosi workspace wrapper

Method 4 — zipapp (portable single file):
  git clone https://github.com/systemd/mkosi && cd mkosi && tools/generate-zipapp.sh
  install builddir/mkosi to a directory on PATH

Host tools (typical distro images): bubblewrap, dosfstools, e2fsprogs, zstd, tar, xz;
  plus the guest distro’s package manager (dnf/apt/pacman/…) on the build host.

Alma/RHEL/Rocky 9: EPEL "dnf install mkosi" is often mkosi 12 — too old for current recipes; prefer this script or pipx from GitHub.
If mkosi complains systemd-repart needs 254+ but the host has 252, add ToolsTree=yes under [Build] in mkosi.conf (mkosi(1) TOOLS TREES).

If mkosi errors that the workspace cannot live under BuildSources=, either pass
  --workspace-directory /var/tmp/mkosi-ws (any dir outside sources), or set
  MKOSI_WORKSPACE_DIRECTORY or MACHINA_MKOSI_WORKSPACE_DIR (see scripts/mkosi-wrapper.sh).

machina env overrides for this script:
  MACHINA_MKOSI_FROM_CLONE=1     — git clone to /opt/mkosi (or MACHINA_MKOSI_CLONE_DIR=…)
  MACHINA_MKOSI_CLONE_DIR=/path — clone destination

machina-daemon (mkosi build) env overrides:
  MACHINA_MKOSI_WORKSPACE_DIR=/path — parent for ephemeral mkosi --workspace-directory (default: /var/tmp/machina-mkosi-ws)
  MACHINA_MKOSI_KEEP_WORKSPACE=1 — after a successful build, do not delete the ephemeral workspace tree

Interactive /usr/local/bin/mkosi (wrapper from this installer):
  MACHINA_MKOSI_WORKSPACE_DIR=/path — parent for default workspace (default: /var/tmp/mkosi-workspace; per-user subdir)
  MKOSI_WORKSPACE_DIRECTORY=/abs/dir — force a single workspace directory
────────────────────────────────────────────────────────────────
MKS
}

# mkosi — default disk image workflow (systemd/mkosi). install_deps always runs this; used when API field `mkosi_workspace` is set.
ensure_mkosi() {
    info "Image tooling: mkosi (recommended) — ensuring mkosi v16+ on PATH (distro → pipx → git clone → venv)"

    # Prefer upstream install in /usr/local/bin over an older distro /usr/bin/mkosi.
    export PATH="/usr/local/bin:$PATH"
    install -d /usr/local/bin 2>/dev/null || true

    install_mkosi_host_tools
    migrate_mkosi_to_wrapper_if_needed

    if mkosi_acceptable; then
        ok "mkosi: $(mkosi --version 2>/dev/null | head -1) (meets v16+ or version unparsable)"
        return 0
    fi

    if command -v mkosi >/dev/null 2>&1; then
        warn "mkosi on PATH is older than v16 or unknown — installing upstream to /usr/local/bin"
    fi

    step "Installing mkosi (try distro package, then pipx, then optional clone, then /opt/mkosi-venv)"

    try_install_mkosi_distro_package
    if mkosi_acceptable; then
        ok "mkosi from distro: $(mkosi --version 2>/dev/null | head -1)"
        return 0
    fi

    if try_install_mkosi_pipx && mkosi_acceptable; then
        ok "mkosi via pipx: $(mkosi --version 2>/dev/null | head -1)"
        return 0
    fi

    if try_install_mkosi_git_clone && mkosi_acceptable; then
        ok "mkosi from git clone: $(mkosi --version 2>/dev/null | head -1)"
        return 0
    fi

    if try_install_mkosi_venv && mkosi_acceptable; then
        ok "mkosi via /opt/mkosi-venv: $(mkosi --version 2>/dev/null | head -1)"
        return 0
    fi

    log_mkosi_upstream_hints
    warn "mkosi could not be installed automatically — see $LOG_FILE for manual options (Methods 1–4)."
}

# ── Enable libvirt ────────────────────────────────────────────────────

enable_libvirt() {
    step "Enabling libvirt"

    systemctl enable --now libvirtd >> "$LOG_FILE" 2>&1 || warn "libvirtd may already be running"

    if virsh list --all >> "$LOG_FILE" 2>&1; then
        ok "libvirt is working"
    else
        warn "libvirt test failed — may need reboot or user group fix"
    fi
}

# ── Install Rust ──────────────────────────────────────────────────────

install_rust() {
    step "Checking Rust toolchain"

    # Check if cargo exists — try multiple locations including user homes
    CARGO_BIN=""
    local -a search_paths=()

    local cmd_cargo=""
    cmd_cargo="$(command -v cargo 2>/dev/null)" || true
    [ -n "$cmd_cargo" ] && search_paths+=("$cmd_cargo")
    search_paths+=("$HOME/.cargo/bin/cargo")
    search_paths+=("/root/.cargo/bin/cargo")
    search_paths+=("/usr/local/cargo/bin/cargo")
    search_paths+=("/usr/local/bin/cargo")
    search_paths+=("/usr/bin/cargo")
    [ -n "${SUDO_USER:-}" ] && search_paths+=("/home/$SUDO_USER/.cargo/bin/cargo")
    shopt -s nullglob
    for user_cargo in /home/*/.cargo/bin/cargo; do
        search_paths+=("$user_cargo")
    done
    shopt -u nullglob

    for candidate in "${search_paths[@]}"; do
        if [ -x "$candidate" ] 2>/dev/null; then
            CARGO_BIN="$candidate"
            break
        fi
    done

    if [ -n "$CARGO_BIN" ]; then
        local cargo_dir
        cargo_dir="$(dirname "$(dirname "$CARGO_BIN")")"
        if [ -d "$cargo_dir/../.rustup" ]; then
            export RUSTUP_HOME="$cargo_dir/../.rustup"
        elif [ -d "${cargo_dir%/cargo}/.rustup" ]; then
            export RUSTUP_HOME="${cargo_dir%/cargo}/.rustup"
        fi

        RUST_VER=$($CARGO_BIN --version 2>/dev/null | awk '{print $2}') || true
        if [ -n "$RUST_VER" ]; then
            ok "Rust already installed: $RUST_VER ($CARGO_BIN)"
            export PATH="$(dirname "$CARGO_BIN"):$PATH"
            return
        fi
        local rustup_bin
        rustup_bin="$(dirname "$CARGO_BIN")/rustup"
        if [ -x "$rustup_bin" ]; then
            info "Setting default Rust toolchain..."
            "$rustup_bin" default stable >> "$LOG_FILE" 2>&1 || true
            RUST_VER=$($CARGO_BIN --version 2>/dev/null | awk '{print $2}') || true
            if [ -n "$RUST_VER" ]; then
                ok "Rust configured: $RUST_VER ($CARGO_BIN)"
                export PATH="$(dirname "$CARGO_BIN"):$PATH"
                return
            fi
        fi
        warn "Found cargo at $CARGO_BIN but it failed. Installing fresh..."
        CARGO_BIN=""
    fi

    info "Installing Rust via rustup..."
    export RUSTUP_HOME="${RUSTUP_HOME:-/usr/local/rustup}"
    export CARGO_HOME="${CARGO_HOME:-/usr/local/cargo}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path >> "$LOG_FILE" 2>&1 || fail "Rust installation failed"
    export PATH="$CARGO_HOME/bin:$PATH"

    ln -sf "$CARGO_HOME/bin/cargo" /usr/local/bin/cargo 2>/dev/null || true
    ln -sf "$CARGO_HOME/bin/rustc" /usr/local/bin/rustc 2>/dev/null || true

    RUST_VER=$(cargo --version 2>/dev/null | awk '{print $2}')
    ok "Rust installed: $RUST_VER"
}

# ── Clone and build ──────────────────────────────────────────────────

detect_bundle_install() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -x "$script_dir/machina-daemon" ] && [ ! -f "$script_dir/Cargo.toml" ]; then
        BUNDLE_INSTALL=true
        INSTALL_DIR="$script_dir"
        INSTALLER_ROOT="$script_dir"
        return 0
    fi
    return 1
}

find_source() {
    step "Locating machina source"

    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # Client tarball (install-full.sh): prebuilt binaries, no Cargo workspace
    if detect_bundle_install; then
        ok "Client bundle at $INSTALL_DIR (installing prebuilt binaries — no source build)"
        cd "$INSTALL_DIR"
        return
    fi

    # If running from within the repo, use it directly
    if [ -f "$script_dir/Makefile" ] && [ -f "$script_dir/Cargo.toml" ]; then
        INSTALL_DIR="$script_dir"
        ok "Using local source at $INSTALL_DIR"
        cd "$INSTALL_DIR"
        return
    fi

    # Check common locations
    for candidate in /root/.machina /opt/machina "$HOME/.machina" "$HOME/.deployment/machina"; do
        if [ -f "$candidate/Cargo.toml" ] && [ -f "$candidate/Makefile" ]; then
            INSTALL_DIR="$candidate"
            ok "Found source at $INSTALL_DIR"
            cd "$INSTALL_DIR"
            return
        fi
    done

    fail "Source not found. Clone the repo first or run install.sh from within it."
}

# pam-sys uses bindgen and needs libclang at compile time
export_libclang_path() {
    if [ -n "${LIBCLANG_PATH:-}" ] && [ -d "$LIBCLANG_PATH" ]; then
        info "Using LIBCLANG_PATH=$LIBCLANG_PATH"
        export LIBCLANG_PATH
        return 0
    fi

    local llvm_cfg libdir
    llvm_cfg="$(command -v llvm-config 2>/dev/null || true)"
    if [ -n "$llvm_cfg" ]; then
        libdir="$("$llvm_cfg" --libdir 2>/dev/null || true)"
        if [ -n "$libdir" ] && [ -d "$libdir" ]; then
            if [ -e "$libdir/libclang.so" ] || [ -e "$libdir/libclang.so.1" ]; then
                export LIBCLANG_PATH="$libdir"
                info "Set LIBCLANG_PATH=$LIBCLANG_PATH (llvm-config)"
                return 0
            fi
        fi
    fi

    local candidate
    for candidate in /usr/lib/llvm/*/lib /usr/lib64/llvm/*/lib; do
        [ -d "$candidate" ] || continue
        if [ -e "$candidate/libclang.so" ] || [ -e "$candidate/libclang.so.1" ]; then
            export LIBCLANG_PATH="$candidate"
            info "Set LIBCLANG_PATH=$LIBCLANG_PATH (versioned LLVM tree)"
            return 0
        fi
    done

    for candidate in /usr/lib /usr/lib64; do
        if [ -e "$candidate/libclang.so" ] || [ -e "$candidate/libclang.so.1" ]; then
            export LIBCLANG_PATH="$candidate"
            info "Set LIBCLANG_PATH=$LIBCLANG_PATH (system lib)"
            return 0
        fi
    done

    warn "Could not auto-detect libclang; pam-sys may fail. Install clang-devel (RPM) or libclang-dev (Debian), or set LIBCLANG_PATH."
    return 0
}

build_rust() {
    step "Building Rust binaries (release mode)"
    info "This may take 2-5 minutes on first build..."

    cd "$INSTALL_DIR"
    export_libclang_path

    # Capture cargo exit code via a temp file (pipes lose it).
    local _rc_file
    _rc_file=$(mktemp /tmp/machina-cargo-rc-XXXXXX)

    # Run cargo in a subshell; stream ALL output to the log AND filter
    # error/warning/progress lines to stderr so they appear over SSH.
    # A heartbeat every 20s keeps the TCP session alive during quiet intervals.
    (
        cargo build --workspace --release 2>&1
        printf '%s' "$?" > "$_rc_file"
    ) | tee -a "$LOG_FILE" \
      | grep --line-buffered -E "^(error|warning\[|Compiling |Finished |   = |note:)" \
      | sed 's/^/  /' >&2 &
    local _pipe_pid=$!
    local _elapsed=0
    while kill -0 "$_pipe_pid" 2>/dev/null; do
        sleep 20
        _elapsed=$((_elapsed + 20))
        printf "  ⏳ compiling… %ds\n" "$_elapsed" >&2
    done
    wait "$_pipe_pid" || true

    local _build_rc=1
    [[ -f "$_rc_file" ]] && _build_rc=$(cat "$_rc_file" | tr -d '[:space:]') || true
    rm -f "$_rc_file"

    if [ "$_build_rc" != "0" ]; then
        echo "⚠️  Last 80 lines of build log ($LOG_FILE):" >&2
        tail -80 "$LOG_FILE" >&2 || true
        fail "Rust build failed (exit $\_build_rc). Full log: $LOG_FILE"
    fi

    ok "Built: target/release/machina-daemon ($(du -h target/release/machina-daemon | cut -f1))"
    ok "Built: target/release/machina-tui ($(du -h target/release/machina-tui | cut -f1))"
}

build_web() {
    step "Building web frontend"

    cd "$INSTALL_DIR/web"

    local node_ver
    node_ver=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
    if ! [[ "$node_ver" =~ ^[0-9]+$ ]] || [ "$node_ver" -lt 20 ]; then
        fail "Node.js 20+ required (found: v${node_ver:-none})"
    fi
    info "Node.js: $(node --version)"

    info "Installing npm dependencies..."
    if ! log_cmd npm install; then
        warn "npm install failed — retrying with clean node_modules..."
        rm -rf node_modules package-lock.json
        log_cmd npm install || fail "npm install failed after clean retry. Check $LOG_FILE"
    fi

    info "Building production bundle..."
    if ! log_cmd npm run build; then
        warn "npm build failed — retrying with clean node_modules (native binding issue)..."
        rm -rf node_modules package-lock.json
        log_cmd npm install || fail "npm install failed on build retry. Check $LOG_FILE"
        log_cmd npm run build || fail "npm build failed after clean retry. Check $LOG_FILE"
    fi

    ok "Web UI built: $(find dist/assets -name '*.js' 2>/dev/null | wc -l) assets"
}

# ── mkosi workspace definitions ──────────────────────────────────────

# Copy bundled workspace definitions to /var/lib/machina/mkosi-defs/.
# Existing workspace dirs are preserved (user customisations respected).
install_mkosi_workspace_defs() {
    local src="${INSTALLER_ROOT}/contrib/mkosi-defs"
    local dst="/var/lib/machina/mkosi-defs"

    if [ ! -d "$src" ]; then
        warn "contrib/mkosi-defs/ not found in installer tree — skipping workspace install"
        return 0
    fi

    install -d "$dst"

    local copied=0
    for ws_src in "$src"/*/; do
        [ -f "${ws_src}mkosi.conf" ] || continue
        local name
        name="$(basename "$ws_src")"
        local ws_dst="$dst/$name"
        if [ -d "$ws_dst" ]; then
            info "mkosi workspace '$name' already exists — not overwriting"
        else
            cp -r "$ws_src" "$ws_dst"
            copied=$((copied + 1))
        fi
    done

    ok "mkosi workspace definitions -> $dst ($copied new)"
}

# ── Install ──────────────────────────────────────────────────────────

install_files_bundle() {
    step "Installing machina (client bundle)"

    local root="$INSTALL_DIR"

    mkdir -p /var/lib/machina/backups
    mkdir -p /var/lib/machina/packer-builds

    install -Dm755 "$root/machina-daemon" /usr/local/bin/machina-daemon
    ok "machina-daemon -> /usr/local/bin/"
    if [ -x "$root/machina" ]; then
        install -Dm755 "$root/machina" /usr/local/bin/machina
        ok "machina TUI -> /usr/local/bin/"
    fi

    if [ ! -f /etc/machina/config.toml ]; then
        if [ -f "$root/machina.toml.example" ]; then
            install -Dm644 "$root/machina.toml.example" /etc/machina/config.toml
        elif [ -f "$root/contrib/machina.toml" ]; then
            install -Dm644 "$root/contrib/machina.toml" /etc/machina/config.toml
        fi
        ok "Config -> /etc/machina/config.toml"
    else
        info "Config already exists, not overwriting"
    fi

    if [ -n "$BIND_HOST" ] && [ -f /etc/machina/config.toml ]; then
        sed -i "s/^host = .*/host = \"$BIND_HOST\"/" /etc/machina/config.toml
        ok "Configured daemon to bind to $BIND_HOST"
    fi

    if [ -n "${MACHINA_LICENSE_KEY:-}" ]; then
        mkdir -p /etc/machina
        printf '%s\n' "$MACHINA_LICENSE_KEY" > /etc/machina/license.key
        chmod 600 /etc/machina/license.key
        ok "License key -> /etc/machina/license.key"
    elif [ ! -f /etc/machina/license.key ]; then
        warn "No license key found — set MACHINA_LICENSE_KEY or place key in /etc/machina/license.key"
    fi

    if [ -f "$root/machina-daemon.service" ]; then
        install -Dm644 "$root/machina-daemon.service" /usr/lib/systemd/system/machina-daemon.service
        systemctl daemon-reload
        ok "Systemd unit -> machina-daemon.service"
    else
        warn "machina-daemon.service missing from bundle — start manually: machina-daemon --config /etc/machina/config.toml"
    fi

    if [ -d "$root/web/dist" ]; then
        mkdir -p /usr/local/share/machina/web
        rm -rf /usr/local/share/machina/web/*
        cp -r "$root/web/dist/"* /usr/local/share/machina/web/
        ok "Web UI -> /usr/local/share/machina/web/"
    else
        warn "web/dist missing from bundle — dashboard may not load"
    fi

    install_mkosi_workspace_defs
}

install_files() {
    if [ "${BUNDLE_INSTALL:-false}" = true ]; then
        install_files_bundle
        return
    fi

    step "Installing machina"

    cd "$INSTALL_DIR"

    # Create required directories BEFORE installing systemd units
    # /var/lib/machina MUST exist or systemd ReadWritePaths causes NAMESPACE failure
    mkdir -p /var/lib/machina/backups
    mkdir -p /var/lib/machina/packer-builds

    # Binaries
    install -Dm755 target/release/machina-daemon /usr/local/bin/machina-daemon
    install -Dm755 target/release/machina-tui /usr/local/bin/machina
    ok "Binaries -> /usr/local/bin/"

    # Config
    if [ ! -f /etc/machina/config.toml ]; then
        install -Dm644 contrib/machina.toml /etc/machina/config.toml
        ok "Config -> /etc/machina/config.toml"
    else
        info "Config already exists, not overwriting"
    fi

    # Apply --bind if specified
    if [ -n "$BIND_HOST" ]; then
        sed -i "s/^host = .*/host = \"$BIND_HOST\"/" /etc/machina/config.toml
        ok "Configured daemon to bind to $BIND_HOST"
    fi

    if [ -n "${MACHINA_LICENSE_KEY:-}" ]; then
        mkdir -p /etc/machina
        printf '%s\n' "$MACHINA_LICENSE_KEY" > /etc/machina/license.key
        chmod 600 /etc/machina/license.key
        ok "License key -> /etc/machina/license.key"
    elif [ ! -f /etc/machina/license.key ]; then
        warn "No license key found — set MACHINA_LICENSE_KEY or place key in /etc/machina/license.key"
    fi

    # Optional env overrides (hyper2kvm-style /etc/default)
    if [ ! -f /etc/default/machina-daemon ]; then
        install -Dm644 contrib/machina-daemon.default /etc/default/machina-daemon
        ok "Defaults -> /etc/default/machina-daemon"
    fi

    # Systemd units
    install -Dm644 contrib/machina-daemon.service /usr/lib/systemd/system/machina-daemon.service
    if [ -f contrib/machina-backup.service ]; then
        install -Dm644 contrib/machina-backup.service /usr/lib/systemd/system/machina-backup.service
    fi
    if [ -f contrib/machina-backup.timer ]; then
        install -Dm644 contrib/machina-backup.timer /usr/lib/systemd/system/machina-backup.timer
    fi
    systemctl daemon-reload
    ok "Systemd units installed"

    # Scripts
    mkdir -p /usr/local/share/machina/scripts
    for script in scripts/*.sh; do
        [ -f "$script" ] || continue
        install -Dm755 "$script" "/usr/local/share/machina/scripts/$(basename "$script")"
    done
    ok "Scripts -> /usr/local/share/machina/scripts/"

    mkdir -p /usr/local/share/machina/packer
    if [ -f contrib/packer/build-linux-image.sh ]; then
        install -Dm755 contrib/packer/build-linux-image.sh /usr/local/share/machina/packer/build-linux-image.sh
        ok "Packer Linux image script -> /usr/local/share/machina/packer/build-linux-image.sh"
    fi
    if [ -d contrib/packer/windows-qemu ]; then
        rm -rf /usr/local/share/machina/packer/windows-qemu
        cp -a contrib/packer/windows-qemu /usr/local/share/machina/packer/
        ok "Packer Windows+VirtIO example -> /usr/local/share/machina/packer/windows-qemu/"
    fi

    if [ -d contrib/guacamole ]; then
        rm -rf /usr/local/share/machina/guacamole
        cp -a contrib/guacamole /usr/local/share/machina/
        ok "Guacamole compose stack -> /usr/local/share/machina/guacamole/"
    fi

    # Backup config
    if [ -f contrib/backup.conf ] && [ ! -f /etc/machina/backup.conf ]; then
        install -Dm644 contrib/backup.conf /etc/machina/backup.conf
        ok "Backup config -> /etc/machina/backup.conf"
    fi

    # Web UI
    if [ -d web/dist ]; then
        mkdir -p /usr/local/share/machina/web
        rm -rf /usr/local/share/machina/web/*
        cp -r web/dist/* /usr/local/share/machina/web/
        ok "Web UI -> /usr/local/share/machina/web/"
    fi

    # machinactl
    if [ -f machinactl ]; then
        install -Dm755 machinactl /usr/local/bin/machinactl
        ok "machinactl -> /usr/local/bin/"
    fi

    # mkosi workspace definitions (shipped in repo, installed once)
    install_mkosi_workspace_defs
}

# ── TLS (HTTPS on :5092) ─────────────────────────────────────────────

ensure_tls_for_https() {
    step "TLS certificate for HTTPS (port 5092)"

    command -v openssl >/dev/null 2>&1 || fail "openssl is required for HTTPS — install openssl and retry"

    local cdir="/etc/machina/ssl"
    local cert="$cdir/cert.pem"
    local key="$cdir/key.pem"
    mkdir -p "$cdir"

    if [ -f "$cert" ] && [ -f "$key" ]; then
        ok "TLS key material already present ($cdir)"
    else
        local hn
        hn=$(hostname -f 2>/dev/null || hostname)
        info "Generating self-signed certificate (browsers show a warning until you replace with your CA)"
        if openssl req -help 2>&1 | grep -q -- '-addext'; then
            log_cmd openssl req -x509 -newkey rsa:4096 \
                -keyout "$key" -out "$cert" \
                -sha256 -days 3650 -nodes \
                -subj "/CN=$hn/O=machina" \
                -addext "subjectAltName=DNS:$hn,DNS:localhost,IP:127.0.0.1"
        else
            log_cmd openssl req -x509 -newkey rsa:4096 \
                -keyout "$key" -out "$cert" \
                -sha256 -days 3650 -nodes \
                -subj "/CN=$hn/O=machina"
        fi
        [ -f "$cert" ] && [ -f "$key" ] || fail "openssl failed — see $LOG_FILE"
        chmod 600 "$key"
        chmod 644 "$cert"
        ok "Self-signed certificate installed"
    fi

    local cfg="/etc/machina/config.toml"
    [ -f "$cfg" ] || return 0
    if grep -q '^\[tls\]' "$cfg" 2>/dev/null; then
        ok "Daemon config already defines [tls]"
        return 0
    fi
    cat >> "$cfg" <<'EOF'

[tls]
enabled = true
cert_path = "/etc/machina/ssl/cert.pem"
key_path = "/etc/machina/ssl/key.pem"
EOF
    ok "Enabled [tls] in /etc/machina/config.toml"
}

# ── Firewall ─────────────────────────────────────────────────────────

configure_host_firewall() {
    if $DISABLE_FIREWALL; then
        step "Disabling host firewall (firewalld/ufw)"
        if disable_firewalld "$LOG_FILE"; then
            ok "Host firewall stopped and disabled"
        else
            info "No active firewalld/ufw service — ports should be reachable"
        fi
        return
    fi
    $OPEN_FIREWALL && open_firewall
}

open_firewall() {
    step "Configuring firewall"

    if command -v firewall-cmd &>/dev/null && systemctl is-active firewalld &>/dev/null; then
        firewall-cmd --add-port=5092/tcp --permanent >> "$LOG_FILE" 2>&1 || true
        firewall-cmd --reload >> "$LOG_FILE" 2>&1 || true
        ok "Opened port 5092/tcp (firewalld)"
    elif command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
        ufw allow 5092/tcp >> "$LOG_FILE" 2>&1 || true
        ok "Opened port 5092/tcp (ufw)"
    elif command -v iptables &>/dev/null; then
        iptables -C INPUT -p tcp --dport 5092 -j ACCEPT 2>/dev/null || \
        iptables -I INPUT -p tcp --dport 5092 -j ACCEPT 2>/dev/null || true
        ok "Opened port 5092/tcp (iptables)"
    else
        info "No firewall detected — port 5092 should be accessible"
    fi
}

# ── Start and verify ─────────────────────────────────────────────────

stop_daemon_for_upgrade() {
    info "Stopping existing machina-daemon (releases TCP :5092 for clean start)..."
    systemctl stop machina-daemon >> "$LOG_FILE" 2>&1 || true
    sleep 2
    # Rare: zombie listener or unrelated process — best-effort clear on Linux.
    if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -q ':5092[[:space:]]'; then
        warn "Port 5092 still occupied — trying to clear listeners (fuser/ss)"
        command -v fuser >/dev/null 2>&1 && fuser -k 5092/tcp >> "$LOG_FILE" 2>&1 || true
        sleep 2
    fi
}

wait_for_https_health() {
    local retries="${1:-15}"
    local attempt=0
    while [ "$attempt" -lt "$retries" ]; do
        if curl -sfk https://localhost:5092/api/v1/health > /dev/null 2>&1; then
            ok "Daemon is running and healthy"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    return 1
}

start_daemon() {
    step "Starting machina daemon"

    stop_daemon_for_upgrade

    systemctl enable machina-daemon >> "$LOG_FILE" 2>&1 || fail "Failed to enable machina-daemon. Check: journalctl -u machina-daemon"
    systemctl start machina-daemon >> "$LOG_FILE" 2>&1 || fail "Failed to start daemon. Check: journalctl -u machina-daemon"

    if wait_for_https_health 15; then
        return 0
    fi

    warn "Health check failed — stopping and starting daemon once more (common after TLS/binary upgrade)"
    stop_daemon_for_upgrade
    systemctl start machina-daemon >> "$LOG_FILE" 2>&1 || fail "Failed to restart daemon. Check: journalctl -u machina-daemon"

    if wait_for_https_health 15; then
        return 0
    fi

    warn "Daemon health check timed out. Showing recent logs:"
    journalctl -u machina-daemon --no-pager -n 25 2>/dev/null || true
    fail "Daemon failed to become healthy at https://localhost:5092/api/v1/health — fix the error above then: sudo systemctl restart machina-daemon"
}

verify_novnc_serving() {
    step "Ensuring noVNC is served by machina-daemon"
    local novnc_dir=""
    for d in /usr/share/novnc /usr/local/share/novnc /usr/share/noVNC; do
        if [ -f "$d/vnc.html" ]; then
            novnc_dir="$d"
            break
        fi
    done
    if [ -z "$novnc_dir" ]; then
        warn "noVNC package missing — installing console packages"
        install_console_packages
        for d in /usr/share/novnc /usr/local/share/novnc /usr/share/noVNC; do
            if [ -f "$d/vnc.html" ]; then
                novnc_dir="$d"
                break
            fi
        done
    fi
    if [ -z "$novnc_dir" ]; then
        warn "noVNC still not on disk — bundled novnc-core in the web UI remains available"
        return 0
    fi
    ok "noVNC files at $novnc_dir"

    _novnc_content_type() {
        curl -sfk -o /dev/null -w '%{content_type}' \
            "https://127.0.0.1:${MACHINA_PORT}/novnc/core/rfb.js" 2>/dev/null || echo ""
    }

    local ctype
    ctype=$(_novnc_content_type)
    if [ "$ctype" = "text/html" ] || [ -z "$ctype" ]; then
        info "Restarting machina-daemon so it picks up /usr/share/novnc"
        systemctl restart machina-daemon >> "$LOG_FILE" 2>&1 || warn "machina-daemon restart failed"
        sleep 2
        wait_for_https_health 10 || true
        ctype=$(_novnc_content_type)
    fi
    if [ "$ctype" = "text/html" ] || [ -z "$ctype" ]; then
        warn "/novnc/core/rfb.js still not served as JavaScript (got: ${ctype:-none})"
        warn "Bundled novnc-core in the web UI still provides in-browser VNC"
    else
        ok "noVNC served at /novnc/ ($ctype)"
    fi
}

install_guacamole_stack() {
    step "Installing Apache Guacamole (Docker)"
    local guac_script=""
    for candidate in \
        "${INSTALLER_ROOT}/scripts/install-guacamole.sh" \
        "/usr/local/share/machina/scripts/install-guacamole.sh"; do
        if [ -f "$candidate" ]; then
            guac_script="$candidate"
            break
        fi
    done
    [ -n "$guac_script" ] || fail "Missing install-guacamole.sh"
    local guac_args=(--install-docker)
    if [ -n "$BIND_HOST" ] && [ "$BIND_HOST" != "127.0.0.1" ]; then
        guac_args+=(--bind "$BIND_HOST")
    fi
    $OPEN_FIREWALL && guac_args+=(--open-firewall)
    guac_args+=(--port "$GUACAMOLE_PORT")
    bash "$guac_script" "${guac_args[@]}" || fail "Guacamole install failed — see log from install-guacamole.sh"
}

# ── Verification tests ───────────────────────────────────────────────

run_tests() {
    step "Running verification tests"

    local passed=0
    local failed=0

    # Check if auth is enabled — if so, API tests are expected to return 401
    local auth_status
    auth_status=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost:5092/api/v1/vms 2>/dev/null) || auth_status="000"
    local auth_enabled=false
    if [ "$auth_status" = "401" ]; then
        auth_enabled=true
        ok "  PAM authentication is active"
        passed=$((passed + 1))
    fi

    test_endpoint() {
        local desc="$1" url="$2" expect="$3"
        local response
        response=$(curl -sfk "$url" 2>/dev/null) || response=""
        if echo "$response" | grep -qF "$expect"; then
            ok "  $desc"
            passed=$((passed + 1))
        else
            echo "  ❌ FAIL $desc (expected '$expect')"
            failed=$((failed + 1))
        fi
    }

    test_endpoint "Health check"      "https://localhost:5092/api/v1/health"        "healthy"

    # API endpoint tests (skipped when auth is enabled — they correctly return 401)
    if ! $auth_enabled; then
        test_endpoint "List VMs"          "https://localhost:5092/api/v1/vms"           "["
        test_endpoint "Node info"         "https://localhost:5092/api/v1/node"          "hostname"
        test_endpoint "List networks"     "https://localhost:5092/api/v1/networks"      "["
        test_endpoint "List storage"      "https://localhost:5092/api/v1/storage/pools" "["
        test_endpoint "Capabilities"      "https://localhost:5092/api/v1/capabilities"  "host_arch"
        test_endpoint "List devices"      "https://localhost:5092/api/v1/devices"       "["
        test_endpoint "List nwfilters"    "https://localhost:5092/api/v1/nwfilters"     "["
        test_endpoint "List secrets"      "https://localhost:5092/api/v1/secrets"       "["
        test_endpoint "Metrics endpoint"  "https://localhost:5092/api/v1/metrics"       "["
        if [ -f /etc/machina/config.toml ] && grep -qE '^\[openstack\]' /etc/machina/config.toml \
            && grep -qE '^\s*enabled\s*=\s*true' /etc/machina/config.toml; then
            test_endpoint "OpenStack status" "https://localhost:5092/api/v1/openstack/status" "enabled"
        fi
    else
        info "  API tests skipped (auth enabled — endpoints correctly return 401)"
    fi

    # Web UI
    local http_code
    http_code=$(curl -sfk -o /dev/null -w "%{http_code}" https://localhost:5092/ 2>/dev/null) || http_code="000"
    if [ "$http_code" = "200" ]; then
        ok "  Web UI serves (HTTPS 200)"
        passed=$((passed + 1))
    else
        echo "  ❌ FAIL Web UI (HTTP $http_code)"
        failed=$((failed + 1))
    fi

    local novnc_ctype
    novnc_ctype=$(curl -sfk -o /dev/null -w '%{content_type}' "https://localhost:5092/novnc/core/rfb.js" 2>/dev/null) || novnc_ctype=""
    if [ -n "$novnc_ctype" ] && [ "$novnc_ctype" != "text/html" ]; then
        ok "  noVNC static files (/novnc/)"
        passed=$((passed + 1))
    else
        info "  noVNC /novnc/ check skipped or HTML fallback (bundled client still works)"
    fi

    # Binaries
    if /usr/local/bin/machina-daemon --help > /dev/null 2>&1; then
        ok "  machina-daemon binary"
        passed=$((passed + 1))
    else
        echo "  ❌ FAIL machina-daemon binary"
        failed=$((failed + 1))
    fi

    if /usr/local/bin/machina --help > /dev/null 2>&1; then
        ok "  machina TUI binary"
        passed=$((passed + 1))
    else
        echo "  ❌ FAIL machina TUI binary"
        failed=$((failed + 1))
    fi

    # Security validation (skipped when auth is enabled)
    if $auth_enabled; then
        info "  Security tests skipped (auth enabled)"
    else
    local migrate_resp
    migrate_resp=$(curl -sk -X POST https://localhost:5092/api/v1/vms/nonexistent/migrate \
        -H 'Content-Type: application/json' \
        -d '{"dest_uri":"http://evil.com","live":false}' 2>/dev/null) || migrate_resp=""
    if echo "$migrate_resp" | grep -qF "Invalid migration URI"; then
        ok "  Migration URI validation"
        passed=$((passed + 1))
    else
        echo "  ❌ FAIL Migration URI validation"
        failed=$((failed + 1))
    fi

    local resize_resp
    resize_resp=$(curl -sk -X POST https://localhost:5092/api/v1/storage/pools/default/volumes/x/resize \
        -H 'Content-Type: application/json' \
        -d '{"capacity_gb":-1}' 2>/dev/null) || resize_resp=""
    if echo "$resize_resp" | grep -qF "capacity_gb must be"; then
        ok "  Resize validation"
        passed=$((passed + 1))
    else
        echo "  ❌ FAIL Resize validation"
        failed=$((failed + 1))
    fi
    fi  # end auth_enabled check for security tests

    echo ""
    echo "📊 Test results: ✅ $passed passed, ❌ $failed failed"
    [ $failed -gt 0 ] && return 1
    return 0
}

# ── Remote deploy ────────────────────────────────────────────────────

remote_deploy() {
    local remote="$1"
    local source_dir
    source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    if [ ! -f "$source_dir/Cargo.toml" ]; then
        fail "Must run --remote from within the machina source directory"
    fi

    step "Deploying to $remote"

    info "Copying source to $remote:~/.deployment/machina (build runs on remote only, not here) ..."
    ssh "$remote" "mkdir -p ~/.deployment/machina"
    rsync -az --delete \
        --exclude target --exclude node_modules --exclude .git --exclude web/dist \
        "$source_dir/" "$remote:~/.deployment/machina/" || fail "rsync failed"
    ok "Source copied"

    info "Running install.sh on $remote (cargo/npm build on server) ..."
    local remote_args=""
    [ -n "$BIND_HOST" ] && remote_args="--bind $BIND_HOST"
    $OPEN_FIREWALL && remote_args="$remote_args --open-firewall"
    $DISABLE_FIREWALL && remote_args="$remote_args --disable-firewalld"
    $WITH_GUACAMOLE && remote_args="$remote_args --with-guacamole --guacamole-port $GUACAMOLE_PORT"

    # Skip curl/API verification on the hypervisor — run locally if needed.
    ssh "$remote" "cd ~/.deployment/machina && sudo bash install.sh --no-tests $remote_args" || fail "Remote install failed"

    # Get the remote IP for summary
    local remote_ip
    remote_ip=$(echo "$remote" | sed 's/.*@//')
    echo ""
    echo "============================================"
    echo "✅ Deployed to $remote"
    echo "============================================"
    echo ""
    echo "  🌐 Web UI:  https://$remote_ip:5092"
    echo "  🔗 API:     https://$remote_ip:5092/api/v1/health"
    if $WITH_GUACAMOLE; then
        echo "  🖥️  Guacamole: http://$remote_ip:${GUACAMOLE_PORT}/guacamole/"
    fi
    echo ""
}

# ── Uninstall ────────────────────────────────────────────────────────

uninstall() {
    step "Uninstalling machina"

    systemctl stop machina-daemon 2>/dev/null || true
    systemctl disable machina-daemon 2>/dev/null || true
    systemctl stop machina-backup.timer 2>/dev/null || true
    systemctl disable machina-backup.timer 2>/dev/null || true

    rm -f /usr/local/bin/machina-daemon
    rm -f /usr/local/bin/machina
    rm -f /usr/local/bin/machinactl
    rm -f /usr/local/libexec/machina/mkosi-real
    if [ -f /usr/local/bin/mkosi ] && grep -q 'machina — mkosi CLI wrapper' /usr/local/bin/mkosi 2>/dev/null; then
        rm -f /usr/local/bin/mkosi
    fi
    rmdir /usr/local/libexec/machina 2>/dev/null || true
    rm -f /usr/lib/systemd/system/machina-daemon.service
    rm -f /usr/lib/systemd/system/machina-backup.service
    rm -f /usr/lib/systemd/system/machina-backup.timer
    rm -rf /usr/local/share/machina
    systemctl daemon-reload 2>/dev/null || true

    ok "Binaries and service removed"
    info "Config kept at /etc/machina/ (remove manually if desired)"
    info "Data kept at /var/lib/machina/ (remove manually if desired)"
}

# ── Summary ──────────────────────────────────────────────────────────

print_summary() {
    local vm_count host_ip host_label lan_only
    vm_count=$(curl -sfk "https://127.0.0.1:${MACHINA_PORT}/api/v1/vms" 2>/dev/null \
        | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null) || vm_count="?"

    host_ip=$(install_primary_ipv4)
    host_label=$(install_primary_host_label)
    lan_only=false
    if [ -z "${BIND_HOST}" ] || [ "${BIND_HOST}" = "127.0.0.1" ]; then
        lan_only=true
    fi

    echo ""
    echo "============================================"
    echo "✅ machina installed successfully!"
    echo "============================================"
    echo ""
    if [ "${host_ip}" != "127.0.0.1" ]; then
        echo "  Web UI:      https://${host_ip}:${MACHINA_PORT}   (${host_label})"
        echo "  API:         https://${host_ip}:${MACHINA_PORT}/api/v1/health"
        if $lan_only; then
            echo "  Note:        daemon is localhost-only — re-run with:"
            echo "               sudo $0 --bind 0.0.0.0 --open-firewall"
        fi
    else
        echo "  Web UI:      https://localhost:${MACHINA_PORT}"
        echo "  API:         https://localhost:${MACHINA_PORT}/api/v1/health"
    fi
    echo "  Local only:  https://127.0.0.1:${MACHINA_PORT}"
    echo "  TUI:         machina"
    echo "  VMs found:   ${vm_count}"
    echo ""
    echo "  Manage:"
    echo "    sudo systemctl status  machina-daemon"
    echo "    sudo systemctl restart machina-daemon"
    echo "    sudo journalctl -u machina-daemon -f"
    echo ""
    echo "  Config:      /etc/machina/config.toml"
    echo "  Source:      ${INSTALL_DIR}"
    echo "  Log:         ${LOG_FILE}"
    echo "  Packer:      /usr/local/share/machina/packer/build-linux-image.sh"
    echo "  Win+VirtIO:  /usr/local/share/machina/packer/windows-qemu/ (see HOWTO.txt)"
    if [ -f /etc/machina/config.toml ] && grep -qE '^\[openstack\]' /etc/machina/config.toml \
        && grep -qE '^\s*enabled\s*=\s*true' /etc/machina/config.toml; then
        echo ""
        echo "  OpenStack:   wire cloud credentials on the host, then test in Settings:"
        echo "    sudo /usr/local/share/machina/scripts/openstack-wire-cloud.sh /root/keystonerc_admin packstack"
        echo "    sudo systemctl restart machina-daemon"
    fi
    if [ -f /etc/machina/config.toml ] && grep -qE '^\[guacamole\]' /etc/machina/config.toml \
        && grep -qE '^\s*enabled\s*=\s*true' /etc/machina/config.toml; then
        local guac_url
        guac_url=$(grep -E '^\s*base_url\s*=' /etc/machina/config.toml 2>/dev/null | head -1 | sed 's/.*=\s*"\?\([^"]*\)"\?.*/\1/' | tr -d ' ')
        echo ""
        echo "  Guacamole:   ${guac_url:-http://127.0.0.1:${GUACAMOLE_PORT}/guacamole}  (optional HTML5 gateway)"
        echo "    VM Details → Guacamole button, or GET /api/v1/vms/{name}/guacamole-auth"
    fi
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────

main() {
    # ASCII banner (figlet -f small machina)
    cat <<'MACHINA_BANNER'
                _    _
  _ __  __ _ __| |_ (_)_ _  __ _
 | '  \/ _` / _| ' \| | ' \/ _` |
 |_|_|_\__,_\__|_||_|_|_||_\__,_|

MACHINA_BANNER
    echo ""
    echo "machina installer — Linux hypervisor host manager"
    echo ""

    # Parse args
    local do_uninstall=false
    local deps_only=false
    local no_start=false
    local prev_arg=""
    for arg in "$@"; do
        case "$prev_arg" in
            --bind)   BIND_HOST="$arg"; BIND_EXPLICIT=true; prev_arg=""; continue ;;
            --remote) REMOTE_HOST="$arg"; prev_arg=""; continue ;;
            --guacamole-port) GUACAMOLE_PORT="$arg"; prev_arg=""; continue ;;
        esac
        case "$arg" in
            --uninstall)     do_uninstall=true ;;
            --deps-only)     deps_only=true ;;
            --no-start)      no_start=true ;;
            --no-tests)      NO_TESTS=true ;;
            --skip-build)    SKIP_BUILD=true ;;
            --open-firewall) OPEN_FIREWALL=true ;;
            --disable-firewalld) DISABLE_FIREWALL=true ;;
            --with-guacamole) WITH_GUACAMOLE=true ;;
            --guacamole-port) prev_arg="--guacamole-port" ;;
            --bind|--remote) prev_arg="$arg" ;;
            --help|-h)
                cat <<'HELPEOF'
Usage: install.sh [OPTIONS]

  Automated installer for machina — Linux hypervisor host management
  with Web UI, REST API, TUI, backups, monitoring, and optional KubeVirt
  helpers when you configure them.

  Detects the Linux distribution, installs all dependencies (libvirt,
  QEMU/KVM, Rust, Node.js 20), then either builds from source (git checkout)
  or installs prebuilt binaries from a client tarball (install-full.sh
  in machina-*-linux-amd64), deploys systemd services, and runs verification
  tests (unless --no-tests).

Install options:
  --bind HOST          Bind daemon to HOST (default: 127.0.0.1)
                       Use 0.0.0.0 to make the web UI accessible from
                       other machines on the network.
  --open-firewall      Open port 5092 in the active firewall.
                       Supports firewalld, ufw, and iptables.
  --disable-firewalld  Stop and disable firewalld/ufw (remote lab / E2E hosts).
  --no-start           Build and install but don't start the daemon.
                       Useful when you want to edit the config first.
  --no-tests           Skip post-install HTTPS/API verification (curl checks).
                       Remote deploy (--remote) passes this automatically.
  --skip-build         Install from existing target/release + web/dist only
                       (no cargo/npm). Used after make release web on the host.
  --deps-only          Only install system dependencies (libvirt, Rust,
                       Node.js) without building or installing machina.
  --with-guacamole     After install, deploy Apache Guacamole via Docker
                       (installs Docker if needed, guacd + PostgreSQL + JSON auth).

Remote deploy:
  --remote USER@HOST   Deploy to a remote machine over SSH.
                       Copies the source via rsync, then runs this
                       installer on the remote host. Does not require
                       root locally — only on the remote machine.
                       Combine with --bind and --open-firewall.

Uninstall:
  --uninstall          Stop the daemon, remove binaries and systemd units.
                       Config (/etc/machina) and data (/var/lib/machina)
                       are preserved — remove manually if desired.

Supported distributions:
  Fedora, RHEL 8/9, CentOS Stream, AlmaLinux, Rocky Linux,
  Ubuntu 20.04+, Debian 11+, Linux Mint, Pop!_OS,
  openSUSE Leap/Tumbleweed, SLES,
  Arch Linux, Manjaro, EndeavourOS.
  Other distros may work if dnf/apt/zypper/pacman is available.

What gets installed:
  /usr/local/bin/machina-daemon    Daemon binary (REST API + WebSocket)
  /usr/local/bin/machina           TUI binary (terminal interface)
  /usr/local/bin/machinactl        Management helper script
  /usr/local/share/machina/web/    Web UI (React frontend)
  /usr/local/share/machina/scripts/  Backup, demo, status scripts
  /etc/machina/config.toml         Daemon configuration
  /etc/default/machina-daemon      Optional env overrides (RUST_LOG, etc.; hyper2kvm-style)
  /etc/machina/backup.conf         Backup configuration
  /var/lib/machina/backups/        Backup storage directory
  /usr/lib/systemd/system/machina-daemon.service
  /usr/lib/systemd/system/machina-backup.{service,timer}

Prerequisites (installed automatically):
  - libvirt + QEMU/KVM
  - novnc + spice-html5 (in-browser graphical consoles at /novnc/ and /spice-html5/)
  - Rust toolchain (via rustup)
  - Node.js 18+ (via NodeSource if distro version is too old)
  - gcc, make, pkg-config, openssl, git, curl

Examples:
  Local install (default — binds to localhost only):
    sudo ./install.sh

  Install and expose on all interfaces with firewall open:
    sudo ./install.sh --bind 0.0.0.0 --open-firewall

  Deploy to a remote server:
    ./install.sh --remote root@192.168.1.100 --bind 0.0.0.0 --open-firewall

  Install dependencies first, build later:
    sudo ./install.sh --deps-only
    sudo ./install.sh

  Install with optional Apache Guacamole gateway:
    sudo ./install.sh --with-guacamole
    sudo ./install.sh --bind 0.0.0.0 --open-firewall --with-guacamole

  Remove machina:
    sudo ./install.sh --uninstall

After install:
  Web UI:    https://localhost:5092   (self-signed by default — browser warning until you install a real cert)
  TUI:       machina
  API test:  curl -sk https://localhost:5092/api/v1/health
  Logs:      sudo journalctl -u machina-daemon -f
  Config:    sudo vim /etc/machina/config.toml
  Restart:   sudo systemctl restart machina-daemon
HELPEOF
                exit 0
                ;;
        esac
    done

    # Remote deploy mode — doesn't need root locally
    if [ -n "$REMOTE_HOST" ]; then
        remote_deploy "$REMOTE_HOST"
        exit 0
    fi

    check_root
    detect_os
    check_arch

    if $do_uninstall; then
        uninstall
        exit 0
    fi

    info "Install log: $LOG_FILE"

    install_deps

    detect_bundle_install || true

    if [ "${BUNDLE_INSTALL:-false}" = true ] && [ "${BIND_EXPLICIT}" = false ]; then
        BIND_HOST="0.0.0.0"
        info "Client bundle: binding daemon to 0.0.0.0:${MACHINA_PORT} (pass --bind 127.0.0.1 for local-only)"
    fi

    if [ "${BUNDLE_INSTALL:-false}" != true ]; then
        install_rust
    else
        info "Client bundle detected — skipping Rust toolchain install (using prebuilt binaries)"
    fi

    if $deps_only; then
        if [ "${BUNDLE_INSTALL:-false}" = true ]; then
            ok "Host dependencies installed. Run: sudo $0 [--bind 0.0.0.0] [--open-firewall]"
        else
            ok "Dependencies installed. Run '$0' again to build and install."
        fi
        exit 0
    fi

    find_source

    if [ "${BUNDLE_INSTALL:-false}" = true ]; then
        enable_libvirt
        install_files
    else
        if $SKIP_BUILD; then
            if [ ! -x "$INSTALL_DIR/target/release/machina-daemon" ]; then
                fail "Missing target/release/machina-daemon — run make release (or install without --skip-build)"
            fi
            if [ ! -f "$INSTALL_DIR/web/dist/index.html" ]; then
                fail "Missing web/dist — run make web (or install without --skip-build)"
            fi
            info "Skipping Rust/web build (--skip-build)"
        else
            build_rust
            build_web
        fi
        # After sources compile: bring up libvirt so virsh failures do not obscure Rust build errors in the log.
        enable_libvirt
        install_files
    fi
    ensure_tls_for_https

    configure_host_firewall

    if $no_start; then
        ok "Installed but not started. Run: sudo systemctl start machina-daemon"
        exit 0
    fi

    start_daemon
    verify_novnc_serving
    if $WITH_GUACAMOLE; then
        install_guacamole_stack
    fi
    if $NO_TESTS; then
        info "Skipping verification tests (--no-tests)"
    else
        run_tests || true
    fi
    print_summary
}

main "$@"

#!/usr/bin/env bash
# install-packetwolf-remote.sh — deploy sibling ../packetwolf on the SSH host (sourced by deploy-remote.sh).
#
# Requires PACKETWOLF_SRC, REMOTE, HOST, USER, and ssh_r_bash from deploy-remote.sh.
set -euo pipefail

install_packetwolf_on_remote() {
    local pw_src="${PACKETWOLF_SRC:?}"
    local remote="${REMOTE:?}"
    local host="${HOST:?}"
    local user="${USER:?}"
    local pw_quick="${PACKETWOLF_DEPLOY_QUICK:-1}"

    if [[ ! -f "${pw_src}/Cargo.toml" ]]; then
        warn "No sibling ../packetwolf — skip PacketWolf deploy"
        return 0
    fi

    info "PacketWolf source → ${pw_src}"
    local pw_remote_dir
    pw_remote_dir="$(dirname "${REMOTE_DIR:-~/.deployment/machina}")/packetwolf"
    local pw_deploy=(env PACKETWOLF_LICENSE_ACCEPT=1 PACKETWOLF_E2E_STRICT=0)
    if [[ "${pw_quick}" == 1 ]]; then
        pw_deploy+=("${pw_src}/scripts/deploy-remote.sh" "${host}" "${user}" --quick --skip-e2e)
    else
        pw_deploy+=("${pw_src}/scripts/deploy-remote.sh" "${host}" "${user}" --skip-e2e)
    fi

    if ! "${pw_deploy[@]}"; then
        warn "PacketWolf deploy-remote failed (Machina deploy continues)"
        return 1
    fi

    info "Re-merge PacketWolf bridge env into machina-controller"
    ssh_r_bash "$remote" "
set -euo pipefail
cd ${REMOTE_DIR:-~/.deployment/machina}
if systemctl cat packetwolf-api.service &>/dev/null; then
  :
elif sudo /usr/local/bin/kubectl --kubeconfig=/etc/packetwolf/k3s.yaml get svc -A 2>/dev/null | grep -q packetwolf-api; then
  echo 'PacketWolf in-cluster — bridging via k8s port-forward on :9191'
else
  echo 'No host packetwolf-api.service or in-cluster packetwolf-api svc' >&2
  exit 1
fi
sudo bash scripts/install-platform.sh --merge-packetwolf-env
sudo systemctl restart machina-controller
echo 'machina-controller restarted with PacketWolf env'
" || {
        warn "PacketWolf env merge failed"
        return 1
    }
    ok "PacketWolf installed and controller bridge env updated"
}

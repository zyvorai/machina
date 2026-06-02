# Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
# shellcheck shell=bash
# Stop and disable host firewalls so Machina API/console ports are reachable remotely.

disable_firewalld() {
    local log_file="${1:-/dev/null}"
    local did=false

    if command -v systemctl &>/dev/null; then
        if systemctl list-unit-files 2>/dev/null | grep -q '^firewalld\.service'; then
            systemctl stop firewalld >>"$log_file" 2>&1 || true
            systemctl disable firewalld >>"$log_file" 2>&1 || true
            systemctl mask firewalld >>"$log_file" 2>&1 || true
            did=true
        fi
        if systemctl list-unit-files 2>/dev/null | grep -q '^ufw\.service'; then
            systemctl stop ufw >>"$log_file" 2>&1 || true
            systemctl disable ufw >>"$log_file" 2>&1 || true
            did=true
        fi
    fi

    if command -v ufw &>/dev/null; then
        ufw disable >>"$log_file" 2>&1 || true
        did=true
    fi

    if $did; then
        return 0
    fi
    return 1
}

#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Resolve canonical Zyvor license root (packetwolf under tt/).
zyvor_canonical_root() {
    local script_dir="${1:?script dir}"
    local parent
    parent="$(cd "${script_dir}/../.." && pwd)"
    if [[ -d "${parent}/packetwolf/LICENSE" ]] || [[ -f "${parent}/packetwolf/LICENSE" ]]; then
        echo "${parent}/packetwolf"
        return 0
    fi
    # Do NOT silently fall back to the calling repo itself: this function's
    # copies (sync-*.sh) get distributed into every sibling repo, so a wrong
    # fallback here would make e.g. "forge" believe it is canonical and
    # overwrite every OTHER sibling's LICENSE/legal docs with its own.
    echo "ERROR: canonical Zyvor root not found (expected ${parent}/packetwolf/LICENSE) — refusing to guess" >&2
    return 1
}

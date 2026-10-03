#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Lightweight libvirt connectivity check for GitHub Actions (KVM optional).
set -euo pipefail

if ! command -v virsh >/dev/null 2>&1; then
  echo "virsh not installed — skipping libvirt smoke"
  exit 0
fi

echo "libvirt URI: ${LIBVIRT_DEFAULT_URI:-qemu:///system}"
virsh -c "${LIBVIRT_DEFAULT_URI:-qemu:///system}" list --all || {
  echo "virsh list failed (no KVM session is OK on shared runners)"
  exit 0
}

echo "Running machina-core guest network parser tests…"
cargo test -p machina-core guest_agent::tests -- --nocapture

echo "libvirt smoke OK"

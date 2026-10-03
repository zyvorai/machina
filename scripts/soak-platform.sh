#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# 7-day soak helper — run platform E2E in a loop (batch 16)
# Usage: SOAK_DAYS=7 SOAK_INTERVAL_SEC=300 ./scripts/soak-platform.sh user host
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_HOST=${1:?usage: soak-platform.sh user host}
DAYS=${SOAK_DAYS:-7}
INTERVAL=${SOAK_INTERVAL_SEC:-300}
END=$(( $(date +%s) + DAYS * 86400 ))
ITER=0

echo "Soak: ${DAYS} days, interval ${INTERVAL}s, target ${USER_HOST}"

while [[ $(date +%s) -lt $END ]]; do
  ITER=$((ITER + 1))
  echo "--- iteration $ITER @ $(date -Iseconds) ---"
  if "$ROOT/scripts/e2e-platform-test-remote.sh" "$USER_HOST"; then
    echo "iteration $ITER PASS"
  else
    echo "iteration $ITER FAIL" >&2
    exit 1
  fi
  sleep "$INTERVAL"
done

echo "Soak complete: $ITER iterations"

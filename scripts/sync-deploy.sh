#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Deprecated — use: ./scripts/deploy remote …
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-remote.sh" "$@"

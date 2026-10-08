#!/bin/bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Run ON THE CONTROLLER (as root). Prints one single-use join command; never prints the admin password.
set -euo pipefail
ENVF=/etc/default/machina-platform
B=http://127.0.0.1:5093
val() { { grep "^$1=" "$ENVF" || true; } | head -1 | cut -d= -f2-; }
USER_NAME="$(val MACHINA_ADMIN_USER)"; USER_NAME="${USER_NAME:-admin}"
PASS="$(val MACHINA_ADMIN_PASSWORD)"
JWT="$(curl -fsS -X POST "$B/api/v1/auth/login" -H 'content-type: application/json' \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"username": sys.argv[1], "password": sys.argv[2]}))' "$USER_NAME" "$PASS")" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')"
curl -fsS -X POST "$B/api/v1/enrollment/tokens" -H "authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"ttl_hours":1}' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); c=d.get("join_command"); print(c if c else "NO_JOIN_COMMAND")'

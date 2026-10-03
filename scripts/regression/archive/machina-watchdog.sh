#!/bin/bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

LOG=/tmp/machina-watchdog.log
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) watchdog start" >> "$LOG"
while true; do
  sleep 45
  if ! curl -sf http://127.0.0.1:9222/json/version >/dev/null; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) restart chrome" >> "$LOG"
    pkill -f 'remote-debugging-port=9222' 2>/dev/null || true
    sleep 1
    DATA=/tmp/machina-chrome-test-profile3
    mkdir -p "$DATA"
    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
      --user-data-dir="$DATA" \
      --remote-debugging-port=9222 \
      --ignore-certificate-errors \
      --no-first-run \
      --no-default-browser-check \
      --disable-background-networking \
      about:blank >> /tmp/machina-chrome.log 2>&1 &
    sleep 4
  fi
  if ! pgrep -f 'forever-pages.js' >/dev/null; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) restart forever-pages" >> "$LOG"
    nohup node /tmp/machina-cdp-test/forever-pages.js >> /tmp/machina-forever-pages.log 2>&1 &
  fi
  if ! pgrep -f 'forever-api.js' >/dev/null; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) restart forever-api" >> "$LOG"
    nohup node /tmp/machina-cdp-test/forever-api.js >> /tmp/machina-forever-api.log 2>&1 &
  fi
done

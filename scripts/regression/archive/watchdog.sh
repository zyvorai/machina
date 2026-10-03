#!/bin/bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

LOG=/tmp/machina-continuous-watchdog.log
for i in $(seq 1 20); do
  if ! pgrep -f 'continuous-10.js' >/dev/null; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) restart #$i" | tee -a "$LOG"
    # ensure chrome
    if ! curl -s -o /dev/null http://127.0.0.1:9222/json/list; then
      DATA=/tmp/machina-chrome-test-profile
      rm -rf "$DATA"; mkdir -p "$DATA"
      /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
        --user-data-dir="$DATA" --remote-debugging-port=9222 --ignore-certificate-errors \
        --no-first-run --no-default-browser-check about:blank > /tmp/machina-chrome.log 2>&1 &
      sleep 4
    fi
    nohup node /tmp/machina-cdp-test/continuous-10.js >> /tmp/machina-continuous-10.log 2>&1 &
    echo "started pid $!" | tee -a "$LOG"
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ok pid=$(pgrep -f continuous-10.js)" >> "$LOG"
  fi
  sleep 120
done
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) watchdog done" | tee -a "$LOG"

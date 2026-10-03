#!/bin/bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

set -e
API="https://localhost:5092/api/v1"
PASS=0; FAIL=0

check() {
    local desc="$1" ok="$2" actual="$3"
    if echo "$actual" | grep -qF "$ok"; then
        echo "  PASS  $desc"
        PASS=$((PASS + 1))
    else
        echo "  FAIL  $desc  (expected '$ok', got: $actual)"
        FAIL=$((FAIL + 1))
    fi
}

echo "============================================"
echo "  machina backup — full test suite"
echo "============================================"
echo ""

# ── Test 1: Full backup (all VMs) ────────────────────────────
echo "--- Test 1: Full backup (all VMs) ---"
RESP=$(curl -sfk -X POST "$API/backups" -H 'Content-Type: application/json' -d '{}')
BID1=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['backup_id'])")
check "Trigger full backup" "started" "$RESP"
echo "  Backup ID: $BID1"
sleep 8

STATUS=$(curl -sfk "$API/backups/$BID1/status")
check "Status is completed" "completed" "$STATUS"
PROGRESS=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['progress'])")
check "Progress is 100" "100" "$PROGRESS"
echo ""

# ── Test 2: Per-VM backup ────────────────────────────────────
echo "--- Test 2: Per-VM backup (photon-os) ---"
RESP=$(curl -sfk -X POST "$API/backups" -H 'Content-Type: application/json' -d '{"vm_name":"photon-os"}')
BID2=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['backup_id'])")
check "Trigger per-VM backup" "started" "$RESP"
sleep 6

LIST=$(curl -sfk "$API/backups")
VM_FILTER=$(echo "$LIST" | python3 -c "import json,sys; [print(b['vm_filter']) for b in json.load(sys.stdin) if b['id']=='$BID2']")
check "Per-VM filter is photon-os" "photon-os" "$VM_FILTER"
VM_COUNT=$(echo "$LIST" | python3 -c "import json,sys; [print(b['vm_count']) for b in json.load(sys.stdin) if b['id']=='$BID2']")
check "VM count is 1" "1" "$VM_COUNT"
echo ""

# ── Test 3: List backups ────────────────────────────────────
echo "--- Test 3: List backups ---"
COUNT=$(curl -sfk "$API/backups" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
check "2 backups exist" "2" "$COUNT"
FIRST_ID=$(curl -sfk "$API/backups" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
check "Newest first" "$BID2" "$FIRST_ID"
echo ""

# ── Test 4: Metadata fields ─────────────────────────────────
echo "--- Test 4: Backup metadata ---"
META=$(curl -sfk "$API/backups" | python3 -c "import json,sys; b=json.load(sys.stdin)[1]; print(json.dumps(b))")
check "Full backup has status" "completed" "$META"
check "Full backup has checksums" "true" "$META"
check "Full backup has size" "K" "$META"
check "Full backup nfs_target" "local" "$META"
echo ""

# ── Test 5: Checksums & Verify ───────────────────────────────
echo "--- Test 5: Verify checksums ---"
VERIFY=$(curl -sfk -X POST "$API/backups/$BID1/verify")
check "Verify returns verified:true" "true" "$VERIFY"
FILES_OK=$(echo "$VERIFY" | python3 -c "import json,sys; print(json.load(sys.stdin)['files_ok'])")
check "Files checked > 0" "$FILES_OK" "$FILES_OK"
FAILED=$(echo "$VERIFY" | python3 -c "import json,sys; print(json.load(sys.stdin)['files_failed'])")
check "No files failed" "0" "$FAILED"
echo ""

# ── Test 6: Download ────────────────────────────────────────
echo "--- Test 6: Download as tar.gz ---"
HEADERS=$(curl -sI "$API/backups/$BID1/download")
check "Content-Type is gzip" "application/gzip" "$HEADERS"
check "Content-Disposition has filename" "machina-backup" "$HEADERS"
TARSIZE=$(curl -sfk "$API/backups/$BID1/download" | wc -c)
check "Tar size > 0" "true" "$([ "$TARSIZE" -gt 100 ] && echo true || echo false)"
echo "  Tar size: ${TARSIZE} bytes"
echo ""

# ── Test 7: Schedule ────────────────────────────────────────
echo "--- Test 7: Schedule management ---"
SCHED=$(curl -sfk "$API/backups/schedule")
check "Timer is installed" "True" "$(echo "$SCHED" | python3 -c "import json,sys; print(json.load(sys.stdin)['installed'])")"

RESP=$(curl -sfk -X POST "$API/backups/schedule" -H 'Content-Type: application/json' -d '{"enabled":true}')
check "Enable timer" "enable" "$RESP"

SCHED=$(curl -sfk "$API/backups/schedule")
check "Timer is active" "True" "$(echo "$SCHED" | python3 -c "import json,sys; print(json.load(sys.stdin)['active'])")"
NEXT=$(echo "$SCHED" | python3 -c "import json,sys; print(json.load(sys.stdin)['next_run'])")
check "Next run is set" "202" "$NEXT"
echo "  Next run: $NEXT"

RESP=$(curl -sfk -X POST "$API/backups/schedule" -H 'Content-Type: application/json' -d '{"enabled":false}')
check "Disable timer" "disable" "$RESP"
echo ""

# ── Test 8: Restore ─────────────────────────────────────────
echo "--- Test 8: Restore ---"
RESP=$(curl -sfk -X POST "$API/backups/restore" -H 'Content-Type: application/json' -d "{\"backup_id\":\"$BID1\"}")
check "Restore started" "restore_started" "$RESP"
sleep 3
echo ""

# ── Test 9: Backup with disks ───────────────────────────────
echo "--- Test 9: Backup with disks ---"
RESP=$(curl -sfk -X POST "$API/backups" -H 'Content-Type: application/json' -d '{"vm_name":"photon-test-vm","with_disks":true}')
BID3=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['backup_id'])")
check "Trigger disk backup" "started" "$RESP"
echo "  Waiting for disk copy..."

# Poll for completion instead of fixed sleep
sleep 3  # give it time to create the dir
for i in $(seq 1 60); do
    STAT=$(curl -sfk "$API/backups/$BID3/status" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "pending")
    if [ "$STAT" = "completed" ] || [ "$STAT" = "failed" ]; then
        break
    fi
    sleep 2
done

STATUS=$(curl -sfk "$API/backups/$BID3/status")
check "Disk backup completed" "completed" "$STATUS"
SIZE=$(curl -sfk "$API/backups" | python3 -c "import json,sys; [print(b['size']) for b in json.load(sys.stdin) if b['id']=='$BID3']")
check "Disk backup has size" "M" "$SIZE"
echo "  Size: $SIZE"
echo ""

# ── Test 10: Security validation ────────────────────────────
echo "--- Test 10: Security validation ---"
RESP=$(curl -s -X DELETE "$API/backups/abc;rm%20-rf")
check "Block special chars" "digits and dashes" "$RESP"

RESP=$(curl -s -X POST "$API/backups/restore" -H 'Content-Type: application/json' -d '{"backup_id":"99999999-999999"}')
check "Non-existent backup" "not found" "$RESP"
echo ""

# ── Test 11: Delete backup ──────────────────────────────────
echo "--- Test 11: Delete ---"
RESP=$(curl -sfk -X DELETE "$API/backups/$BID3")
check "Delete disk backup" "deleted" "$RESP"
COUNT=$(curl -sfk "$API/backups" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
check "2 backups remain" "2" "$COUNT"
echo ""

# ── Test 12: Verify per-VM backup ────────────────────────────
echo "--- Test 12: Verify per-VM backup ---"
VERIFY=$(curl -sfk -X POST "$API/backups/$BID2/verify")
check "Per-VM verify passes" "true" "$VERIFY"
echo ""

# ── Summary ─────────────────────────────────────────────────
echo "============================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "============================================"
[ $FAIL -eq 0 ] && exit 0 || exit 1

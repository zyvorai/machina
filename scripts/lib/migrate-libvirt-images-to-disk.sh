#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# migrate-libvirt-images-to-disk.sh — move /var/lib/libvirt/images to a large disk (bind mount).
#
# Safe default: rsync to TARGET/libvirt/images, bind-mount over the original path
# so libvirt pool XML and Machina paths keep using /var/lib/libvirt/images.
#
#   sudo ./scripts/lib/migrate-libvirt-images-to-disk.sh /sdb
#   sudo ./scripts/lib/migrate-libvirt-images-to-disk.sh /sdb --dry-run
#   sudo ./scripts/lib/migrate-libvirt-images-to-disk.sh /data --shutdown-vms
#
set -euo pipefail

TARGET_ROOT="${1:-/sdb}"
shift || true

DRY_RUN=false
SHUTDOWN_VMS=false
YES=false

usage() {
  cat <<'EOF'
Usage: migrate-libvirt-images-to-disk.sh [TARGET_MOUNT] [options]

  TARGET_MOUNT   Large disk mount (default: /sdb). Images go to TARGET/libvirt/images.

Options:
  --dry-run        Show planned actions only
  --shutdown-vms   virsh shutdown all running domains before copy
  --yes            Skip confirmation prompt
  -h, --help       This help

Example (175.110.114.93):
  sudo ./scripts/lib/migrate-libvirt-images-to-disk.sh /sdb --shutdown-vms --yes
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --shutdown-vms) SHUTDOWN_VMS=true; shift ;;
    --yes) YES=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# TARGET_ROOT is interpolated inside single-quoted strings that get eval'd (see run()
# below); reject anything that could break out of that quoting (e.g. a stray "'") and
# cause arbitrary command execution.
if [[ ! "$TARGET_ROOT" =~ ^[A-Za-z0-9_./-]+$ ]]; then
  echo "ERROR: invalid target mount path: '$TARGET_ROOT' (only letters, digits, '.', '/', '_', '-' allowed)" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

SOURCE="/var/lib/libvirt/images"
TARGET="${TARGET_ROOT%/}/libvirt/images"
BACKUP="${SOURCE}.pre-bind-migrate"

log() { printf '▶ %s\n' "$*"; }
run() {
  if $DRY_RUN; then
    printf '[dry-run] %s\n' "$*"
  else
    log "$*"
    eval "$@"
  fi
}

ensure_target_mounted() {
  if mountpoint -q "$TARGET_ROOT" 2>/dev/null; then
    log "Target mount OK: $TARGET_ROOT"
    return 0
  fi
  if [[ -b /dev/sdb1 ]] && ! mountpoint -q "$TARGET_ROOT" 2>/dev/null; then
    log "Mounting /dev/sdb1 -> $TARGET_ROOT"
    run "mkdir -p '$TARGET_ROOT'"
    if ! $DRY_RUN; then
      mount /dev/sdb1 "$TARGET_ROOT" 2>/dev/null || mount /dev/sdb "$TARGET_ROOT" 2>/dev/null || true
    fi
  fi
  if [[ -b /dev/sdb ]] && ! mountpoint -q "$TARGET_ROOT" 2>/dev/null; then
    log "Trying mount /dev/sdb -> $TARGET_ROOT"
    run "mkdir -p '$TARGET_ROOT'"
    if ! $DRY_RUN; then
      mount /dev/sdb "$TARGET_ROOT" 2>/dev/null || true
    fi
  fi
  if ! mountpoint -q "$TARGET_ROOT" 2>/dev/null; then
    echo "ERROR: $TARGET_ROOT is not a mount point. Mount /dev/sdb first, e.g.:" >&2
    echo "  sudo mkdir -p /sdb && sudo mount /dev/sdb1 /sdb   # or whole-disk fs" >&2
    exit 1
  fi
}

already_migrated() {
  if mountpoint -q "$SOURCE" 2>/dev/null; then
    local src
    src="$(findmnt -n -o SOURCE --target "$SOURCE" 2>/dev/null || true)"
    if [[ "$src" == "$TARGET" ]] || [[ "$src" == *"/sdb"* ]]; then
      log "Already bind-mounted: $SOURCE <- $src"
      df -h "$SOURCE" "$TARGET_ROOT"
      exit 0
    fi
  fi
}

# Refuse to rsync a live libvirt images directory out from under running VMs unless
# the operator explicitly opted into --shutdown-vms (or there is nothing running).
# Copying open/actively-written disk images can yield an inconsistent copy, and the
# later mv+bind-mount swap happens underneath any qemu process still holding the old
# file open — a real corruption risk, not just a cosmetic one.
check_running_vms() {
  command -v virsh &>/dev/null || return 0
  local running
  running="$(virsh list --name 2>/dev/null | sed '/^$/d')"
  [[ -z "$running" ]] && return 0

  if $SHUTDOWN_VMS; then
    log "Running VM(s) detected, will shut down (--shutdown-vms): $(tr '\n' ' ' <<<"$running")"
    return 0
  fi

  if $DRY_RUN; then
    log "[dry-run] WARNING: VM(s) currently running: $(tr '\n' ' ' <<<"$running")"
    log "[dry-run] would refuse to proceed for real without --shutdown-vms"
    return 0
  fi

  echo "ERROR: VM(s) currently running: $(tr '\n' ' ' <<<"$running")" >&2
  echo "  Migrating live disk images while VMs are running risks a corrupted/inconsistent copy." >&2
  echo "  Re-run with --shutdown-vms to shut them down first, or stop them manually and retry." >&2
  exit 1
}

# Abort before a large rsync if the target clearly doesn't have room, rather than
# discovering a full disk (and a truncated copy) partway through the transfer.
check_free_space() {
  local need_kb avail_kb
  need_kb="$(du -sk "$SOURCE" 2>/dev/null | awk '{print $1}')"
  avail_kb="$(df -Pk "$TARGET_ROOT" 2>/dev/null | awk 'NR==2{print $4}')"
  if [[ -z "$need_kb" || -z "$avail_kb" ]]; then
    log "WARNING: could not determine source/target size — skipping free-space check"
    return 0
  fi
  local need_with_margin=$(( need_kb + need_kb / 10 + 1 ))
  if (( avail_kb < need_with_margin )); then
    echo "ERROR: not enough free space on $TARGET_ROOT for the migration" >&2
    echo "  need ~${need_kb} KB (+10% margin = ${need_with_margin} KB), have ${avail_kb} KB available" >&2
    exit 1
  fi
  log "Free space OK on $TARGET_ROOT: need ~${need_kb} KB (+10% margin), have ${avail_kb} KB"
}

main() {
  ensure_target_mounted
  already_migrated
  check_running_vms

  log "Layout:"
  df -h "$SOURCE" "$TARGET_ROOT" 2>/dev/null || true
  lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT | sed 's/^/  /'

  local used
  used="$(du -sh "$SOURCE" 2>/dev/null | awk '{print $1}' || echo '?')"
  log "Source $SOURCE uses ~${used}; target ${TARGET}"

  check_free_space

  if ! $YES && ! $DRY_RUN; then
    read -r -p "Migrate $SOURCE -> $TARGET and bind-mount? [y/N] " ans
    [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]] || { echo "Aborted."; exit 1; }
  fi

  if $SHUTDOWN_VMS && command -v virsh &>/dev/null; then
    log "Shutting down running VMs (best-effort)…"
    while read -r name; do
      [[ -z "$name" ]] && continue
      if $DRY_RUN; then
        printf '[dry-run] virsh shutdown %q\n' "$name"
      else
        log "virsh shutdown $name"
        virsh shutdown "$name" || true
      fi
    done < <(virsh list --name 2>/dev/null || true)
    if ! $DRY_RUN; then
      sleep 5
      while read -r name; do
        [[ -z "$name" ]] && continue
        virsh destroy "$name" 2>/dev/null || true
      done < <(virsh list --name 2>/dev/null || true)
    fi
  fi

  run "systemctl stop machina-daemon machina-agent 2>/dev/null || true"

  run "mkdir -p '$TARGET'"
  if [[ -d "$BACKUP" ]]; then
    echo "ERROR: backup $BACKUP already exists — resolve manually" >&2
    exit 1
  fi

  run "rsync -aHAX --info=progress2 '$SOURCE/' '$TARGET/'"

  if ! mountpoint -q "$SOURCE" 2>/dev/null; then
    if [[ -d "$SOURCE" ]] && [[ "$(ls -A "$SOURCE" 2>/dev/null | wc -l)" -gt 0 ]]; then
      run "mv '$SOURCE' '$BACKUP'"
      run "mkdir -p '$SOURCE'"
      run "chmod 0711 '$SOURCE'"
    fi
  fi

  FSTAB_LINE="${TARGET} ${SOURCE} none bind 0 0"
  if ! $DRY_RUN; then
    if ! grep -qF "$FSTAB_LINE" /etc/fstab 2>/dev/null; then
      printf '%s\n' "$FSTAB_LINE" >> /etc/fstab
      log "Added fstab bind entry"
    fi
    mount --bind "$TARGET" "$SOURCE"
  else
    run "echo '$FSTAB_LINE' >> /etc/fstab"
    run "mount --bind '$TARGET' '$SOURCE'"
  fi

  run "virsh pool-refresh default 2>/dev/null || true"
  run "systemctl start machina-daemon machina-agent 2>/dev/null || true"

  log "Done. Verify:"
  if ! $DRY_RUN; then
    df -h "$SOURCE" "$TARGET_ROOT"
    findmnt "$SOURCE" || true
    virsh pool-info default 2>/dev/null || true
    echo "Backup kept at $BACKUP — remove after validation: rm -rf '$BACKUP'"
  fi
}

main

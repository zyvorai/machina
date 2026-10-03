#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Upload all 5 Firecracker-launch demo videos to YouTube (public) and wire
# them into ../hypersdk-web. Mirrors publish-hardware-reel.sh's pattern.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SECRETS="${YT_CLIENT_SECRETS:-$HOME/Desktop/Zeus-OS-Demo-Videos/client_secret_369624289033-fphugk292q2ff61cb25aqetljgus4aoi.apps.googleusercontent.com.json}"
TOKEN="${YT_TOKEN:-$HOME/Desktop/Zeus-OS-Demo-Videos/.youtube-upload/token.json}"
PY="${YT_PYTHON:-$HOME/Desktop/zyvor-demo-videos/.venv/bin/python}"
WEB_ROOT="${HYPERSDK_WEB:-$HOME/tt/hypersdk-web}"
DEMO_TS="$WEB_ROOT/src/data/product-demo-videos.ts"
[[ -x "$PY" ]] || PY=python3

upload_one() {
  local video="$1" state_key="$2" title="$3" desc="$4"
  [[ -f "$video" ]] || { echo "missing $video"; exit 2; }
  "$PY" upload-wow-reel.py \
    --video "$video" \
    --client-secrets "$SECRETS" \
    --token "$TOKEN" \
    --privacy public \
    --state out/youtube-state.json \
    --state-key "$state_key" \
    --title "$title" \
    --description "$desc"
}

MACHINA_FOOTER='
→ https://zyvor.dev/machina
→ Trial: https://zyvor.dev/contact?intent=trial&product=machina

#Machina #Firecracker #KVM #libvirt #Zyvor #virtualization #microVM'

GUESTKIT_FOOTER='
→ https://zyvor.dev/guestkit

#GuestKit #Firecracker #KVM #libvirt #Zyvor #virtualization'

upload_one "out/machina-firecracker-cli.mp4" "machina-firecracker-cli" \
  "Machina — Firecracker Sprite Backend, Live (CLI → SSH → Internet)" \
  "machinactl sprite create --backend firecracker --network-egress, on a real lab host: real vsock CID, real SSH login, real DHCP lease, and a real curl to the internet.

Firecracker joins libvirt/QEMU and Cloud Hypervisor as a third sprite backend — same disposable, TTL-reaped, destroy-only API, a different VMM underneath.${MACHINA_FOOTER}"

upload_one "out/machina-three-backends.mp4" "machina-three-backends" \
  "Machina — Three Hypervisors, One Sprite API" \
  "Three concurrent sprites — one on libvirt, one on Cloud Hypervisor, one on Firecracker — created in parallel from the same machinactl call, drawing distinct vsock CIDs from one shared, backend-agnostic allocator. Zero collisions.${MACHINA_FOOTER}"

upload_one "out/machina-firecracker-boot-bug.mp4" "machina-firecracker-boot-bug" \
  "Machina Engineering — A Real Firecracker Boot Bug, Found Live" \
  "Firecracker silently appends its own root=/dev/vda (whole-disk, no partition) for the root drive — after whatever boot_args you supply. A caller-set root=/dev/vda1 just loses.

This is the real console log from finding that live: the kernel panic, the root-cause, the fix (extract the root partition into an unpartitioned raw file), and the clean boot that followed.${MACHINA_FOOTER}"

upload_one "out/machina-sprites-web-ui-tour.mp4" "machina-sprites-web-ui-tour" \
  "Machina — Sprites Web UI: Three Backends, One Picker" \
  "A real, live recording of the Machina web dashboard's Sprites page: the three-way backend picker (Libvirt / Cloud Hypervisor / Firecracker), the network-egress toggle, and the live sprite list with vsock CIDs and expiry countdowns.${MACHINA_FOOTER}"

upload_one "out/machina-guestkit-install-pkgs.mp4" "guestkit-install-pkgs" \
  "GuestKit — Offline Package Install into a Golden Image" \
  "guestkit rescue -o install-packages: bind-mounts /proc,/sys,/dev into a mounted guest root and chroots apt-get/dnf/apk/pacman straight into it — no libguestfs appliance, no network stack inside a helper VM. --network temporarily swaps in the host's resolver so the package manager can actually resolve real repositories.

Real run: baking jq into a real qcow2 golden image, then confirming it's really there.${GUESTKIT_FOOTER}"

echo ""
echo "== Wiring hypersdk-web =="
IDS_JSON=$(python3 - <<'PY'
import json
from pathlib import Path
st = json.loads(Path("out/youtube-state.json").read_text())
keys = ["machina-firecracker-cli", "machina-three-backends", "machina-firecracker-boot-bug",
        "machina-sprites-web-ui-tour", "guestkit-install-pkgs"]
print(json.dumps({k: st[k] for k in keys}))
PY
)
echo "$IDS_JSON"

if [[ -f "$DEMO_TS" ]] && ! grep -q "MACHINA_FIRECRACKER_CLI_DEMO_VIDEO" "$DEMO_TS"; then
  IDS_JSON="$IDS_JSON" DEMO_TS="$DEMO_TS" python3 <<'PY'
import json
import os
from pathlib import Path

ids = json.loads(os.environ["IDS_JSON"])
p = Path(os.environ["DEMO_TS"])
text = p.read_text()

def js_str(s):
    # Single-quoted JS/TS string literal — escape backslashes and single quotes.
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"

def entry(const, key, title, desc):
    vid = ids[key]["id"]
    return f"""export const {const}: ProductDemoVideo = {{
  youtubeId: '{vid}',
  title: {js_str(title)},
  watchUrl: 'https://www.youtube.com/watch?v={vid}',
  description:
    {js_str(desc)},
}};

"""

machina_block = (
    "/** Machina — Firecracker sprite backend launch (Aug 2026), lab 175.110.122.71. */\n"
    + entry(
        "MACHINA_FIRECRACKER_CLI_DEMO_VIDEO", "machina-firecracker-cli",
        "Machina — Firecracker Sprite Backend, Live (CLI \\u2192 SSH \\u2192 Internet)",
        "machinactl sprite create --backend firecracker --network-egress: real vsock CID, real SSH, real DHCP lease, real internet access.",
    )
    + entry(
        "MACHINA_THREE_BACKENDS_DEMO_VIDEO", "machina-three-backends",
        "Machina — Three Hypervisors, One Sprite API",
        "libvirt, Cloud Hypervisor, and Firecracker sprites created concurrently, drawing distinct vsock CIDs from one shared allocator.",
    )
    + entry(
        "MACHINA_FIRECRACKER_BOOT_BUG_DEMO_VIDEO", "machina-firecracker-boot-bug",
        "Machina Engineering \\u2014 A Real Firecracker Boot Bug, Found Live",
        "The real console log: a kernel panic from Firecracker's auto-appended root=, the root cause, the fix, and the clean boot that followed.",
    )
    + entry(
        "MACHINA_SPRITES_WEB_UI_DEMO_VIDEO", "machina-sprites-web-ui-tour",
        "Machina \\u2014 Sprites Web UI: Three Backends, One Picker",
        "The live Sprites page: the three-way backend picker, the network-egress toggle, and the sprite list with vsock CIDs and expiry countdowns.",
    )
)

anchor = "const MACHINA_DEMO_VIDEOS_ALL: ProductDemoVideo[] = ["
if anchor not in text:
    raise SystemExit("MACHINA_DEMO_VIDEOS_ALL anchor missing")
text = text.replace(anchor, machina_block + anchor, 1)
old = "  MACHINA_CREATE_VM_DEMO_VIDEO,\n];"
new = (
    "  MACHINA_CREATE_VM_DEMO_VIDEO,\n"
    "  MACHINA_FIRECRACKER_CLI_DEMO_VIDEO,\n"
    "  MACHINA_THREE_BACKENDS_DEMO_VIDEO,\n"
    "  MACHINA_FIRECRACKER_BOOT_BUG_DEMO_VIDEO,\n"
    "  MACHINA_SPRITES_WEB_UI_DEMO_VIDEO,\n];"
)
if old not in text:
    raise SystemExit("MACHINA_DEMO_VIDEOS_ALL list tail anchor missing")
text = text.replace(old, new, 1)

gk_block = entry(
    "GUESTKIT_INSTALL_PACKAGES_DEMO_VIDEO", "guestkit-install-pkgs",
    "GuestKit \\u2014 Offline Package Install into a Golden Image",
    "guestkit rescue -o install-packages: chroot + bind mounts, no libguestfs appliance. Baking jq into a real qcow2 golden image and confirming it live.",
)
gk_anchor = "/** GuestKit live UX demos shown together on /guestkit"
if gk_anchor not in text:
    raise SystemExit("GuestKit anchor missing")
text = text.replace(gk_anchor, gk_block + gk_anchor, 1)
gk_old = "  GUESTKIT_WEB_TUTORIAL_DEMO_VIDEO,\n];"
gk_new = "  GUESTKIT_WEB_TUTORIAL_DEMO_VIDEO,\n  GUESTKIT_INSTALL_PACKAGES_DEMO_VIDEO,\n];"
if gk_old not in text:
    raise SystemExit("GUESTKIT_LIVE_DEMO_VIDEOS list tail anchor missing")
text = text.replace(gk_old, gk_new, 1)

p.write_text(text)
print(f"Wired {p}")
PY
  echo "Next: cd $WEB_ROOT && git add src/data/product-demo-videos.ts && git commit && git push"
else
  echo "hypersdk-web already has MACHINA_FIRECRACKER_CLI_DEMO_VIDEO or path missing — wire IDs manually"
fi

#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Build machina-guestkit-wow-reel from Playwright recording + title cards.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

W=1920
H=1080
FPS=30
CRF=18
PRESET=slow
FADE=0.35
PNG=png-guestkit

mkdir -p seg-gk out raw

src_of() { ls raw/"$1"/*.webm | head -1; }

make_title() {
  local out="$1" dur="$2" png="$3"
  local fout
  fout=$(python3 -c "print(${dur} - ${FADE})")
  ffmpeg -y -loop 1 -t "${dur}" -i "${PNG}/${png}.png" \
    -vf "fade=t=in:st=0:d=${FADE},fade=t=out:st=${fout}:d=${FADE}" \
    -r "${FPS}" -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "seg-gk/${out}" -loglevel error
  echo "  title: ${out} (${dur}s)"
}

extract_clip() {
  local segdir="$1" start="$2" dur="$3" out="$4" cap="$5"
  local src="$(src_of "${segdir}")"
  local tmp="seg-gk/_raw_${out}"
  local fout
  fout=$(python3 -c "print(${dur} - ${FADE})")
  ffmpeg -y -ss "${start}" -t "${dur}" -i "${src}" \
    -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p,fade=t=in:st=0:d=${FADE},fade=t=out:st=${fout}:d=${FADE}" \
    -an -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "${tmp}" -loglevel error
  ffmpeg -y -i "${tmp}" -loop 1 -i "${PNG}/${cap}.png" \
    -filter_complex "[0:v][1:v] overlay=(W-w)/2:H-h-60:shortest=1" \
    -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "seg-gk/${out}" -loglevel error
  rm -f "${tmp}"
  echo "  extract: ${out} [${start}, +${dur}]"
}

concat_to() {
  local outfile="$1"; shift
  local listfile="seg-gk/_list.txt"
  : > "${listfile}"
  for f in "$@"; do echo "file '${f}.mp4'" >> "${listfile}"; done
  ffmpeg -y -f concat -safe 0 -i "${listfile}" -c copy "out/${outfile}" -loglevel error
  echo "== built out/${outfile} =="
  ffprobe -v error -show_entries format=duration -of csv=p=0 "out/${outfile}"
}

# Optional: pass MARKS file with start offsets (seconds) for each clip.
# Format: login=6 health=12 sync=16.5 network=20 services=28 stop=32 start=36
MARKS_FILE="${1:-}"
login_s=6.0; health_s=12.0; sync_s=16.5; network_s=20.0; services_s=28.0; stop_s=32.0; start_s=36.0
if [[ -n "${MARKS_FILE}" && -f "${MARKS_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${MARKS_FILE}"
fi

echo "== Title cards =="
make_title "k00.mp4" 3.8 "gk00-title"
make_title "k01t.mp4" 1.5 "gk01-login"
make_title "k03t.mp4" 1.5 "gk02-health"
make_title "k05t.mp4" 1.5 "gk02b-network"
make_title "k07t.mp4" 1.5 "gk03-services"
make_title "k11.mp4" 3.5 "gk04-outro"

echo "== Clips =="
extract_clip "seg-gk-agent"  "${login_s}"    2.2 "k02.mp4" "cap-gk-login"
extract_clip "seg-gk-agent"  "${health_s}"   2.8 "k04.mp4" "cap-gk-health"
extract_clip "seg-gk-agent"  "${sync_s}"     2.5 "k05.mp4" "cap-gk-sync"
extract_clip "seg-gk-agent"  "${network_s}"  4.0 "k06.mp4" "cap-gk-network"
extract_clip "seg-gk-agent"  "${services_s}" 2.5 "k08.mp4" "cap-gk-stop"
extract_clip "seg-gk-agent"  "${stop_s}"     2.8 "k09.mp4" "cap-gk-stop"
extract_clip "seg-gk-agent"  "${start_s}"    2.8 "k10.mp4" "cap-gk-start"

concat_to "machina-guestkit-wow-reel.mp4" \
  k00 k01t k02 k03t k04 k05 k05t k06 k07t k08 k09 k10 k11

cp out/machina-guestkit-wow-reel.mp4 out/machina-guestkit-wow-reel-linkedin-1080p.mp4
ffmpeg -y -i out/machina-guestkit-wow-reel.mp4 -c:v libvpx-vp9 -b:v 0 -crf 32 -an \
  out/machina-guestkit-wow-reel.webm -loglevel error
echo "== Done =="

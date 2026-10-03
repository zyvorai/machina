#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Build machina-sprites-wow-reel from the seg-sprites.mjs Playwright recording + title cards.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

W=1920
H=1080
FPS=30
CRF=18
PRESET=slow
FADE=0.35
PNG=png-sprites

mkdir -p seg-sprites out raw

src_of() { ls raw/"$1"/*.webm | head -1; }

make_title() {
  local out="$1" dur="$2" png="$3"
  local fout
  fout=$(python3 -c "print(${dur} - ${FADE})")
  ffmpeg -y -loop 1 -t "${dur}" -i "${PNG}/${png}.png" \
    -vf "fade=t=in:st=0:d=${FADE},fade=t=out:st=${fout}:d=${FADE}" \
    -r "${FPS}" -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "seg-sprites/${out}" -loglevel error
  echo "  title: ${out} (${dur}s)"
}

extract_clip() {
  local segdir="$1" start="$2" dur="$3" out="$4" cap="$5"
  local src="$(src_of "${segdir}")"
  local tmp="seg-sprites/_raw_${out}"
  local fout
  fout=$(python3 -c "print(${dur} - ${FADE})")
  ffmpeg -y -ss "${start}" -t "${dur}" -i "${src}" \
    -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p,fade=t=in:st=0:d=${FADE},fade=t=out:st=${fout}:d=${FADE}" \
    -an -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "${tmp}" -loglevel error
  ffmpeg -y -i "${tmp}" -loop 1 -i "${PNG}/${cap}.png" \
    -filter_complex "[0:v][1:v] overlay=(W-w)/2:H-h-60:shortest=1" \
    -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "seg-sprites/${out}" -loglevel error
  rm -f "${tmp}"
  echo "  extract: ${out} [${start}, +${dur}]"
}

concat_to() {
  local outfile="$1"; shift
  local listfile="seg-sprites/_list.txt"
  : > "${listfile}"
  for f in "$@"; do echo "file '${f}.mp4'" >> "${listfile}"; done
  ffmpeg -y -f concat -safe 0 -i "${listfile}" -c copy "out/${outfile}" -loglevel error
  echo "== built out/${outfile} =="
  ffprobe -v error -show_entries format=duration -of csv=p=0 "out/${outfile}"
}

# Video-relative seconds, calibrated from seg-sprites.mjs's own mark() log
# against the actual recorded webm duration — see build.sh's header comment
# for why marks (measured from process start) need this offset.
MARKS_FILE="${1:-}"
empty_s=41.1
libvirt_create_s=42.2
chv_create_s=47.1
list_both_s=75.1
delete_s=79.9
if [[ -n "${MARKS_FILE}" && -f "${MARKS_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${MARKS_FILE}"
fi

echo "== Title cards =="
make_title "k00.mp4" 3.8 "sp00-title"
make_title "k01t.mp4" 1.4 "sp01-empty"
make_title "k03t.mp4" 1.4 "sp02-libvirt"
make_title "k05t.mp4" 1.4 "sp03-chv"
make_title "k07t.mp4" 1.4 "sp04-list"
make_title "k09t.mp4" 1.4 "sp05-delete"
make_title "k11.mp4" 3.5 "sp06-outro"

echo "== Clips =="
extract_clip "seg-sprites" "${empty_s}"          1.0 "k02.mp4" "cap-sp-empty"
extract_clip "seg-sprites" "${libvirt_create_s}" 2.9 "k04.mp4" "cap-sp-libvirt"
extract_clip "seg-sprites" "${chv_create_s}"     2.5 "k06.mp4" "cap-sp-chv"
extract_clip "seg-sprites" "${list_both_s}"      4.0 "k08.mp4" "cap-sp-list"
extract_clip "seg-sprites" "${delete_s}"         2.0 "k10.mp4" "cap-sp-delete"

concat_to "machina-sprites-wow-reel.mp4" \
  k00 k01t k02 k03t k04 k05t k06 k07t k08 k09t k10 k11

cp out/machina-sprites-wow-reel.mp4 out/machina-sprites-wow-reel-linkedin-1080p.mp4
ffmpeg -y -i out/machina-sprites-wow-reel.mp4 -c:v libvpx-vp9 -b:v 0 -crf 32 -an \
  out/machina-sprites-wow-reel.webm -loglevel error

mkdir -p "$HOME/Desktop/Machina-Demo-Videos/sprites"
cp -f out/machina-sprites-wow-reel.mp4 \
      out/machina-sprites-wow-reel-linkedin-1080p.mp4 \
      out/machina-sprites-wow-reel.webm \
      "$HOME/Desktop/Machina-Demo-Videos/sprites/"
cp -f out/machina-sprites-wow-reel.mp4 "$HOME/Desktop/"
echo "== Done =="

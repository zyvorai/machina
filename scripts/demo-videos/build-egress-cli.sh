#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Build machina-sprite-cli-egress-demo from the terminal recording + title cards.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

W=1920
H=1080
FPS=30
CRF=18
PRESET=slow
FADE=0.35
PNG=png-egress-cli

mkdir -p seg-egress-cli out raw

src_of() { ls raw/"$1"/*.webm | head -1; }

make_title() {
  local out="$1" dur="$2" png="$3"
  local fout
  fout=$(python3 -c "print(${dur} - ${FADE})")
  ffmpeg -y -loop 1 -t "${dur}" -i "${PNG}/${png}.png" \
    -vf "fade=t=in:st=0:d=${FADE},fade=t=out:st=${fout}:d=${FADE}" \
    -r "${FPS}" -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "seg-egress-cli/${out}" -loglevel error
  echo "  title: ${out} (${dur}s)"
}

extract_clip() {
  local segdir="$1" start="$2" dur="$3" out="$4"
  local src="$(src_of "${segdir}")"
  local fout
  fout=$(python3 -c "print(${dur} - ${FADE})")
  ffmpeg -y -ss "${start}" -t "${dur}" -i "${src}" \
    -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p,fade=t=in:st=0:d=${FADE},fade=t=out:st=${fout}:d=${FADE}" \
    -an -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "seg-egress-cli/${out}" -loglevel error
  echo "  extract: ${out} [${start}, +${dur}]"
}

concat_to() {
  local outfile="$1"; shift
  local listfile="seg-egress-cli/_list.txt"
  : > "${listfile}"
  for f in "$@"; do echo "file '${f}.mp4'" >> "${listfile}"; done
  ffmpeg -y -f concat -safe 0 -i "${listfile}" -c copy "out/${outfile}" -loglevel error
  echo "== built out/${outfile} =="
  ffprobe -v error -show_entries format=duration -of csv=p=0 "out/${outfile}"
}

echo "== Title cards =="
make_title "k00.mp4" 4.0 "ec00-title"
make_title "k02.mp4" 3.8 "ec01-outro"

echo "== Terminal clip =="
DEMO_DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$(src_of seg-terminal-egress)")"
extract_clip "seg-terminal-egress" 0 "${DEMO_DUR}" "k01.mp4"

concat_to "machina-sprite-cli-egress-demo.mp4" k00 k01 k02

cp out/machina-sprite-cli-egress-demo.mp4 out/machina-sprite-cli-egress-demo-linkedin-1080p.mp4
ffmpeg -y -i out/machina-sprite-cli-egress-demo.mp4 -c:v libvpx-vp9 -b:v 0 -crf 32 -an \
  out/machina-sprite-cli-egress-demo.webm -loglevel error

mkdir -p "$HOME/Desktop/Machina-Demo-Videos/sprite-cli-egress"
cp -f out/machina-sprite-cli-egress-demo.mp4 \
      out/machina-sprite-cli-egress-demo-linkedin-1080p.mp4 \
      out/machina-sprite-cli-egress-demo.webm \
      "$HOME/Desktop/Machina-Demo-Videos/sprite-cli-egress/"
cp -f out/machina-sprite-cli-egress-demo.mp4 "$HOME/Desktop/"
echo "== Done =="

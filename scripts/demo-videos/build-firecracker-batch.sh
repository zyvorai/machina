#!/usr/bin/env bash
# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

# Build all 5 Firecracker-launch demo videos from their recordings + title cards.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

W=1920
H=1080
FPS=30
CRF=18
PRESET=slow
FADE=0.35
PNG=png-firecracker
SEG=seg-firecracker-batch

mkdir -p "$SEG" out

src_of() { ls raw/"$1"/*.webm | head -1; }

make_title() {
  local out="$1" dur="$2" png="$3"
  local fout
  fout=$(python3 -c "print(${dur} - ${FADE})")
  ffmpeg -y -loop 1 -t "${dur}" -i "${PNG}/${png}.png" \
    -vf "fade=t=in:st=0:d=${FADE},fade=t=out:st=${fout}:d=${FADE}" \
    -r "${FPS}" -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "${SEG}/${out}" -loglevel error
  echo "  title: ${out} (${dur}s)"
}

extract_clip() {
  local segdir="$1" start="$2" dur="$3" out="$4"
  local src="$(src_of "${segdir}")"
  local fout
  fout=$(python3 -c "print(${dur} - ${FADE})")
  ffmpeg -y -ss "${start}" -t "${dur}" -i "${src}" \
    -vf "scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p,fade=t=in:st=0:d=${FADE},fade=t=out:st=${fout}:d=${FADE}" \
    -an -c:v libx264 -preset "${PRESET}" -crf "${CRF}" -pix_fmt yuv420p -movflags +faststart "${SEG}/${out}" -loglevel error
  echo "  extract: ${out} [${start}, +${dur}]"
}

concat_to() {
  local outfile="$1"; shift
  local listfile="${SEG}/_list.txt"
  : > "${listfile}"
  for f in "$@"; do echo "file '${f}.mp4'" >> "${listfile}"; done
  ffmpeg -y -f concat -safe 0 -i "${listfile}" -c copy "out/${outfile}" -loglevel error
  echo "== built out/${outfile} =="
  ffprobe -v error -show_entries format=duration -of csv=p=0 "out/${outfile}"
}

build_one() {
  local name="$1" segdir="$2" title_png="$3" outro_png="$4" title_dur="${5:-4.0}" outro_dur="${6:-3.8}" clip_start="${7:-0}"
  echo "== ${name} =="
  make_title "${name}-k00.mp4" "${title_dur}" "${title_png}"
  local total dur
  total="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$(src_of "${segdir}")")"
  dur="$(python3 -c "print(${total} - ${clip_start})")"
  extract_clip "${segdir}" "${clip_start}" "${dur}" "${name}-k01.mp4"
  make_title "${name}-k02.mp4" "${outro_dur}" "${outro_png}"
  concat_to "machina-${name}.mp4" "${name}-k00" "${name}-k01" "${name}-k02"
}

build_one "firecracker-cli"       seg-fc-cli           fc-cli-title fc-cli-outro
build_one "three-backends"        seg-three-backends    three-title  three-outro
build_one "firecracker-boot-bug"  seg-fc-bug            bug-title    bug-outro
build_one "guestkit-install-pkgs" seg-guestkit-install  gk-title     gk-outro
build_one "sprites-web-ui-tour"   seg-sprites-fc        ui-title     ui-outro 4.0 4.0 39

echo "== transcoding to webm + copying to LinkedIn-friendly names =="
mkdir -p "$HOME/Desktop/Machina-Demo-Videos/firecracker-launch"
for f in firecracker-cli three-backends firecracker-boot-bug guestkit-install-pkgs sprites-web-ui-tour; do
  cp out/machina-${f}.mp4 out/machina-${f}-linkedin-1080p.mp4
  ffmpeg -y -i out/machina-${f}.mp4 -c:v libvpx-vp9 -b:v 0 -crf 32 -an out/machina-${f}.webm -loglevel error
  cp -f out/machina-${f}.mp4 out/machina-${f}-linkedin-1080p.mp4 out/machina-${f}.webm \
    "$HOME/Desktop/Machina-Demo-Videos/firecracker-launch/"
  cp -f out/machina-${f}.mp4 "$HOME/Desktop/"
  echo "  -> ${f} done"
done

echo "== Done =="

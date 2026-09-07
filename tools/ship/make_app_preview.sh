#!/usr/bin/env bash
#
# Build an App Store app preview from a raw iOS screen recording, and check one before upload.
#
#   tools/ship/make_app_preview.sh export raw.mov preview_65.mov      # convert to App Store spec
#   tools/ship/make_app_preview.sh export raw.mov out.mov --start 12  # take the segment from 0:12
#   tools/ship/make_app_preview.sh check preview_65.mov               # validate a finished file
#
# Why this exists. Build 1.0.8 (52) was rejected on 2026-09-06 under Guideline 2.3.4 because the
# preview was a screen recording composited INSIDE a white tablet mockup, with black bars on all
# four sides. Apple's wording: "Includes device images and/or device frames." A device frame always
# leaves letterboxing, and letterboxing is measurable - so `check` measures it. That check is the
# whole point of this script; the conversion is the easy half.
#
# The same rule as tools/ship/ship_testflight.sh applies: an exit code is not evidence. `export`
# runs `check` against its own output before it will call the file done.
#
# Needs ffmpeg + ffprobe. Runs anywhere they do, this repo's Windows checkout included - unlike
# ship_testflight.sh, which is macOS-only.

set -euo pipefail

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  sed -n '3,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

command -v ffmpeg  >/dev/null || fail "ffmpeg not installed"
command -v ffprobe >/dev/null || fail "ffprobe not installed"

# The only sizes App Store Connect accepts for the iPhone 6.5"/6.7"/6.9" portrait preview slot.
# This app is iPhone-only and portrait-only - ios/project.yml sets TARGETED_DEVICE_FAMILY "1" and
# UIInterfaceOrientationPortrait - so there is deliberately no landscape or iPad size here.
# Media Manager states the requirement for any other slot; trust it over this list if they differ.
SIZES="886x1920 1080x1920"

MIN_SECONDS=15
MAX_SECONDS=30

# Letterbox detection. An edge strip is called a black border when it is BOTH near-black in
# absolute terms AND far darker than the frame as a whole.
#
# The second half is what makes this work, and it was not obvious. This app is very dark: its most
# common background, #0F1A2E, measures luma 8-10 through this pipeline, while the bars on the
# preview Apple rejected measure 0-5. No absolute threshold separates those two with any margin -
# a first attempt at 12 flagged a full-bleed navy screen as letterboxed. The ratio does separate
# them, because a frame that is ALL dark has a low mean too: the rejected file averages 87 against
# a top edge of 5 (17x), where a legitimately dark screen sits near its own average (~1x).
#
# This is also deliberately NOT ffmpeg's cropdetect. cropdetect only trims a row when EVERY pixel
# in it falls under the limit, so a handful of compression-noise pixels defeat it: on the rejected
# file it reports a full 244x530 frame at both limit=8 and limit=16, finding the real 238x330 box
# only at limit=24. Averaging a strip is stable where an all-pixels rule is not.
BLACK_LUMA_CEILING=24   # an edge brighter than this is never a bar, whatever the ratio says
BLACK_LUMA_RATIO=4      # ...and it must be at least this many times darker than the whole frame

probe() {
  ffprobe -v error -select_streams "$1" -show_entries "$2" \
          -of default=nw=1:nk=1 -- "$3" 2>/dev/null | head -1
}

duration_of() {
  ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 -- "$1"
}

# Mean luma of one region, sampled every 3 seconds - one number per sample, 0-255.
# `scale=1:1` makes ffmpeg average the whole region into a single pixel, so exactly one byte comes
# back per sampled frame.
#   $1 = file   $2 = an ffmpeg crop geometry, W:H:X:Y
luma_samples() {
  ffmpeg -v error -i "$1" -vf "crop=$2,fps=1/3,scale=1:1" -f rawvideo -pix_fmt gray - 2>/dev/null \
    | od -An -tu1 | tr ' ' '\n' | grep -E '^[0-9]+$'
}

# The BRIGHTEST sample of a region. A black bar never brightens, so its maximum stays near zero.
region_max() { luma_samples "$1" "$2" | sort -n | tail -1; }

# The average sample of a region - the reference the edges are judged against.
region_avg() { luma_samples "$1" "$2" | awk '{s+=$1; n++} END{printf "%d", (n ? s/n : 0)}'; }

# ---------------------------------------------------------------------------- check
note() { printf '    %s\n' "$*"; }

do_check() {
  local f="$1" quiet="${2:-}"
  [ -f "$f" ] || fail "no such file: $f"
  [ -n "$quiet" ] || say "Checking $(basename "$f")"

  local w h codec pixfmt dur acodec trc
  w=$(probe v:0 stream=width "$f")
  h=$(probe v:0 stream=height "$f")
  codec=$(probe v:0 stream=codec_name "$f")
  pixfmt=$(probe v:0 stream=pix_fmt "$f")
  trc=$(probe v:0 stream=color_transfer "$f")
  acodec=$(probe a:0 stream=codec_name "$f")
  dur=$(duration_of "$f")
  { [ -n "$w" ] && [ -n "$h" ]; } || fail "$f has no video stream"

  CHECK_ERRS=0
  bad() { printf '\033[31m    X  %s\033[0m\n' "$*"; CHECK_ERRS=$((CHECK_ERRS + 1)); }

  note "$w x $h, ${dur}s, $codec/$pixfmt, audio: ${acodec:-NONE}"

  # 1 - dimensions
  case " $SIZES " in
    *" ${w}x${h} "*) ;;
    *) bad "$w x $h is not an accepted preview size. App Store Connect takes: $SIZES" ;;
  esac

  # 2 - duration: Apple requires 15-30 seconds
  awk -v d="$dur" -v lo="$MIN_SECONDS" -v hi="$MAX_SECONDS" 'BEGIN{exit !(d>=lo && d<=hi)}' \
    || bad "$(printf '%.2f' "$dur")s is outside the required ${MIN_SECONDS}-${MAX_SECONDS}s"

  # 3 - codec
  case "$codec" in
    h264|prores) ;;
    *) bad "codec is $codec; App Store Connect takes H.264 or ProRes 422 (HQ)" ;;
  esac
  if [ "$codec" = h264 ] && [ "$pixfmt" != yuv420p ]; then
    bad "pixel format is $pixfmt; H.264 must be yuv420p or QuickTime will not play it"
  fi

  # 4 - an audio track must exist even when it is silent. Simulator recordings have none.
  [ -n "$acodec" ] || bad "no audio stream. Add a silent one - 'export' does this automatically."

  # 5 - HDR. An HLG/PQ recording encoded as SDR looks washed out on the store page.
  case "$trc" in
    arib-std-b67|smpte2084) bad "HDR transfer ($trc). Re-record with HDR off, or tonemap first." ;;
  esac

  # 6 - THE ONE THAT MATTERS. A black border on any edge means a device frame, a mockup or a
  #     letterboxed export - the exact defect Apple cited in the 2.3.4 rejection of 1.0.8 (52).
  #     Each edge strip is averaged once every 3 seconds across the whole clip; a real bar stays
  #     black in every sample, while a merely dark scene does not.
  local sv sh whole dark edge name geom val
  sv=$((h / 50)); if [ "$sv" -lt 2 ]; then sv=2; fi
  sh=$((w / 50)); if [ "$sh" -lt 2 ]; then sh=2; fi
  whole=$(region_avg "$f" "${w}:${h}:0:0")

  dark=""
  for edge in "top ${w}:${sv}:0:0" \
              "bottom ${w}:${sv}:0:$((h - sv))" \
              "left ${sh}:${h}:0:0" \
              "right ${sh}:${h}:$((w - sh)):0"; do
    name="${edge%% *}"; geom="${edge#* }"
    val=$(region_max "$f" "$geom")
    val="${val:-255}"
    printf '    edge %-6s luma %3s   (frame average %s)\n' "$name" "$val" "$whole"
    if [ "$val" -le "$BLACK_LUMA_CEILING" ] \
       && [ $((val * BLACK_LUMA_RATIO)) -le "$whole" ]; then
      dark="$dark $name"
    fi
  done

  if [ -n "$dark" ]; then
    bad "black border on:$dark - near-black, and over ${BLACK_LUMA_RATIO}x darker than the frame"
    printf '\033[31m       Guideline 2.3.4 - an app preview may not include device images or\n'
    printf '       device frames. Record full screen; do not composite into a mockup.\033[0m\n'
  fi

  if [ "$CHECK_ERRS" -gt 0 ]; then
    printf '\n\033[31m%s: %d problem(s). DO NOT UPLOAD.\033[0m\n' "$(basename "$f")" "$CHECK_ERRS" >&2
    return 1
  fi
  printf '\033[32m    ok - ready to upload\033[0m\n'
  return 0
}

# --------------------------------------------------------------------------- export
do_export() {
  local src="$1" out="$2"
  shift 2
  local start=0 want="" allow_hdr=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --start)     start="$2"; shift 2 ;;
      --duration)  want="$2";  shift 2 ;;
      --allow-hdr) allow_hdr=1; shift ;;
      *) fail "unknown option: $1" ;;
    esac
  done
  [ -f "$src" ] || fail "no such file: $src"

  say "Reading $(basename "$src")"
  local w h srcdur trc
  w=$(probe v:0 stream=width "$src")
  h=$(probe v:0 stream=height "$src")
  trc=$(probe v:0 stream=color_transfer "$src")
  srcdur=$(duration_of "$src")
  { [ -n "$w" ] && [ -n "$h" ]; } || fail "$src has no video stream"
  note "source $w x $h, ${srcdur}s"

  [ "$w" -lt "$h" ] || fail "source is landscape ($w x $h). This app is portrait-only."

  if [ "$allow_hdr" -eq 0 ]; then
    case "$trc" in
      arib-std-b67|smpte2084)
        fail "source is HDR ($trc). Encoding it as SDR washes the colours out. Re-record with
       HDR capture off, or pass --allow-hdr if you have already tonemapped it." ;;
    esac
  fi

  # Pick the target from the source aspect rather than forcing one, so nothing gets stretched.
  local target ratio
  ratio=$(awk -v w="$w" -v h="$h" 'BEGIN{printf "%.4f", w/h}')
  target=$(awk -v r="$ratio" 'BEGIN{
    if (r > 0.4615*0.98 && r < 0.4615*1.02) print "886x1920"
    else if (r > 0.5625*0.98 && r < 0.5625*1.02) print "1080x1920"
  }')
  [ -n "$target" ] || fail "source aspect $ratio matches neither 886:1920 (0.4615) nor
       1080:1920 (0.5625), the only shapes App Store Connect accepts for this slot.
       Record on an iPhone whose screen is one of those, or crop the source first."
  local tw="${target%x*}" th="${target#*x}"
  note "target $tw x $th"

  # Duration: default to the whole clip from --start, capped at 30s.
  local dur
  dur=$(awk -v s="$srcdur" -v st="$start" -v want="$want" -v hi="$MAX_SECONDS" 'BEGIN{
    avail = s - st
    d = (want == "" ? avail : want)
    if (d > hi) d = hi
    printf "%.3f", d
  }')
  awk -v d="$dur" -v lo="$MIN_SECONDS" 'BEGIN{exit !(d>=lo)}' \
    || fail "only ${dur}s of footage from --start ${start}; App Store Connect needs ${MIN_SECONDS}s minimum"
  note "taking ${dur}s from ${start}s"

  say "Encoding"
  local vf="scale=${tw}:${th}:flags=lanczos,setsar=1"
  local venc=(-c:v libx264 -profile:v high -pix_fmt yuv420p -r 30 -crf 18 -preset slow)
  local aenc=(-c:a aac -b:a 128k -ar 44100 -ac 2)

  if [ -n "$(probe a:0 stream=codec_name "$src")" ]; then
    ffmpeg -y -v error -stats -ss "$start" -i "$src" \
      -map 0:v:0 -map 0:a:0 -t "$dur" -vf "$vf" "${venc[@]}" "${aenc[@]}" \
      -movflags +faststart -- "$out"
  else
    # Simulator recordings carry no audio, and App Store Connect wants a track present.
    note "source has no audio - adding a silent stereo track"
    ffmpeg -y -v error -stats -ss "$start" -i "$src" \
      -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
      -map 0:v:0 -map 1:a:0 -t "$dur" -shortest -vf "$vf" "${venc[@]}" "${aenc[@]}" \
      -movflags +faststart -- "$out"
  fi

  # Decode the artifact. An exit code is not evidence.
  say "Verifying the file that was actually written"
  do_check "$out" quiet || fail "the exported file does not pass its own check: $out"
  printf '\n\033[32m==> %s is ready for App Store Connect\033[0m\n' "$out"
}

# ----------------------------------------------------------------------------- main
[ $# -ge 1 ] || usage
case "$1" in
  check)  shift; [ $# -eq 1 ] || usage; do_check "$1" ;;
  export) shift; [ $# -ge 2 ] || usage; do_export "$@" ;;
  *) usage ;;
esac

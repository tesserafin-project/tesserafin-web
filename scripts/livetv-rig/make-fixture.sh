#!/usr/bin/env bash
# Synthesize the Live TV rig's channel fixture and its M3U playlist.
#
# No binary test asset is committed, for the same reason ci/serve-e2e.sh synthesizes its media with
# ffmpeg rather than shipping it: the recipe is reviewable and the bytes are reproducible.
#
# The default 120 s is chosen so a proof that needs >= 30 s of real playback fits comfortably inside
# one pass, with the tuner host registered with EnableStreamLooping false.
set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/fixture"
DURATION="${TESSERAFIN_TUNER_DURATION:-120}"
PORT="${TESSERAFIN_TUNER_PORT:-18099}"

command -v ffmpeg > /dev/null || { echo "ffmpeg is required" >&2; exit 2; }
mkdir -p "$DIR"

ffmpeg -y -loglevel error \
    -f lavfi -i "testsrc=size=640x360:rate=25:duration=${DURATION}" \
    -f lavfi -i "sine=frequency=440:duration=${DURATION}" \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
    -c:a aac -shortest -f mpegts "$DIR/channel1.ts"

printf '#EXTM3U\n#EXTINF:-1 tvg-id="ltv-1" tvg-name="LTV One",LTV One\nhttp://127.0.0.1:%s/channel1.ts\n' \
    "$PORT" > "$DIR/playlist.m3u"

# ffprobe the result rather than trusting the encode, the same way ci/serve-e2e.sh asserts each of
# its fixtures immediately after writing it.
ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$DIR/channel1.ts"
printf 'fixture: %s (%s bytes, %s s)\n' \
    "$DIR/channel1.ts" "$(stat -c %s "$DIR/channel1.ts")" "$DURATION"

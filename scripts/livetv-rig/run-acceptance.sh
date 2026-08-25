#!/usr/bin/env bash
# Live TV runtime acceptance: the browser reaching real live fragments through the software tuner.
#
# Runs INSIDE `ci/serve-e2e.sh --exec`, so the server is already booted, seeded and reachable at
# $TESSERAFIN_E2E_BASE_URL with $TESSERAFIN_E2E_USER / $TESSERAFIN_E2E_PASSWORD. What serve-e2e.sh
# does not do is Live TV, so this adds the ephemeral M3U software tuner and then hands over to the
# browser harness.
set -uo pipefail

D="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BASE="$TESSERAFIN_E2E_BASE_URL"
OUT="${1:?usage: run-livetv-acceptance.sh <out.json>}"

say() { printf '[ltv] %s\n' "$*"; }

# --- authenticate ---------------------------------------------------------------------------
TOKEN="$(curl -fsS -X POST "$BASE/Users/AuthenticateByName" \
    -H 'Content-Type: application/json' \
    -H 'Authorization: MediaBrowser Client="ltv-rig", Device="ltv-rig", DeviceId="ltv-rig-1", Version="1.0.0"' \
    -d "{\"Username\":\"$TESSERAFIN_E2E_USER\",\"Pw\":\"$TESSERAFIN_E2E_PASSWORD\"}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["AccessToken"])')" || {
    say "authentication failed"; exit 2; }
AUTH=(-H "Authorization: MediaBrowser Token=\"$TOKEN\"" -H 'Content-Type: application/json')
say "authenticated"

# --- the ephemeral software tuner ------------------------------------------------------------
[ -f "$D/fixture/channel1.ts" ] || bash "$D/make-fixture.sh" >&2

# --- the independent positive oracle -------------------------------------------------------
# Derived HERE, from the fixture this rig just wrote, and therefore before the tuner host is
# registered, before the channel is indexed and before the PlaybackInfo request being graded
# exists. See expected-source-id.py for the three server anchors the hash contract replicates.
# The input is fixture-owned; nothing in the response under test can influence it.
EXPECTED_SOURCE_ID="$(python3 "$D/expected-source-id.py" "$D/fixture/playlist.m3u")" || {
    say "could not derive the expected tuner source id from the fixture playlist"; exit 2; }
case "$EXPECTED_SOURCE_ID" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) say "the derived expected tuner source id is not a 32-hex id: $EXPECTED_SOURCE_ID"; exit 2 ;;
esac
say "expected tuner source id $EXPECTED_SOURCE_ID (from the fixture playlist, pre-PlaybackInfo)"

python3 "$D/tuner-server.py" > "$D/tuner.log" 2>&1 &
TUNER_PID=$!
trap 'kill "$TUNER_PID" 2>/dev/null; wait "$TUNER_PID" 2>/dev/null' EXIT
for _ in $(seq 1 40); do
    curl -fsS -o /dev/null "http://127.0.0.1:18099/playlist.m3u" && break
    sleep 0.25
done
curl -fsS -o /dev/null "http://127.0.0.1:18099/playlist.m3u" || { say "tuner did not come up"; exit 2; }
say "tuner serving playlist.m3u and channel1.ts on 127.0.0.1:18099"

# EnableStreamLooping stays false on purpose: a looping fixture caps every playback proof at the
# fixture length, and section 5 wants >= 30 s of real progression out of a 120 s stream.
curl -fsS -X POST "$BASE/LiveTv/TunerHosts" "${AUTH[@]}" -d '{
    "Url":"http://127.0.0.1:18099/playlist.m3u","Type":"m3u",
    "FriendlyName":"LTVP0 Software Tuner","ImportFavoritesOnly":false,
    "AllowHWTranscoding":false,"AllowFmp4TranscodingContainer":false,"AllowStreamSharing":true,
    "FallbackMaxStreamingBitrate":30000000,"EnableStreamLooping":false,"TunerCount":3,
    "UserAgent":"","IgnoreDts":true,"ReadAtNativeFramerate":false }' > "$D/tunerhost.json" || {
    say "adding the tuner host failed"; exit 2; }
say "tuner host registered"

# --- wait for the channel to index -------------------------------------------------------------
CHANNEL_ID=""
for _ in $(seq 1 120); do
    CHANNEL_ID="$(curl -fsS "$BASE/LiveTv/Channels" "${AUTH[@]}" \
        | python3 -c 'import sys,json
d=json.load(sys.stdin).get("Items") or []
print(d[0]["Id"] if d else "")' 2>/dev/null)"
    [ -n "$CHANNEL_ID" ] && break
    sleep 1
done
[ -n "$CHANNEL_ID" ] || { say "no Live TV channel indexed"; exit 2; }
say "channel $CHANNEL_ID"

# --- the library movie the fixture sequence starts from -----------------------------------------
MOVIE_ID="$(curl -fsS "$BASE/Items?includeItemTypes=Movie&recursive=true" "${AUTH[@]}" \
    | python3 -c 'import sys,json
items=json.load(sys.stdin)["Items"]
# the direct-play fixture, not the transcode probe: the sequence needs a source that starts fast
pick=[i for i in items if "Smoke" in i["Name"]] or items
print(pick[0]["Id"])')"
[ -n "$MOVIE_ID" ] || { say "no movie item"; exit 2; }
say "movie $MOVIE_ID"

# --- drive the browser ---------------------------------------------------------------------------
TESSERAFIN_E2E_TOKEN="$TOKEN" LTV_RIG_ASSERT="${LTV_RIG_ASSERT:-1}" \
    LTV_EXPECTED_SOURCE_ID="$EXPECTED_SOURCE_ID" \
    node "$D/acceptance.mjs" "$MOVIE_ID" "$CHANNEL_ID" "$OUT" "s-merge"
STATUS=$?

# --- the rig's permanent hostile controls ----------------------------------------------------
# Opt-in, because they re-drive the browser three more times. They reuse THIS session's server,
# tuner host and channel; nothing else can, which is why they are invoked from here.
if [ "${LTV_RIG_CONTROLS:-0}" = "1" ] && [ "$STATUS" -eq 0 ]; then
    say "running the rig hostile controls"
    TESSERAFIN_E2E_TOKEN="$TOKEN" \
        node "$D/hostile-controls.mjs" "$MOVIE_ID" "$CHANNEL_ID" "$EXPECTED_SOURCE_ID" \
        "$(dirname -- "$OUT")"
    STATUS=$?
fi
say "harness exited $STATUS"
exit "$STATUS"

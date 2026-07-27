# B1 maintainer-observed error-handling pass

tesserafin-web #54 requires a manual pass over error handling. Automation does
not substitute for it: the automated suite proves that error *states* are
reached, and this checklist asks a human whether what appears on screen is
actually usable.

Run it against the exact published candidate, and record the answers in a
comment on #54.

## Candidate under test

| | |
| --- | --- |
| Server image | `ghcr.io/tesserafin-project/tesserafin-server@sha256:fd1fa9e0f5a28a07e5872cc5ff13257a92d988717a33519f62c4b26c6ab36249` |
| Immutable server tag | `1.0.0-dev.44f5ab62b522` |
| Server source commit | `44f5ab62b522684b4fa58ed10de80b8c6a7bb392` |
| Bundled web commit | `489a90be0dbe80aede3dbbc028b140756211d43c` |
| Bundled web-assets image | `ghcr.io/tesserafin-project/tesserafin-web-assets@sha256:ef817dec29f8fd08cee9910954b576d05a947936f93a8a9e3309031b8d656104` |

The web client you exercise must be the one the image bundles. Do not point a
locally built bundle at the container: that would test different bytes from the
ones the candidate ships.

## Bringing the candidate up

From a checkout of the server repository at `44f5ab62b522684b4fa58ed10de80b8c6a7bb392`
or later:

```bash
mkdir -p /tmp/b1-manual/{config,cache,data,media,probes}
docker run --rm -v /tmp/b1-manual:/w busybox chown -R 10000:10000 /w/config /w/cache /w/data
docker run -d --name tesserafin-b1-manual \
  -p 127.0.0.1:8096:8096 \
  -v /tmp/b1-manual/config:/config -v /tmp/b1-manual/cache:/cache \
  -v /tmp/b1-manual/data:/data \
  -v /tmp/b1-manual/media:/media:ro -v /tmp/b1-manual/probes:/probes:ro \
  ghcr.io/tesserafin-project/tesserafin-server@sha256:fd1fa9e0f5a28a07e5872cc5ff13257a92d988717a33519f62c4b26c6ab36249
```

Then open <http://127.0.0.1:8096/>, complete onboarding, and add
`/media` as a Movies library. For steps 7 and 8 you need one file that direct
plays (H.264 + AAC in MP4) and one that cannot (MPEG-4 Part 2 + AC-3 in MP4);
`ci/serve-e2e.sh`'s `synthesize_fixtures` builds both with ffmpeg if you would
rather not supply your own.

Before you start, open the browser console and leave it open. Steps 1, 5 and 7
ask what appeared there.

## The eight observations

Record, for each: **pass / fail**, the wording or state you actually saw, and any
console error that belongs to the failure.

| # | Do this | Expect to see |
| - | ------- | ------------- |
| 1 | Sign in with a **wrong password** for a real user | A visible, readable error appears and the form is usable again. The spinner does **not** stay up. You are still on the login screen — no session was created. |
| 2 | Immediately sign in again with the **correct** password, without clearing browser data | You reach the home screen. The earlier failure left nothing behind that blocks a good login. |
| 3 | Sign out from the user menu | You are returned to the login screen, and pressing Back or typing an authenticated URL does not show library content. |
| 4 | Sign in again | Your library is there as before — the same libraries, the same items. |
| 5 | Stop the container (`docker stop tesserafin-b1-manual`), then reload the page | Within a bounded time a visible connection error appears. **Not** an endless spinner, **not** a blank page. No password, token or server filesystem path appears in the message. |
| 6 | Start it again (`docker start tesserafin-b1-manual`), wait for it to come up, and retry from the UI — **without** deleting browser data | The application recovers and shows your library again. |
| 7 | Provoke a playback failure. The simplest deterministic way: with a video open, stop the container mid-playback; alternatively use DevTools request blocking on the media URL | A visible playback error appears. Playback does not silently continue on some other path. You can leave the item or retry **without** reloading the whole application. No full source-media path, API key or token is displayed. |
| 8 | Start the container again and play both fixtures: the H.264/AAC one and the MPEG-4 Part 2/AC-3 one | Both play. The first direct plays; the second is transcoded by the server. |

## What to report back

Copy this block into the #54 comment and fill it in:

```
Candidate digest : sha256:fd1fa9e0f5a28a07e5872cc5ff13257a92d988717a33519f62c4b26c6ab36249
Browser / version:
Operating system :

1 invalid login        : PASS/FAIL — observed:
2 correct login after  : PASS/FAIL — observed:
3 logout               : PASS/FAIL — observed:
4 fresh login          : PASS/FAIL — observed:
5 server unavailable   : PASS/FAIL — observed:
6 server restored      : PASS/FAIL — observed:
7 playback failure     : PASS/FAIL — observed:
8 direct play + transcode: PASS/FAIL — observed:

Console errors relevant to any failure:

No credential, token or complete media path was displayed at any point: YES/NO
```

## Known limitation to watch for at step 7

The automated suite found that a playback session can outlive a stop: the
client dispatches the teardown `DELETE /Playback/Sessions/{id}` exactly once, as
its contract requires, but the request can be lost in flight during page
teardown, leaving the session alive on the server until its TTL. See the
`b1-` evidence section of #54. It does not produce a visible symptom for a
user, so step 7 will not surface it — it is recorded here so the manual pass is
not read as having cleared it.

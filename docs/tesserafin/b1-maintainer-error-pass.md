# B1 maintainer-observed error-handling pass

> **Namespace note.** The references below name `tesserafin-project`, the
> organisation login in force when this record was written. The canonical
> organisation is now `tesserafin` and the same artifacts are served from
> `ghcr.io/tesserafin/…`. The recorded identities are preserved verbatim so this
> record keeps stating where each artifact was originally published. See the
> namespace cutover tracker, `tesserafin/tesserafin#147`.


tesserafin-web #54 requires a manual pass over error handling. Automation does
not substitute for it: the automated suite proves that error *states* are
reached, and this checklist asks a human whether what appears on screen is
actually usable.

Run it against the exact published candidate, and record the answers in a
comment on #54.

## Candidate under test

| | |
| --- | --- |
| Server image | `ghcr.io/tesserafin-project/tesserafin-server@sha256:89dd01add7cbe7fd1d1529979f6aa4e6537c9b4b31e2ebec1836a583548a1bf9` |
| Immutable server tag | `1.0.0-dev.a8ac09f3ff5a` |
| Server source commit | `a8ac09f3ff5a715b35b9dc31d1b23c5865a6d34e` |
| Bundled web commit | `a63cb11e8e9cfa137b6c3f739e8881a6dfb39dfb` |
| Bundled web-assets image | `ghcr.io/tesserafin-project/tesserafin-web-assets@sha256:2585fc7e1e06cee0be1bb0bcac735ed783b6e8c3ea2ff346561e7f62c0a75daf` |

The web client you exercise must be the one the image bundles — the client the
container serves at `/web/`, reached by opening the server's own address. Do not
point a locally built bundle, a `npm run serve` dev server or a checkout of this
repository at the container: that would test different bytes from the ones the
candidate ships, and the answers would not be about this candidate.

This candidate replaces `sha256:fd1fa9e0f5a28a07e5872cc5ff13257a92d988717a33519f62c4b26c6ab36249`,
which is still published and immutable but is no longer an installation default.
Do not run this checklist against it: it bundles the web client in which a
terminal playback failure was silent (#67).

## Bringing the candidate up

From a checkout of the server repository at `a8ac09f3ff5a715b35b9dc31d1b23c5865a6d34e`
or later:

```bash
mkdir -p /tmp/b1-manual/{config,cache,data,media,probes}
docker run --rm -v /tmp/b1-manual:/w busybox chown -R 10000:10000 /w/config /w/cache /w/data
docker run -d --name tesserafin-b1-manual \
  -p 127.0.0.1:8096:8096 \
  -v /tmp/b1-manual/config:/config -v /tmp/b1-manual/cache:/cache \
  -v /tmp/b1-manual/data:/data \
  -v /tmp/b1-manual/media:/media:ro -v /tmp/b1-manual/probes:/probes:ro \
  ghcr.io/tesserafin-project/tesserafin-server@sha256:89dd01add7cbe7fd1d1529979f6aa4e6537c9b4b31e2ebec1836a583548a1bf9
```

### The two media fixtures

Steps 7 and 9 need one file that direct plays and one that cannot. These are the
same recipes the automated rig uses. Run them **before** adding the library, so
the first scan already sees both:

```bash
mkdir -p "/tmp/b1-manual/media/Smoke Test Movie (2020)" \
         "/tmp/b1-manual/media/Transcode Probe (2021)"

# DIRECT PLAY — H.264 + AAC in MP4.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc=size=320x240:rate=15:duration=2" \
  -f lavfi -i "sine=frequency=1000:duration=2" \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a aac -movflags +faststart \
  "/tmp/b1-manual/media/Smoke Test Movie (2020)/Smoke Test Movie (2020).mp4"

# TRANSCODE — MPEG-4 Part 2 + AC-3. No browser build ships either decoder, so
# the server has no choice but to re-encode.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc=size=320x240:rate=15:duration=2" \
  -f lavfi -i "sine=frequency=1000:duration=2" \
  -c:v mpeg4 -pix_fmt yuv420p \
  -c:a ac3 -b:a 96k -movflags +faststart \
  "/tmp/b1-manual/media/Transcode Probe (2021)/Transcode Probe (2021).mp4"
```

Each clip is two seconds long. Then open <http://127.0.0.1:8096/>, complete
onboarding, and add `/media` as a **Movies** library.

Before you start, open the browser console and leave it open. Steps 1, 5 and 7
ask what appeared there.

## The nine observations

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
| 7 | Provoke a playback failure. The simplest deterministic way: with a video open, stop the container mid-playback; alternatively use DevTools request blocking on the media URL | A visible playback error appears and says a playback failure happened, in ordinary wording rather than a message key. Playback does not silently continue on some other path. The player does not stay mounted over media that will never play. You can dismiss the error with its own button and carry on **without** reloading the whole application. No full source-media path, API key or token is displayed. |
| 8 | Open **Search** from the toolbar. Search for `Smoke`, then for a string that matches nothing (for example `zzzzzz`) | The first search shows the matching movie. The second says plainly that there is no result — not a blank panel, not a spinner that never ends, not an error. |
| 9 | Start the container again and play both fixtures: the H.264/AAC one and the MPEG-4 Part 2/AC-3 one | Both play. The first direct plays; the second is transcoded by the server. |

## What to report back

Copy this block into the #54 comment and fill it in:

```
Candidate digest : sha256:89dd01add7cbe7fd1d1529979f6aa4e6537c9b4b31e2ebec1836a583548a1bf9
Server source    : a8ac09f3ff5a715b35b9dc31d1b23c5865a6d34e
Bundled web      : a63cb11e8e9cfa137b6c3f739e8881a6dfb39dfb
Web client used  : the one the image bundles (served by the container at /web/)
Browser / version:
Operating system :

1 invalid login        : PASS/FAIL — observed:
2 correct login after  : PASS/FAIL — observed:
3 logout               : PASS/FAIL — observed:
4 fresh login          : PASS/FAIL — observed:
5 server unavailable   : PASS/FAIL — observed:
6 server restored      : PASS/FAIL — observed:
7 playback failure     : PASS/FAIL — observed:
8 search               : PASS/FAIL — observed:
9 direct play + transcode: PASS/FAIL — observed:

Console errors relevant to any failure:

No credential, token or complete media path was displayed at any point: YES/NO
```

## What step 7 is asking now

Step 7 used to carry a known wrong answer. It does not any more. #67 is fixed in
the bundled web client (tesserafin-project/tesserafin-web#69): a terminal
playback failure now reaches a real, translated, dismissable error dialog, the
player is torn down rather than left over dead media, dismissal needs no document
reload, and the server-side session is released. The automated suite asserts all
of that on every run — as an ordinary passing assertion, not a declared expected
failure — over three consecutive rounds against this exact image.

So step 7 is a genuine observation again, not a confirmation of a defect. What
automation cannot judge is whether the surface you are left on reads as "broken"
to a person, whether the wording tells you what went wrong, and whether you can
tell playback failed without opening the console. Record what you saw in those
terms.

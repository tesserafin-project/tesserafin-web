# Codec profile probes: current scope and browser evidence

The `Profiles` half of [web#29](https://github.com/tesserafin-project/tesserafin-web/issues/29)
was already delivered by [web#49](https://github.com/tesserafin-project/tesserafin-web/pull/49).
`videoCodecProfiles.ts` derives H.264, HEVC and AV1 profile names from exact
`canPlayType` MIME strings. Only `probably` is accepted. Known High 10 false-positive
browser families remain vetoed. VP8/VP9 have no profile rows and remain unrestricted.

## Meaning on the server

A nonempty `VideoCodecCapability.Profiles` is an allow-list compared with the source
stream's ffprobe profile using case-insensitive equality. An absent source profile
or an unlisted profile requests transcoding. An empty list disables this restriction;
it does **not** express that no profile is supported. The current wire contract has
no separate field for unknown versus unsupported profile detection.

Consequently this feature can reject an unsafe Direct Play choice; it cannot by
itself increase the number of Direct Play choices. Do not describe it as reducing
unnecessary transcoding. A profile accepted at one probed level is also not evidence
for all levels, bitrates, pixel formats or container combinations.

## Standalone qualification

Run:

```sh
npm ci --no-audit
npx playwright install --with-deps chromium firefox
npx vitest run src/scripts/videoCodecProfiles.test.ts src/scripts/tesserafinPlaybackCapabilities.test.ts
npx playwright test --config playwright.codecProfiles.config.ts
```

The dedicated read-only PR workflow runs the exact candidate on Ubuntu 24.04 using
Playwright's package-lock-pinned Chromium and Firefox. It records every table MIME
answer, browser version/UA and derived profile list in the job log and step summary.
Each test also attaches the JSON observations to its local Playwright results.
This consumes no hosted artifact upload storage. The pure mapping and wire tests
remain separate from these browser-owned observations.

The tests ask real `HTMLMediaElement.canPlayType` on `about:blank`; no server, user,
media URL, account or credentials are required. They ensure mainstream H.264
profile MIME strings remain recognizable in these configured browsers, preserve
ordering/deduplication, retain unrestricted results outside the closed table and
never promote an actual inconclusive answer into a claim. The High 4:4:4 control
is recorded rather than assumed to have one answer across every browser build.

Per the [HTML Standard](https://html.spec.whatwg.org/multipage/media.html#dom-media-canplaytype),
these answers describe browser confidence. They do not establish decoded-frame,
real-server session, hardware acceleration, display-chain or whole-format support.
No Safari/WebKit, physical TV/phone, proprietary decoder or playback acceptance is
created by this workflow. A green result must retain its exact browser/build scope.

## Remaining work

`VideoRangeTypes` remains `['SDR']` on every emitted codec. The dormant HDR probe
is not wired into the advertised capabilities. A high-dynamic-range display media
query alone does not establish decoder or full output-chain support; HDR10, HLG,
Dolby Vision and hardware claims require their own selected evidence and remain
open under #29. Actual decoded media and server decision validation remain separate
from the confidence-probe gate.

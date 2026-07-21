# HDR detection — feasibility reconnaissance (issue #29, half 2)

**Status: measurement + dormant foundation. No production behaviour changed.
`VideoRangeTypes: ['SDR']` stays. #29 stays open.**

Scope: issue [#29](https://github.com/all3f0r1/reefin-web/issues/29) asks for `VideoRangeTypes` to be
derived from real browser probes instead of the constant `['SDR']` emitted at
`src/scripts/reefinPlaybackCapabilities.ts:321`. This document answers only *whether that is
measurable here*, and what a probe would have to look like.

§§1–6 are the hardware measurement, taken on a single identified machine, and they are the reason
`['SDR']` is still correct here: **the display half measures NEGATIVE.** §7 records the dormant
module that was subsequently landed from that finding — `src/scripts/hdrProbe.ts`, which is pure,
dependency-injected, imported by nothing but its own unit tests, and proven absent from every
emitted bundle (§7.1). Nothing in this repository claims HDR10 today, and nothing here may claim it
until a conjunction positive is observed on identified HDR hardware, which does not exist yet.

## 0. The rule this document is held to

HDR10 may be claimed only for the **conjunction** of two independent facts:

| Half | Question | API |
| --- | --- | --- |
| DECODE | can the browser decode this exact codec + profile + transfer function + colour space? | `navigator.mediaCapabilities.decodingInfo()` |
| DISPLAY | can the display chain actually render high dynamic range? | `matchMedia('(dynamic-range: high)')` |

`matchMedia` alone does not prove decoding. `decodingInfo` alone does not prove display.
Both must be measured **on an identified browser and an identified display**.

Three outcomes are kept distinct throughout and are *not* interchangeable:

- **API ABSENT** — the browser does not implement the feature. Nothing was measured.
- **NEGATIVE** — the feature is implemented and answered "no". A fact about this machine.
- **UNKNOWN** — the API answered, but the answer does not discriminate the property we care
  about, so it is not evidence either way.

Only NEGATIVE is a measurement. ABSENT and UNKNOWN must never be folded into it, and none of
the three may be reported as a positive.

## 1. What could actually be launched here

| Browser | Available | Ran | Notes |
| --- | --- | --- | --- |
| Chromium / Chrome for Testing 149.0.7827.55 (headless, `--headless=new`) | yes | **yes** | Playwright cache `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`. UA `HeadlessChrome/149.0.0.0`. |
| Chromium / Chrome for Testing 149.0.7827.55 (headed, real X11 `:0.0`) | yes | **yes** | Same binary, UA `Chrome/149.0.0.0`. |
| Google Chrome (stable, system) | **no** | no | Not installed (`/opt/google/chrome` absent, not on `PATH`). |
| Microsoft Edge | **no** | no | Not installed (`/opt/microsoft` absent). |
| Firefox | **no** | no | Not on `PATH`, and no `firefox-*` in the Playwright browser cache. |
| WebKit / Safari | **no** | no | No `webkit-*` in the Playwright cache; Safari is not available on Linux at all. |

So the matrix below covers **one engine (Blink), two run modes**. Any statement about Gecko or
WebKit behaviour would be an assumption, and this document makes none. Note also that the repo's
Playwright config (`playwright.config.ts`) declares a single `chromium` project, so the project's
own runner could not have widened this either.

The probe therefore drives Chromium directly over CDP (no npm dependency; `node_modules` is not
installed in this worktree). Script: [`hdr-probe.mjs`](./hdr-probe.mjs). Raw output:
[`result-chromium149-headless.json`](./result-chromium149-headless.json),
[`result-chromium149-headed-x11.json`](./result-chromium149-headed-x11.json).

## 2. The identified display and session

| Property | Value | Source |
| --- | --- | --- |
| Session type | **X11** (`XDG_SESSION_TYPE=x11`, `DISPLAY=:0.0`, `WAYLAND_DISPLAY` unset) | env |
| GPU | `amdgpu`, `card1` | `/sys/class/drm` |
| Connected output | `eDP-1` (internal panel). `HDMI-A-1` disconnected. | `/sys/class/drm/card1-*/status` |
| Panel | AUO, product `0xfcad`, week 24 / 2023, 344 mm × 194 mm, 1920×1080 | EDID via `xrandr --verbose` |
| Panel bit depth | **6 bits per primary colour** (EDID byte 20 = `0x95`, bit-depth code 1) | EDID |
| EDID extension block | tag `0x70` = **DisplayID**, *not* CTA-861 | EDID |
| CTA HDR Static Metadata Data Block | **not present, and cannot be** — there is no CTA-861 extension block at all | EDID |
| Browser-visible colour depth | `screen.colorDepth = 24`, `pixelDepth = 24` | probe |

This is a 6-bit SDR laptop panel. It is not an HDR display, and the EDID does not advertise HDR
static metadata under any transfer function. On top of that, the session is X11, which has no
colour-management / HDR path to hand to the browser regardless of what a panel advertises.

**These are two independent negatives.** Even if the session were switched to Wayland with a
compositor colour-management protocol, the panel would still be 6-bit SDR. Buying a Wayland
session does not buy an HDR display.

## 3. DISPLAY half — media query results

`matchMedia` is always *present* (it returns a `MediaQueryList` for any string), so "API ABSENT"
can never be read off its existence. It has to be inferred another way — see §3.1.

| Media query | headless | headed X11 | Verdict |
| --- | --- | --- | --- |
| `(dynamic-range: high)` | `false` | `false` | **NEGATIVE** |
| `(dynamic-range: standard)` | `true` | `true` | POSITIVE — confirms the feature is implemented and answering |
| `(video-dynamic-range: high)` | `false` | `false` | **ABSENT** (see §3.1) |
| `(video-dynamic-range: standard)` | `false` | `false` | **ABSENT** (see §3.1) |
| `(color-gamut: srgb)` | `true` | `true` | POSITIVE |
| `(color-gamut: p3)` | `false` | `false` | NEGATIVE |
| `(color-gamut: rec2020)` | `false` | `false` | NEGATIVE |
| `(prefers-color-scheme: dark)` — control | `false` | **`true`** | control works: the headed run is reading the *real* session, the headless one is not |
| `(totally-bogus-feature: high)` — control | `false` | `false` | see §3.1 |

`dynamic-range` partitions cleanly — `standard` true, `high` false — so this is a genuine
**NEGATIVE**: the feature is implemented, it was asked, and the answer is "this chain is SDR".
That is consistent with the hardware in §2 and is the expected, correct answer.

### 3.1 How ABSENT was established, and a technique that does *not* work

The obvious way to separate "feature unknown to the browser" from "feature known and false" is the
syntactic round-trip: an unrecognised media feature is supposed to serialise back as `not all`.

**Measured, and it does not hold in Chromium 149.** `matchMedia('(totally-bogus-feature: high)').media`
returns `"(totally-bogus-feature: high)"` verbatim, not `"not all"`. The same is true through the
CSSOM (`CSSMediaRule.conditionText` / `media.mediaText` after `insertRule('@media (totally-bogus-feature: high){…}')`)
and for a valid feature with a bogus value, `(dynamic-range: bogusvalue)`. So in this engine the
serialisation carries **no** ABSENT signal, and any probe that relies on it will silently
mis-report ABSENT as NEGATIVE. This is recorded because it is the exact failure mode issue #29
warns about — an absence quietly becoming a claim.

The sound test is **semantic partition**: an implemented enumerated feature must match exactly one
of its values. `dynamic-range` matches `standard` and not `high` → implemented, NEGATIVE.
`video-dynamic-range` matches **neither** `high` nor `standard` → it cannot be implemented →
**ABSENT**. Chromium 149 does not implement the Media Queries 5 `video-dynamic-range` feature.

Consequence for #29: **`video-dynamic-range` is not usable as a probe on Blink today.**
`dynamic-range` is the only display-side signal available, and a detector must treat
"matches neither value" as ABSENT, never as "not HDR".

## 4. DECODE half — `mediaCapabilities.decodingInfo` results

Every configuration is `{ type, video: { contentType, width: 1920, height: 1080, bitrate: 12000000,
framerate: 24, …hdrFields } }`. The exact HDR field sets used:

```js
const SDR   = { transferFunction: 'srgb', colorGamut: 'srgb' };
const HDR10 = { transferFunction: 'pq',  colorGamut: 'rec2020', hdrMetadataType: 'smpteSt2086' };
const HLG   = { transferFunction: 'hlg', colorGamut: 'rec2020' };
```

The `headless` column is recorded for completeness only — **headless is an invalid instrument for
decode, see §4.1.** Do not read a ❌ in that column as a capability fact.

| id | `type` | `contentType` | HDR fields | headless *(invalid, §4.1)* | headed X11 |
| --- | --- | --- | --- | --- | --- |
| `h264-high-sdr` | `file` | `video/mp4; codecs="avc1.640028"` | SDR | ✅ supported, smooth, **not** power-efficient | ✅ supported, smooth, **power-efficient** |
| `hevc-main-sdr` | `file` | `video/mp4; codecs="hvc1.1.6.L153.90"` | SDR | ❌ **not supported** | ✅ supported, smooth, power-efficient |
| `hevc-main10-hdr10` | `file` | `video/mp4; codecs="hvc1.2.4.L153.90"` | HDR10 | ❌ **not supported** | ✅ supported, smooth, power-efficient |
| `hevc-main10-hlg` | `file` | `video/mp4; codecs="hvc1.2.4.L153.90"` | HLG | ❌ not supported | ✅ supported, smooth, power-efficient |
| `hevc-main10-nohdrfields` | `file` | `video/mp4; codecs="hvc1.2.4.L153.90"` | *(none)* | ❌ not supported | ✅ supported |
| `vp9-p0-sdr` | `file` | `video/webm; codecs="vp09.00.10.08"` | SDR | ✅ supported | ✅ supported |
| `vp9-p2-hdr10` | `file` | `video/webm; codecs="vp09.02.10.10.01.09.16.09.01"` | HDR10 | ✅ supported | ✅ supported |
| `vp9-p2-sdrfields` **(twin)** | `file` | *same as above* | SDR | ❌ **not supported** | ❌ **not supported** |
| `vp9-p2-nofields` **(twin)** | `file` | *same as above* | *(none)* | ✅ supported | ✅ supported |
| `vp9-p2-hdr10plus` | `file` | *same as above* | pq / rec2020 / `smpteSt2094-40` | ❌ **not supported** | ❌ **not supported** |
| `vp9-p2-dovi-meta` | `file` | *same as above* | pq / rec2020 / `smpteSt2094-10` | ❌ **not supported** | ❌ **not supported** |
| `av1-8bit-sdr` | `file` | `video/mp4; codecs="av01.0.09M.08"` | SDR | ✅ supported | ✅ supported, not power-efficient |
| `av1-10bit-hdr10` | `file` | `video/mp4; codecs="av01.0.09M.10.0.110.09.16.09.0"` | HDR10 | ✅ supported | ✅ supported, not power-efficient |
| `av1-10bit-sdrfields` **(twin)** | `file` | *same as above* | SDR | ❌ **not supported** | ❌ **not supported** |
| `hevc-main10-hdr10-mse` | `media-source` | `video/mp4; codecs="hvc1.2.4.L153.90"` | HDR10 | ❌ not supported | ✅ supported |
| `vp9-p2-hdr10-mse` | `media-source` | `video/webm; codecs="vp09.02.10.10.01.09.16.09.01"` | HDR10 | ✅ supported | ✅ supported |
| `CONTROL-bogus-codec` | `file` | `video/mp4; codecs="bogus.9.9.9"` | SDR | ❌ not supported | ❌ not supported |
| `CONTROL-bogus-tf` | `file` | `video/mp4; codecs="avc1.640028"` | `transferFunction: 'definitely-not-a-transfer-function'` | **throws `TypeError`** | **throws `TypeError`** |

Cross-checks in the same run:

| | headless | headed |
| --- | --- | --- |
| `canPlayType('video/mp4; codecs="hvc1.2.4.L153.90"')` | `''` | `'probably'` |
| `MediaSource.isTypeSupported('video/mp4; codecs="hvc1.2.4.L153.90"')` | `false` | `true` |

### 4.1 What the decode half actually proves

**The HDR fields are load-bearing — this is the good news.** Three matched twins differ *only* in
the HDR members of `VideoConfiguration`, and they flip the answer:

- `vp09.02.10.10.01.09.16.09.01` + HDR10 fields → **supported**; the *same codec string* + `srgb`/`srgb`
  → **not supported**. Chromium is validating the requested transfer function/colour space against
  the codec string's in-band signalling (that codec string declares BT.2020 primaries, transfer
  characteristic 16 = PQ) and against the platform.
- `av01.0.09M.10.0.110.09.16.09.0` behaves identically.
- `CONTROL-bogus-tf` throws `TypeError: … 'definitely-not-a-transfer-function' is not a valid enum
  value of type TransferFunction`, proving the field is parsed rather than ignored.

So `decodingInfo` is **not** the "returns true for everything" API the pessimistic reading feared.
A positive here is a real, discriminating decode signal — this is exactly the raw material #29 item
2 needs, and it is better material than `canPlayType`, which cannot express a transfer function at all.

`hdrMetadataType` is also discriminating and **narrower than HDR10 support**: `smpteSt2086`
(HDR10 static metadata) passes where `smpteSt2094-40` (HDR10+) and `smpteSt2094-10` are refused, on
both run modes. Any future detector must therefore probe `smpteSt2086` for `HDR10` and must *not*
extrapolate from it to `HDR10Plus` or `DOVI` — which is precisely the over-claim `browserDeviceProfile.js`
lines 1289–1319 make today on the legacy path (it appends `HDR10|HDR10Plus` together off one check).

**Headless is not a valid measurement surface for decode.** Same binary, same machine: HEVC Main
and Main10 are *entirely unsupported* headless and *fully supported, hardware, power-efficient*
headed. `powerEfficient` is `false` for everything headless and `true` for the platform-decoded
codecs headed. A headless CI run would have reported a NEGATIVE for HEVC that is simply an artefact
of having no GPU/platform decoder attached. Treating that as evidence would be the mirror image of
over-claiming: it would be under-claiming from a broken instrument.

## 5. The conjunction

| | DECODE | DISPLAY | HDR10 evidence |
| --- | --- | --- | --- |
| Chromium 149 headless | HEVC ❌ / VP9-P2 ✅ / AV1-10 ✅ — but instrument invalid (§4.1) | `dynamic-range: high` **NEGATIVE** | **NO** |
| Chromium 149 headed, X11, AUO eDP 6-bit | HEVC ✅ / VP9-P2 ✅ / AV1-10 ✅ (HDR10 configs supported, power-efficient) | `dynamic-range: high` **NEGATIVE** | **NO** |

The decode half is positive on real hardware. The display half is negative on real hardware.
**The conjunction fails.** There is no positive HDR10 proof on this machine, so per the rule in §0:

- `VideoRangeTypes: ['SDR']` stays exactly as it is at `src/scripts/reefinPlaybackCapabilities.ts:321`.
- Issue #29 stays open.
- No mock-based HDR claim is made.

## 6. Bench verdict: can a real HDR bench be built on this machine?

**No — not one that can ever produce a positive. And that is a hardware conclusion, not a tooling one.**

Justification, in the order the blockers bind:

1. **The panel is not HDR.** AUO eDP, 6 bits per primary, DisplayID extension with no CTA-861
   block and therefore no HDR Static Metadata Data Block. The only other connector, `HDMI-A-1`, is
   disconnected. No amount of software configuration makes a 6-bit SDR panel report HDR truthfully.
2. **The session is X11.** Even with an HDR panel attached over that HDMI port, an X11 session has
   no path to expose HDR to Chromium. This would additionally need a Wayland session with a
   compositor colour-management protocol and a Chromium built/flagged to use it.
3. **Headless CI cannot measure either half.** Display: `dynamic-range: high` is NEGATIVE headless
   (and `prefers-color-scheme` proves the headless run isn't even reading the real session).
   Decode: measured above, headless loses HEVC entirely. A headless job is a valid place to assert
   *plumbing* — "the probe ran, the shape is right, ABSENT stayed ABSENT" — and an invalid place to
   assert *capability*.
4. **The mock route is not evidence, whether or not it works.** In *this* configuration
   (Chromium 149, headless, fresh target, no reload), CDP `Emulation.setEmulatedMedia` with
   `{name: 'dynamic-range', value: 'high'}` was *accepted without error* and **did not alter the
   result** (`high:false, std:true` before and after). That is a single observation and may differ
   headed, after a reload, on another version, or through another channel — so it is not claimed as
   a universal. The load-bearing point does not depend on it: even a successful emulation would
   describe the emulator, not the display, and would not be product evidence. This document does
   not use it as such.

What a genuine bench would require, stated so it is costed honestly rather than half-attempted:
an HDR10 display (or capture device) on the HDMI output, a Wayland session with HDR enabled, a
Chromium with the corresponding flags, and a human to confirm the picture. That is a hardware
procurement + session-migration task, not a code task, and it is out of scope for CI. Until it
exists, the honest CI-side assertion is a **negative-and-absent** one.

## 7. The dormant foundation — landed, contains no HDR-claiming code

Items 1–4 below **have landed** as `src/scripts/hdrProbe.ts` + `src/scripts/hdrProbe.test.ts`.
They change no emitted value; they make the *absence* of detection explicit and machine-checked,
which is #29 item 3. Item 5 remains blocked on hardware.

1. **A pure probe module** — `src/scripts/hdrProbe.ts` — exporting functions that return a
   four-state result and *not wired into `buildDecodeCapabilities`*:
   ```ts
   type ProbeOutcome = 'positive' | 'negative' | 'absent' | 'unknown';
   ```
   - Display: `dynamic-range` via the **partition test** of §3.1 — `high && !standard` → positive,
     `!high && standard` → negative, neither → **`absent`**. Never infer `absent` from
     `MediaQueryList.media` (§3.1 shows that is broken in Blink). Do not consult
     `video-dynamic-range` for a decision; record it only.
   - Decode: `decodingInfo` with the **twin** technique of §4.1 — an HDR config and an SDR twin that
     differ only in `transferFunction`/`colorGamut`/`hdrMetadataType`. If both answer identically,
     the API is not discriminating on this platform → **`unknown`**, not a decode win.
   - `decodingInfo` absent, or throwing, → `absent` / `unknown`. Never `negative`.
2. **Unit tests that exercise all four outcomes** with an injected fake `matchMedia`/`mediaCapabilities`
   — testing the *four-outcome logic*, explicitly not asserting any HDR capability of the host. In
   particular a test that a browser matching neither `dynamic-range` value yields `absent`, and a
   test that identical twin results yield `unknown`.
3. **A conjunction function that is deliberately hard to misuse**: HDR10 is claimable only when
   display is `positive` **and** decode is `positive` for the concrete `smpteSt2086` configuration.
   Any `absent`/`unknown` on either half yields "no claim". No `HDR10Plus`/`DOVI` inference from an
   `HDR10` positive (§4.1).
4. **Wire nothing.** `reefinPlaybackCapabilities.ts:321` keeps returning
   `{ Codec: codec, Profiles: [], VideoRangeTypes: ['SDR'] }`. The probe is dead code from the
   server's point of view until step 5.
5. **(Blocked, not scheduled)** Only once a probe has returned a *conjunction positive* on
   identified real hardware may `VideoRangeTypes` be derived from it — and the diff that does so
   should land with the hardware identification in its message.

An optional adjunct, **not** done: fold the `docs/reefin/bench-hdr/hdr-probe.mjs` script into an
opt-in (`REEFIN_HDR_BENCH=1`) manual script, kept out of the default test run, so the measurement is
repeatable when hardware changes. It must never gate CI, because on this machine it can only ever
report negative-and-absent.

### 7.1 Proof that the module reaches no bundle

"Not wired in" is a claim about the build output, so it is checked against the build output rather
than by reading imports. `webpack.common.js` builds from fixed entry points and globs only
`themes/**/*.scss`; there is no `require.context` or source glob that could sweep `src/scripts/*.ts`
into a chunk. The positive check:

```bash
rm -rf dist && npm run build:production          # module present on disk
for t in smpteSt2086 probeHdrDisplay probeHdr10Decode hdr10Claimable concludeHdr10; do
    echo "$t: $(grep -rl -- "$t" dist | wc -l) files"
done
```

Every token — including the string literals `smpteSt2086` and `'(dynamic-range: high)'`, which
survive minification where identifiers do not — occurs in **0 of the 981 emitted `.js` files**.
This covers *every* chunk, not just `main.jellyfin.bundle.js`, and does not depend on the build
being byte-reproducible.

The secondary check is byte comparison against a build of the same tree without the module. It has
one confounder: `webpack.common.js` injects `__COMMIT_SHA__` from `git describe --always --dirty`,
so `main.jellyfin.bundle.js` embeds the build-time working-tree state and can never be
bit-identical across two different commits. That confounder is fully accounted for:

| Build | tree | `git describe` | size | sha256 of `main.jellyfin.bundle.js` |
| --- | --- | --- | --- | --- |
| baseline | `origin/main`, clean, module absent | `ddc61b5fb6` | 382 256 B | `9373e9ba…dedbfec` |
| this branch | clean, module present | `9e2522d92c` | **382 256 B** | `b3ed6627…4a8be1c9` |

(`9e2522d92c` is this branch's commit *as measured*; the commit was subsequently amended to fold in
this very paragraph, so re-running the comparison today yields the amended id in that one 10-byte
run and nothing else. The measured facts — identical size, single differing run — are unaffected,
and re-deriving them is one `git describe` substitution away.)

Identical size, and the two differ in **exactly one 10-byte run**: substituting the single
occurrence of `9e2522d92c` back to `ddc61b5fb6` reproduces the baseline sha256
`9373e9ba…dedbfec` bit-for-bit. So the main bundle is byte-identical apart from the commit
identifier, which is not code.

Determinism was checked rather than assumed: an intermediate pair of builds over an unchanged tree
produced the same sha256 twice, and a dirty-tree build differed from its clean counterpart by
exactly 6 bytes — the length of the `-dirty` suffix. Both observations point at `git describe` and
neither at added code.

## 8. Stop condition

None fired. The expected honest outcome — decode positive, display negative, conjunction fails,
`['SDR']` retained, #29 open — was reached without being asked to claim anything unproven.

For the record, the designated stop condition remains: **if any policy requires choosing an HDR
claim without hardware proof, that must be raised rather than implemented.** Nothing in this lane
required it.

## Appendix — reproducing

```bash
node docs/reefin/bench-hdr/hdr-probe.mjs \
  ~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome chromium-149-headless
DISPLAY=:0.0 node docs/reefin/bench-hdr/hdr-probe.mjs \
  ~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome chromium-149-headed-x11 --headed
```

No npm dependencies (raw CDP over Node's built-in `WebSocket`). Not wired into the build, into
`playwright.config.ts`, or into any default test run.

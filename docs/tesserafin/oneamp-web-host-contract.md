# OneAmp web host contract and bounded demonstrator

- **Status:** Draft for review — specification only; adds no dependency and no code
- **Date:** 2026-11-05
- **Owner issue:** tesserafin/tesserafin#308 (parent tracker #307)
- **Boundaries preserved:** #146 (core / client / module), #304 (adaptive layer stays later)
- **First client:** Tesserafin Web (`htmlAudioPlayer`), audio items in Direct Play

This document freezes the contract between Tesserafin Web (the *host*) and
OneAmp's processing chain compiled to WebAssembly (the *processor*), and
plans a bounded demonstrator. It is meant to be accepted, amended or
rejected as a whole; once accepted, §11 becomes a separate implementation
issue. Until then no OneAmp artifact enters this repository.

The browser keeps decoding, buffering and transport (`<audio>`, MSE via
hls.js, `#t=` start offsets). OneAmp only transforms PCM between the
media element and the output. FFmpeg on the server is not replaced and
its paths are not modified.

---

## 1. Pinned revision and what was verified

| Item | Value |
|---|---|
| Repository | `github.com/all3f0r1/oneamp` |
| Revision | `c2eb12157d761fe6f885079382a899bd40645822` (tag `v1.4.1`, `main` on 2026-11-05) |
| Crate | `oneamp-wasm` (last touched by `e6753f6`, 2026-10-19), depends on `oneamp-core` with `default-features = false` |
| Build | `cargo build -p oneamp-wasm --target wasm32-unknown-unknown --release` |
| Artifact (this audit's build) | `oneamp_wasm.wasm`, 154.7 KiB raw, 66,637 bytes `gzip -9`, sha256 `e741630f4a333430bc630bae04b9efec05f76f0ba22694684457242e5e030b84` |
| Licence | `MIT OR Apache-2.0` for every crate linked into the module (`anyhow`, `itoa`, `memchr` [Unlicense OR MIT], `serde*`, `serde_json`, `zmij` [MIT], build-time `proc-macro2`/`quote`/`syn`/`unicode-ident`). Tesserafin Web is `GPL-2.0-or-later`: take the **MIT** option. |

The sha256 is the audit build's; the implementation must record its own
build's hash together with the toolchain, since `wasm32` output is not
assumed byte-reproducible across rustc versions.

### 1.1 Verified at the pin (by this audit)

| Claim | Evidence |
|---|---|
| The module has **zero imports** | `WebAssembly.Module.imports(m).length === 0` in Node 24 |
| Export list | `memory`, `oneamp_new`, `oneamp_free`, `oneamp_buffer`, `oneamp_buffer_frames`, `oneamp_process`, `oneamp_flush`, `oneamp_reset`, `oneamp_latency_frames`, `oneamp_output_channels`, `oneamp_is_bypassed`, `oneamp_set_eq_enabled`, `oneamp_set_eq_band`, `oneamp_set_preamp`, `oneamp_set_volume`, `oneamp_set_balance`, `oneamp_set_mono`, `oneamp_set_loudness`, `oneamp_set_replaygain`, `oneamp_set_media_gain`, `oneamp_set_params_json`, `oneamp_alloc`, `oneamp_dealloc` |
| Reference worklet glue works against the module, block by block | `node oneamp-wasm/www/test-worklet.mjs ./oneamp_wasm.wasm` → `worklet ok: latency 95 frames`: default params are an exact 95-frame delay at 48 kHz; a −6.02 dB preamp halves the steady-state peak; a JSON `params` message applies; after `dispose`, `process()` returns `false` |
| C ABI round trip | `oneamp-wasm/src/lib.rs` test `c_abi_round_trip`: rate 1000 Hz rejected (null handle), 6-channel input folds to 2 output channels |

### 1.2 Read in the source, not exercised here

- Supported rates: `8_000..=384_000` Hz (`oneamp-core/src/dsp/mod.rs`, `SAMPLE_RATES`).
- Latency is the limiter look-ahead, a window of `round(rate × 0.002)` frames (≥ 2); the reported delay is 95 frames at 48 kHz (measured), i.e. ≈2 ms at any rate. The host reads `oneamp_latency_frames()` and never derives it.
- `set_params` sanitises every field (clamps, replaces non-finite values) and **ramps** gains/EQ to their targets; `reset` snaps ramps and clears filter history and the look-ahead line.
- `oneamp_set_media_gain` is real-time safe and must be called before the media's first block.
- `oneamp_set_params_json` **allocates** (serde) and may grow wasm memory.
- A change of `multichannel` mode only takes effect on `configure`, which the C ABI does not export: from wasm the mode is always `FoldToStereo`.

### 1.3 Not verified anywhere

OneAmp's own documentation states it: the worklet path has **not been run
in a real browser**. Every browser-side statement below (routing, channel
mixing, autoplay, Safari) is a requirement for the demonstrator to prove,
not an established fact.

---

## 2. Inventory: OneAmp vs. Tesserafin adapter

### 2.1 Available in the C ABI at the pin

10-band EQ (±`EQ_MAX_DB`), preamp, in-chain linear volume (0..1.5, ahead of
the limiter), balance, mono, loudness compensation driven by a listening
volume, ReplayGain (off / track / album / auto with a listening context,
optional clip prevention) fed by host-supplied media gains, surround
fold-down to stereo, look-ahead limiter, `reset`, `flush`, latency and
output-channel queries, a coarse `is_bypassed` flag.

### 2.2 Missing or to fix in OneAmp (upstream work, none blocks the demonstrator)

| # | Gap | Why it matters | Demonstrator workaround |
|---|---|---|---|
| O1 | No export of `Processor::active()` (applied ReplayGain dB, active stages) or limiter gain reduction | #307 requires observable processing state | Report host-side state (route, params sent, `is_bypassed`) only |
| O2 | `oneamp_set_params_json` allocates on the audio thread when sent as a port message | Breaks the "no allocation in the callback" property the module otherwise has | Host never sends `params` after the node is running; typed setters only |
| O3 | `multichannel: Passthrough` unreachable (no `configure` export, `oneamp_new` uses defaults) | Needed only if the host ever feeds > 2 channels | Host feeds stereo (§4.1) |
| O4 | Reference `www/oneamp.js` creates the node with `channelCountMode: 'explicit'`, `channelInterpretation: 'discrete'`, `channelCount: 2` | With *discrete* mixing a mono source reaches **the left channel only**, and a 5.1 source keeps FL/FR and **drops the centre (dialogue)** — Web Audio discrete up/down-mix rules | Tesserafin's adapter uses `'speakers'` (§4.1); report upstream |
| O5 | No ready/handshake or error codes from the worklet; no protocol version | Host cannot distinguish "loading" from "broken" except by `processorerror` | Tesserafin-owned worklet glue adds them (§4.4) |
| O6 | No published binary/package; no browser test | Reproducible provenance | Vendored artifact + provenance record (§10) |

### 2.3 Missing in Tesserafin Web (adapter work, in the implementation issue)

- A single owner of the Web Audio graph for the audio element (today the graph is created ad hoc by the normalisation code, §3).
- The OneAmp host adapter: loading, node lifecycle, message protocol, fallback, state.
- Routing policy by delivery path (§6) and the normalisation-ownership rule (§5).
- Demonstrator controls and tests (§9).

---

## 3. The current web audio path (facts at `origin/main` 084df56f68)

- `src/plugins/htmlAudioPlayer/plugin.js` plays every audio item through one
  hidden `<audio class="mediaPlayerAudio">`, reused across items.
- `options.playMethod` (`DirectPlay` / `DirectStream` / `Transcode`) is built by
  `createStreamInfo` in `src/components/playback/playbackmanager.js` and
  reaches `HtmlAudioPlayer.play(options)`.
- HLS transcodes play through hls.js attached to **the same element**
  (`enableHlsPlayer` → `hls.attachMedia(elem)`); otherwise `src` is set
  directly. Start offsets use the `#t=` fragment then `seekOnPlaybackStart`.
- **Client-side normalisation already exists.** When the user setting
  `selectAudioNormalization()` is `TrackGain` or `AlbumGain`,
  `addGainElement` creates an `AudioContext`, a `MediaElementAudioSourceNode`
  for the element and a `GainNode` (`source → gain → destination`), and sets
  `gain = 10^(NormalizationGain/20)` (or the album value). In Safari the gain
  node also carries the slider volume (`elem.volume` does not affect the
  source node there); elsewhere the slider stays on `elem.volume`.
- With normalisation off, no Web Audio graph exists and the element plays
  directly.

Server side (`tesserafin` `origin/master` 0eff74dd97):

- `NormalizationGain` in DTOs is `-18 − LUFS` from the `AudioNormalizationTask`
  `ebur128` scan (`DtoService.cs`), or a tag value from `AudioFileProber`.
  −18 LUFS is the ReplayGain 2.0 reference, so the value maps directly to
  OneAmp's `track_gain_db` / `album_gain_db`. Peaks are not stored.
- **No transcode path applies loudness normalisation.** `EncodingHelper.GetAudioFilterParam`
  adds only: a `pan=` downmix when going from > 2 to 2 channels (algorithm
  `DownMixStereoAlgorithm`, default `None`), `volume=DownMixAudioBoost`
  (default **2**, i.e. +6 dB) in that same downmix case, and `asetpts` for
  burned text subtitles.

---

## 4. Host contract

Terminology: *host* = Tesserafin Web main thread; *worklet* = the
Tesserafin-owned `AudioWorkletProcessor` glue; *processor* = the OneAmp
wasm instance inside it.

### 4.1 PCM format, rate, channels

| Aspect | Contract |
|---|---|
| Sample format | 32-bit float, nominal range ±1.0, **interleaved** inside wasm memory; planar `Float32Array`s at the Web Audio boundary. The worklet interleaves/de-interleaves. |
| Block size | The Web Audio render quantum: **128 frames**. `oneamp_new(rate, 2, 128)`; the buffer capacity is `max(128, latency)` frames. A block larger than the capacity is a host bug (the processor truncates). |
| Rate | `AudioContext.sampleRate`, fixed for the context's lifetime (the browser resamples every media to it). Must be within 8 kHz..384 kHz; otherwise `oneamp_new` returns 0 → fallback. Per-track rate changes are invisible to the processor. A different context rate requires a new node. |
| Input channels | **2**, produced by the browser: node options `channelCount: 2`, `channelCountMode: 'explicit'`, `channelInterpretation: 'speakers'`. Mono is copied to both channels; 5.1/7.1 is down-mixed by the Web Audio speaker rules (unnormalised: overs are caught by OneAmp's limiter). |
| Output channels | `outputChannelCount: [2]`; the worklet reads `oneamp_output_channels()` (2) and refuses to start otherwise. |
| Multichannel | Out of scope (§8): no Passthrough, no OneAmp fold-down in v1. |

### 4.2 Threads, ownership, allocation

- The processor handle, its interleaved buffer and wasm memory are owned by
  the worklet, on the audio rendering thread. The host never touches them.
- The host owns: the `AudioContext`, the single `MediaElementAudioSourceNode`,
  the `GainNode`, the `AudioWorkletNode`, and the routing between them.
- The host compiles the module once (`WebAssembly.compile` on the main
  thread) and passes the `WebAssembly.Module` in `processorOptions`; the worklet
  instantiates it synchronously with an empty import object. No fetch, no
  `TextDecoder`, no allocation in the worklet after construction.
- Typed setters are applied between blocks (port messages are delivered on
  the audio thread between `process()` calls). They never allocate.
- `params` (whole `DspParams` JSON) is allowed **only before the node is
  connected** (initial snapshot). After that, typed setters only (gap O2).
  The worklet rebinds its `Float32Array` view whenever `memory.buffer`
  changes, as defence in depth.

### 4.3 Lifecycle

```
            flag on + eligible item
 Absent ───────────────────────────► Loading ──ready──► Active ◄──► Bypassed
   ▲                                    │                 │  ▲          │
   │                                    └─fail/timeout─► Failed (route = bypass, sticky for the page)
   │                                                      │
   └──────────────── teardown (flag off / player destroy) ┘
```

| Operation | Host action | Processor call |
|---|---|---|
| **prepare** | Ensure graph (§7), `compile` module (cached per page), `audioWorklet.addModule` (cached per context), create node with the initial parameter snapshot, wait for `{type:'ready'}` (timeout 2 s) | `oneamp_new`, optional `oneamp_set_params_json` (before first block) |
| **process** | Nothing: the render thread pulls blocks | `oneamp_process` per 128-frame block |
| **bypass** (user or policy) | Re-route `source → gain` and disconnect the worklet node. This is a **hard bypass**: OneAmp is out of the signal path, including its 2 ms delay and limiter. | none (node idles or is disposed) |
| *transparent* | Default parameters inside the chain: `is_bypassed() = 1`, pure delay. Not offered as "bypass" to users because the limiter remains armed. | — |
| **reset** (seek, new media) | Post `{type:'reset'}` | `oneamp_reset` |
| **flush** | Not used on the web. End-of-stream is not observable inside the graph; after `ended`/`pause` the element outputs silence and the 2 ms look-ahead drains by itself. | — |
| **teardown** | Post `{type:'dispose'}`, disconnect node, drop references. The `AudioContext` and `MediaElementAudioSourceNode` are **not** destroyed (see §7.2). | `oneamp_free`; `process()` returns `false` |

Re-routing while audio plays produces a discontinuity of the order of the
latency (≈2 ms). Acceptable for the demonstrator; a crossfade is an
implementation-issue option, not a contract requirement.

### 4.4 Message protocol (port messages, versioned)

Host → worklet (`node.port.postMessage`), all carry `v: 1`:

| `type` | Fields | Processor call |
|---|---|---|
| `eqEnabled` | `on: boolean` | `oneamp_set_eq_enabled` |
| `eqBand` | `band: 0..9`, `db: number` | `oneamp_set_eq_band` |
| `preamp` | `db: number` | `oneamp_set_preamp` |
| `volume` | `value: 0..1.5` | `oneamp_set_volume` |
| `balance` | `value: -1..1` | `oneamp_set_balance` |
| `mono` | `on: boolean` | `oneamp_set_mono` |
| `loudness` | `on: boolean`, `listeningVolume: 0..1` | `oneamp_set_loudness` |
| `replayGain` | `mode: 0..3`, `preventClipping: boolean` | `oneamp_set_replaygain` |
| `mediaGain` | `trackDb?`, `trackPeak?`, `albumDb?`, `albumPeak?` (absent → NaN), `context: 0 unknown / 1 album / 2 mixed` | `oneamp_set_media_gain` |
| `reset` | — | `oneamp_reset` |
| `dispose` | — | `oneamp_free` |
| `query` | — | replies with `state` |

Worklet → host:

| `type` | Fields |
|---|---|
| `ready` | `sampleRate`, `latencyFrames`, `outputChannels`, `protocol: 1` |
| `state` | `bypassed: boolean` (`oneamp_is_bypassed`), `latencyFrames` |
| `error` | `code: 'unsupported-format' \| 'bad-output-layout' \| 'bad-message' \| 'protocol'` |

Unknown `type` or `v` → `error` + ignored, never a throw on the audio thread.
Construction failures throw in the constructor, which the host observes as
`processorerror` on the node. Messages are FIFO but **not sample-accurate**:
they take effect at the next block boundary after delivery.

The source of truth for parameters is the host (it keeps the last snapshot
and re-sends it to a new node). The processor is never queried for
parameters.

### 4.5 Latency and timestamps

- Processor latency = `oneamp_latency_frames() / sampleRate` ≈ **2 ms**
  (95 frames at 48 kHz measured). It is constant for a node.
- The Web Audio graph adds `AudioContext.baseLatency + outputLatency`, the
  same as today's normalisation path; OneAmp adds only its 2 ms on top.
- The element's `currentTime` (progress reporting, `Sessions/Playing/Progress`,
  lyrics) is **not** corrected: 2 ms is far below any perceptible threshold
  for audio-only playback.
- A/V sync: video is out of scope (§8). For a later video host, the host
  exposes `latencyFrames/sampleRate` so a player can offset; 2 ms is well
  inside lip-sync tolerances and no compensation is planned.

### 4.6 Playback events

| Event | Host behaviour |
|---|---|
| New media (`setCurrentSrc`) | Decide the route for this item (§6) **before** assigning `src`/attaching hls.js. If routed through OneAmp: post `mediaGain` (only when OneAmp owns normalisation, §5) then `reset`. Loading takes far longer than one quantum, so both land before the first sample of the new media in practice. |
| `seeking` | Post `reset` (clears filter history and the look-ahead so nothing from the old position rings into the new one). |
| `pause` / `play` | Nothing. The element outputs silence while paused; the chain processes silence (cheap) and the tail drains. The context is not suspended by the adapter. |
| `ended` / `stop` | Nothing beyond the existing player logic; the node stays for the next item. |
| `waiting` (stall) | Nothing; silence flows. |
| Volume slider | Unchanged ownership: `elem.volume` (non-Safari) or the `GainNode` (Safari), *after* OneAmp in the graph (§7). OneAmp's `volume` stays 1.0 in product use; `loudness.listeningVolume` follows the slider when loudness is enabled. |
| `AudioContext` `suspended` (autoplay) | `resume()` on play, as the existing gain path must. See limit L6. |
| Item ineligible (§6) | Route = bypass; node kept (not disposed) for the next eligible item. |
| Flag turned off | Teardown. |

### 4.7 Fallback (safe by construction)

The fallback route is the one shipped today: `source → gain → destination`
(or no graph at all if neither OneAmp nor normalisation was ever enabled on
this page). Triggers, each recorded as a reason in the observable state:

| Trigger | Detection |
|---|---|
| No `AudioWorklet` / `WebAssembly` | Feature test before creating anything → OneAmp `Unavailable`, no graph created on its behalf |
| Module fetch/compile fails (network, MIME, CSP without `'wasm-unsafe-eval'`) | `compile` rejects |
| `addModule` fails (CSP, 404) | promise rejects |
| `oneamp_new` returns 0, output layout ≠ 2 | `processorerror` / `error` message |
| No `ready` within 2 s | timeout |
| Worklet error at runtime | `processorerror` |

Rules: the fallback never stops or reloads playback; `Failed` is sticky
for the page (no retry loop); failures are logged once, without URLs (the
media URL carries credentials, see #75/S4). The **one irreversible
step** is `createMediaElementSource` (§7.2): the adapter must never be the
first to create it unless it then routes successfully or falls back to
`source → gain → destination` with gain 1.

### 4.8 Observable state

The adapter exposes, read-only, for the demonstrator panel and later for
the playback diagnostics page (`design-web-playback-diagnostics.md`):

`{ state: 'absent'|'loading'|'active'|'bypassed'|'failed', reason?, route,
playMethod, sampleRate, latencyFrames, processorBypassed, normalisationOwner:
'none'|'legacy-gain'|'oneamp', params }`.

Applied ReplayGain dB and limiter activity require OneAmp gap O1.

---

## 5. Normalisation ownership (no double processing)

Invariant: **at most one gain-normalisation stage applies to a stream.**

| Stage | Applies today | Contract |
|---|---|---|
| Server, any delivery path | No loudness normalisation exists (§3). `volume=DownMixAudioBoost` (+6 dB default) applies only to server-side multichannel → stereo downmixes. | Unchanged. Not counted as normalisation, but noted as limit L4. |
| Web legacy `GainNode` | When the user setting is `TrackGain`/`AlbumGain` | Remains the owner in the demonstrator. |
| OneAmp ReplayGain | — | **Off** (`mode 0`) in the demonstrator. |

Implementation-issue option (recommended after the demonstrator): move
ownership to OneAmp when it is in the path — map the existing setting
`TrackGain → mode 1`, `AlbumGain → mode 2`, send `mediaGain` with
`NormalizationGain` / `AlbumNormalizationGain` (peaks absent), and force
the legacy gain to 1 (× slider in Safari). Gain and limiting then live in one
place, with the limiter catching positive gains the legacy path lets clip.
On a bypass or fallback route, ownership returns to the legacy gain for
that item. An assertion in the adapter checks the invariant on every route
change.

OneAmp's own limiter is not a normalisation stage; there is no other
limiter in the web path.

---

## 6. Delivery paths

| Path (web) | Signal reaching the element | Demonstrator route | Later |
|---|---|---|---|
| Direct Play, progressive HTTP (`/Audio/{id}/stream?static=true`) | Original file decoded by the browser | **OneAmp** | — |
| Direct Stream (remux, audio copied) | Same audio, new container | Bypass | Eligible; same PCM properties as Direct Play |
| Transcode, progressive | FFmpeg-encoded audio (possibly downmixed + boosted) | **Bypass** — the demonstrator proves this path is unaffected | Eligible once L4 is handled |
| Transcode, HLS via hls.js (MSE) | Same element, MSE buffer | Bypass | Needs browser proof (Chromium, Firefox) |
| HLS played natively by Safari | Native pipeline | Bypass | Unverified: Web Audio capture of native HLS in WebKit must be proven before any graph is created for it (L5) |
| Bitstream/passthrough (AC-3/DTS to a receiver) | Not available to web pages: browsers always decode to PCM | n/a | n/a |
| Video (`htmlVideoPlayer`), cast, remote players | Not touched | n/a | Separate decision |

Eligibility in the demonstrator: flag on **and** `playMethod === 'DirectPlay'`
**and** no hls.js instance for the item **and** the media type is `Audio`.

---

## 7. Insertion in the existing player

### 7.1 Graph

```
<audio.mediaPlayerAudio> ─► MediaElementAudioSourceNode ─┬─► AudioWorkletNode('oneamp') ─┐
   (decode, MSE, seek,                                    │                                ├─► GainNode ─► destination
    elem.volume*)                                         └──────── (bypass route) ────────┘   (legacy normalisation,
                                                                                                 Safari slider volume)
```

\* `elem.volume` attenuates before the source node in Chromium/Firefox; in
Safari it does not, hence the gain node carries it (existing behaviour).

The gain node stays **after** OneAmp so that the legacy normalisation and
Safari volume behave exactly as today on both routes, and the bypass route is
the shipped graph unchanged. Consequence: a positive legacy normalisation
gain is applied after OneAmp's limiter and can clip, as it can today — one
more reason for the §5 option that moves normalisation into OneAmp.

### 7.2 Single owner of the graph

`createMediaElementSource(elem)` can be called once per element, and from
then on the element's audio only reaches the speakers through that
context. Today `addGainElement` does it lazily. The implementation moves it
into one `audioGraph` module owned by `htmlAudioPlayer`:

- `ensureGraph()` — idempotent: context, source, gain, default route.
- `setRoute('oneamp' | 'bypass')` — the only place that connects/disconnects.
- The legacy normalisation code calls `ensureGraph()` and sets the gain;
  it no longer creates nodes.
- With the flag off and normalisation off, `ensureGraph()` is never called
  and playback is byte-for-byte today's path.

---

## 8. Known limits

| # | Limit | Consequence / safe behaviour |
|---|---|---|
| L1 | Stereo only. Multichannel sources are down-mixed by the browser before OneAmp (speaker rules, no centre-preserving dialogue mix). | Fine for music; video/surround is out of scope. |
| L2 | Not run in a real browser yet (OneAmp's own statement, §1.3). | The demonstrator is the proof; fallback covers failure. |
| L3 | Parameter changes are block-accurate, not sample-accurate; `reset` on seek may land a block or two late. | Inaudible in practice; documented. |
| L4 | Server-side downmix applies `DownMixAudioBoost` (+6 dB default) after `NormalizationGain` was measured on the original. | Transcoded multichannel items would be over-normalised if OneAmp owned normalisation on that path: stays bypassed. |
| L5 | Safari native HLS and Web Audio capture: unverified; historically unreliable. | No OneAmp route for HLS; Safari HLS must be tested before the flag is offered on Safari. |
| L6 | `createMediaElementSource` is irreversible; a context left `suspended` by autoplay policy silences the element. | Same risk the legacy normalisation path already carries; graph created only on a user-initiated play, `resume()` on play; demonstrator checks it. |
| L7 | Hard-bypass toggles cause a ≈2 ms discontinuity. | Acceptable for a demonstrator. |
| L8 | Cross-origin media without CORS feeds zeros to a source node. | Tesserafin Web is served same-origin with the server; reverse-proxied split origins must send CORS (already needed by hls.js). |
| L9 | Deployments that add a CSP must allow `'wasm-unsafe-eval'` (compile) and `'self'` worklet modules. | Otherwise compile fails → fallback (§4.7). Tesserafin's server sets no CSP for the web client today. |
| L10 | Rate is the context rate; no per-track rate, no bit-perfect output. | Inherent to Web Audio. |
| L11 | Observable state lacks applied gain/limiter activity (O1). | Panel shows host-side state only. |
| L12 | Adaptive behaviour, presets, persistence/sync of settings. | #304 / later implementation issues. |

---

## 9. Demonstrator plan (bounded)

### 9.1 Scope

In: Tesserafin Web, `htmlAudioPlayer`, audio items in Direct Play,
Chromium and Firefox (last 2), Safari only to prove fallback/bypass.
Controls: bypass, OneAmp in-chain volume, preamp, EQ (enable + 10 bands).
Out: video, Android, settings persistence, normalisation migration (§5
option), product UI, i18n.

Gate: an experimental flag read from `localStorage`
(`tesserafin.experimental.oneamp = "1"`), off by default, no settings UI.
With the flag off nothing loads (no wasm/worklet request, no graph).

### 9.2 Files (tesserafin-web)

| File | Role |
|---|---|
| `src/plugins/htmlAudioPlayer/audioGraph.ts` | Single graph owner (§7.2); replaces `addGainElement` |
| `src/plugins/htmlAudioPlayer/oneamp/oneampHost.ts` | Loading, lifecycle state machine, protocol, fallback, observable state; lazy chunk |
| `src/plugins/htmlAudioPlayer/oneamp/oneampWorklet.js` | Tesserafin-owned worklet glue derived from OneAmp `www/oneamp-worklet.js` at the pin, with §4.4 protocol, `ready`/`error`, no `params` after start; emitted as its own asset via `new URL(..., import.meta.url)` |
| `src/plugins/htmlAudioPlayer/oneamp/oneamp_wasm.wasm` + `PROVENANCE.md` | Vendored artifact: revision, toolchain, build command, sha256 (§10) |
| `src/plugins/htmlAudioPlayer/oneamp/OneAmpDevPanel.tsx` | Flag-only floating panel: controls + §4.8 state readout |
| `plugin.js` | Route decision in `setCurrentSrc`, `seeking` → reset, legacy gain via `audioGraph` |

The wasm is fetched with `fetch` + `WebAssembly.compile(await res.arrayBuffer())`
(does not depend on the server's `.wasm` MIME type). Neither file may enter
the initial bundle (delivery-budget gate).

### 9.3 Steps

1. `audioGraph` refactor alone, flag-independent: legacy normalisation
   behaves exactly as before (existing tests + a new unit test for the
   Safari volume path).
2. `oneampHost` + worklet with a fake `AudioContext` under vitest: state
   machine, every fallback trigger of §4.7, the route decision table of §6,
   message sequence on new media/seek, normalisation invariant of §5.
3. Worklet against the real wasm under Node (ported `test-worklet.mjs`):
   bypass = `latencyFrames` delay; −6.02 dB preamp halves the level;
   +12 dB preamp on a 0 dBFS sine stays ≤ 1.0 (limiter); silence in →
   exact zeros out; wasm `memory.buffer.byteLength` unchanged after 10⁵
   blocks of setter traffic.
4. Dev panel + wiring in `plugin.js` behind the flag.
5. Browser proof (Playwright, Chromium + Firefox, server-free suite with a
   Direct Play fixture): with an `AnalyserNode` tap after the gain node,
   assert RMS(bypass) ≈ 2 × RMS(preamp −6.02 dB); EQ +12 dB at one band
   raises that band's FFT bin; toggling bypass changes `state` and route;
   seek posts `reset`; a forced compile failure (served 404) leaves audio
   audible with `state: failed`.
6. Transcode-path check against a real server (§9.4).
7. Listening pass and a short report on #308: clipping, silence, CPU
   (worklet `process` time vs. the 2.67 ms quantum at 48 kHz), latency.

### 9.4 Verifying the server FFmpeg path still works

Flag **on**, same session:

1. Play a Direct Play item → `state: active`.
2. Play an item that cannot be direct-played (e.g. MP2 in Matroska audio,
   or force it by lowering the max streaming bitrate) → `/Sessions` shows
   `PlayMethod: Transcode`; the server log shows a `TranscodeManager` line
   running ffmpeg; the adapter reports `state: bypassed, reason:
   not-direct-play`; analyser RMS > 0 (audible); progress reports advance;
   seeking works.
3. Same with an HLS transcode (hls.js) → same expectations.
4. Back to a Direct Play item → `active` again, no reload.

Flag **off**: the same three items behave exactly as `main` (no wasm or
worklet network request; no `AudioContext` unless normalisation is on).

No server change is made, so server tests are not part of this gate.

### 9.5 Acceptance

- [ ] All §4.7 fallback triggers leave playback audible, proved by test.
- [ ] Flag off = no network request for OneAmp assets and unchanged graph.
- [ ] Direct Play routes through OneAmp in Chromium and Firefox; preamp, EQ,
      volume and bypass have measured effects.
- [ ] Transcode (progressive and HLS) plays, seeks and reports progress with
      the flag on (§9.4).
- [ ] Normalisation invariant holds on every route change (§5).
- [ ] No allocation after start (wasm memory stable; no `params` after start).
- [ ] Mono source plays on both channels (regression test for O4).
- [ ] Initial bundle unchanged (delivery-budget gate green).
- [ ] Safari: flag on either works for Direct Play or falls back audibly;
      HLS stays bypassed.

---

## 10. Boundaries, packaging, licensing

- **#146:** the processing chain is a client-side optional capability, not
  core. No server API, DTO or authorisation change. The contract above is a
  web-client adapter boundary; the processor is a replaceable module behind
  it. Settings persistence/sync, when it comes, uses existing client
  preference storage and is a separate decision.
- **Packaging (decision requested):** recommended — vendor the built `.wasm`
  with a `PROVENANCE.md` (revision, rustc version, command, sha256) and a CI
  check that the file's hash matches the record. Alternative: build in web CI,
  which adds a Rust toolchain to the web pipeline. Either is a dependency and
  lands only with the implementation issue.
- **Licence:** take OneAmp under MIT; record the transitive crate licences
  (§1) in the provenance file.
- **#304:** nothing here analyses content or adapts; the processor runs with
  explicit, user-set parameters only.
- **Defaults:** off. Enabling processing by default is a later product
  decision (#307 "conservative defaults").

---

## 11. Draft implementation issue (to file after this contract is accepted)

> **[Audio / DSP-2] Web demonstrator: OneAmp AudioWorklet on Direct Play audio**
>
> Parent: #307 · Contract: `tesserafin-web` `docs/tesserafin/oneamp-web-host-contract.md`
> (accepted revision) · OneAmp pin: `c2eb12157d761fe6f885079382a899bd40645822` (v1.4.1)
>
> Implement §9 of the contract behind the `tesserafin.experimental.oneamp`
> flag: single Web Audio graph owner, OneAmp host adapter with the §4.4
> protocol and §4.7 fallback, vendored wasm with provenance, flag-only dev
> panel (bypass, volume, preamp, EQ), tests of §9.3 and the server-path
> check of §9.4. Acceptance: §9.5.
>
> Non-goals: video, Android, normalisation migration to OneAmp, settings
> UI/persistence, multichannel, adaptive behaviour (#304).
>
> Upstream follow-ups to file on OneAmp: O1 (observable state export), O2
> (non-allocating parameter snapshot), O4 (`speakers` channel
> interpretation in the reference glue), O5 (worklet handshake), O6
> (browser test + release artifact).

## 12. Decisions requested from the reviewer

1. Accept the hard-bypass definition (§4.3) and the gain-node-after-OneAmp
   graph (§7.1).
2. Normalisation: legacy gain stays the owner for the demonstrator (§5) —
   and is moving it to OneAmp the next step?
3. Packaging: vendored wasm + provenance (recommended) or CI build (§10).
4. Safari policy for the demonstrator flag (§9.5 last item).

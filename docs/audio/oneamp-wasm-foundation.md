# OneAmp PCM/WASM foundation (experimental)

This is the build and offline PCM proof for the first part of DSP-2, refs #211.
It does not enable DSP in Tesserafin's player, add a setting, or deliver an asset
in the production bundle. Nothing under `src/` imports these tools.

The audited upstream source is [OneAmp v1.4.0, commit cbf04e7](https://github.com/all3f0r1/oneamp/tree/cbf04e7ba97f000676c829257ce215e41281dd84).
The [server audit and host contract](https://github.com/tesserafin-project/tesserafin/blob/master/docs/audio/oneamp-dsp-1-audit.md)
remain the integration reference. This lot replaces the audit's mock ABI proof
with execution of the actual Rust-produced module, without claiming a finished
AudioWorklet integration.

## Build and inspect

Requires Node 24, Git, rustup and access to GitHub, crates.io and Rust's distribution
service at build time. No npm dependency is added. From the repository root:

```sh
rustup toolchain install 1.94.0 --profile minimal --target wasm32-unknown-unknown
node tools/oneamp/build.mjs --output oneamp-dsp-out
node --test tools/oneamp/pcm.test.mjs
node tools/oneamp/build.mjs --output oneamp-dsp-repeat
node tools/oneamp/compare-builds.mjs oneamp-dsp-out oneamp-dsp-repeat
```

The build pins the full source commit, Cargo.lock SHA-256, Rust 1.94.0 and
`wasm32-unknown-unknown`. It invokes Cargo with `--locked`, release optimizations
from the pinned workspace, fresh target directories, normalized source paths
and `SOURCE_DATE_EPOCH=0`. It builds only `oneamp-wasm` and its PCM-only core
(`default-features = false`). Cargo may fetch workspace metadata, including
unselected desktop packages; these are not linked into the WASM dependency tree.
The build fails if the module has any imports. It never runs upstream shell or
package installation scripts. Cargo build scripts run as part of compilation.

`--source /absolute/clean/checkout` can reuse an audited local checkout; a different
commit or dirty checkout is refused. Output must be a new directory. Both default
builds use separate source checkouts and target directories. The comparison checks
every output byte, including manifest and notices. This establishes repeatability
on the same runner/toolchain; it is not cross-platform or independent-builder
reproducibility certification.

Outputs are ignored locally. CI retains the experimental artifact for 14 days:

- `oneamp.wasm`: the module; the manifest records its byte length and SHA-256.
- `manifest.json`: source/toolchain/lock identity, exports and selected normal/build
  dependency inventory (including proc macros, not a claim that every crate's code
  survives optimization).
- `notices/`: exact selected package license/notice files and the Rust installation's
  copyright inventories and license texts. OneAmp and dual MIT dependencies select
  MIT; unicode-ident additionally retains Unicode-3.0. Unknown license expressions
  stop the build for review. Rust's supplied inventory is broader than linked code.

Keep notices and manifest with the binary. This is an experimental verification
artifact, not a complete distribution/legal audit or a release SBOM. Review release
packaging and the final host adapter before shipping it.

## PCM contract exercised

`pcm-host.mjs` is an allocating **offline test host**, not real-time callback code.
It accepts stereo Float32 PCM at 44.1/48 kHz, limits block capacity, rejects malformed
or non-finite input, obtains fresh memory views, checks returned sample counts and
copies only the valid output. It calls the C ABI directly. ReplayGain is off and
internal volume is unity; the future player still owns normalization and user
volume. Preamp/EQ are explicit test controls.

The 17 tests execute the real binary and cover:

- the pinned module hash, required exports and import-free instantiation;
- 64/128/256/512-frame blocks at both rates, finite samples and flat delayed PCM;
- latency queried from the ABI (87 frames at 44.1 kHz, 95 at 48 kHz);
- one EOS flush, complete sample-aligned tails including a short clip, refusal of
  duplicate flush/process-after-EOS, and reset before reuse;
- measurable preamp attenuation/EQ boost, chunk independence with identical
  parameter state, and finite sample peaks at or below unity on hot input;
- reset clearing filter/lookahead history, idempotent teardown, invalid input,
  disposed handles, and honoring/rejecting returned sample counts.

Reset also snaps parameter smoothing to targets. Tests compare equivalent reset
states; they do not equate a live parameter transition with a settled preset.
The limiter bound is **sample peak**, not true peak or loudness certification.
The upstream flush is called once with sufficient capacity, never repeatedly
until zero. No JSON control API runs in a callback.

## Remaining integration work

A bounded, allocation-audited AudioWorklet adapter still needs actual graph
insertion/removal, dry/delayed bypass alignment, autoplay/unlock, pause/seek/new-track
and EOS synchronization, tail policy, browser timing/CPU and failure recovery tests.
Those tests must use the actual HTML audio graph and supported browsers. The
upstream fixed-128-frame worklet is not copied or qualified here.

There is no video, multichannel, Android, OneDrop, TV, Cast, HLS or transcoder
support claim in this lot. Existing playback and the production loading graph
receive no DSP code from this change.

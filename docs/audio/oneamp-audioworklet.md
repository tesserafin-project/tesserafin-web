# Experimental OneAmp AudioWorklet

This is a bounded demonstrator, not production player activation. It extends the
pinned real PCM/WASM foundation with an actual AudioWorklet and a retained-bypass
graph adapter. No setting, automatic import, server API or account is added.

The adapter accepts an existing AudioContext and normalization gain. It never
creates a media source or a second normalization stage. OneAmp volume stays at 1
and ReplayGain stays off. Only 44.1/48 kHz stereo PCM is accepted. Controls are
bounded, sequenced and scoped to lifecycle epochs; missing input is not EOS.

Build the pinned asset and run:

```sh
node tools/oneamp/build.mjs --output oneamp-dsp-out
node --test tools/oneamp/worklet/core.test.mjs
node tools/oneamp/worklet/browser.mjs
```

The browser rig self-hosts the generated WASM and fixture WAV, verifies its
manifest hash and runs actual AudioWorklet processing in Chromium and Firefox.
It measures final impulses, single normalization/preamp application, control
acknowledgements, reset, retained bypass and failure/disposal. These isolated
observations do not certify Tesserafin player/session integration, physical sink
completion, Safari, video, multichannel, HLS or remote media.

Local observation (2026-10-21): Chromium 134.0.6998.35, Linux x64, render quantum
128. Both 44.1 and 48 kHz retain both fixture impulses and their exact separation.
Native latency: 87 and 95 frames respectively. At 44.1 kHz the final impulse was
submitted at graph frame 25227 and the element ended callback was observed at
25600; at 48 kHz they were 28081 and 28416. This is one measured run, not a bound
on callback delay or proof of audible sink completion. A drained acknowledgement
means the tail was submitted to the rendering graph. Never use it to report an
already completed player session as newly drained.

The existing player must own source preparation, seek gating, source changes and
ended/progress ordering before activation. Actual-player qualification is a
separate acceptance layer, with unsupported/error paths retaining playback.

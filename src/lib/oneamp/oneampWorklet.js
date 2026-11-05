// OneAmp processing chain in an AudioWorkletGlobalScope - Tesserafin-owned glue.
//
// Contract: docs/tesserafin/oneamp-web-host-contract.md §4.1-§4.4. Derived from
// OneAmp's reference `oneamp-wasm/www/oneamp-worklet.js` at the pinned commit
// (see PROVENANCE.md), with Tesserafin's versioned port protocol: `ready` /
// `ack` / `state` / `error` replies, a typed `apply` snapshot, no JSON at any
// point (the scope has no TextEncoder, and `oneamp_set_params_json`
// allocates), and messages that never throw on the audio thread.
//
// Loaded with `audioWorklet.addModule` as a plain script: no imports, no
// fetch. The host compiles the module and passes it in `processorOptions`.
//
// `sampleRate`, `AudioWorkletProcessor` and `registerProcessor` are globals of
// the AudioWorkletGlobalScope, read through `globalThis`.
const { AudioWorkletProcessor, registerProcessor } = globalThis;

const PROTOCOL = 1;
const CHANNELS = 2;
const RENDER_QUANTUM = 128;
const EQ_BANDS = 10;

function isNumber(x) {
    return typeof x === 'number' && Number.isFinite(x);
}

function isBool(x) {
    return typeof x === 'boolean';
}

// Absent (undefined or null) media-gain figures are "unknown" (NaN) for OneAmp.
function figure(x) {
    return isNumber(x) ? x : NaN;
}

function inRange(lo, hi) {
    return (x) => isNumber(x) && x >= lo && x <= hi;
}

function integerIn(lo, hi) {
    return (x) => Number.isInteger(x) && x >= lo && x <= hi;
}

function isBands(x) {
    return Array.isArray(x) && x.length === EQ_BANDS && x.every(isNumber);
}

// Contract §4.4 domains. Every field of a message or snapshot is checked
// against these BEFORE any setter runs, so a rejected message changes nothing.
const isVolume = inRange(0, 1.5);
const isBalance = inRange(-1, 1);
const isListeningVolume = inRange(0, 1);
const isReplayGainMode = integerIn(0, 3);
const isGainContext = integerIn(0, 2);
const isBand = integerIn(0, EQ_BANDS - 1);

const SNAPSHOT_FIELDS = [
    ['eqEnabled', isBool],
    ['eqBands', isBands],
    ['preamp', isNumber],
    ['volume', isVolume],
    ['balance', isBalance],
    ['mono', isBool],
    ['loudness', isBool],
    ['listeningVolume', isListeningVolume],
    ['replayGain', isReplayGainMode],
    ['preventClipping', isBool]
];
const MEDIA_GAIN_FIGURES = ['trackDb', 'trackPeak', 'albumDb', 'albumPeak'];

function isObject(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
}

// Validates media-gain figures and context. Returns the bad field or null.
function mediaGainError(g, prefix) {
    for (const k of MEDIA_GAIN_FIGURES) {
        const x = g[k];
        if (x !== undefined && x !== null && !isNumber(x)) return prefix + k;
    }
    if (g.context !== undefined && !isGainContext(g.context)) {
        return `${prefix}context`;
    }
    return null;
}

// Validates a whole snapshot, nested fields included. Returns the bad
// field's path, or null when every field is acceptable.
function snapshotError(p) {
    if (!isObject(p)) return 'params';
    for (const [k, ok] of SNAPSHOT_FIELDS) {
        if (!ok(p[k])) return k;
    }
    if (p.mediaGain !== undefined) {
        if (!isObject(p.mediaGain)) return 'mediaGain';
        return mediaGainError(p.mediaGain, 'mediaGain.');
    }
    return null;
}

class BadMessage extends Error {
    constructor(code, detail) {
        super(detail);
        this.code = code;
    }
}

class OneAmpProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const { module, params } = options.processorOptions || {};
        const wasm = new WebAssembly.Instance(module, {}).exports;
        const sampleRate = globalThis.sampleRate;
        const h = wasm.oneamp_new(sampleRate, CHANNELS, RENDER_QUANTUM);
        this.sampleRate = sampleRate;
        // Construction failures throw: the host sees `processorerror`.
        if (h === 0) throw new Error('unsupported-format');
        if (wasm.oneamp_output_channels(h) !== CHANNELS) {
            wasm.oneamp_free(h);
            throw new Error('bad-output-layout');
        }
        this.wasm = wasm;
        this.h = h;
        this.latencyFrames = wasm.oneamp_latency_frames(h);
        if (params !== undefined) {
            const bad = snapshotError(params);
            if (bad) {
                wasm.oneamp_free(h);
                throw new Error(`bad-message: params.${bad}`);
            }
            this.applySnapshot(params);
        }
        this.rebind();
        this.port.onmessage = (e) => this.receive(e.data);
        this.port.postMessage({
            type: 'ready',
            v: PROTOCOL,
            protocol: PROTOCOL,
            sampleRate: this.sampleRate,
            latencyFrames: this.latencyFrames,
            outputChannels: CHANNELS
        });
    }

    // The interleaved buffer view. Only rebuilt if wasm memory grew, which
    // nothing after construction should cause (no JSON, no allocator call):
    // defence in depth, outside the steady state.
    rebind() {
        const w = this.wasm;
        this.view = new Float32Array(
            w.memory.buffer,
            w.oneamp_buffer(this.h),
            w.oneamp_buffer_frames(this.h) * CHANNELS
        );
    }

    receive(m) {
        try {
            this.handle(m);
        } catch (err) {
            const code = err instanceof BadMessage ? err.code : 'bad-message';
            this.port.postMessage({
                type: 'error',
                v: PROTOCOL,
                code,
                about: m && typeof m.type === 'string' ? m.type : null,
                detail: String(err && err.message ? err.message : err)
            });
        }
    }

    handle(m) {
        if (m === null || typeof m !== 'object' || m.v !== PROTOCOL) {
            throw new BadMessage('protocol', 'expected { v: 1 }');
        }
        if (this.h === 0) {
            if (m.type === 'dispose') return;
            throw new BadMessage('protocol', 'disposed');
        }
        const w = this.wasm;
        const h = this.h;
        switch (m.type) {
            case 'eqEnabled':
                if (!isBool(m.on)) throw new BadMessage('bad-message', 'on');
                w.oneamp_set_eq_enabled(h, m.on ? 1 : 0);
                break;
            case 'eqBand':
                if (!isBand(m.band))
                    throw new BadMessage('bad-message', 'band');
                if (!isNumber(m.db)) throw new BadMessage('bad-message', 'db');
                w.oneamp_set_eq_band(h, m.band, m.db);
                break;
            case 'preamp':
                if (!isNumber(m.db)) throw new BadMessage('bad-message', 'db');
                w.oneamp_set_preamp(h, m.db);
                break;
            case 'volume':
                if (!isVolume(m.value)) {
                    throw new BadMessage('bad-message', 'value');
                }
                w.oneamp_set_volume(h, m.value);
                break;
            case 'balance':
                if (!isBalance(m.value)) {
                    throw new BadMessage('bad-message', 'value');
                }
                w.oneamp_set_balance(h, m.value);
                break;
            case 'mono':
                if (!isBool(m.on)) throw new BadMessage('bad-message', 'on');
                w.oneamp_set_mono(h, m.on ? 1 : 0);
                break;
            case 'loudness':
                if (!isBool(m.on)) throw new BadMessage('bad-message', 'on');
                if (!isListeningVolume(m.listeningVolume)) {
                    throw new BadMessage('bad-message', 'listeningVolume');
                }
                w.oneamp_set_loudness(h, m.on ? 1 : 0, m.listeningVolume);
                break;
            case 'replayGain':
                if (!isReplayGainMode(m.mode)) {
                    throw new BadMessage('bad-message', 'mode');
                }
                if (!isBool(m.preventClipping)) {
                    throw new BadMessage('bad-message', 'preventClipping');
                }
                w.oneamp_set_replaygain(h, m.mode, m.preventClipping ? 1 : 0);
                break;
            case 'mediaGain': {
                const bad = mediaGainError(m, '');
                if (bad) throw new BadMessage('bad-message', bad);
                this.applyMediaGain(m);
                break;
            }
            case 'reset':
                w.oneamp_reset(h);
                break;
            case 'apply': {
                if (!isNumber(m.seq))
                    throw new BadMessage('bad-message', 'seq');
                const bad = snapshotError(m.params);
                if (bad) throw new BadMessage('bad-message', `params.${bad}`);
                this.applySnapshot(m.params);
                this.port.postMessage({ type: 'ack', v: PROTOCOL, seq: m.seq });
                break;
            }
            case 'query':
                this.port.postMessage({
                    type: 'state',
                    v: PROTOCOL,
                    bypassed: w.oneamp_is_bypassed(h) === 1,
                    latencyFrames: this.latencyFrames
                });
                break;
            case 'dispose':
                w.oneamp_free(h);
                this.h = 0;
                break;
            default:
                throw new BadMessage('bad-message', 'unknown type');
        }
    }

    // Validated by `mediaGainError` first.
    applyMediaGain(g) {
        const context = g.context ?? 0;
        this.wasm.oneamp_set_media_gain(
            this.h,
            figure(g.trackDb),
            figure(g.trackPeak),
            figure(g.albumDb),
            figure(g.albumPeak),
            context
        );
    }

    // Contract §4.4 order. Validated as a whole by `snapshotError` first:
    // no setter runs for a snapshot that has any bad field.
    applySnapshot(p) {
        const w = this.wasm;
        const h = this.h;
        w.oneamp_set_eq_enabled(h, p.eqEnabled ? 1 : 0);
        for (let b = 0; b < EQ_BANDS; b++)
            w.oneamp_set_eq_band(h, b, p.eqBands[b]);
        w.oneamp_set_preamp(h, p.preamp);
        w.oneamp_set_volume(h, p.volume);
        w.oneamp_set_balance(h, p.balance);
        w.oneamp_set_mono(h, p.mono ? 1 : 0);
        w.oneamp_set_loudness(h, p.loudness ? 1 : 0, p.listeningVolume);
        w.oneamp_set_replaygain(h, p.replayGain, p.preventClipping ? 1 : 0);
        if (p.mediaGain !== undefined) this.applyMediaGain(p.mediaGain);
    }

    // Per render quantum. No explicit allocation in this method (no `new`,
    // literals, closures or string building): checked by a static test.
    process(inputs, outputs) {
        if (this.h === 0) return false;
        const output = outputs[0];
        const input = inputs[0];
        const frames = output[0].length;
        if (this.view.buffer !== this.wasm.memory.buffer) this.rebind();
        const view = this.view;
        for (let c = 0; c < CHANNELS; c++) {
            const src =
                input !== undefined && c < input.length ? input[c] : undefined;
            if (src === undefined) {
                for (let i = 0; i < frames; i++) view[i * CHANNELS + c] = 0;
            } else {
                for (let i = 0; i < frames; i++)
                    view[i * CHANNELS + c] = src[i];
            }
        }
        this.wasm.oneamp_process(this.h, frames);
        for (let c = 0; c < output.length; c++) {
            const dst = output[c];
            const sc = c < CHANNELS ? c : CHANNELS - 1;
            for (let i = 0; i < frames; i++) dst[i] = view[i * CHANNELS + sc];
        }
        return true;
    }
}

registerProcessor('tesserafin-oneamp', OneAmpProcessor);

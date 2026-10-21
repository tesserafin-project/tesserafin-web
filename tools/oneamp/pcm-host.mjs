// Offline test host; allocates/copies on each block. Not an AudioWorklet adapter.
export class PcmHost {
    constructor(exports, rate, maxFrames = 128) {
        if (
            ![44100, 48000].includes(rate) ||
            !Number.isInteger(maxFrames) ||
            maxFrames < 1 ||
            maxFrames > 8192
        )
            throw new RangeError('Unsupported PCM format/capacity');
        this.api = exports;
        this.handle = exports.oneamp_new(rate, 2, maxFrames);
        if (!this.handle) throw new Error('WASM refused format');
        this.capacity = exports.oneamp_buffer_frames(this.handle);
        this.latency = exports.oneamp_latency_frames(this.handle);
        this.ended = false;
        exports.oneamp_set_replaygain(this.handle, 0, 0);
        exports.oneamp_set_volume(this.handle, 1);
        if (
            exports.oneamp_output_channels(this.handle) !== 2 ||
            this.capacity < maxFrames ||
            this.capacity < this.latency
        ) {
            this.close();
            throw new Error('Unexpected PCM ABI');
        }
    }
    live() {
        if (!this.handle) throw new Error('Host closed');
    }
    read(count) {
        if (
            !Number.isInteger(count) ||
            count < 0 ||
            count > this.capacity * 2 ||
            count % 2
        )
            throw new Error('Invalid returned sample count');
        return new Float32Array(
            this.api.memory.buffer,
            this.api.oneamp_buffer(this.handle),
            count
        ).slice();
    }
    process(input) {
        this.live();
        if (this.ended) throw new Error('Reset required after EOS');
        if (
            !(input instanceof Float32Array) ||
            !input.length ||
            input.length % 2 ||
            input.length > this.capacity * 2 ||
            !input.every(Number.isFinite)
        )
            throw new RangeError('Invalid stereo PCM block');
        new Float32Array(
            this.api.memory.buffer,
            this.api.oneamp_buffer(this.handle),
            input.length
        ).set(input);
        return this.read(
            this.api.oneamp_process(this.handle, input.length / 2)
        );
    }
    finish() {
        this.live();
        if (this.ended) throw new Error('EOS already flushed');
        this.ended = true;
        return this.read(this.api.oneamp_flush(this.handle));
    }
    reset() {
        this.live();
        this.api.oneamp_reset(this.handle);
        this.ended = false;
    }
    preamp(db) {
        this.live();
        if (!Number.isFinite(db) || Math.abs(db) > 12)
            throw new RangeError('Invalid preamp');
        this.api.oneamp_set_preamp(this.handle, db);
    }
    eq(band, db) {
        this.live();
        if (
            !Number.isInteger(band) ||
            band < 0 ||
            band > 9 ||
            !Number.isFinite(db) ||
            Math.abs(db) > 12
        )
            throw new RangeError('Invalid EQ');
        this.api.oneamp_set_eq_band(this.handle, band, db);
        this.api.oneamp_set_eq_enabled(this.handle, 1);
    }
    close() {
        if (this.handle) {
            this.api.oneamp_free(this.handle);
            this.handle = 0;
        }
    }
}

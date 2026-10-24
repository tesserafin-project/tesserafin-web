// Experimental PCM owner shared by the real AudioWorklet and offline ABI tests.
// No network, media identity, JSON parsing or per-block buffer creation.
export class ProcessorCore {
    constructor(module, rate, capacity = 512) {
        if (![44100, 48000].includes(rate) || capacity !== 512)
            throw new RangeError('unsupported-format');
        this.api = new WebAssembly.Instance(module, {}).exports;
        this.handle = this.api.oneamp_new(rate, 2, capacity);
        if (!this.handle) throw new Error('engine-prepare-failed');
        this.capacity = this.api.oneamp_buffer_frames(this.handle);
        this.latency = this.api.oneamp_latency_frames(this.handle);
        if (
            this.capacity < capacity ||
            this.latency > capacity ||
            this.api.oneamp_output_channels(this.handle) !== 2
        ) {
            this.dispose();
            throw new Error('engine-abi-mismatch');
        }
        this.memory = this.api.memory.buffer;
        this.samples = new Float32Array(
            this.memory,
            this.api.oneamp_buffer(this.handle),
            this.capacity * 2
        );
        this.tail = new Float32Array(capacity * 2);
        this.gains = new Float32Array(10);
        this.epoch = 0;
        this.sequence = 0;
        this.phase = 'running';
        this.tailFrames = 0;
        this.tailOffset = 0;
        this.api.oneamp_set_volume(this.handle, 1);
        this.api.oneamp_set_replaygain(this.handle, 0, 0);
    }
    live() {
        if (!this.handle) throw new Error('engine-disposed');
        if (this.api.memory.buffer !== this.memory)
            throw new Error('engine-memory-changed');
    }
    configure(epoch, sequence, preamp, gains) {
        this.live();
        if (
            !Number.isSafeInteger(epoch) ||
            !Number.isSafeInteger(sequence) ||
            epoch !== this.epoch ||
            sequence <= this.sequence
        )
            return false;
        if (
            !Number.isFinite(preamp) ||
            Math.abs(preamp) > 12 ||
            !(gains instanceof Float32Array) ||
            gains.length !== 10
        )
            throw new RangeError('invalid-controls');
        for (let band = 0; band < 10; band++) {
            if (!Number.isFinite(gains[band]) || Math.abs(gains[band]) > 12)
                throw new RangeError('invalid-controls');
        }
        this.api.oneamp_set_preamp(this.handle, preamp);
        for (let band = 0; band < 10; band++)
            this.api.oneamp_set_eq_band(this.handle, band, gains[band]);
        this.api.oneamp_set_eq_enabled(this.handle, 1);
        this.sequence = sequence;
        return true;
    }
    reset(epoch) {
        this.live();
        if (!Number.isSafeInteger(epoch) || epoch <= this.epoch) return false;
        this.api.oneamp_reset(this.handle);
        this.epoch = epoch;
        this.sequence = 0;
        this.phase = 'running';
        this.tailFrames = 0;
        this.tailOffset = 0;
        return true;
    }
    drain(epoch) {
        this.live();
        if (epoch !== this.epoch || this.phase !== 'running') return false;
        const count = this.api.oneamp_flush(this.handle);
        if (
            !Number.isInteger(count) ||
            count < 0 ||
            count > this.latency * 2 ||
            count % 2
        )
            throw new Error('invalid-flush-count');
        for (let i = 0; i < count; i++) {
            if (!Number.isFinite(this.samples[i]))
                throw new Error('invalid-output');
            this.tail[i] = this.samples[i];
        }
        this.tailFrames = count / 2;
        this.tailOffset = 0;
        this.phase = 'draining';
        return true;
    }
    render(left, right, outLeft, outRight) {
        this.live();
        if (
            !(outLeft instanceof Float32Array) ||
            !(outRight instanceof Float32Array) ||
            outLeft.length !== outRight.length ||
            !outLeft.length ||
            outLeft.length > 8192
        )
            throw new RangeError('invalid-output-shape');
        const frames = outLeft.length;
        outLeft.fill(0);
        outRight.fill(0);
        if (this.phase === 'draining') {
            let frame = 0;
            while (frame < frames && this.tailOffset < this.tailFrames) {
                outLeft[frame] = this.tail[this.tailOffset * 2];
                outRight[frame] = this.tail[this.tailOffset * 2 + 1];
                this.tailOffset++;
                frame++;
            }
            if (this.tailOffset === this.tailFrames) this.phase = 'drained';
            return;
        }
        if (this.phase === 'drained') return;
        // A missing input is silence, not an end-of-stream signal.
        if (!left && !right) return;
        if (
            !(left instanceof Float32Array) ||
            !(right instanceof Float32Array) ||
            left.length !== frames ||
            right.length !== frames
        )
            throw new RangeError('unsupported-input-layout');
        // Validate the entire quantum before mutating the engine.
        for (let i = 0; i < frames; i++) {
            if (!Number.isFinite(left[i]) || !Number.isFinite(right[i]))
                throw new RangeError('invalid-input');
        }
        for (let offset = 0; offset < frames; offset += this.capacity) {
            const n = Math.min(this.capacity, frames - offset);
            for (let i = 0; i < n; i++) {
                this.samples[2 * i] = left[offset + i];
                this.samples[2 * i + 1] = right[offset + i];
            }
            const count = this.api.oneamp_process(this.handle, n);
            if (count !== n * 2) throw new Error('invalid-process-count');
            for (let i = 0; i < n; i++) {
                const l = this.samples[2 * i];
                const r = this.samples[2 * i + 1];
                if (!Number.isFinite(l) || !Number.isFinite(r))
                    throw new Error('invalid-output');
                outLeft[offset + i] = l;
                outRight[offset + i] = r;
            }
        }
    }
    dispose() {
        if (this.handle) this.api.oneamp_free(this.handle);
        this.handle = 0;
        this.phase = 'disposed';
    }
}

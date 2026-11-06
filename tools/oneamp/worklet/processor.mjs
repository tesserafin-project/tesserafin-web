import { ProcessorCore } from './processor-core.mjs';

class OneAmpProcessor extends globalThis.AudioWorkletProcessor {
    constructor(options) {
        super();
        this.core = new ProcessorCore(
            options.processorOptions.module,
            globalThis.sampleRate
        );
        this.pending = null;
        this.disposed = false;
        this.drainedSent = false;
        this.port.onmessage = ({ data }) => {
            if (this.disposed || !data || typeof data !== 'object') return;
            if (data.type === 'configure') {
                // Coalesce UI bursts to one bounded transaction; validate before queueing.
                if (
                    data.epoch !== this.core.epoch ||
                    !Number.isSafeInteger(data.sequence) ||
                    data.sequence <=
                        Math.max(
                            this.core.sequence,
                            this.pending?.sequence || 0
                        )
                )
                    return;
                if (
                    !Number.isFinite(data.preamp) ||
                    Math.abs(data.preamp) > 12 ||
                    !(data.gains instanceof Float32Array) ||
                    data.gains.length !== 10 ||
                    !data.gains.every(
                        (gain) => Number.isFinite(gain) && Math.abs(gain) <= 12
                    )
                ) {
                    this.port.postMessage({
                        type: 'rejected',
                        reason: 'invalid-controls'
                    });
                    return;
                }
                this.pending = data;
            } else if (data.type === 'reset') {
                if (this.core.reset(data.epoch)) {
                    this.pending = null;
                    this.drainedSent = false;
                    this.port.postMessage({
                        type: 'reset',
                        epoch: this.core.epoch
                    });
                }
            } else if (data.type === 'drain') {
                this.core.drain(data.epoch);
            } else if (data.type === 'dispose') {
                this.core.dispose();
                this.pending = null;
                this.disposed = true;
                this.port.postMessage({ type: 'disposed' });
            }
        };
        this.port.postMessage({
            type: 'ready',
            epoch: 0,
            latencyFrames: this.core.latency,
            rate: globalThis.sampleRate
        });
    }
    process(inputs, outputs) {
        if (this.disposed) return false;
        try {
            if (this.pending) {
                const controls = this.pending;
                this.pending = null;
                if (
                    this.core.configure(
                        controls.epoch,
                        controls.sequence,
                        controls.preamp,
                        controls.gains
                    )
                )
                    this.port.postMessage({
                        type: 'applied',
                        epoch: this.core.epoch,
                        sequence: this.core.sequence
                    });
            }
            const input = inputs[0];
            const output = outputs[0];
            if (!output || output.length !== 2)
                throw new Error('unsupported-output-layout');
            this.core.render(input?.[0], input?.[1], output[0], output[1]);
            if (this.core.phase === 'drained' && !this.drainedSent) {
                this.drainedSent = true;
                // Render submission acknowledgement, not proof of audible sink completion.
                this.port.postMessage({
                    type: 'drained',
                    epoch: this.core.epoch
                });
            }
            return true;
        } catch {
            // Throwing triggers processorerror. The owner must reconnect its retained bypass.
            this.core.dispose();
            this.disposed = true;
            throw new Error('oneamp-render-failed');
        }
    }
}
globalThis.registerProcessor('tesserafin-oneamp-experimental', OneAmpProcessor);

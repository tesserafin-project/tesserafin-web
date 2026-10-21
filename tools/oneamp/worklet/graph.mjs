// Experimental adapter for an EXISTING context/source/normalization graph.
// It never creates a media element source, normalization gain, or shared context.
export class OneAmpGraph {
    constructor(context, normalizationGain, node) {
        this.context = context;
        this.gain = normalizationGain;
        this.node = node;
        this.epoch = 0;
        this.sequence = 0;
        this.state = 'bypassed';
        this.pending = new Map();
        node.onprocessorerror = () => this.fail('processor-failed');
        node.port.onmessage = ({ data }) => {
            // Coalescing applies the latest controls. Resolve older requests as superseded,
            // rather than treating an expected supersession as an engine timeout/failure.
            if (data.type === 'applied') {
                for (const [pendingKey, pendingEntry] of this.pending) {
                    const match = /^applied:(\d+):(\d+)$/.exec(pendingKey);
                    if (
                        match &&
                        Number(match[1]) === data.epoch &&
                        Number(match[2]) < data.sequence
                    ) {
                        clearTimeout(pendingEntry.timer);
                        this.pending.delete(pendingKey);
                        pendingEntry.resolve({
                            type: 'superseded',
                            epoch: data.epoch,
                            sequence: Number(match[2]),
                            appliedSequence: data.sequence
                        });
                    }
                }
            }
            const key =
                data.type === 'applied'
                    ? `applied:${data.epoch}:${data.sequence}`
                    : `${data.type}:${data.epoch ?? ''}`;
            const entry = this.pending.get(key);
            if (entry) {
                clearTimeout(entry.timer);
                this.pending.delete(key);
                entry.resolve(data);
            }
        };
    }
    static async prepare(context, normalizationGain, module, processorUrl) {
        if (
            !isSecureContext ||
            !context.audioWorklet ||
            ![44100, 48000].includes(context.sampleRate)
        )
            throw new Error('unsupported-context');
        await context.audioWorklet.addModule(processorUrl);
        const node = new AudioWorkletNode(
            context,
            'tesserafin-oneamp-experimental',
            {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                channelCount: 2,
                channelCountMode: 'explicit',
                channelInterpretation: 'discrete',
                processorOptions: { module }
            }
        );
        const graph = new OneAmpGraph(context, normalizationGain, node);
        try {
            const ready = await graph.wait('ready:0');
            graph.latencyFrames = ready.latencyFrames;
            return graph;
        } catch (error) {
            graph.fail('prepare-failed');
            throw error;
        }
    }
    wait(key) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(key);
                this.fail('ack-timeout');
                reject(new Error('ack-timeout'));
            }, 2000);
            this.pending.set(key, { resolve, reject, timer });
        });
    }
    enable() {
        if (this.state === 'error' || this.state === 'disposed')
            throw new Error('graph-unavailable');
        if (this.state === 'active') return;
        // The caller supplies one gain connected only to destination at preparation.
        this.gain.disconnect();
        this.node.disconnect();
        this.gain.connect(this.node);
        this.node.connect(this.context.destination);
        this.state = 'active';
    }
    bypass() {
        this.gain.disconnect();
        this.node.disconnect();
        this.gain.connect(this.context.destination);
        if (this.state !== 'error' && this.state !== 'disposed')
            this.state = 'bypassed';
    }
    async configure(preamp, gains) {
        if (
            !Number.isFinite(preamp) ||
            Math.abs(preamp) > 12 ||
            !(gains instanceof Float32Array) ||
            gains.length !== 10 ||
            !gains.every((g) => Number.isFinite(g) && Math.abs(g) <= 12)
        )
            throw new RangeError('invalid-controls');
        const sequence = ++this.sequence;
        const ack = this.wait(`applied:${this.epoch}:${sequence}`);
        this.node.port.postMessage({
            type: 'configure',
            epoch: this.epoch,
            sequence,
            preamp,
            gains
        });
        return ack;
    }
    async reset() {
        // Caller must pause/gate media before this operation and resume only after ACK.
        for (const [key, entry] of this.pending) {
            clearTimeout(entry.timer);
            entry.resolve({ type: 'superseded', epoch: this.epoch });
            this.pending.delete(key);
        }
        this.epoch++;
        this.sequence = 0;
        const ack = this.wait(`reset:${this.epoch}`);
        this.node.port.postMessage({ type: 'reset', epoch: this.epoch });
        return ack;
    }
    async drain() {
        const ack = this.wait(`drained:${this.epoch}`);
        this.node.port.postMessage({ type: 'drain', epoch: this.epoch });
        return ack;
    }
    fail(reason) {
        this.bypass();
        this.state = 'error';
        this.reason = reason;
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(new Error(reason));
        }
        this.pending.clear();
    }
    async dispose() {
        if (this.state === 'disposed') return;
        this.bypass();
        if (this.state !== 'error') {
            const ack = this.wait('disposed:');
            this.node.port.postMessage({ type: 'dispose' });
            await ack;
        }
        this.node.port.close();
        this.state = 'disposed';
    }
}

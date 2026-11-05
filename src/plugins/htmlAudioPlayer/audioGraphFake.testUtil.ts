/**
 * Minimal Web Audio stand-in for graph tests: records which node feeds which,
 * and every element captured by `createMediaElementSource`.
 */

export class FakeNode {
    readonly kind: string;
    readonly outputs = new Set<FakeNode>();
    constructor(kind: string) {
        this.kind = kind;
    }
    connect(target: FakeNode): FakeNode {
        this.outputs.add(target);
        return target;
    }
    disconnect(): void {
        this.outputs.clear();
    }
}

export class FakeGain extends FakeNode {
    readonly gain = { value: 1 };
    constructor() {
        super('gain');
    }
}

export class FakeAudioContext {
    static instances: FakeAudioContext[] = [];
    static captured: unknown[] = [];
    static failCapture = false;
    readonly destination = new FakeNode('destination');
    state: 'running' | 'suspended' | 'closed' = 'running';
    resumed = 0;
    readonly sources: FakeNode[] = [];
    constructor() {
        FakeAudioContext.instances.push(this);
    }
    static reset(): void {
        FakeAudioContext.instances = [];
        FakeAudioContext.captured = [];
        FakeAudioContext.failCapture = false;
    }
    createMediaElementSource(elem: unknown): FakeNode {
        if (FakeAudioContext.failCapture)
            throw new DOMException('nope', 'InvalidStateError');
        FakeAudioContext.captured.push(elem);
        const node = new FakeNode('source');
        this.sources.push(node);
        return node;
    }
    createGain(): FakeGain {
        return new FakeGain();
    }
    resume(): Promise<void> {
        this.resumed++;
        this.state = 'running';
        return Promise.resolve();
    }
    close(): Promise<void> {
        this.state = 'closed';
        return Promise.resolve();
    }
}

/** Node kinds along the single path from `from`, e.g. ['source', 'gain', 'destination']. */
export function path(from: FakeNode): string[] {
    const out = [from.kind];
    let node = from;
    while (node.outputs.size === 1) {
        node = [...node.outputs][0];
        out.push(node.kind);
    }
    if (node.outputs.size > 1) out.push('<fan-out>');
    return out;
}

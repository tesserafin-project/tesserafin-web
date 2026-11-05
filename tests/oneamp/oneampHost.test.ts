import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type HostDeps,
    type HostGraph,
    type HostNode,
    type MediaFacts,
    OneAmpHost
} from '../../src/lib/oneamp/oneampHost';
import {
    decideRoute,
    readOneAmpFlag
} from '../../src/lib/oneamp/routeDecision';

/**
 * OneAmp host adapter against a fake graph and a fake worklet node (contract §9.3 step 2):
 * the route table of §6, every §4.7.3 fallback trigger with the expected gain restored (never
 * forced to 1), the §4.3.1 generation sequences, and the §5 invariant after every transition.
 */

const GAIN = 0.5; // an expected gain that is not unity, so a forced 1 is visible

class FakeGraph implements HostGraph {
    captured = true;
    context = {} as BaseAudioContext;
    route: 'oneamp' | 'bypass' = 'bypass';
    gainValue: number | null = null;
    readonly routes: { route: string; gain: number }[] = [];
    setRoute(
        route: 'oneamp' | 'bypass',
        o: { gain: number; processor?: AudioNode }
    ) {
        if (route === 'oneamp' && !o.processor) throw new Error('no processor');
        this.route = route;
        this.gainValue = o.gain;
        this.routes.push({ route, gain: o.gain });
    }
    setGain(value: number) {
        this.gainValue = value;
    }
}

class FakeNode implements HostNode {
    readonly posted: Record<string, unknown>[] = [];
    readonly options: AudioWorkletNodeOptions;
    disconnected = false;
    port = {
        onmessage: null as ((e: MessageEvent) => void) | null,
        postMessage: (m: Record<string, unknown>) => {
            this.posted.push(m);
        }
    };
    onprocessorerror: ((e: Event) => void) | null = null;
    constructor(options: AudioWorkletNodeOptions) {
        this.options = options;
    }
    disconnect() {
        this.disconnected = true;
    }
    reply(m: Record<string, unknown>) {
        this.port.onmessage?.({ data: { v: 1, ...m } } as MessageEvent);
    }
    ready() {
        this.reply({
            type: 'ready',
            protocol: 1,
            sampleRate: 48000,
            latencyFrames: 95,
            outputChannels: 2
        });
    }
    /** The seq of the last `apply` posted. */
    lastApplySeq(): number | undefined {
        return [...this.posted].reverse().find((m) => m.type === 'apply')
            ?.seq as number | undefined;
    }
    ack(seq = this.lastApplySeq()) {
        this.reply({ type: 'ack', seq });
    }
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(overrides: Partial<HostDeps> = {}) {
    const graph = new FakeGraph();
    const nodes: FakeNode[] = [];
    const module = deferred<WebAssembly.Module>();
    const logs: string[] = [];
    const deps: HostDeps = {
        loadModule: () => module.promise,
        addWorklet: () => Promise.resolve(),
        createNode: (_ctx, options) => {
            const n = new FakeNode(options);
            nodes.push(n);
            return n;
        },
        available: () => true,
        log: (m) => logs.push(m),
        ...overrides
    };
    const host = new OneAmpHost(graph, deps);
    const node = () => nodes[nodes.length - 1];
    return { graph, nodes, node, module, logs, host };
}

const directPlay: MediaFacts = {
    desired: 'oneamp',
    playMethod: 'DirectPlay',
    expectedGain: GAIN,
    normalisationOwner: 'legacy-gain'
};
const transcode: MediaFacts = {
    desired: 'bypass',
    reason: 'not-direct-play',
    playMethod: 'Transcode',
    expectedGain: GAIN,
    normalisationOwner: 'legacy-gain'
};

/** Brings a fresh host to `active` on a Direct Play item. */
async function activeHost() {
    const t = setup();
    t.host.onMedia(directPlay);
    t.module.resolve({} as WebAssembly.Module);
    await flush();
    t.node().ready();
    await flush();
    t.node().ack();
    await flush();
    expect(t.host.state.state).toBe('active');
    return t;
}

/** Every route ever applied carried the expected gain, and the invariant holds. */
function expectGainAlwaysExpected(t: { graph: FakeGraph; host: OneAmpHost }) {
    expect(t.graph.routes.length).toBeGreaterThan(0);
    for (const r of t.graph.routes) expect(r.gain).toBe(GAIN);
    expect(t.host.normalisationInvariantHolds()).toBe(true);
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('route decision (§6)', () => {
    const base = {
        flag: true,
        safari: false,
        mediaType: 'Audio',
        playMethod: 'DirectPlay',
        hls: false,
        capturable: true
    };
    it.each([
        [{}, 'oneamp', undefined],
        [{ flag: false }, 'bypass', 'flag-off'],
        [{ safari: true }, 'bypass', 'safari'],
        [{ mediaType: 'Video' }, 'bypass', 'not-audio'],
        [{ playMethod: 'DirectStream' }, 'bypass', 'not-direct-play'],
        [{ playMethod: 'Transcode' }, 'bypass', 'not-direct-play'],
        [{ hls: true }, 'bypass', 'hls'],
        [{ capturable: false }, 'bypass', 'not-capturable']
    ])('%j -> %s %s', (change, route, reason) => {
        const d = decideRoute({ ...base, ...change });
        expect(d.route).toBe(route);
        expect(d.route === 'bypass' ? d.reason : undefined).toBe(reason);
    });

    it('the flag is "1" in localStorage, off on anything else or an error', () => {
        expect(readOneAmpFlag({ getItem: () => '1' })).toBe(true);
        expect(readOneAmpFlag({ getItem: () => 'true' })).toBe(false);
        expect(readOneAmpFlag({ getItem: () => null })).toBe(false);
        expect(
            readOneAmpFlag({
                getItem: () => {
                    throw new Error('denied');
                }
            })
        ).toBe(false);
        expect(readOneAmpFlag(undefined)).toBe(false);
    });
});

describe('activation (§4.3.1)', () => {
    it('stays on bypass until the matching ack, then routes through OneAmp', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        expect(t.graph.route).toBe('bypass');
        expect(t.host.state.state).toBe('loading');

        t.module.resolve({} as WebAssembly.Module);
        await flush();
        const n = t.node();
        expect(n.options).toMatchObject({
            channelCount: 2,
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
            outputChannelCount: [2]
        });
        expect(n.posted).toEqual([]);

        n.ready();
        await flush();
        expect(n.posted.map((m) => m.type)).toEqual(['reset', 'apply']);
        const [reset, apply] = n.posted;
        expect(reset.seq).toBe(apply.seq);
        expect(apply.v).toBe(1);
        expect(t.graph.route).toBe('bypass');

        n.ack();
        await flush();
        expect(t.graph.route).toBe('oneamp');
        expect(t.host.state).toMatchObject({
            state: 'active',
            route: 'oneamp',
            sampleRate: 48000,
            latencyFrames: 95,
            normalisationOwner: 'legacy-gain'
        });
        expectGainAlwaysExpected(t);
    });

    it('a non-OneAmp item is bypassed at once with its expected gain, and nothing loads', () => {
        const load = vi.fn(
            () => new Promise<WebAssembly.Module>(() => undefined)
        );
        const t = setup({ loadModule: load });
        t.host.onMedia(transcode);
        expect(t.graph.routes).toEqual([{ route: 'bypass', gain: GAIN }]);
        expect(t.host.state).toMatchObject({
            state: 'absent',
            reason: 'not-direct-play'
        });
        expect(load).not.toHaveBeenCalled();
        expect(t.nodes).toHaveLength(0);
    });

    it('reuses the node for the next Direct Play item, with a fresh ack', async () => {
        const t = await activeHost();
        t.host.onMedia(transcode);
        expect(t.graph.route).toBe('bypass');
        expect(t.host.state).toMatchObject({
            state: 'bypassed',
            reason: 'not-direct-play'
        });
        t.host.onMedia(directPlay);
        await flush();
        expect(t.graph.route).toBe('bypass');
        const seq = t.node().lastApplySeq();
        t.node().ack(seq);
        await flush();
        expect(t.graph.route).toBe('oneamp');
        expect(t.nodes).toHaveLength(1);
        expectGainAlwaysExpected(t);
    });
});

describe('generation sequences (§4.3.1, §9.3)', () => {
    it('Direct Play -> transcode while loading, then back: the transcode never routes through OneAmp', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.host.onMedia(transcode);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.node().ready();
        await flush();
        // The stale generation posted nothing and routed nothing.
        expect(t.node().posted).toEqual([]);
        expect(t.graph.routes.every((r) => r.route === 'bypass')).toBe(true);
        expect(t.host.state).toMatchObject({
            state: 'bypassed',
            reason: 'not-direct-play'
        });

        t.host.onMedia(directPlay);
        await flush();
        t.node().ack();
        await flush();
        expect(t.graph.route).toBe('oneamp');
        expectGainAlwaysExpected(t);
    });

    it('stop during loading cancels the activation', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.host.onStop();
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.node().ready();
        await flush();
        expect(t.node().posted).toEqual([]);
        expect(t.graph.route).toBe('bypass');
        expectGainAlwaysExpected(t);
    });

    it('flag off during loading: bypass, node disposed, and no late failure', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        const n = t.node();
        t.host.teardown();
        expect(n.disconnected).toBe(true);
        expect(n.posted.at(-1)).toMatchObject({ type: 'dispose' });
        n.ready(); // too late: handler detached
        await vi.advanceTimersByTimeAsync(5000);
        expect(t.host.state).toMatchObject({
            state: 'absent',
            reason: 'flag-off'
        });
        expect(t.graph.route).toBe('bypass');
        expect(t.logs).toEqual([]);
        expectGainAlwaysExpected(t);
    });

    it('an ack arriving after a switch to transcode does not route the transcode through OneAmp', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.node().ready();
        await flush();
        const seq = t.node().lastApplySeq();
        t.host.onMedia(transcode);
        t.node().ack(seq);
        await flush();
        expect(t.graph.route).toBe('bypass');
        expect(t.host.state).toMatchObject({
            state: 'bypassed',
            reason: 'not-direct-play'
        });
        // Nor does its absence fail the module later.
        await vi.advanceTimersByTimeAsync(5000);
        expect(t.host.state.state).toBe('bypassed');
        expect(t.logs).toEqual([]);
        expectGainAlwaysExpected(t);
    });

    it('stop while waiting for the ack: no activation, no late failure', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.node().ready();
        await flush();
        t.host.onStop();
        await vi.advanceTimersByTimeAsync(5000);
        t.node().ack();
        await flush();
        expect(t.graph.route).toBe('bypass');
        expect(t.host.state.state).not.toBe('failed');
        expect(t.logs).toEqual([]);
    });

    it('a ready arriving after a newer bypass generation changes nothing', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.host.onMedia(transcode);
        t.node().ready();
        await flush();
        expect(t.node().posted).toEqual([]);
        expect(t.graph.route).toBe('bypass');
    });

    it('an ack with a stale seq does not activate; the matching one does', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.node().ready();
        await flush();
        const seq = t.node().lastApplySeq() as number;
        t.node().ack(seq - 1);
        await flush();
        expect(t.graph.route).toBe('bypass');
        t.node().ack(seq);
        await flush();
        expect(t.graph.route).toBe('oneamp');
    });

    it('two media changes inside one ack round trip: only the last activates, the first ack is stale', async () => {
        const t = await activeHost();
        t.host.onMedia(directPlay);
        await flush();
        const first = t.node().lastApplySeq() as number;
        t.host.onMedia(directPlay);
        await flush();
        const second = t.node().lastApplySeq() as number;
        expect(second).toBeGreaterThan(first);
        const routesBefore = t.graph.routes.length;

        t.node().ack(first);
        await flush();
        expect(t.graph.route).toBe('bypass');
        expect(t.graph.routes.length).toBe(routesBefore);

        t.node().ack(second);
        await flush();
        expect(t.graph.route).toBe('oneamp');
        // The superseded wait was cancelled, not left to time out into `failed`.
        await vi.advanceTimersByTimeAsync(5000);
        expect(t.host.state.state).toBe('active');
        expectGainAlwaysExpected(t);
    });
});

describe('fallback triggers (§4.7.3): audible at the expected gain, sticky', () => {
    async function expectFailed(t: ReturnType<typeof setup>, reason: string) {
        expect(t.host.state).toMatchObject({
            state: 'failed',
            reason,
            route: 'bypass'
        });
        expect(t.graph.route).toBe('bypass');
        expect(t.graph.gainValue).toBe(GAIN);
        expectGainAlwaysExpected(t);
        expect(t.logs).toHaveLength(1);
        expect(t.logs[0]).not.toMatch(/https?:|ApiKey|api_key/i);
        // Sticky: the next eligible item stays bypassed, nothing is retried.
        const created = t.nodes.length;
        t.host.onMedia(directPlay);
        await flush();
        expect(t.host.state).toMatchObject({ state: 'failed', reason });
        expect(t.graph.route).toBe('bypass');
        expect(t.nodes.length).toBe(created);
        expect(t.logs).toHaveLength(1);
    }

    it('no AudioWorklet / WebAssembly', async () => {
        const t = setup({ available: () => false });
        t.host.onMedia(directPlay);
        await flush();
        await expectFailed(t, 'unavailable');
        expect(t.nodes).toHaveLength(0);
    });

    it('module fetch/compile fails', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.reject(new Error('404'));
        await flush();
        await expectFailed(t, 'compile');
    });

    it('addModule fails', async () => {
        const t = setup({ addWorklet: () => Promise.reject(new Error('csp')) });
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        await expectFailed(t, 'add-module');
    });

    it('the node constructor throws', async () => {
        const t = setup({
            createNode: () => {
                throw new Error('nope');
            }
        });
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        await expectFailed(t, 'create-node');
    });

    it('processorerror during construction (oneamp_new returned 0, bad layout)', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.node().onprocessorerror?.(new Event('processorerror'));
        await flush();
        await expectFailed(t, 'processor-error');
    });

    it('a ready with the wrong protocol or layout', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.node().reply({ type: 'ready', protocol: 2, outputChannels: 2 });
        await flush();
        await expectFailed(t, 'protocol');
    });

    it('no ready within 2 s', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        await vi.advanceTimersByTimeAsync(1999);
        expect(t.host.state.state).toBe('loading');
        await vi.advanceTimersByTimeAsync(1);
        await expectFailed(t, 'ready-timeout');
    });

    it('no matching ack within 2 s', async () => {
        const t = setup();
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.node().ready();
        await flush();
        await vi.advanceTimersByTimeAsync(2000);
        await expectFailed(t, 'ack-timeout');
    });

    it('a worklet error at runtime, while active', async () => {
        const t = await activeHost();
        const n = t.node();
        n.onprocessorerror?.(new Event('processorerror'));
        await flush();
        expect(n.disconnected).toBe(true);
        await expectFailed(t, 'processor-error');
    });

    it('the graph is not captured (the player never captured a non-capturable item)', async () => {
        const t = setup();
        t.graph.captured = false;
        t.host.onMedia(directPlay);
        await flush();
        expect(t.host.state).toMatchObject({
            state: 'failed',
            reason: 'no-graph'
        });
        expect(t.graph.routes).toEqual([]);
    });
});

describe('controls', () => {
    it('user bypass is a hard bypass with the expected gain; re-enabling needs a fresh ack', async () => {
        const t = await activeHost();
        t.host.setBypass(true);
        expect(t.graph.route).toBe('bypass');
        expect(t.host.state).toMatchObject({
            state: 'bypassed',
            reason: 'user'
        });
        t.host.onMedia(directPlay); // still bypassed by the user
        await flush();
        expect(t.graph.route).toBe('bypass');
        t.host.setBypass(false);
        await flush();
        expect(t.graph.route).toBe('bypass');
        t.node().ack();
        await flush();
        expect(t.graph.route).toBe('oneamp');
        expectGainAlwaysExpected(t);
    });

    it('parameter changes go out as typed setters and land in the next apply', async () => {
        const t = await activeHost();
        const n = t.node();
        n.posted.length = 0;
        t.host.setParams({ preamp: -6, eqEnabled: true, volume: 1.2 });
        expect(n.posted).toEqual([
            { v: 1, type: 'eqEnabled', on: true },
            { v: 1, type: 'preamp', db: -6 },
            { v: 1, type: 'volume', value: 1.2 }
        ]);
        t.host.setParams({ eqBands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
        expect(n.posted.filter((m) => m.type === 'eqBand')).toHaveLength(10);
        expect(n.posted.some((m) => m.type === 'params')).toBe(false);

        t.host.onMedia(directPlay);
        await flush();
        const apply = n.posted.at(-1) as {
            type: string;
            params: Record<string, unknown>;
        };
        expect(apply.type).toBe('apply');
        expect(apply.params).toMatchObject({
            preamp: -6,
            eqEnabled: true,
            volume: 1.2,
            replayGain: 0,
            eqBands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        });
    });

    it('seeking posts reset only while active', async () => {
        const t = setup();
        t.host.onSeeking();
        const a = await activeHost();
        a.node().posted.length = 0;
        a.host.onSeeking();
        expect(a.node().posted).toEqual([{ v: 1, type: 'reset' }]);
        a.host.onMedia(transcode);
        a.node().posted.length = 0;
        a.host.onSeeking();
        expect(a.node().posted).toEqual([]);
        expect(t.nodes).toHaveLength(0);
    });

    it('query updates processorBypassed', async () => {
        const t = await activeHost();
        t.host.query();
        expect(t.node().posted.at(-1)).toMatchObject({ type: 'query' });
        t.node().reply({ type: 'state', bypassed: false, latencyFrames: 95 });
        expect(t.host.state.processorBypassed).toBe(false);
    });

    it('a slider change updates the gain on whichever route is live', async () => {
        const t = await activeHost();
        t.host.setExpectedGain(0.25);
        expect(t.graph.gainValue).toBe(0.25);
        t.host.setBypass(true);
        expect(t.graph.routes.at(-1)).toEqual({ route: 'bypass', gain: 0.25 });
    });

    it('subscribers get every state change; the state is a copy', async () => {
        const t = setup();
        const seen: string[] = [];
        t.host.subscribe((snapshot) => seen.push(snapshot.state));
        t.host.onMedia(directPlay);
        t.module.resolve({} as WebAssembly.Module);
        await flush();
        t.node().ready();
        await flush();
        t.node().ack();
        await flush();
        expect(seen.at(-1)).toBe('active');
        expect(seen).toContain('loading');
        const s = t.host.state;
        s.params.eqBands[0] = 99;
        expect(t.host.state.params.eqBands[0]).toBe(0);
    });
});

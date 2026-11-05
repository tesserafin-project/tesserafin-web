/**
 * OneAmp host adapter (OneAmp web host contract §4.3-§4.8): loading, node
 * lifecycle, the versioned port protocol, playback generations with
 * ack-gated activation, fallback with the expected gain, observable state.
 *
 * The adapter never captures an element: the player decides the route
 * (`routeDecision.ts`), owns the graph (`audioGraph.ts`) and calls
 * `ensureGraph()` only for a capturable item. Every failure routes
 * `source -> gain -> destination` with the item's expected gain (§4.7.2).
 */

export const PROTOCOL = 1;
export const EQ_BANDS = 10;
export const HANDSHAKE_TIMEOUT_MS = 2000;

/** Typed parameter snapshot (§4.4 `apply`). OneAmp ReplayGain stays off (§5). */
export interface OneAmpParams {
    eqEnabled: boolean;
    eqBands: number[];
    preamp: number;
    volume: number;
    balance: number;
    mono: boolean;
    loudness: boolean;
    listeningVolume: number;
    replayGain: number;
    preventClipping: boolean;
}

export function defaultParams(): OneAmpParams {
    return {
        eqEnabled: false,
        eqBands: new Array(EQ_BANDS).fill(0),
        preamp: 0,
        volume: 1,
        balance: 0,
        mono: false,
        loudness: false,
        listeningVolume: 1,
        replayGain: 0,
        preventClipping: false
    };
}

export type HostState = 'absent' | 'loading' | 'active' | 'bypassed' | 'failed';

export interface ObservableState {
    state: HostState;
    reason: string | null;
    route: 'oneamp' | 'bypass';
    playMethod: string | null;
    sampleRate: number | null;
    latencyFrames: number | null;
    processorBypassed: boolean | null;
    normalisationOwner: 'none' | 'legacy-gain' | 'oneamp';
    params: OneAmpParams;
}

/** What the adapter needs from the player's graph (`AudioGraph`). */
export interface HostGraph {
    readonly captured: boolean;
    readonly context: BaseAudioContext | null;
    readonly route: 'oneamp' | 'bypass';
    setRoute(
        route: 'oneamp' | 'bypass',
        o: { gain: number; processor?: AudioNode }
    ): void;
    setGain(value: number): void;
}

export interface HostNode {
    readonly port: Pick<MessagePort, 'postMessage'> & {
        onmessage: ((e: MessageEvent) => void) | null;
    };
    onprocessorerror: ((e: Event) => void) | null;
    disconnect(): void;
}

export interface HostDeps {
    /** Compiled module, cached for the page by the caller. */
    loadModule(): Promise<WebAssembly.Module>;
    /** `audioWorklet.addModule`, cached per context by the caller. */
    addWorklet(context: BaseAudioContext): Promise<void>;
    createNode(
        context: BaseAudioContext,
        options: AudioWorkletNodeOptions
    ): HostNode;
    /** Feature test for AudioWorklet + WebAssembly (§4.7.3). */
    available(): boolean;
    timeoutMs?: number;
    /** Failures are logged once, without URLs. */
    log?(message: string): void;
}

/** What the player knows about the new media (§4.6). */
export interface MediaFacts {
    desired: 'oneamp' | 'bypass';
    reason?: string;
    playMethod: string | null;
    expectedGain: number;
    /** `legacy-gain` when the user normalisation setting is on (§5). */
    normalisationOwner: 'none' | 'legacy-gain';
}

class Failure extends Error {
    readonly reason: string;
    constructor(reason: string) {
        super(reason);
        this.reason = reason;
    }
}

/** A wait made pointless by a newer activation or a teardown: not a failure. */
class Stale extends Error {}

export class OneAmpHost {
    private readonly deps: HostDeps;
    private readonly graph: HostGraph;
    private generation = 0;
    private seq = 0;
    private desired: 'oneamp' | 'bypass' = 'bypass';
    private userBypass = false;
    private node: HostNode | null = null;
    private ready: Promise<void> | null = null;
    private pendingAck: { seq: number; resolve: () => void } | null = null;
    /** Cancels the pending ack wait, if any, with `Stale`. */
    private cancelAck: (() => void) | null = null;
    /** Cancels every in-flight wait (handshake, ack) with `Stale`. */
    private readonly cancels = new Set<() => void>();
    private expected = 1;
    private failedReason: string | null = null;
    private logged = false;
    private readonly listeners = new Set<(s: ObservableState) => void>();
    private s: ObservableState;

    constructor(graph: HostGraph, deps: HostDeps) {
        this.graph = graph;
        this.deps = deps;
        this.s = {
            state: 'absent',
            reason: null,
            route: 'bypass',
            playMethod: null,
            sampleRate: null,
            latencyFrames: null,
            processorBypassed: null,
            normalisationOwner: 'none',
            params: defaultParams()
        };
    }

    get state(): ObservableState {
        return { ...this.s, params: cloneParams(this.s.params) };
    }

    subscribe(listener: (s: ObservableState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * New media, called synchronously before `src`/hls.js is assigned. A
     * non-OneAmp route is applied immediately; a OneAmp route starts from
     * bypass and activates only after a matching `ack`.
     */
    onMedia(m: MediaFacts): void {
        const gen = ++this.generation;
        this.dropAck();
        this.desired = m.desired;
        this.expected = m.expectedGain;
        this.update({
            playMethod: m.playMethod,
            normalisationOwner: m.normalisationOwner
        });
        this.bypass(
            m.desired === 'oneamp' ? 'activating' : (m.reason ?? 'policy')
        );
        if (m.desired === 'oneamp') void this.activate(gen);
    }

    /** `stop` / `destroy`: cancels any pending activation. */
    onStop(): void {
        this.generation++;
        this.dropAck();
        this.desired = 'bypass';
    }

    /** Seek inside the current item: clear filter history (best effort, L3). */
    onSeeking(): void {
        if (this.s.state === 'active') this.post({ type: 'reset' });
    }

    /** Slider or normalisation change for the current item. */
    setExpectedGain(gain: number): void {
        this.expected = gain;
        this.graph.setGain(gain);
    }

    /** User hard bypass (§4.3): OneAmp out of the signal path. */
    setBypass(on: boolean): void {
        this.userBypass = on;
        const gen = ++this.generation;
        this.dropAck();
        if (on) {
            this.bypass('user');
        } else if (this.desired === 'oneamp') {
            void this.activate(gen);
        }
    }

    /** Parameter changes: kept as the snapshot, sent with typed setters when a node exists. */
    setParams(
        change: Partial<Omit<OneAmpParams, 'replayGain' | 'preventClipping'>>
    ): void {
        const p = sanitiseParams(
            { ...this.s.params, ...change },
            this.s.params
        );
        this.update({ params: p });
        if (!this.node) return;
        if (change.eqEnabled !== undefined)
            this.post({ type: 'eqEnabled', on: p.eqEnabled });
        if (change.eqBands) {
            for (let band = 0; band < p.eqBands.length; band++) {
                this.post({ type: 'eqBand', band, db: p.eqBands[band] });
            }
        }
        if (change.preamp !== undefined)
            this.post({ type: 'preamp', db: p.preamp });
        if (change.volume !== undefined)
            this.post({ type: 'volume', value: p.volume });
        if (change.balance !== undefined)
            this.post({ type: 'balance', value: p.balance });
        if (change.mono !== undefined) this.post({ type: 'mono', on: p.mono });
        if (
            change.loudness !== undefined ||
            change.listeningVolume !== undefined
        ) {
            this.post({
                type: 'loudness',
                on: p.loudness,
                listeningVolume: p.listeningVolume
            });
        }
    }

    /** Ask the worklet for `oneamp_is_bypassed`; the reply updates the state. */
    query(): void {
        if (this.node) this.post({ type: 'query' });
    }

    /** Flag off or player destroy: bypass with the expected gain, then teardown (§4.6). */
    teardown(): void {
        this.generation++;
        this.desired = 'bypass';
        this.bypass('flag-off');
        this.disposeNode();
        if (this.s.state !== 'failed')
            this.update({ state: 'absent', reason: 'flag-off' });
    }

    /** §5 invariant: at most one normalisation stage. OneAmp ReplayGain is never on here. */
    normalisationInvariantHolds(): boolean {
        return (
            this.s.params.replayGain === 0 &&
            this.s.normalisationOwner !== 'oneamp'
        );
    }

    // ------------------------------------------------------------------

    private async activate(gen: number): Promise<void> {
        if (this.failedReason) {
            this.update({ state: 'failed', reason: this.failedReason });
            return;
        }
        if (this.userBypass) {
            this.update({ state: 'bypassed', reason: 'user' });
            return;
        }
        if (!this.graph.captured || !this.graph.context) {
            this.fail('no-graph');
            return;
        }
        try {
            if (!this.node) {
                this.update({ state: 'loading', reason: null });
                await this.prepare(this.graph.context);
            } else {
                await this.ready;
            }
            if (!this.current(gen)) return;

            const seq = ++this.seq;
            const acked = this.waitAck(seq);
            this.post({ type: 'reset', seq });
            this.post({
                type: 'apply',
                seq,
                params: cloneParams(this.s.params)
            });
            await acked;
            if (!this.current(gen)) return;

            this.graph.setRoute('oneamp', {
                gain: this.expected,
                processor: this.node as unknown as AudioNode
            });
            this.update({ state: 'active', reason: null, route: 'oneamp' });
        } catch (e) {
            if (e instanceof Stale) return;
            // A stale generation's failure is still a failure of the module:
            // `failed` is sticky for the page (§4.7.3).
            this.fail(e instanceof Failure ? e.reason : 'error');
        }
    }

    private current(gen: number): boolean {
        return (
            gen === this.generation &&
            this.desired === 'oneamp' &&
            !this.userBypass
        );
    }

    private prepare(context: BaseAudioContext): Promise<void> {
        const prepared = (async () => {
            if (!this.deps.available()) throw new Failure('unavailable');
            let module: WebAssembly.Module;
            try {
                module = await this.deps.loadModule();
            } catch {
                throw new Failure('compile');
            }
            try {
                await this.deps.addWorklet(context);
            } catch {
                throw new Failure('add-module');
            }
            let node: HostNode;
            try {
                node = this.deps.createNode(context, {
                    numberOfInputs: 1,
                    numberOfOutputs: 1,
                    outputChannelCount: [2],
                    channelCount: 2,
                    channelCountMode: 'explicit',
                    channelInterpretation: 'speakers',
                    processorOptions: {
                        module,
                        params: cloneParams(this.s.params)
                    }
                });
            } catch {
                throw new Failure('create-node');
            }
            this.node = node;
            await this.handshake(node);
        })();
        this.ready = prepared;
        return prepared;
    }

    /** A wait that times out with `failure`, or is cancelled with `Stale`. */
    private wait(
        failure: string,
        start: (resolve: () => void, reject: (e: Error) => void) => void
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const done = () => {
                clearTimeout(timer);
                this.cancels.delete(cancel);
            };
            const cancel = () => {
                done();
                reject(new Stale());
            };
            const timer = setTimeout(() => {
                done();
                reject(new Failure(failure));
            }, this.timeout);
            this.cancels.add(cancel);
            start(
                () => {
                    done();
                    resolve();
                },
                (e) => {
                    done();
                    reject(e);
                }
            );
        });
    }

    private handshake(node: HostNode): Promise<void> {
        return this.wait('ready-timeout', (resolve, reject) => {
            node.onprocessorerror = () => {
                reject(new Failure('processor-error'));
                this.fail('processor-error');
            };
            node.port.onmessage = (e) =>
                this.onWorkletMessage(e.data, resolve, reject);
        });
    }

    private onWorkletMessage(
        data: unknown,
        ready: () => void,
        refuse: (e: Error) => void
    ): void {
        const m = data as Record<string, unknown> | null;
        if (!m || m.v !== PROTOCOL) return;
        switch (m.type) {
            case 'ready':
                if (m.protocol !== PROTOCOL || m.outputChannels !== 2) {
                    refuse(new Failure('protocol'));
                    return;
                }
                this.update({
                    sampleRate: m.sampleRate as number,
                    latencyFrames: m.latencyFrames as number
                });
                ready();
                break;
            case 'ack':
                this.onAck(m.seq);
                break;
            case 'state':
                this.update({ processorBypassed: m.bypassed === true });
                break;
            case 'error':
                this.logOnce(`OneAmp worklet error: ${String(m.code)}`);
                break;
        }
    }

    /** Only the ack of the pending activation counts; any other seq is stale. */
    private onAck(seq: unknown): void {
        const pending = this.pendingAck;
        if (!pending || seq !== pending.seq) return;
        this.pendingAck = null;
        this.cancelAck = null;
        pending.resolve();
    }

    private waitAck(seq: number): Promise<void> {
        // A newer activation supersedes the pending one: its ack is stale.
        this.dropAck();
        return this.wait('ack-timeout', (resolve, reject) => {
            this.pendingAck = { seq, resolve };
            this.cancelAck = () => reject(new Stale());
        });
    }

    /**
     * Any change of the desired route makes a pending ack pointless: its
     * late arrival must not activate, and its absence must not fail.
     */
    private dropAck(): void {
        const cancel = this.cancelAck;
        this.cancelAck = null;
        this.pendingAck = null;
        cancel?.();
    }

    private get timeout(): number {
        return this.deps.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    }

    private post(m: Record<string, unknown>): void {
        this.node?.port.postMessage({ v: PROTOCOL, ...m });
    }

    private bypass(reason: string): void {
        if (this.graph.captured) {
            this.graph.setRoute('bypass', { gain: this.expected });
        }
        // `absent` until OneAmp has been loaded on this page.
        let state: HostState = this.ready ? 'bypassed' : 'absent';
        if (this.failedReason) state = 'failed';
        this.update({
            state,
            reason: this.failedReason ?? reason,
            route: 'bypass'
        });
    }

    private fail(reason: string): void {
        if (!this.failedReason) {
            this.failedReason = reason;
            this.logOnce(`OneAmp unavailable (${reason}); playing without it`);
        }
        this.generation++;
        if (this.graph.captured) {
            this.graph.setRoute('bypass', { gain: this.expected });
        }
        this.disposeNode();
        this.update({
            state: 'failed',
            reason: this.failedReason,
            route: 'bypass'
        });
    }

    private cancelWaits(): void {
        for (const cancel of [...this.cancels]) cancel();
    }

    private disposeNode(): void {
        const node = this.node;
        this.cancelWaits();
        if (!node) return;
        this.node = null;
        this.ready = null;
        this.pendingAck = null;
        try {
            node.port.postMessage({ v: PROTOCOL, type: 'dispose' });
            node.port.onmessage = null;
            node.onprocessorerror = null;
            node.disconnect();
        } catch {
            // Already gone.
        }
    }

    private logOnce(message: string): void {
        if (this.logged) return;
        this.logged = true;
        (this.deps.log ?? console.warn)(message);
    }

    private update(change: Partial<ObservableState>): void {
        this.s = { ...this.s, ...change };
        const snapshot = this.state;
        for (const l of this.listeners) l(snapshot);
    }
}

function clamp(x: unknown, lo: number, hi: number, fallback: number): number {
    if (typeof x !== 'number' || !Number.isFinite(x)) return fallback;
    return Math.min(hi, Math.max(lo, x));
}

/**
 * Brings a snapshot into the contract §4.4 domains the worklet enforces: a
 * value it would reject would leave an `apply` without its `ack`, and the
 * activation would fail. Non-finite values keep the previous setting.
 */
export function sanitiseParams(
    p: OneAmpParams,
    previous: OneAmpParams = defaultParams()
): OneAmpParams {
    const bands = Array.isArray(p.eqBands) ? p.eqBands : previous.eqBands;
    return {
        eqEnabled: p.eqEnabled === true,
        eqBands: Array.from({ length: EQ_BANDS }, (_, i) =>
            clamp(bands[i], -Infinity, Infinity, previous.eqBands[i] ?? 0)
        ),
        preamp: clamp(p.preamp, -Infinity, Infinity, previous.preamp),
        volume: clamp(p.volume, 0, 1.5, previous.volume),
        balance: clamp(p.balance, -1, 1, previous.balance),
        mono: p.mono === true,
        loudness: p.loudness === true,
        listeningVolume: clamp(
            p.listeningVolume,
            0,
            1,
            previous.listeningVolume
        ),
        // OneAmp ReplayGain stays off in the demonstrator (§5).
        replayGain: 0,
        preventClipping: false
    };
}

function cloneParams(p: OneAmpParams): OneAmpParams {
    return { ...p, eqBands: p.eqBands.slice() };
}

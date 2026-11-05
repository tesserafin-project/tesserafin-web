/**
 * Glue between the HTML audio player and the OneAmp host (contract §4.6,
 * §6, §9.3 step 4). The player calls it synchronously on each new media,
 * before `src` or hls.js is assigned.
 *
 * This module only imports the route policy. The host, the worklet, the wasm
 * and the dev panel are behind dynamic imports reached only with the
 * experimental flag on and an eligible item. With the flag off, or in
 * Safari, nothing loads and no graph is created on OneAmp's behalf.
 */
import type { AudioGraph } from '../audio/audioGraph';
import type { MediaFacts, OneAmpHost } from './oneampHost';
import { decideRoute, readOneAmpFlag } from './routeDecision';

export interface BridgeEnv {
    safari: boolean;
    readFlag?: () => boolean;
    /** The player's graph for `elem`, created and captured on demand. */
    ensureGraph(elem: HTMLMediaElement): AudioGraph | null;
    loadHost?: () => Promise<{
        createOneAmpHost(
            graph: AudioGraph,
            initialFailure?: string | null
        ): OneAmpHost;
    }>;
    loadPanel?: () => Promise<{
        mountOneAmpDevPanel(host: OneAmpHost): () => void;
    }>;
}

export interface MediaInput {
    elem: HTMLMediaElement;
    url: string;
    playMethod: string | null | undefined;
    capturable: boolean;
    expectedGain: number;
    normalising: boolean;
}

export class OneAmpBridge {
    private readonly env: BridgeEnv;
    private host: OneAmpHost | null = null;
    private graph: AudioGraph | null = null;
    private hostLoad: ReturnType<NonNullable<BridgeEnv['loadHost']>> | null =
        null;
    private unmountPanel: (() => void) | null = null;
    private failure: string | null = null;
    private generation = 0;
    private lastFacts: MediaFacts | null = null;

    constructor(env: BridgeEnv) {
        this.env = env;
    }

    get currentHost(): OneAmpHost | null {
        return this.host;
    }

    onMedia(m: MediaInput): void {
        const gen = ++this.generation;
        const flag = (this.env.readFlag ?? readOneAmpFlag)();
        if (!flag) {
            this.teardown();
            return;
        }
        const decision = decideRoute({
            flag,
            safari: this.env.safari,
            mediaType: 'Audio',
            playMethod: m.playMethod,
            hls: m.url.includes('.m3u8'),
            capturable: m.capturable
        });
        const facts: MediaFacts = {
            desired: decision.route,
            reason: decision.route === 'bypass' ? decision.reason : undefined,
            playMethod: m.playMethod ?? null,
            expectedGain: m.expectedGain,
            normalisationOwner: m.normalising ? 'legacy-gain' : 'none'
        };
        this.lastFacts = facts;

        if (decision.route === 'bypass') {
            // Never load OneAmp or build a graph for a bypassed item.
            this.host?.onMedia(facts);
            return;
        }

        const graph = this.env.ensureGraph(m.elem);
        if (!graph) return; // no Web Audio: the element plays as today
        if (this.host && this.graph === graph) {
            this.host.onMedia(facts);
            return;
        }
        this.dropHost();
        this.graph = graph;
        const loadHost = this.env.loadHost ?? (() => import('./loadOneAmp'));
        this.hostLoad ??= loadHost();
        this.hostLoad.then(
            ({ createOneAmpHost }) => {
                if (gen !== this.generation || this.graph !== graph) return;
                this.host ??= createOneAmpHost(graph, this.failure);
                this.host.onMedia(facts);
                this.mountPanel();
            },
            () => {
                this.failure ??= 'host-load';
            }
        );
    }

    /**
     * The player found out late (HEAD request) that the item plays through
     * hls.js: OneAmp is not eligible for it (§6).
     */
    onHlsAttached(): void {
        const last = this.lastFacts;
        if (!last || last.desired === 'bypass') return;
        this.generation++;
        this.lastFacts = { ...last, desired: 'bypass', reason: 'hls' };
        this.host?.onMedia(this.lastFacts);
    }

    /** The legacy normalisation computed the item's gain (async settings). */
    setExpectedGain(gain: number): void {
        this.host?.setExpectedGain(gain);
    }

    onSeeking(): void {
        this.host?.onSeeking();
    }

    onStop(): void {
        this.generation++;
        this.host?.onStop();
    }

    /**
     * The player released its captured element (§4.7.1 swap): the host's
     * graph is gone. A sticky failure carries over to the next host.
     */
    onGraphReleased(): void {
        this.generation++;
        this.dropHost();
        this.graph = null;
    }

    /** Flag off: bypass with the expected gain, dispose, unmount (§4.6). */
    teardown(): void {
        this.dropHost();
    }

    /** The panel belongs to one host: it goes with it. */
    private dropHost(): void {
        this.unmountPanel?.();
        this.unmountPanel = null;
        const host = this.host;
        if (!host) return;
        this.failure = host.failure ?? this.failure;
        host.teardown();
        this.host = null;
    }

    private mountPanel(): void {
        if (this.unmountPanel || !this.host) return;
        const host = this.host;
        const loadPanel =
            this.env.loadPanel ?? (() => import('./OneAmpDevPanel'));
        this.unmountPanel = () => undefined; // mounting
        loadPanel().then(
            ({ mountOneAmpDevPanel }) => {
                if (this.host !== host) {
                    this.unmountPanel = null;
                    return;
                }
                this.unmountPanel = mountOneAmpDevPanel(host);
            },
            () => {
                this.unmountPanel = null;
            }
        );
    }
}

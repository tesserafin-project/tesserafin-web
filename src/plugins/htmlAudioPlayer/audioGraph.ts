/**
 * Single owner of the Web Audio graph behind the HTML audio player
 * (OneAmp web host contract, docs/tesserafin/oneamp-web-host-contract.md §7.2).
 *
 *   <audio> ─► MediaElementAudioSourceNode ─┬─► (processor, later) ─┐
 *                                           └──── bypass route ─────┴─► GainNode ─► destination
 *
 * `createMediaElementSource` is irreversible: once an element is captured, its
 * audio only reaches the speakers through this context, and a resource that is
 * not CORS-same-origin comes out of the source node as zeros. So nothing captures
 * an element unless `isCapturable` holds (§4.7.1), and every bypass sets the
 * item's expected gain, never unity (§4.7.2).
 */

/** The user's audio normalisation setting (`userSettings.selectAudioNormalization()`). */
export type NormalisationSetting = 'TrackGain' | 'AlbumGain' | string;

export interface NormalisationSource {
    item?: { NormalizationGain?: number | null } | null;
    mediaSource?: {
        albumNormalizationGain?: number | null;
        IsRemote?: boolean | null;
    } | null;
}

/** Gain in dB the legacy normalisation applies; Track/Album fall back to each other, then 0. */
export function normalisationDb(
    { item, mediaSource }: NormalisationSource,
    setting: NormalisationSetting
): number {
    const track = item?.NormalizationGain;
    const album = mediaSource?.albumNormalizationGain;
    let db: number | null | undefined;
    if (setting === 'TrackGain') {
        db = track ?? album;
    } else if (setting === 'AlbumGain') {
        db = album ?? track;
    }
    return typeof db === 'number' && Number.isFinite(db) ? db : 0;
}

export function normalisationGain(
    source: NormalisationSource,
    setting: NormalisationSetting
): number {
    return 10 ** (normalisationDb(source, setting) / 20);
}

/**
 * Gain the gain node must carry for an item on the bypass route. In Safari
 * `elem.volume` does not affect the source node's output, so the slider volume
 * is carried by the gain node there (unchanged legacy behaviour).
 */
export function expectedGain(
    normalisation: number,
    { safari, volume }: { safari: boolean; volume: number }
): number {
    return normalisation * (safari ? volume : 1);
}

export function isNormalising(setting: NormalisationSetting): boolean {
    return setting === 'TrackGain' || setting === 'AlbumGain';
}

/**
 * §4.7.1: an item may be captured only if it is not a remote (external)
 * media source and the element requests it with CORS. Whether the server
 * really answers with CORS headers is proved by tests, not assumed here.
 */
export function isCapturable(
    mediaSource: NormalisationSource['mediaSource'],
    elem: Pick<HTMLMediaElement, 'crossOrigin'>
): boolean {
    if (!mediaSource || mediaSource.IsRemote === true) return false;
    return (
        elem.crossOrigin === 'anonymous' ||
        elem.crossOrigin === 'use-credentials'
    );
}

/**
 * Apply the item's CORS mode to the (possibly reused) element. A `null` value
 * clears the attribute: a stale `anonymous` from the previous item would turn
 * a remote load into a CORS request.
 */
export function applyCrossOrigin(
    elem: HTMLMediaElement,
    value: string | null
): void {
    if (value) {
        elem.crossOrigin = value;
    } else {
        elem.removeAttribute('crossorigin');
    }
}

export type Route = 'bypass' | 'oneamp';

type AudioContextCtor = new () => AudioContext;

function defaultContextCtor(): AudioContextCtor | undefined {
    const w = globalThis as unknown as {
        AudioContext?: AudioContextCtor;
        webkitAudioContext?: AudioContextCtor;
    };
    return w.AudioContext || w.webkitAudioContext;
}

export class AudioGraph {
    readonly element: HTMLMediaElement;
    private readonly contextCtor: () => AudioContextCtor | undefined;
    private ctx: AudioContext | null = null;
    private source: MediaElementAudioSourceNode | null = null;
    private gainNode: GainNode | null = null;
    private processor: AudioNode | null = null;
    private currentRoute: Route = 'bypass';
    private released = false;

    constructor(
        element: HTMLMediaElement,
        contextCtor: () => AudioContextCtor | undefined = defaultContextCtor
    ) {
        this.element = element;
        this.contextCtor = contextCtor;
    }

    /** True once the element belongs to a context (irreversible for the element). */
    get captured(): boolean {
        return this.source !== null;
    }

    get context(): AudioContext | null {
        return this.ctx;
    }

    get route(): Route {
        return this.currentRoute;
    }

    get gain(): number | null {
        return this.gainNode ? this.gainNode.gain.value : null;
    }

    /**
     * Idempotent: context, source, gain and the bypass route. Returns false if
     * Web Audio is unavailable or the capture failed; the element then plays
     * without a graph, as it would without normalisation.
     */
    ensureGraph(): boolean {
        if (this.gainNode) return true;
        if (this.released) return false;
        let ctx: AudioContext | null = null;
        try {
            const Ctor = this.contextCtor();
            if (!Ctor) return false;
            ctx = new Ctor();
            const source = ctx.createMediaElementSource(this.element);
            const gainNode = ctx.createGain();
            source.connect(gainNode);
            gainNode.connect(ctx.destination);
            this.ctx = ctx;
            this.source = source;
            this.gainNode = gainNode;
            this.currentRoute = 'bypass';
            return true;
        } catch (e) {
            console.error(
                'Web Audio graph unavailable:',
                (e as Error)?.name ?? e
            );
            if (ctx && !this.source) ctx.close().catch(() => undefined);
            return false;
        }
    }

    setGain(value: number): void {
        if (this.gainNode) this.gainNode.gain.value = value;
    }

    /**
     * The only place that connects or disconnects nodes. `bypass` takes the
     * expected gain of the current item (§4.7.2): every fallback restores it.
     * `oneamp` needs the processor node, which must belong to this context.
     */
    setRoute(
        route: Route,
        { gain, processor }: { gain: number; processor?: AudioNode }
    ): void {
        const source = this.source;
        const gainNode = this.gainNode;
        if (!source || !gainNode) return;
        if (route === 'oneamp' && !processor) {
            throw new Error('oneamp route needs a processor node');
        }
        source.disconnect();
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (route === 'oneamp' && processor) {
            source.connect(processor);
            processor.connect(gainNode);
            this.processor = processor;
        } else {
            source.connect(gainNode);
        }
        this.currentRoute = route;
        gainNode.gain.value = gain;
    }

    /** Resume a context left suspended by autoplay policy (call on play). */
    resume(): void {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => undefined);
        }
    }

    /**
     * Drop the graph and close the context, for the element swap of §4.7.1.
     * The element itself stays captured for ever and must not be reused.
     */
    release(): void {
        this.released = true;
        try {
            this.source?.disconnect();
            this.processor?.disconnect();
            this.gainNode?.disconnect();
        } catch {
            // Already disconnected.
        }
        this.ctx?.close().catch(() => undefined);
        this.ctx = null;
        this.gainNode = null;
        this.processor = null;
        this.currentRoute = 'bypass';
    }
}

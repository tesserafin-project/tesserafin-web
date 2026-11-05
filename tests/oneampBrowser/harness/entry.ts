/**
 * OneAmp browser harness: the real HTML audio player, exposed to Playwright with an analyser
 * tap after the gain node (the last node before the destination, contract §7.1).
 */
import HtmlAudioPlayer from '../../../src/plugins/htmlAudioPlayer/plugin';
import { harnessSettings } from './services';

interface PlayOptions {
    playMethod?: string;
    normalizationGain?: number;
    isRemote?: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: the harness reads private player fields.
type AnyRecord = Record<string, any>;

const player = new (HtmlAudioPlayer as unknown as new () => AnyRecord)();
let tap: { left: AnalyserNode; right: AnalyserNode; ctx: AudioContext } | null =
    null;
const posted: string[] = [];

function graph(): AnyRecord | null {
    return player._audioGraph ?? null;
}

function host(): AnyRecord | null {
    return player._oneamp?.currentHost ?? null;
}

const harness = {
    settings: harnessSettings,

    async play(url: string, o: PlayOptions = {}) {
        tap = null;
        await player.play({
            url,
            playMethod: o.playMethod ?? 'DirectPlay',
            item: { NormalizationGain: o.normalizationGain },
            mediaSource: { IsRemote: o.isRemote === true, RunTimeTicks: 1e8 }
        });
    },

    element(): HTMLAudioElement {
        return player._mediaElement;
    },

    state() {
        return host()?.state ?? null;
    },

    graphInfo() {
        const g = graph();
        return g
            ? { captured: g.captured, route: g.route, gain: g.gain }
            : null;
    },

    host() {
        return host();
    },

    /** Records every message type the host posts to the worklet from now on. */
    recordPosts() {
        const node = host()?.node;
        if (!node || node.__recorded) return false;
        const send = node.port.postMessage.bind(node.port);
        node.port.postMessage = (m: AnyRecord) => {
            posted.push(String(m.type));
            send(m);
        };
        node.__recorded = true;
        return true;
    },

    posted() {
        return posted.slice();
    },

    /**
     * Splits the gain node's output into two analysers; the audible path is unchanged. A new
     * tap's buffer starts empty, so the caller waits for it to fill before reading.
     */
    async ensureTap() {
        const g = graph();
        if (!g?.gainNode || !g.context) return false;
        if (tap && tap.ctx === g.context) return true;
        const ctx = g.context as AudioContext;
        const splitter = ctx.createChannelSplitter(2);
        const left = ctx.createAnalyser();
        const right = ctx.createAnalyser();
        left.fftSize = right.fftSize = 8192;
        left.smoothingTimeConstant = right.smoothingTimeConstant = 0;
        g.gainNode.connect(splitter);
        splitter.connect(left, 0);
        splitter.connect(right, 1);
        tap = { left, right, ctx };
        const fillMs = (1000 * left.fftSize) / ctx.sampleRate;
        await new Promise((r) => setTimeout(r, 2 * fillMs + 50));
        return true;
    },

    /** Mean RMS per channel over `ms`, sampled every 50 ms. */
    async rms(ms = 600) {
        if (!(await harness.ensureTap()) || !tap) return null;
        const { left, right } = tap;
        const buf = new Float32Array(left.fftSize);
        const sums = { l: 0, r: 0, n: 0 };
        const end = performance.now() + ms;
        while (performance.now() < end) {
            left.getFloatTimeDomainData(buf);
            sums.l += Math.sqrt(
                buf.reduce((s, x) => s + x * x, 0) / buf.length
            );
            right.getFloatTimeDomainData(buf);
            sums.r += Math.sqrt(
                buf.reduce((s, x) => s + x * x, 0) / buf.length
            );
            sums.n++;
            await new Promise((r) => setTimeout(r, 50));
        }
        return { left: sums.l / sums.n, right: sums.r / sums.n };
    },

    /** Left-channel level in dB at `hz`, averaged over `ms`. */
    async binDb(hz: number, ms = 600) {
        if (!(await harness.ensureTap()) || !tap) return null;
        const { left, ctx } = tap;
        const data = new Float32Array(left.frequencyBinCount);
        const bin = Math.round((hz / ctx.sampleRate) * left.fftSize);
        let sum = 0;
        let n = 0;
        const end = performance.now() + ms;
        while (performance.now() < end) {
            left.getFloatFrequencyData(data);
            sum += Math.max(data[bin - 1], data[bin], data[bin + 1]);
            n++;
            await new Promise((r) => setTimeout(r, 50));
        }
        return sum / n;
    },

    contextState() {
        return graph()?.context?.state ?? null;
    }
};

(window as unknown as { oneampHarness: typeof harness }).oneampHarness =
    harness;

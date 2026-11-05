import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeAudioContext, path } from './audioGraphFake.testUtil';

/**
 * The HTML audio player's legacy normalisation on the shared graph, and the two
 * capture-safety fixes of the OneAmp web host contract §4.7.1: a stale
 * `crossOrigin` is cleared, and a non-capturable (remote, non-CORS) item never
 * plays through a captured element - before or after a captured item.
 */

const settings = vi.hoisted(() => ({ normalisation: 'TrackGain' }));
const browserFlags = vi.hoisted(
    () => ({ safari: false }) as Record<string, boolean>
);

vi.mock('../../scripts/browser', () => ({ default: browserFlags }));
vi.mock('../../components/apphost', () => ({
    appHost: { supports: () => false }
}));
vi.mock('../../components/router/appRouter', () => ({
    appRouter: { baseUrl: () => '' }
}));
vi.mock('../../scripts/browserDeviceProfile', () => ({ default: () => ({}) }));
vi.mock('../../scripts/settings/webSettings', () => ({
    getIncludeCorsCredentials: () => Promise.resolve(false)
}));
vi.mock('../../scripts/settings/userSettings', () => ({
    selectAudioNormalization: () => settings.normalisation
}));

import HtmlAudioPlayer from './plugin';

interface PlayOptions {
    url: string;
    item: { NormalizationGain?: number };
    mediaSource: {
        IsRemote?: boolean;
        albumNormalizationGain?: number;
        RunTimeTicks?: number;
    };
}

const local = (gainDb?: number): PlayOptions => ({
    url: 'http://server.test/Audio/a/stream?static=true',
    item: { NormalizationGain: gainDb },
    mediaSource: { IsRemote: false, RunTimeTicks: 1 }
});
const remote = (): PlayOptions => ({
    url: 'http://elsewhere.test/a.mp3',
    item: { NormalizationGain: -6 },
    mediaSource: { IsRemote: true, RunTimeTicks: 1 }
});

// The settings import (a dynamic import, slow on first use) and the src
// assignment both resolve asynchronously: drain a few macrotasks.
async function settle() {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

type Player = {
    play(o: PlayOptions): Promise<void>;
    _mediaElement: HTMLAudioElement;
    _audioGraph: { captured: boolean; gain: number | null } | null;
};

let player: Player;

beforeEach(() => {
    FakeAudioContext.reset();
    settings.normalisation = 'TrackGain';
    browserFlags.safari = false;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
        Promise.resolve()
    );
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
        () => undefined
    );
    document.body.innerHTML = '';
    player = new (HtmlAudioPlayer as unknown as new () => Player)();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function play(options: PlayOptions) {
    await player.play(options);
    await settle();
    return player._mediaElement;
}

describe('legacy normalisation through audioGraph', () => {
    it('captures a local item once and applies its gain', async () => {
        const elem = await play(local(-20));
        expect(FakeAudioContext.captured).toEqual([elem]);
        expect(player._audioGraph?.gain).toBeCloseTo(0.1, 12);
        const source = FakeAudioContext.instances[0].sources[0];
        expect(path(source)).toEqual(['source', 'gain', 'destination']);

        // Next item: same element, same context, new gain; no new capture.
        const again = await play(local());
        expect(again).toBe(elem);
        expect(FakeAudioContext.captured).toHaveLength(1);
        expect(player._audioGraph?.gain).toBe(1);
    });

    it('creates no graph with normalisation off', async () => {
        settings.normalisation = 'None';
        await play(local(-20));
        expect(FakeAudioContext.instances).toHaveLength(0);
        expect(player._audioGraph).toBeNull();
    });

    it('returns the gain to unity when normalisation is turned off with a graph in place', async () => {
        await play(local(-20));
        settings.normalisation = 'None';
        await play(local(-20));
        expect(player._audioGraph?.gain).toBe(1);
    });

    it('Safari: the gain node carries normalisation × slider volume', async () => {
        browserFlags.safari = true;
        const elem = await play(local(-20));
        expect(player._audioGraph?.gain).toBeCloseTo(0.1 * elem.volume, 12);
        elem.volume = 0.5;
        elem.dispatchEvent(new Event('volumechange'));
        expect(player._audioGraph?.gain).toBeCloseTo(0.05, 12);
    });

    it('resumes a suspended context on play', async () => {
        const elem = await play(local(-6));
        const ctx = FakeAudioContext.instances[0];
        ctx.state = 'suspended';
        elem.dispatchEvent(new Event('play'));
        expect(ctx.resumed).toBe(1);
    });
});

describe('capture safety (§4.7.1)', () => {
    it('a remote item before any capture plays without a graph and without CORS', async () => {
        const elem = await play(remote());
        expect(FakeAudioContext.captured).toHaveLength(0);
        expect(elem.hasAttribute('crossorigin')).toBe(false);
    });

    it('clears the crossOrigin a previous item left on the reused element', async () => {
        settings.normalisation = 'None';
        const first = await play(local());
        expect(first.crossOrigin).toBe('anonymous');
        const second = await play(remote());
        expect(second).toBe(first);
        expect(second.hasAttribute('crossorigin')).toBe(false);
    });

    it('a remote item after a captured one plays on a fresh, uncaptured element', async () => {
        const captured = await play(local(-6));
        const ctx = FakeAudioContext.instances[0];
        expect(FakeAudioContext.captured).toEqual([captured]);

        const fresh = await play(remote());
        expect(fresh).not.toBe(captured);
        expect(fresh.classList.contains('mediaPlayerAudio')).toBe(true);
        expect(document.querySelectorAll('.mediaPlayerAudio')).toHaveLength(1);
        expect(fresh.getAttribute('src')).toBe(remote().url);
        expect(fresh.hasAttribute('crossorigin')).toBe(false);
        expect(captured.hasAttribute('src')).toBe(false);
        expect(ctx.state).toBe('closed');
        // Not normalised: capturing it would silence it.
        expect(FakeAudioContext.captured).toEqual([captured]);
        expect(player._audioGraph).toBeNull();

        // The next local item builds a new graph on the fresh element.
        const next = await play(local(-20));
        expect(next).toBe(fresh);
        expect(FakeAudioContext.captured).toEqual([captured, fresh]);
        expect(player._audioGraph?.gain).toBeCloseTo(0.1, 12);
    });

    it('keeps volume and mute across the element swap', async () => {
        const captured = await play(local(-6));
        captured.volume = 0.3;
        captured.muted = true;
        const fresh = await play(remote());
        expect(fresh.volume).toBe(0.3);
        expect(fresh.muted).toBe(true);
    });

    it('events follow the swapped element', async () => {
        const captured = await play(local(-6));
        const fresh = await play(remote());
        const seen: string[] = [];
        const Events = (await import('../../utils/events')).default;
        Events.on(player, 'pause', () => seen.push('pause'));
        captured.dispatchEvent(new Event('pause'));
        expect(seen).toEqual([]);
        fresh.dispatchEvent(new Event('pause'));
        expect(seen).toEqual(['pause']);
    });

    it('a late continuation for a replaced item leaves the released element alone', async () => {
        const captured = await play(local(-20));
        // A local item whose settings load is still pending when a remote
        // item replaces it: the swap releases the captured element, and the
        // late continuation must not build a graph on it again.
        player.play(local(-6));
        const fresh = await play(remote());
        expect(fresh).not.toBe(captured);
        expect(FakeAudioContext.captured).toEqual([captured]);
        expect(player._audioGraph).toBeNull();
    });
});

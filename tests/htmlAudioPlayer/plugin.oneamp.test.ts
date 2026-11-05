import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeAudioContext } from './fakeAudioContext';

/**
 * The real HTML audio player with the experimental OneAmp flag (contract §9.5): with the
 * flag off, and in Safari with it on, no OneAmp module is requested and no graph is created
 * on its behalf; a Direct Play item captures and reaches the host; a transcode item does not.
 * The host module is replaced by a recorder, so nothing here depends on Web Audio worklets.
 */

const settings = vi.hoisted(() => ({ normalisation: 'None' }));
const browserFlags = vi.hoisted(
    () => ({ safari: false }) as Record<string, boolean>
);
const loads = vi.hoisted(() => ({
    host: 0,
    panel: 0,
    facts: [] as Record<string, unknown>[]
}));

vi.mock('../../src/scripts/browser', () => ({ default: browserFlags }));
vi.mock('../../src/components/apphost', () => ({
    appHost: { supports: () => false }
}));
vi.mock('../../src/components/router/appRouter', () => ({
    appRouter: { baseUrl: () => '' }
}));
vi.mock('../../src/scripts/browserDeviceProfile', () => ({
    default: () => ({})
}));
vi.mock('../../src/scripts/settings/webSettings', () => ({
    getIncludeCorsCredentials: () => Promise.resolve(false)
}));
vi.mock('../../src/scripts/settings/userSettings', () => ({
    selectAudioNormalization: () => settings.normalisation
}));
vi.mock('../../src/lib/oneamp/loadOneAmp', () => {
    loads.host++;
    return {
        createOneAmpHost: () => ({
            failure: null,
            onMedia: (f: Record<string, unknown>) => loads.facts.push(f),
            onSeeking: () => undefined,
            onStop: () => undefined,
            setExpectedGain: () => undefined,
            teardown: () => undefined
        })
    };
});
vi.mock('../../src/lib/oneamp/OneAmpDevPanel', () => {
    loads.panel++;
    return { mountOneAmpDevPanel: () => () => undefined };
});

type Player = {
    play(o: Record<string, unknown>): Promise<void>;
    _mediaElement: HTMLAudioElement;
    _audioGraph: { captured: boolean } | null;
};

const item = (playMethod: string) => ({
    url: 'http://server.test/Audio/a/stream?static=true',
    playMethod,
    item: {},
    mediaSource: { IsRemote: false, RunTimeTicks: 1 }
});

async function settle() {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

let player: Player;

// A fresh module graph per test, so `loads.host` counts real requests of the
// OneAmp module, and the player is built after the browser flags are set.
async function newPlayer(): Promise<Player> {
    const { default: HtmlAudioPlayer } = await import(
        '../../src/plugins/htmlAudioPlayer/plugin'
    );
    player = new (HtmlAudioPlayer as unknown as new () => Player)();
    return player;
}

beforeEach(() => {
    vi.resetModules();
    FakeAudioContext.reset();
    loads.facts = [];
    loads.host = 0;
    loads.panel = 0;
    browserFlags.safari = false;
    localStorage.clear();
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() =>
        Promise.resolve()
    );
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
        () => undefined
    );
    document.body.innerHTML = '';
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('flag off, and Safari with the flag on: unchanged', () => {
    it('flag off: no OneAmp module, no graph', async () => {
        await (await newPlayer()).play(item('DirectPlay'));
        await settle();
        expect(loads.host).toBe(0);
        expect(FakeAudioContext.instances).toHaveLength(0);
        expect(player._audioGraph).toBeNull();
    });

    it('Safari with the flag on: no OneAmp module, no graph', async () => {
        localStorage.setItem('tesserafin.experimental.oneamp', '1');
        browserFlags.safari = true;
        await (await newPlayer()).play(item('DirectPlay'));
        await settle();
        expect(loads.host).toBe(0);
        expect(FakeAudioContext.instances).toHaveLength(0);
    });

    it('flag on, transcode item: no OneAmp module, no graph', async () => {
        localStorage.setItem('tesserafin.experimental.oneamp', '1');
        await (await newPlayer()).play(item('Transcode'));
        await settle();
        expect(loads.host).toBe(0);
        expect(FakeAudioContext.instances).toHaveLength(0);
    });
});

describe('flag on, Direct Play', () => {
    it('captures the element and hands the item to the host', async () => {
        localStorage.setItem('tesserafin.experimental.oneamp', '1');
        await (await newPlayer()).play(item('DirectPlay'));
        await settle();
        expect(FakeAudioContext.captured).toEqual([player._mediaElement]);
        expect(loads.host).toBe(1);
        expect(loads.panel).toBe(1);
        expect(loads.facts.at(-1)).toMatchObject({
            desired: 'oneamp',
            playMethod: 'DirectPlay',
            expectedGain: 1,
            normalisationOwner: 'none'
        });

        await player.play(item('Transcode'));
        await settle();
        expect(loads.facts.at(-1)).toMatchObject({
            desired: 'bypass',
            reason: 'not-direct-play'
        });
    });
});

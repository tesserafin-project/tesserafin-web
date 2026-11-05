import { describe, expect, it, vi } from 'vitest';

import type { AudioGraph } from '../../src/lib/audio/audioGraph';
import {
    type MediaInput,
    OneAmpBridge
} from '../../src/lib/oneamp/oneampBridge';
import type { MediaFacts, OneAmpHost } from '../../src/lib/oneamp/oneampHost';

/**
 * Player-side wiring (contract §4.6, §6, §9.5): with the flag off or in Safari nothing loads
 * and no graph is created on OneAmp's behalf; only an eligible item captures and loads; a
 * sticky failure survives an element swap.
 */

const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

function fakeHost(failure: string | null = null) {
    const calls: MediaFacts[] = [];
    const host = {
        calls,
        failure,
        onMedia: vi.fn((f: MediaFacts) => calls.push(f)),
        onSeeking: vi.fn(),
        onStop: vi.fn(),
        setExpectedGain: vi.fn(),
        teardown: vi.fn()
    };
    return host;
}

function setup({ flag = true, safari = false, graphOk = true } = {}) {
    const graphs: object[] = [];
    const hosts: ReturnType<typeof fakeHost>[] = [];
    const initialFailures: (string | null | undefined)[] = [];
    const ensureGraph = vi.fn((_elem: HTMLMediaElement) => {
        if (!graphOk) return null;
        graphs[0] ??= {};
        return graphs[0] as AudioGraph;
    });
    const loadHost = vi.fn(() =>
        Promise.resolve({
            createOneAmpHost: (
                _g: AudioGraph,
                initialFailure?: string | null
            ) => {
                initialFailures.push(initialFailure);
                const h = fakeHost();
                hosts.push(h);
                return h as unknown as OneAmpHost;
            }
        })
    );
    const unmount = vi.fn();
    const loadPanel = vi.fn(() =>
        Promise.resolve({ mountOneAmpDevPanel: () => unmount })
    );
    const bridge = new OneAmpBridge({
        safari,
        readFlag: () => flag,
        ensureGraph,
        loadHost,
        loadPanel
    });
    return {
        bridge,
        ensureGraph,
        loadHost,
        loadPanel,
        unmount,
        hosts,
        graphs,
        initialFailures
    };
}

const elem = document.createElement('audio');
const media = (change: Partial<MediaInput> = {}): MediaInput => ({
    elem,
    url: 'http://server.test/Audio/1/stream?static=true',
    playMethod: 'DirectPlay',
    capturable: true,
    expectedGain: 0.5,
    normalising: true,
    ...change
});

describe('nothing loads or captures unless the item is eligible', () => {
    it.each([
        ['flag off', { flag: false }, {}],
        ['Safari, flag on', { safari: true }, {}],
        ['transcode', {}, { playMethod: 'Transcode' }],
        ['direct stream', {}, { playMethod: 'DirectStream' }],
        ['HLS url', {}, { url: 'http://server.test/master.m3u8' }],
        ['not capturable', {}, { capturable: false }]
    ])('%s', async (_name, env, item) => {
        const t = setup(env);
        t.bridge.onMedia(media(item));
        await flush();
        expect(t.ensureGraph).not.toHaveBeenCalled();
        expect(t.loadHost).not.toHaveBeenCalled();
        expect(t.loadPanel).not.toHaveBeenCalled();
    });
});

describe('eligible Direct Play', () => {
    it('captures, loads the host once, passes the facts, mounts the panel', async () => {
        const t = setup();
        t.bridge.onMedia(media());
        await flush();
        expect(t.ensureGraph).toHaveBeenCalledWith(elem);
        expect(t.loadHost).toHaveBeenCalledTimes(1);
        expect(t.hosts).toHaveLength(1);
        expect(t.hosts[0].calls).toEqual([
            {
                desired: 'oneamp',
                reason: undefined,
                playMethod: 'DirectPlay',
                expectedGain: 0.5,
                normalisationOwner: 'legacy-gain'
            }
        ]);
        expect(t.loadPanel).toHaveBeenCalledTimes(1);

        // Next item, transcode: same host, bypass with its reason.
        t.bridge.onMedia(
            media({ playMethod: 'Transcode', normalising: false })
        );
        expect(t.hosts[0].calls.at(-1)).toMatchObject({
            desired: 'bypass',
            reason: 'not-direct-play',
            normalisationOwner: 'none'
        });
        expect(t.loadHost).toHaveBeenCalledTimes(1);
    });

    it('no Web Audio: nothing loads, the element plays as today', async () => {
        const t = setup({ graphOk: false });
        t.bridge.onMedia(media());
        await flush();
        expect(t.loadHost).not.toHaveBeenCalled();
    });

    it('only the latest item reaches the host once it has loaded', async () => {
        const t = setup();
        t.bridge.onMedia(media());
        t.bridge.onMedia(media({ expectedGain: 0.25 }));
        await flush();
        expect(t.hosts).toHaveLength(1);
        expect(t.hosts[0].calls.map((c) => c.expectedGain)).toEqual([0.25]);
    });

    it('a late hls.js attach turns the item into a bypass', async () => {
        const t = setup();
        t.bridge.onMedia(media());
        await flush();
        t.bridge.onHlsAttached();
        expect(t.hosts[0].calls.at(-1)).toMatchObject({
            desired: 'bypass',
            reason: 'hls'
        });
    });

    it('forwards seeking, stop and the expected gain', async () => {
        const t = setup();
        t.bridge.onMedia(media());
        await flush();
        t.bridge.onSeeking();
        t.bridge.onStop();
        t.bridge.setExpectedGain(0.7);
        expect(t.hosts[0].onSeeking).toHaveBeenCalled();
        expect(t.hosts[0].onStop).toHaveBeenCalled();
        expect(t.hosts[0].setExpectedGain).toHaveBeenCalledWith(0.7);
    });
});

describe('lifecycle', () => {
    it('flag turned off: the host is torn down and the panel unmounted', async () => {
        let flag = true;
        const t = setup();
        const bridge = new OneAmpBridge({
            safari: false,
            readFlag: () => flag,
            ensureGraph: t.ensureGraph,
            loadHost: t.loadHost,
            loadPanel: t.loadPanel
        });
        bridge.onMedia(media());
        await flush();
        flag = false;
        bridge.onMedia(media());
        expect(t.hosts[0].teardown).toHaveBeenCalled();
        expect(t.unmount).toHaveBeenCalled();
        expect(bridge.currentHost).toBeNull();
    });

    it('an element swap drops the host; a sticky failure carries to the next one', async () => {
        const t = setup();
        t.bridge.onMedia(media());
        await flush();
        t.hosts[0].failure = 'compile';
        t.bridge.onGraphReleased();
        expect(t.hosts[0].teardown).toHaveBeenCalled();
        expect(t.unmount).toHaveBeenCalled();

        t.graphs.length = 0; // the player builds a new graph on the fresh element
        t.bridge.onMedia(media());
        await flush();
        expect(t.hosts).toHaveLength(2);
        expect(t.initialFailures).toEqual([null, 'compile']);
    });
});

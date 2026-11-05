import { beforeEach, describe, expect, it } from 'vitest';

import {
    AudioGraph,
    applyCrossOrigin,
    expectedGain,
    isCapturable,
    normalisationDb,
    normalisationGain
} from './audioGraph';
import { FakeAudioContext, FakeNode, path } from './audioGraphFake.testUtil';

/** OneAmp web host contract §4.7 and §7.2 (docs/tesserafin/oneamp-web-host-contract.md). */

const ctor = () => FakeAudioContext as unknown as new () => AudioContext;

describe('normalisationDb: Track/Album fallback table (§4.7.2)', () => {
    const cases: [string, number | undefined, number | undefined, number][] = [
        // setting, track, album, expected dB
        ['TrackGain', -6, -3, -6],
        ['TrackGain', undefined, -3, -3],
        ['TrackGain', -6, undefined, -6],
        ['TrackGain', undefined, undefined, 0],
        ['AlbumGain', -6, -3, -3],
        ['AlbumGain', -6, undefined, -6],
        ['AlbumGain', undefined, -3, -3],
        ['AlbumGain', undefined, undefined, 0],
        ['None', -6, -3, 0],
        ['', -6, -3, 0]
    ];
    it.each(cases)(
        '%s track=%s album=%s → %s dB',
        (setting, track, album, db) => {
            const source = {
                item: { NormalizationGain: track },
                mediaSource: { albumNormalizationGain: album }
            };
            expect(normalisationDb(source, setting)).toBe(db);
        }
    );

    it('a track gain of 0 dB is a value, not a missing one', () => {
        const source = {
            item: { NormalizationGain: 0 },
            mediaSource: { albumNormalizationGain: -9 }
        };
        expect(normalisationDb(source, 'TrackGain')).toBe(0);
    });

    it('null values fall back like absent ones', () => {
        const source = {
            item: { NormalizationGain: null },
            mediaSource: { albumNormalizationGain: -3 }
        };
        expect(normalisationDb(source, 'TrackGain')).toBe(-3);
    });

    it('converts dB to a linear gain', () => {
        const source = { item: { NormalizationGain: -20 }, mediaSource: {} };
        expect(normalisationGain(source, 'TrackGain')).toBeCloseTo(0.1, 12);
        expect(normalisationGain(source, 'None')).toBe(1);
    });
});

describe('expectedGain', () => {
    it('carries the slider volume only in Safari', () => {
        expect(expectedGain(0.5, { safari: false, volume: 0.25 })).toBe(0.5);
        expect(expectedGain(0.5, { safari: true, volume: 0.25 })).toBe(0.125);
    });
});

describe('isCapturable (§4.7.1)', () => {
    const elem = (crossOrigin: string | null) => ({ crossOrigin });
    it('needs a non-remote source requested with CORS', () => {
        expect(isCapturable({ IsRemote: false }, elem('anonymous'))).toBe(true);
        expect(isCapturable({}, elem('use-credentials'))).toBe(true);
        expect(isCapturable({ IsRemote: true }, elem('anonymous'))).toBe(false);
        expect(isCapturable({ IsRemote: false }, elem(null))).toBe(false);
        expect(isCapturable({ IsRemote: false }, elem(''))).toBe(false);
        expect(isCapturable(null, elem('anonymous'))).toBe(false);
    });
});

describe('applyCrossOrigin', () => {
    it('clears a stale value instead of keeping it', () => {
        const audio = document.createElement('audio');
        applyCrossOrigin(audio, 'anonymous');
        expect(audio.getAttribute('crossorigin')).toBe('anonymous');
        applyCrossOrigin(audio, null);
        expect(audio.hasAttribute('crossorigin')).toBe(false);
        expect(audio.crossOrigin).toBeNull();
    });
});

describe('AudioGraph', () => {
    beforeEach(() => FakeAudioContext.reset());

    it('ensureGraph is idempotent and captures the element once', () => {
        const audio = document.createElement('audio');
        const graph = new AudioGraph(audio, ctor);
        expect(graph.captured).toBe(false);
        expect(graph.ensureGraph()).toBe(true);
        expect(graph.ensureGraph()).toBe(true);
        expect(FakeAudioContext.instances).toHaveLength(1);
        expect(FakeAudioContext.captured).toEqual([audio]);
        expect(graph.captured).toBe(true);
        expect(graph.route).toBe('bypass');
        const source = FakeAudioContext.instances[0].sources[0];
        expect(path(source)).toEqual(['source', 'gain', 'destination']);
    });

    it('reports no graph without Web Audio, and on a failed capture', () => {
        const audio = document.createElement('audio');
        expect(new AudioGraph(audio, () => undefined).ensureGraph()).toBe(
            false
        );
        FakeAudioContext.failCapture = true;
        const graph = new AudioGraph(audio, ctor);
        expect(graph.ensureGraph()).toBe(false);
        expect(graph.captured).toBe(false);
        expect(FakeAudioContext.instances[0].state).toBe('closed');
    });

    it('routes through a processor and back, setting the gain each time', () => {
        const graph = new AudioGraph(document.createElement('audio'), ctor);
        graph.ensureGraph();
        const source = FakeAudioContext.instances[0].sources[0];
        const processor = new FakeNode('processor');

        graph.setRoute('oneamp', {
            gain: 0.5,
            processor: processor as unknown as AudioNode
        });
        expect(path(source)).toEqual([
            'source',
            'processor',
            'gain',
            'destination'
        ]);
        expect(graph.route).toBe('oneamp');
        expect(graph.gain).toBe(0.5);

        graph.setRoute('bypass', { gain: 0.25 });
        expect(path(source)).toEqual(['source', 'gain', 'destination']);
        expect(processor.outputs.size).toBe(0);
        expect(graph.route).toBe('bypass');
        expect(graph.gain).toBe(0.25);
    });

    it('refuses the oneamp route without a processor node', () => {
        const graph = new AudioGraph(document.createElement('audio'), ctor);
        graph.ensureGraph();
        expect(() => graph.setRoute('oneamp', { gain: 1 })).toThrow();
    });

    it('resumes a suspended context', () => {
        const graph = new AudioGraph(document.createElement('audio'), ctor);
        graph.ensureGraph();
        const ctx = FakeAudioContext.instances[0];
        graph.resume();
        expect(ctx.resumed).toBe(0);
        ctx.state = 'suspended';
        graph.resume();
        expect(ctx.resumed).toBe(1);
    });

    it('release closes the context; the element stays captured and is never re-captured', () => {
        const graph = new AudioGraph(document.createElement('audio'), ctor);
        graph.ensureGraph();
        graph.release();
        expect(FakeAudioContext.instances[0].state).toBe('closed');
        expect(graph.captured).toBe(true);
        expect(graph.ensureGraph()).toBe(false);
        expect(FakeAudioContext.captured).toHaveLength(1);
    });
});

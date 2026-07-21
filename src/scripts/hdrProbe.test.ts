/**
 * Tests for the dormant HDR probe (issue #29, `VideoRangeTypes` half).
 *
 * READ THIS BEFORE ADDING A TEST HERE: every probe surface is a hand-written fake. These tests
 * assert the *four-outcome logic* and nothing else. Not one of them measures, or is allowed to
 * measure, the HDR capability of whatever machine runs them - the runner is jsdom, which
 * implements neither `matchMedia` nor `mediaCapabilities`, and even under a real browser a CI
 * container's answer would be an artefact of the container. A green run here is evidence that the
 * outcomes are computed correctly; it is NOT evidence that any hardware supports HDR10. The only
 * thing that could be that evidence is a conjunction positive on identified HDR hardware, which
 * does not exist yet - see `docs/reefin/bench-hdr/hdr-detection-feasibility.md`.
 */
import { describe, expect, it } from 'vitest';

import {
    concludeHdr10,
    type DecodingInfoQuery,
    type HdrVideoConfiguration,
    type MediaQueryProbe,
    probeHdr10Decode,
    probeHdrDisplay
} from './hdrProbe';

/** Fake `matchMedia` driven by an explicit answer table: a query absent from the table matches
 * `false`, which is exactly how a browser reports a media feature it does not implement. */
function fakeMatchMedia(answers: Record<string, boolean>): MediaQueryProbe {
    return (query: string) => ({ matches: answers[query] === true });
}

const HEVC_MAIN10: HdrVideoConfiguration = {
    contentType: 'video/mp4; codecs="hvc1.2.4.L153.90"',
    width: 1920,
    height: 1080,
    bitrate: 12_000_000,
    framerate: 24
};

/** Records what was asked, so the twin construction itself can be asserted rather than assumed. */
function recordingDecodingInfo(answer: (q: DecodingInfoQuery) => boolean) {
    const calls: DecodingInfoQuery[] = [];
    return {
        calls,
        probe: (query: DecodingInfoQuery) => {
            calls.push(query);
            return Promise.resolve({ supported: answer(query) });
        }
    };
}

const isHdrRequest = (q: DecodingInfoQuery) =>
    q.video.transferFunction === 'pq';

describe('probeHdrDisplay - semantic partition', () => {
    it('is positive when the partition says high and not standard', () => {
        expect(
            probeHdrDisplay({
                matchMedia: fakeMatchMedia({
                    '(dynamic-range: high)': true,
                    '(dynamic-range: standard)': false
                })
            })
        ).toBe('positive');
    });

    it('is negative when the feature is implemented and answers standard - the real measured shape of the SDR bench machine', () => {
        expect(
            probeHdrDisplay({
                matchMedia: fakeMatchMedia({
                    '(dynamic-range: high)': false,
                    '(dynamic-range: standard)': true
                })
            })
        ).toBe('negative');
    });

    it('is absent - NOT negative - when neither value of the enumerated feature matches', () => {
        // This is the whole reason the partition technique exists. A one-query probe
        // (`matchMedia('(dynamic-range: high)').matches === false`) would report this browser as
        // "no HDR", when in fact it never answered the question at all. That silent promotion of
        // an absence into a claim is precisely what issue #29 item 3 forbids.
        expect(
            probeHdrDisplay({
                matchMedia: fakeMatchMedia({})
            })
        ).toBe('absent');
    });

    it('is absent when there is no matchMedia at all', () => {
        expect(probeHdrDisplay({})).toBe('absent');
    });

    it('is unknown when both values match, because the partition is then meaningless', () => {
        expect(
            probeHdrDisplay({
                matchMedia: fakeMatchMedia({
                    '(dynamic-range: high)': true,
                    '(dynamic-range: standard)': true
                })
            })
        ).toBe('unknown');
    });

    it('is unknown - never negative - when matchMedia throws', () => {
        expect(
            probeHdrDisplay({
                matchMedia: () => {
                    throw new TypeError('nope');
                }
            })
        ).toBe('unknown');
    });

    it('never consults video-dynamic-range, which Chromium 149 does not implement', () => {
        const asked: string[] = [];
        probeHdrDisplay({
            matchMedia: (query: string) => {
                asked.push(query);
                return { matches: false };
            }
        });
        expect(asked).toEqual([
            '(dynamic-range: high)',
            '(dynamic-range: standard)'
        ]);
    });
});

describe('probeHdr10Decode - twin configurations', () => {
    it('is positive when the HDR config is supported and its SDR twin is not', async () => {
        const { probe } = recordingDecodingInfo(isHdrRequest);
        await expect(
            probeHdr10Decode({ decodingInfo: probe }, HEVC_MAIN10)
        ).resolves.toBe('positive');
    });

    it('builds a twin that differs ONLY in the HDR members', async () => {
        const { calls, probe } = recordingDecodingInfo(isHdrRequest);
        await probeHdr10Decode({ decodingInfo: probe }, HEVC_MAIN10);

        expect(calls).toHaveLength(2);
        const [hdr, sdr] = calls;
        expect(hdr.video).toEqual({
            ...HEVC_MAIN10,
            transferFunction: 'pq',
            colorGamut: 'rec2020',
            hdrMetadataType: 'smpteSt2086'
        });
        expect(sdr.video).toEqual({
            ...HEVC_MAIN10,
            transferFunction: 'srgb',
            colorGamut: 'srgb'
        });
        // No SDR metadata type exists, so the twin drops the member rather than inventing a value.
        expect('hdrMetadataType' in sdr.video).toBe(false);
        expect(hdr.type).toBe('file');
        expect(sdr.type).toBe('file');
    });

    it('probes smpteSt2086 only, and never HDR10+ or Dolby Vision metadata', async () => {
        const { calls, probe } = recordingDecodingInfo(isHdrRequest);
        await probeHdr10Decode({ decodingInfo: probe }, HEVC_MAIN10);

        const metadataTypes = calls.map((c) => c.video.hdrMetadataType);
        expect(metadataTypes).not.toContain('smpteSt2094-40'); // HDR10+
        expect(metadataTypes).not.toContain('smpteSt2094-10'); // Dolby Vision
        // HLG is a transfer function, not a metadata type, and is equally never requested.
        expect(calls.map((c) => c.video.transferFunction)).not.toContain('hlg');
    });

    it('is negative when the HDR config is refused while its SDR twin passes', async () => {
        const { probe } = recordingDecodingInfo((q) => !isHdrRequest(q));
        await expect(
            probeHdr10Decode({ decodingInfo: probe }, HEVC_MAIN10)
        ).resolves.toBe('negative');
    });

    it('is unknown - not positive - when both twins are supported, because the fields discriminated nothing', async () => {
        const { probe } = recordingDecodingInfo(() => true);
        await expect(
            probeHdr10Decode({ decodingInfo: probe }, HEVC_MAIN10)
        ).resolves.toBe('unknown');
    });

    it('is unknown - not negative - when both twins are refused', async () => {
        const { probe } = recordingDecodingInfo(() => false);
        await expect(
            probeHdr10Decode({ decodingInfo: probe }, HEVC_MAIN10)
        ).resolves.toBe('unknown');
    });

    it('is absent when there is no decodingInfo at all', async () => {
        await expect(probeHdr10Decode({}, HEVC_MAIN10)).resolves.toBe('absent');
    });

    it('is unknown - not negative - when decodingInfo rejects, as Chromium does on a bogus enum member', async () => {
        await expect(
            probeHdr10Decode(
                {
                    decodingInfo: () =>
                        Promise.reject(
                            new TypeError(
                                "'definitely-not-a-transfer-function' is not a valid enum value of type TransferFunction"
                            )
                        )
                },
                HEVC_MAIN10
            )
        ).resolves.toBe('unknown');
    });

    it('passes the media-source type through unchanged when asked for it', async () => {
        const { calls, probe } = recordingDecodingInfo(isHdrRequest);
        await probeHdr10Decode(
            { decodingInfo: probe },
            HEVC_MAIN10,
            'media-source'
        );
        expect(calls.map((c) => c.type)).toEqual([
            'media-source',
            'media-source'
        ]);
    });
});

describe('concludeHdr10 - the conjunction', () => {
    it('claims HDR10 only for two independent positives', () => {
        expect(concludeHdr10('positive', 'positive')).toEqual({
            display: 'positive',
            decode: 'positive',
            hdr10Claimable: true
        });
    });

    it.each([
        ['negative', 'positive'],
        ['absent', 'positive'],
        ['unknown', 'positive'],
        ['positive', 'negative'],
        ['positive', 'absent'],
        ['positive', 'unknown'],
        ['negative', 'negative'],
        ['absent', 'absent'],
        ['unknown', 'unknown']
    ] as const)(
        'refuses to claim HDR10 for display=%s decode=%s',
        (display, decode) => {
            expect(concludeHdr10(display, decode).hdr10Claimable).toBe(false);
        }
    );

    it('reproduces the measured bench outcome: decode positive, display negative, no claim', () => {
        // This mirrors the real Chromium 149 / headed X11 / AUO 6-bit eDP measurement recorded in
        // docs/reefin/bench-hdr/. The values are typed in here as a regression guard on the
        // conjunction logic - running this test measures nothing about the current host.
        expect(concludeHdr10('negative', 'positive')).toEqual({
            display: 'negative',
            decode: 'positive',
            hdr10Claimable: false
        });
    });

    it('preserves both raw outcomes so "measured no" stays distinguishable from "not measured"', () => {
        expect(concludeHdr10('negative', 'positive').display).toBe('negative');
        expect(concludeHdr10('absent', 'positive').display).toBe('absent');
    });
});

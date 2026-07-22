import { describe, expect, it } from 'vitest';

import type {
    PlaybackDecisionClientCapabilities,
    PlaybackDecisionDecodeProfile,
    PlaybackDecisionPlaybackOutputProfile,
    PlaybackDecisionVideoCodecCapability
} from 'lib/tesserafin-sdk';
import { compareClientCapabilities } from './compareClientCapabilities';

/**
 * Fixture builders for the three shapes whose members reefin#51 made required on the wire.
 *
 * `compareClientCapabilities` reads none of the newly-required members - it only ever looks at
 * `Codec`, `Format`, `Containers`, `Container` and the two `Supports*` flags - so these builders
 * declare them empty purely to satisfy the contract. No assertion in this file depends on their
 * values, and filling them in changed no expectation.
 */
const videoCodec = (Codec: string): PlaybackDecisionVideoCodecCapability => ({
    Codec,
    Profiles: [],
    VideoRangeTypes: []
});

const decodeProfile = (
    Containers: string[]
): PlaybackDecisionDecodeProfile => ({
    Type: 'Video',
    Containers,
    VideoCodecs: [],
    AudioCodecs: []
});

const outputProfile = (
    Type: 'Video' | 'Audio',
    Protocol: 'Hls' | 'Http',
    Container: string
): PlaybackDecisionPlaybackOutputProfile => ({
    Type,
    Protocol,
    Container,
    VideoCodecs: [],
    AudioCodecs: []
});

const capabilities = (
    overrides: Partial<PlaybackDecisionClientCapabilities> = {}
): PlaybackDecisionClientCapabilities => ({
    Decode: {
        DirectPlayProfiles: [],
        VideoCodecs: [],
        AudioCodecs: [],
        SubtitleDelivery: [],
        SupportsHls: false,
        SupportsDash: false
    },
    OutputProfiles: [],
    ...overrides
});

describe('compareClientCapabilities()', () => {
    it('reports every category empty when both sides declare nothing', () => {
        const result = compareClientCapabilities(
            capabilities(),
            capabilities()
        );

        expect(result.videoCodecs).toEqual({
            onlyInNative: [],
            onlyInReconstructed: [],
            inBoth: []
        });
        expect(result.audioCodecs).toEqual({
            onlyInNative: [],
            onlyInReconstructed: [],
            inBoth: []
        });
        expect(result.subtitleFormats).toEqual({
            onlyInNative: [],
            onlyInReconstructed: [],
            inBoth: []
        });
        expect(result.directPlayContainers).toEqual({
            onlyInNative: [],
            onlyInReconstructed: [],
            inBoth: []
        });
        expect(result.outputContainers).toEqual({
            onlyInNative: [],
            onlyInReconstructed: [],
            inBoth: []
        });
        expect(result.supportsHls).toEqual({
            native: false,
            reconstructed: false,
            matches: true
        });
        expect(result.supportsDash).toEqual({
            native: false,
            reconstructed: false,
            matches: true
        });
    });

    it('splits video/audio codecs into onlyInNative/onlyInReconstructed/inBoth', () => {
        const native = capabilities({
            Decode: {
                DirectPlayProfiles: [],
                VideoCodecs: [videoCodec('h264'), videoCodec('av1')],
                AudioCodecs: [{ Codec: 'aac' }],
                SubtitleDelivery: [],
                SupportsHls: false,
                SupportsDash: false
            }
        });
        const reconstructed = capabilities({
            Decode: {
                DirectPlayProfiles: [],
                VideoCodecs: [videoCodec('h264'), videoCodec('hevc')],
                AudioCodecs: [{ Codec: 'aac' }, { Codec: 'ac3' }],
                SubtitleDelivery: [],
                SupportsHls: false,
                SupportsDash: false
            }
        });

        const result = compareClientCapabilities(native, reconstructed);

        expect(result.videoCodecs).toEqual({
            onlyInNative: ['av1'],
            onlyInReconstructed: ['hevc'],
            inBoth: ['h264']
        });
        expect(result.audioCodecs).toEqual({
            onlyInNative: [],
            onlyInReconstructed: ['ac3'],
            inBoth: ['aac']
        });
    });

    it('deduplicates and sorts subtitle formats regardless of declared order', () => {
        const native = capabilities({
            Decode: {
                DirectPlayProfiles: [],
                VideoCodecs: [],
                AudioCodecs: [],
                SubtitleDelivery: [
                    { Format: 'ssa', Method: 'External' },
                    { Format: 'ass', Method: 'External' },
                    { Format: 'ass', Method: 'External' }
                ],
                SupportsHls: false,
                SupportsDash: false
            }
        });

        const result = compareClientCapabilities(native, capabilities());

        expect(result.subtitleFormats.onlyInNative).toEqual(['ass', 'ssa']);
    });

    it('flattens DirectPlayProfiles.Containers across multiple profiles into one set', () => {
        const native = capabilities({
            Decode: {
                DirectPlayProfiles: [
                    decodeProfile(['mp4', 'm4v']),
                    decodeProfile(['mkv'])
                ],
                VideoCodecs: [],
                AudioCodecs: [],
                SubtitleDelivery: [],
                SupportsHls: false,
                SupportsDash: false
            }
        });

        const result = compareClientCapabilities(native, capabilities());

        expect(result.directPlayContainers.onlyInNative).toEqual([
            'm4v',
            'mkv',
            'mp4'
        ]);
    });

    it('reads output container names from OutputProfiles', () => {
        const reconstructed = capabilities({
            OutputProfiles: [
                outputProfile('Video', 'Hls', 'ts'),
                outputProfile('Audio', 'Http', 'mp3')
            ]
        });

        const result = compareClientCapabilities(capabilities(), reconstructed);

        expect(result.outputContainers.onlyInReconstructed).toEqual([
            'mp3',
            'ts'
        ]);
    });

    it('reports SupportsHls/SupportsDash divergence with matches: false', () => {
        const native = capabilities({
            Decode: {
                DirectPlayProfiles: [],
                VideoCodecs: [],
                AudioCodecs: [],
                SubtitleDelivery: [],
                SupportsHls: true,
                SupportsDash: false
            }
        });
        const reconstructed = capabilities({
            Decode: {
                DirectPlayProfiles: [],
                VideoCodecs: [],
                AudioCodecs: [],
                SubtitleDelivery: [],
                SupportsHls: false,
                SupportsDash: false
            }
        });

        const result = compareClientCapabilities(native, reconstructed);

        expect(result.supportsHls).toEqual({
            native: true,
            reconstructed: false,
            matches: false
        });
        expect(result.supportsDash).toEqual({
            native: false,
            reconstructed: false,
            matches: true
        });
    });

    it('treats missing/undefined nested fields as empty rather than throwing', () => {
        // Deliberately contract-violating input, kept after reefin#51 made `Decode` and
        // `OutputProfiles` required. `required` constrains what a *conforming server* sends; it is
        // not something TypeScript can enforce on bytes arriving over the wire at runtime. An older
        // server, a truncated payload or an intermediary can still produce this, and
        // compareClientCapabilities' `?.`/`?? []` handling exists precisely for that case - so this
        // test keeps exercising it, and the cast documents that the violation is the point.
        const malformed = {} as PlaybackDecisionClientCapabilities;

        const result = compareClientCapabilities(malformed, malformed);

        expect(result.videoCodecs).toEqual({
            onlyInNative: [],
            onlyInReconstructed: [],
            inBoth: []
        });
        expect(result.supportsHls).toEqual({
            native: false,
            reconstructed: false,
            matches: true
        });
    });

    it('filters out entries with an empty/missing Codec or Container name', () => {
        const native = capabilities({
            Decode: {
                DirectPlayProfiles: [],
                // Same rationale as the test above: `Codec` is required on the wire since
                // reefin#51, but the filtering being tested here is the runtime guard against a
                // server that sends an empty or absent one anyway. Cast so the deliberately
                // malformed entries survive the stricter type.
                VideoCodecs: [
                    { Codec: '' },
                    { Codec: undefined }
                ] as unknown as PlaybackDecisionVideoCodecCapability[],
                AudioCodecs: [],
                SubtitleDelivery: [],
                SupportsHls: false,
                SupportsDash: false
            },
            OutputProfiles: [outputProfile('Video', 'Hls', '')]
        });

        const result = compareClientCapabilities(native, capabilities());

        expect(result.videoCodecs.onlyInNative).toEqual([]);
        expect(result.outputContainers.onlyInNative).toEqual([]);
    });
});

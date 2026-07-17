import { describe, expect, it } from 'vitest';

import type { PlaybackDecisionClientCapabilities } from 'lib/reefin-sdk';
import { compareClientCapabilities } from './compareClientCapabilities';

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
                VideoCodecs: [{ Codec: 'h264' }, { Codec: 'av1' }],
                AudioCodecs: [{ Codec: 'aac' }],
                SubtitleDelivery: [],
                SupportsHls: false,
                SupportsDash: false
            }
        });
        const reconstructed = capabilities({
            Decode: {
                DirectPlayProfiles: [],
                VideoCodecs: [{ Codec: 'h264' }, { Codec: 'hevc' }],
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
                    { Type: 'Video', Containers: ['mp4', 'm4v'] },
                    { Type: 'Video', Containers: ['mkv'] }
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
                { Type: 'Video', Protocol: 'Hls', Container: 'ts' },
                { Type: 'Audio', Protocol: 'Http', Container: 'mp3' }
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
        const result = compareClientCapabilities({}, {});

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
                VideoCodecs: [{ Codec: '' }, { Codec: undefined }],
                AudioCodecs: [],
                SubtitleDelivery: [],
                SupportsHls: false,
                SupportsDash: false
            },
            OutputProfiles: [{ Type: 'Video', Protocol: 'Hls', Container: '' }]
        });

        const result = compareClientCapabilities(native, capabilities());

        expect(result.videoCodecs.onlyInNative).toEqual([]);
        expect(result.outputContainers.onlyInNative).toEqual([]);
    });
});

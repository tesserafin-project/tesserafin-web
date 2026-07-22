import { describe, expect, it } from 'vitest';

import type {
    BrowserSignals,
    MediaTypeProbe,
    PlaybackCapabilityInputs
} from './tesserafinPlaybackCapabilities';
import {
    buildClientCapabilities,
    buildDecodeCapabilities,
    buildOutputProfiles,
    buildPlaybackConstraints
} from './tesserafinPlaybackCapabilities';

/** A `canPlayType` stand-in that reports "probably" for any MIME/codec string containing one of
 * `supported`, matching `browserDeviceProfile.js`'s own `.replace(/no/, '')` truthiness check
 * (`'probably'`/`'maybe'` are both truthy, `''` is falsy). */
function probe(supported: string[]): MediaTypeProbe {
    return {
        canPlayType: (type: string) =>
            supported.some((needle) => type.includes(needle)) ? 'probably' : ''
    };
}

const NOTHING = probe([]);

/** A desktop-Chrome-like browser/device matrix entry: H264/HEVC/VP8/VP9/AV1 all decodable, MSE
 * present (so HLS works via MSE even without native HLS), MKV decodable, common audio codecs
 * decodable, no AC3/EAC3/DTS. */
function chromeDesktop(): {
    browser: BrowserSignals;
    inputs: PlaybackCapabilityInputs;
} {
    const browser: BrowserSignals = { chrome: true, versionMajor: 120 };
    return {
        browser,
        inputs: {
            browser,
            videoProbe: probe([
                'avc1.42E01E',
                'hvc1.1.L120',
                'av01.0.15M.08',
                'av01.0.15M.10',
                'vp8',
                'vp9',
                'x-matroska'
            ]),
            audioProbe: probe(['aac', 'mp3', 'opus', 'flac']),
            supportsMediaSourceExtensions: true,
            supportsTextTracks: true,
            supportsCanvas2D: true
        }
    };
}

/** A Safari-on-macOS-like entry: H264/HEVC decodable, native HLS (no MSE dependency), ALAC
 * decodable (Safari+macOS special-case), no VP8/VP9/AV1 (mirrors Safari's real-world codec gaps),
 * no AC3/EAC3 (represents an older/limited Safari without those). */
function safariMac(): {
    browser: BrowserSignals;
    inputs: PlaybackCapabilityInputs;
} {
    const browser: BrowserSignals = {
        safari: true,
        osx: true,
        versionMajor: 17
    };
    return {
        browser,
        inputs: {
            browser,
            videoProbe: probe([
                'avc1.42E01E',
                'hvc1.1.L120',
                'x-mpegURL',
                'mpegURL'
            ]),
            audioProbe: probe(['aac']),
            supportsMediaSourceExtensions: false,
            supportsTextTracks: true,
            supportsCanvas2D: true
        }
    };
}

/** A minimal/legacy-feeling device: nothing decodes, no MSE, no text tracks, no canvas. Used to
 * pin down the "declares nothing when nothing is supported" floor. */
function bareDevice(): PlaybackCapabilityInputs {
    return {
        browser: {},
        videoProbe: NOTHING,
        audioProbe: NOTHING,
        supportsMediaSourceExtensions: false,
        supportsTextTracks: false,
        supportsCanvas2D: false
    };
}

describe('buildDecodeCapabilities()', () => {
    it('declares codec, container, and HLS capability for a Chrome-desktop-like device', () => {
        const { inputs } = chromeDesktop();
        const decode = buildDecodeCapabilities(inputs);

        expect(decode.VideoCodecs?.map((c) => c.Codec).sort()).toEqual(
            ['av1', 'h264', 'hevc', 'vp8', 'vp9'].sort()
        );
        expect(decode.AudioCodecs?.map((c) => c.Codec).sort()).toEqual(
            ['aac', 'flac', 'mp3', 'opus'].sort()
        );
        expect(decode.SupportsHls).toBe(true);
        expect(decode.SupportsDash).toBe(false);

        const mp4Profile = decode.DirectPlayProfiles?.find((p) =>
            p.Containers?.includes('mp4')
        );
        expect(mp4Profile?.Type).toBe('Video');
        expect(mp4Profile?.VideoCodecs?.sort()).toEqual(
            ['av1', 'h264', 'hevc', 'vp9'].sort()
        );

        const webmProfile = decode.DirectPlayProfiles?.find((p) =>
            p.Containers?.includes('webm')
        );
        expect(webmProfile?.VideoCodecs?.sort()).toEqual(['vp8', 'vp9'].sort());

        const mkvProfile = decode.DirectPlayProfiles?.find((p) =>
            p.Containers?.includes('mkv')
        );
        expect(mkvProfile).toBeDefined();

        // Chrome is in the mov-eligible browser family (safari/chrome/edgeChromium).
        const movProfile = decode.DirectPlayProfiles?.find((p) =>
            p.Containers?.includes('mov')
        );
        expect(movProfile?.VideoCodecs).toEqual(['h264']);

        // Standalone audio-container direct-play entries, wildcard AudioCodecs (empty array).
        const aacAudioProfile = decode.DirectPlayProfiles?.find(
            (p) => p.Type === 'Audio' && p.Containers?.includes('aac')
        );
        expect(aacAudioProfile?.AudioCodecs).toEqual([]);
    });

    it('declares ALAC via the Safari+macOS special case and native HLS without MSE for a Safari-like device', () => {
        const { inputs } = safariMac();
        const decode = buildDecodeCapabilities(inputs);

        expect(decode.AudioCodecs?.map((c) => c.Codec)).toContain('alac');
        expect(decode.SupportsHls).toBe(true);

        // Safari has no VP8/VP9/AV1 canPlayType hits in this fixture.
        expect(decode.VideoCodecs?.map((c) => c.Codec).sort()).toEqual(
            ['h264', 'hevc'].sort()
        );
    });

    it('declares HEVC unconditionally on Xbox One regardless of the codec probe', () => {
        const decode = buildDecodeCapabilities({
            browser: { xboxOne: true },
            videoProbe: NOTHING,
            audioProbe: NOTHING,
            supportsMediaSourceExtensions: false,
            supportsTextTracks: false,
            supportsCanvas2D: false
        });

        expect(decode.VideoCodecs?.map((c) => c.Codec)).toContain('hevc');
    });

    it('never declares HEVC on PS4 even when the probe reports support', () => {
        const decode = buildDecodeCapabilities({
            browser: { ps4: true },
            videoProbe: probe(['hvc1.1.L120']),
            audioProbe: NOTHING,
            supportsMediaSourceExtensions: false,
            supportsTextTracks: false,
            supportsCanvas2D: false
        });

        expect(decode.VideoCodecs?.map((c) => c.Codec)).not.toContain('hevc');
    });

    it('only declares EAC3 alongside AC3, matching browserDeviceProfile.js nesting', () => {
        const decode = buildDecodeCapabilities({
            browser: {},
            // EAC3 probe hits, AC3 probe does not - legacy never checks EAC3 unless AC3 is true.
            videoProbe: probe(['ec-3']),
            audioProbe: NOTHING,
            supportsMediaSourceExtensions: false,
            supportsTextTracks: false,
            supportsCanvas2D: false
        });

        expect(decode.AudioCodecs?.map((c) => c.Codec)).not.toContain('eac3');
        expect(decode.AudioCodecs?.map((c) => c.Codec)).not.toContain('ac3');
    });

    it('declares both AC3 and EAC3 when both probes hit', () => {
        const decode = buildDecodeCapabilities({
            browser: {},
            videoProbe: probe(['ac-3', 'ec-3']),
            audioProbe: NOTHING,
            supportsMediaSourceExtensions: false,
            supportsTextTracks: false,
            supportsCanvas2D: false
        });

        expect(decode.AudioCodecs?.map((c) => c.Codec).sort()).toEqual(
            ['ac3', 'eac3'].sort()
        );
    });

    it('excludes MKV direct play on Firefox even when the container probe hits', () => {
        const decode = buildDecodeCapabilities({
            browser: { firefox: true, versionMajor: 145 },
            videoProbe: probe(['avc1.42E01E', 'x-matroska']),
            audioProbe: NOTHING,
            supportsMediaSourceExtensions: false,
            supportsTextTracks: false,
            supportsCanvas2D: false
        });

        const mkvProfile = decode.DirectPlayProfiles?.find((p) =>
            p.Containers?.includes('mkv')
        );
        expect(mkvProfile).toBeUndefined();
    });

    it('declares no DTS capability when the probe does not hit', () => {
        const decode = buildDecodeCapabilities(bareDevice());
        expect(decode.AudioCodecs?.map((c) => c.Codec)).not.toContain('dca');
    });

    it('declares DTS when the probe hits (default browser fallback, no app setting involved)', () => {
        const decode = buildDecodeCapabilities({
            browser: {},
            videoProbe: probe(['dts-']),
            audioProbe: NOTHING,
            supportsMediaSourceExtensions: false,
            supportsTextTracks: false,
            supportsCanvas2D: false
        });
        expect(decode.AudioCodecs?.map((c) => c.Codec)).toContain('dca');
    });

    it('declares nothing when nothing is supported', () => {
        const decode = buildDecodeCapabilities(bareDevice());

        expect(decode.VideoCodecs).toEqual([]);
        expect(decode.AudioCodecs).toEqual([]);
        expect(decode.DirectPlayProfiles).toEqual([]);
        expect(decode.SupportsHls).toBe(false);
        expect(decode.SupportsDash).toBe(false);
        // vtt is gated on supportsTextTracks (false here); ass/ssa are unconditional in the
        // legacy default path, so they still appear even on a device that decodes nothing.
        expect(decode.SubtitleDelivery?.map((s) => s.Format).sort()).toEqual(
            ['ass', 'ssa'].sort()
        );
    });

    /** The server's `VideoCodecCapability` (`Reefin.Playback.Decision`) is a positional record whose
     * `Profiles`/`VideoRangeTypes` are non-nullable `IReadOnlyList<string>`, so both members must be
     * PRESENT on every serialized entry or ASP.NET model binding rejects the whole request `400`
     * ("The Profiles field is required."). The generated TS model marks both `?`-optional, so
     * omitting them type-checks - nothing but a test like this can catch a regression. */
    describe('VideoCodecs wire contract', () => {
        /** Every device shape that emits at least one video codec. `bareDevice()` is deliberately
         * excluded: it emits `VideoCodecs: []`, which would satisfy any per-entry loop vacuously. */
        const populatedDevices: [string, PlaybackCapabilityInputs][] = [
            ['chrome desktop', chromeDesktop().inputs],
            ['safari mac', safariMac().inputs]
        ];

        it.each(populatedDevices)(
            'emits Profiles and VideoRangeTypes on EVERY video codec entry (%s)',
            (_name, inputs) => {
                const decode = buildDecodeCapabilities(inputs);
                const codecs = decode.VideoCodecs ?? [];

                // Anti-vacuity: an empty list would make every per-entry check below pass for free.
                expect(codecs.length).toBeGreaterThan(0);

                // Structural assertion over the WHOLE list, not a hand-picked entry: reduce to the
                // set of property keys present per entry so a single missing field fails loudly and
                // names the offending codec.
                expect(
                    codecs.map((c) => ({
                        Codec: c.Codec,
                        hasProfiles: 'Profiles' in c,
                        hasVideoRangeTypes: 'VideoRangeTypes' in c
                    }))
                ).toEqual(
                    codecs.map((c) => ({
                        Codec: c.Codec,
                        hasProfiles: true,
                        hasVideoRangeTypes: true
                    }))
                );
            }
        );

        it('emits probe-derived Profiles per codec, and VideoRangeTypes: ["SDR"] on all of them', () => {
            const decode = buildDecodeCapabilities(chromeDesktop().inputs);
            const codecs = decode.VideoCodecs ?? [];
            expect(codecs.length).toBeGreaterThan(0);

            // ISSUE #29, `Profiles` HALF. This fixture's `probe()` answers 'probably' only for the
            // exact substrings it was given, so the expectation below is precisely "what the fake
            // browser could prove", codec by codec:
            //   h264 - only `avc1.42E01E` is in the fixture, and that string names Constrained
            //          Baseline and nothing else. `main`/`high`/`high 10` are NOT inferred from it.
            //   hevc - the fixture answers for `hvc1.1.L120`, the generic "can you HEVC at all"
            //          gate, which is in NO profile row. Proving the codec proves no profile: [].
            //   av1  - `av01.0.15M.08` is literally the `main` row's second string.
            //   vp8/vp9 - absent from the closed table by design, so always [].
            expect(
                Object.fromEntries(codecs.map((c) => [c.Codec, c.Profiles]))
            ).toEqual({
                h264: ['constrained baseline'],
                hevc: [],
                av1: ['main'],
                vp8: [],
                vp9: []
            });

            for (const codec of codecs) {
                // `['SDR']` mirrors the server's legacy-adapter fallback
                // (ClientCapabilitiesMapper: `videoRangeTypes = ["SDR"]`) - never an undetected
                // HDR10/HLG/Dolby Vision claim. That half of issue #29 is deliberately untouched.
                expect(codec.VideoRangeTypes, `codec ${codec.Codec}`).toEqual([
                    'SDR'
                ]);
            }
        });

        it('an EMPTY Profiles list still means "no restriction", never "nothing supported"', () => {
            // The distinction issue #29 §3 insists on. HEVC below IS declared as a decodable codec
            // (it is in VideoCodecs at all), yet carries `Profiles: []` because no profile-specific
            // string probed. The server reads that as full latitude, not as a rejection.
            const decode = buildDecodeCapabilities(chromeDesktop().inputs);
            const hevc = decode.VideoCodecs?.find((c) => c.Codec === 'hevc');
            expect(hevc, 'hevc must still be declared decodable').toBeDefined();
            expect(hevc?.Profiles).toEqual([]);
        });

        it('both fields survive JSON serialization on the full ClientCapabilities payload', () => {
            // The 400-fix hinges on an EMPTY array reaching the wire (a builder-level assertion
            // would still pass if serialization dropped empty collections, and the server would go
            // back to 400) - so round-trip the real payload the client POSTs. Now that some entries
            // are non-empty, BOTH shapes must survive, which is why the anti-vacuity checks below
            // demand at least one of each.
            const caps = buildClientCapabilities(chromeDesktop().inputs);
            const wire = JSON.parse(JSON.stringify(caps));
            const codecs = wire?.Decode?.VideoCodecs ?? [];

            expect(codecs.length).toBeGreaterThan(0);
            expect(
                codecs.some(
                    (c: { Profiles: string[] }) => c.Profiles.length === 0
                ),
                'no empty Profiles left to prove empty arrays survive'
            ).toBe(true);
            expect(
                codecs.some(
                    (c: { Profiles: string[] }) => c.Profiles.length > 0
                ),
                'no populated Profiles left to prove derived values survive'
            ).toBe(true);

            for (const codec of codecs) {
                expect(codec.Profiles, `codec ${codec.Codec}`).toBeInstanceOf(
                    Array
                );
                expect(codec.VideoRangeTypes, `codec ${codec.Codec}`).toEqual([
                    'SDR'
                ]);
            }
            expect(
                Object.fromEntries(
                    codecs.map((c: { Codec: string; Profiles: string[] }) => [
                        c.Codec,
                        c.Profiles
                    ])
                )
            ).toEqual({
                h264: ['constrained baseline'],
                hevc: [],
                av1: ['main'],
                vp8: [],
                vp9: []
            });
        });
    });

    describe('subtitle delivery', () => {
        it('declares vtt only when supportsTextTracks is true', () => {
            const withTracks = buildDecodeCapabilities({
                ...bareDevice(),
                supportsTextTracks: true
            });
            expect(withTracks.SubtitleDelivery?.map((s) => s.Format)).toContain(
                'vtt'
            );

            const withoutTracks = buildDecodeCapabilities({
                ...bareDevice(),
                supportsTextTracks: false
            });
            expect(
                withoutTracks.SubtitleDelivery?.map((s) => s.Format)
            ).not.toContain('vtt');
        });

        it('always declares ass/ssa regardless of supportsTextTracks (legacy default path)', () => {
            const decode = buildDecodeCapabilities(bareDevice());
            expect(decode.SubtitleDelivery?.map((s) => s.Format)).toEqual(
                expect.arrayContaining(['ass', 'ssa'])
            );
        });

        it('only declares pgssub when both canvas2D support and the explicit opt-in are present', () => {
            const noOptIn = buildDecodeCapabilities({
                ...bareDevice(),
                supportsCanvas2D: true,
                enablePgsSubtitles: false
            });
            expect(
                noOptIn.SubtitleDelivery?.map((s) => s.Format)
            ).not.toContain('pgssub');

            const optedIn = buildDecodeCapabilities({
                ...bareDevice(),
                supportsCanvas2D: true,
                enablePgsSubtitles: true
            });
            expect(optedIn.SubtitleDelivery?.map((s) => s.Format)).toContain(
                'pgssub'
            );

            const optedInNoCanvas = buildDecodeCapabilities({
                ...bareDevice(),
                supportsCanvas2D: false,
                enablePgsSubtitles: true
            });
            expect(
                optedInNoCanvas.SubtitleDelivery?.map((s) => s.Format)
            ).not.toContain('pgssub');
        });

        it('uses External delivery for every declared subtitle format (matches browserDeviceProfile.js)', () => {
            const decode = buildDecodeCapabilities({
                ...chromeDesktop().inputs,
                supportsCanvas2D: true,
                enablePgsSubtitles: true
            });
            expect(
                decode.SubtitleDelivery?.every((s) => s.Method === 'External')
            ).toBe(true);
        });
    });
});

describe('buildOutputProfiles()', () => {
    it('prefers the fMP4 container for HLS audio on Chrome (a fMP4-reliable browser family)', () => {
        const { inputs } = chromeDesktop();
        const profiles = buildOutputProfiles(inputs);

        const hlsAudio = profiles.find(
            (p) => p.Type === 'Audio' && p.Protocol === 'Hls'
        );
        expect(hlsAudio?.Container).toBe('mp4');
    });

    it('falls back to the ts container for HLS audio on a browser family outside the fMP4 allowlist', () => {
        const decode = buildOutputProfiles({
            browser: { android: true },
            videoProbe: probe(['x-mpegURL']),
            audioProbe: probe(['aac']),
            supportsMediaSourceExtensions: false,
            supportsTextTracks: false,
            supportsCanvas2D: false
        });

        const hlsAudio = decode.find(
            (p) => p.Type === 'Audio' && p.Protocol === 'Hls'
        );
        expect(hlsAudio?.Container).toBe('ts');
    });

    it('declares Streaming-context HTTP audio output profiles for each playable format', () => {
        const { inputs } = chromeDesktop();
        const profiles = buildOutputProfiles(inputs);

        // The Streaming-context HTTP audio transcode target list is exactly aac/mp3/opus/wav
        // (browserDeviceProfile.js's TranscodingProfiles) - flac is never a transcode *target*
        // even though it's a decode capability, so it must not appear here.
        const httpAudioContainers = profiles
            .filter((p) => p.Type === 'Audio' && p.Protocol === 'Http')
            .map((p) => p.Container)
            .sort();
        expect(httpAudioContainers).toEqual(['aac', 'mp3', 'opus'].sort());
    });

    it('declares no video output profiles when HLS is unavailable', () => {
        const profiles = buildOutputProfiles(bareDevice());
        expect(profiles.some((p) => p.Type === 'Video')).toBe(false);
    });

    it('excludes AV1 from the HLS video output on mobile Chrome, isolated from the fMP4-container gate', () => {
        // Chrome is in the fMP4-container allowlist regardless of `mobile` (so this exercises the
        // AV1-specific eligibility check in isolation, not just "fMP4 disabled"): legacy requires
        // `canPlayAv1() && (safari || (!mobile && (edgeChromium||firefox||chrome||opera)))` - on
        // mobile Chrome the `!mobile` clause fails, so AV1 must never be offered even though H264
        // still is and even though the raw canPlayType probe reports AV1 as decodable.
        const profiles = buildOutputProfiles({
            browser: { chrome: true, mobile: true },
            videoProbe: probe([
                'x-mpegURL',
                'av01.0.15M.08',
                'av01.0.15M.10',
                'avc1.42E01E'
            ]),
            audioProbe: probe(['aac']),
            supportsMediaSourceExtensions: false,
            supportsTextTracks: false,
            supportsCanvas2D: false
        });

        const fmp4Video = profiles.find(
            (p) => p.Type === 'Video' && p.Container === 'mp4'
        );
        expect(fmp4Video).toBeDefined();
        expect(fmp4Video?.VideoCodecs).not.toContain('av1');
        expect(fmp4Video?.VideoCodecs).toContain('h264');
    });
});

describe('buildClientCapabilities()', () => {
    it('combines Decode and OutputProfiles into one payload', () => {
        const { inputs } = chromeDesktop();
        const capabilities = buildClientCapabilities(inputs);

        expect(capabilities.Decode).toEqual(buildDecodeCapabilities(inputs));
        expect(capabilities.OutputProfiles).toEqual(
            buildOutputProfiles(inputs)
        );
    });
});

describe('buildPlaybackConstraints()', () => {
    it('defaults to permissive direct play/stream/transcode with no bitrate cap', () => {
        const constraints = buildPlaybackConstraints();

        expect(constraints.AllowDirectPlay).toBe(true);
        expect(constraints.AllowDirectStream).toBe(true);
        expect(constraints.AllowTranscoding).toBe(true);
        expect(constraints.MaxBitrate).toBeNull();
        expect(constraints.SubtitleMode).toBe('Default');
        expect(constraints.PreferredSubtitleLanguages).toEqual([]);
    });

    it('maps a caller-supplied max bitrate straight through', () => {
        const constraints = buildPlaybackConstraints({ maxBitrate: 8_000_000 });

        expect(constraints.MaxBitrate).toBe(8_000_000);
        // Everything else still takes its default.
        expect(constraints.AllowDirectPlay).toBe(true);
    });

    it('maps every overridable field when the caller supplies one', () => {
        const constraints = buildPlaybackConstraints({
            allowDirectPlay: false,
            allowDirectStream: false,
            allowTranscoding: true,
            allowVideoStreamCopy: false,
            allowAudioStreamCopy: false,
            maxBitrate: 4_000_000,
            maxAudioChannels: 2,
            preferredAudioStreamIndex: 1,
            preferredSubtitleStreamIndex: 3,
            subtitleMode: 'Smart',
            preferredSubtitleLanguages: ['eng', 'fra'],
            alwaysBurnInSubtitleWhenTranscoding: true,
            startTimeTicks: 12345
        });

        expect(constraints).toEqual({
            AllowDirectPlay: false,
            AllowDirectStream: false,
            AllowTranscoding: true,
            AllowVideoStreamCopy: false,
            AllowAudioStreamCopy: false,
            MaxBitrate: 4_000_000,
            MaxAudioChannels: 2,
            PreferredAudioStreamIndex: 1,
            PreferredSubtitleStreamIndex: 3,
            SubtitleMode: 'Smart',
            PreferredSubtitleLanguages: ['eng', 'fra'],
            AlwaysBurnInSubtitleWhenTranscoding: true,
            StartTimeTicks: 12345
        });
    });
});

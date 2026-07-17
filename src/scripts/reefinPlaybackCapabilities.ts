/**
 * Native builder for the server's v2 `ClientCapabilities`/`PlaybackConstraints` request shapes
 * (`Reefin.Playback.Decision`, PR91/PR92/PR112b — see `docs/pr116-client-migration-design.md`
 * PR116a in the `reefin` repo). Parallel to `./browserDeviceProfile.js`, which builds the legacy
 * DLNA `DeviceProfile` this module deliberately does NOT build from or reverse-map out of — every
 * capability below comes straight from the same underlying browser probes (`canPlayType`, user
 * agent sniffing, `MediaSource`, `<canvas>` 2D context) that `browserDeviceProfile.js` itself
 * queries, not from inspecting an already-built `DeviceProfile`.
 *
 * NAME COLLISION TRAP (design doc §1.4): the generated SDK (`lib/reefin-sdk`) exports TWO
 * unrelated types that both informally mean "client capabilities":
 *   - `ClientCapabilitiesDto` (`client-capabilities-dto.ts`) — session capabilities (playable
 *     media types, supported remote-control commands, a raw `DeviceProfile`). NOT this module.
 *   - `PlaybackDecisionClientCapabilities` (`playback-decision-client-capabilities.ts`) — the PR91
 *     playback-decision domain type (`Decode`/`OutputProfiles`). This is the one this module
 *     builds. Every import below is aliased with a `PlaybackDecision`-prefixed generated name
 *     precisely so a reader (or a future edit) can't casually reach for the wrong one - importing
 *     `ClientCapabilitiesDto` here would compile (different shape, no structural overlap) but
 *     produce a silently invalid payload, exactly the failure mode the design doc warns about.
 *
 * Deliberate duplication, not extraction (design doc §3 PR116a explicitly allows either "the time
 * of coexistence"): `browserDeviceProfile.js` does not export its detection primitives
 * (`canPlayH264`/`canPlayHevc`/`canPlayAv1`/`canPlayHls`/`supportsAc3`/`supportsEac3`/
 * `canPlayDts`/`canPlayAudioFormat`/`testCanPlayMkv`/etc. are all module-private). Rather than
 * changing that file's exports as a side effect of an unrelated, additive, dormant PR, this module
 * re-implements the same probes against the same `canPlayType()` strings, parameterized so they're
 * unit-testable without a real DOM/browser. If PR116b+ needs closer coupling later, extracting a
 * shared primitives module becomes a deliberate refactor of its own, not a drive-by here.
 *
 * Scope of this first pass (design doc §3 PR116a: "sous-ensemble strict acceptable au premier jet,
 * sur-ensemble à justifier" - a strict subset of what `browserDeviceProfile.js` declares is fine,
 * declaring anything extra needs justification). What's intentionally NOT ported, so this module
 * never claims a capability the legacy builder wouldn't declare under default settings:
 *   - Settings-gated extras that default off (`enableTrueHd`, `alwaysRemuxFlac`, `alwaysRemuxMp3`,
 *     PGS subtitle rendering) are simply omitted rather than wired to `appSettings`/`userSettings`
 *     (a storage dependency this pure module intentionally has none of). `canPlayDts` IS included
 *     because, unlike TrueHD, the legacy code falls back to the real browser probe whenever neither
 *     the setting nor an explicit option is set - i.e. that's the default-path behavior already.
 *   - Per-codec HDR/Dolby Vision profile/level/bit-depth detail (`browserDeviceProfile.js`'s
 *     `CodecProfiles` `Conditions` machinery, ~600 lines) is not ported; codec entries below leave
 *     `MaxLevel`/`MaxBitDepth`/`VideoRangeTypes`/`MaxResolution`/`MaxBitrate` unset, which the
 *     generated model docs each define as "unbounded/unknown" - a safe omission, never a false claim.
 *   - Container aliasing/remux quirks (`ts` for mp3, `webm`/`m4a`/`m4b` duplicate entries) and the
 *     `Static` (offline sync) transcoding context are not ported; only the `Streaming`-context
 *     equivalents relevant to live playback are represented.
 *   - Per-output bitrate/channel limits (`MaxVideoBitrate`/`MaxAudioBitrate`/`MaxAudioChannels` on
 *     `PlaybackOutputProfile`) are left unset - `browserDeviceProfile.js` doesn't set meaningful
 *     per-profile limits here either (its analogous numbers live in DLNA `Conditions`, which have no
 *     clean 1:1 mapping onto the flatter domain shape).
 *
 * No network call. No wiring into `playbackmanager.js`. Dormant until a later PR116 slice calls it.
 */

import { detectBrowser } from './browser';

import type {
    PlaybackDecisionAudioCodecCapability as AudioCodecCapability,
    PlaybackDecisionClientCapabilities as PlaybackClientCapabilities,
    PlaybackDecisionDecodeCapabilities as DecodeCapabilities,
    PlaybackDecisionDecodeProfile as DecodeProfile,
    PlaybackDecisionPlaybackConstraints as PlaybackConstraints,
    PlaybackDecisionPlaybackOutputProfile as PlaybackOutputProfile,
    PlaybackDecisionSubtitleCapability as SubtitleCapability,
    PlaybackDecisionVideoCodecCapability as VideoCodecCapability
} from 'lib/reefin-sdk';
import {
    PlaybackDecisionMediaKind as MediaKind,
    PlaybackDecisionStreamingProtocol as StreamingProtocol,
    PlaybackDecisionSubtitleDeliveryMethod as SubtitleDeliveryMethod,
    PlaybackDecisionSubtitlePlaybackMode as SubtitlePlaybackMode
} from 'lib/reefin-sdk';

/** The subset of `detectBrowser()`'s (untyped, plain-JS) return value this module reads. Declared
 * locally rather than trusting inference from `./browser.js` (`allowJs`, not `checkJs`) because
 * that file assigns most flags via dynamic bracket notation (`browser[matched.browser] = true`),
 * which TS can't track back into a precise return type - `./browser.d.ts` itself only declares a
 * partial shape for the same reason (confirmed against the runtime source: `chrome`/`android`/
 * `opera`/`windows` are all real fields at runtime but missing from that declaration file). */
export interface BrowserSignals {
    chrome?: boolean;
    safari?: boolean;
    firefox?: boolean;
    edgeChromium?: boolean;
    opera?: boolean;
    osx?: boolean;
    windows?: boolean;
    iOS?: boolean;
    iOSVersion?: number;
    android?: boolean;
    mobile?: boolean;
    vidaa?: boolean;
    xboxOne?: boolean;
    ps4?: boolean;
    versionMajor?: number;
}

/** Mirrors the one method of `HTMLMediaElement` every detection primitive below actually needs,
 * so tests can inject a fake instead of depending on jsdom's (non-)implementation of codec
 * support. */
export type MediaTypeProbe = Pick<HTMLMediaElement, 'canPlayType'>;

/** Every field is optional and defaults to a real browser probe - production call sites can invoke
 * `buildClientCapabilities()` with no arguments; tests inject exactly the signals they want to
 * pin down. */
export interface PlaybackCapabilityInputs {
    /** Defaults to a real `<video>` element. */
    videoProbe?: MediaTypeProbe;
    /** Defaults to a real `<audio>` element. */
    audioProbe?: MediaTypeProbe;
    /** Defaults to `detectBrowser()` against the live `navigator.userAgent`. */
    browser?: BrowserSignals;
    /** Defaults to `document.createElement('video').textTracks != null`. */
    supportsTextTracks?: boolean;
    /** Defaults to `document.createElement('canvas').getContext('2d') != null`. */
    supportsCanvas2D?: boolean;
    /** Defaults to `window.MediaSource != null`. */
    supportsMediaSourceExtensions?: boolean;
    /** Defaults to `false`, matching `userSettings`'s default for PGS subtitle rendering - this
     * module has no storage dependency, so the caller opts in explicitly instead. */
    enablePgsSubtitles?: boolean;
}

interface ResolvedInputs {
    videoProbe: MediaTypeProbe;
    audioProbe: MediaTypeProbe;
    browser: BrowserSignals;
    supportsTextTracks: boolean;
    supportsCanvas2D: boolean;
    supportsMediaSourceExtensions: boolean;
    enablePgsSubtitles: boolean;
}

function resolveInputs(inputs: PlaybackCapabilityInputs): ResolvedInputs {
    return {
        videoProbe: inputs.videoProbe ?? document.createElement('video'),
        audioProbe: inputs.audioProbe ?? document.createElement('audio'),
        browser:
            inputs.browser ?? (detectBrowser() as unknown as BrowserSignals),
        supportsTextTracks:
            inputs.supportsTextTracks ??
            document.createElement('video').textTracks != null,
        supportsCanvas2D:
            inputs.supportsCanvas2D ??
            document.createElement('canvas').getContext('2d') != null,
        supportsMediaSourceExtensions:
            inputs.supportsMediaSourceExtensions ??
            (typeof window !== 'undefined' && window.MediaSource != null),
        enablePgsSubtitles: inputs.enablePgsSubtitles ?? false
    };
}

// ---------------------------------------------------------------------------------------------
// Detection primitives - duplicated from `browserDeviceProfile.js`, see file-level doc comment.
// ---------------------------------------------------------------------------------------------

function playable(probe: MediaTypeProbe, type: string): boolean {
    return !!probe.canPlayType(type).replace(/no/, '');
}

function canPlayH264(videoProbe: MediaTypeProbe): boolean {
    return playable(videoProbe, 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
}

function canPlayHevc(
    videoProbe: MediaTypeProbe,
    browser: BrowserSignals
): boolean {
    if (browser.xboxOne) {
        return true;
    }

    if (browser.ps4) {
        return false;
    }

    return (
        playable(videoProbe, 'video/mp4; codecs="hvc1.1.L120"') ||
        playable(videoProbe, 'video/mp4; codecs="hev1.1.L120"') ||
        playable(videoProbe, 'video/mp4; codecs="hvc1.1.0.L120"') ||
        playable(videoProbe, 'video/mp4; codecs="hev1.1.0.L120"')
    );
}

function canPlayAv1(
    videoProbe: MediaTypeProbe,
    browser: BrowserSignals
): boolean {
    if (browser.xboxOne) {
        return false;
    }

    return (
        playable(videoProbe, 'video/mp4; codecs="av01.0.15M.08"') &&
        playable(videoProbe, 'video/mp4; codecs="av01.0.15M.10"')
    );
}

function canPlayVp8(videoProbe: MediaTypeProbe): boolean {
    return playable(videoProbe, 'video/webm; codecs="vp8"');
}

function canPlayVp9(videoProbe: MediaTypeProbe): boolean {
    return playable(videoProbe, 'video/webm; codecs="vp9"');
}

function canPlayNativeHls(videoProbe: MediaTypeProbe): boolean {
    return (
        playable(videoProbe, 'application/x-mpegURL') ||
        playable(videoProbe, 'application/vnd.apple.mpegURL')
    );
}

function canPlayHls(
    videoProbe: MediaTypeProbe,
    supportsMediaSourceExtensions: boolean
): boolean {
    return canPlayNativeHls(videoProbe) || supportsMediaSourceExtensions;
}

function supportsAc3(
    videoProbe: MediaTypeProbe,
    browser: BrowserSignals
): boolean {
    if (browser.iOS && (browser.iOSVersion ?? 0) < 11) {
        return false;
    }

    return playable(videoProbe, 'audio/mp4; codecs="ac-3"');
}

function supportsEac3(
    videoProbe: MediaTypeProbe,
    browser: BrowserSignals
): boolean {
    if (browser.iOS && (browser.iOSVersion ?? 0) < 11) {
        return false;
    }

    return playable(videoProbe, 'audio/mp4; codecs="ec-3"');
}

function canPlayDts(videoProbe: MediaTypeProbe): boolean {
    return (
        playable(videoProbe, 'video/mp4; codecs="dts-"') ||
        playable(videoProbe, 'video/mp4; codecs="dts+"')
    );
}

/** `format` is a normalized codec/container name (`'aac'`, `'opus'`, ...), tested the same way
 * `browserDeviceProfile.js#canPlayAudioFormat` does: `audio/<format>` via an `<audio>` element,
 * with the same two hand-carved exceptions (`alac` on Apple platforms, `webma` as `audio/webm`).
 * `mp2` is deliberately excluded - the legacy function hardcodes `return false` for it ("For now"),
 * so there is no real probe to duplicate. */
function canPlayAudioFormat(
    audioProbe: MediaTypeProbe,
    format: string,
    browser: BrowserSignals
): boolean {
    if (format === 'alac') {
        if (browser.iOS || (browser.osx && browser.safari)) {
            return true;
        }
    }

    const typeString = format === 'webma' ? 'audio/webm' : `audio/${format}`;
    return playable(audioProbe, typeString);
}

function canPlayMkv(
    videoProbe: MediaTypeProbe,
    browser: BrowserSignals
): boolean {
    if (browser.vidaa || browser.firefox) {
        return false;
    }

    if (
        playable(videoProbe, 'video/x-matroska') ||
        playable(videoProbe, 'video/mkv')
    ) {
        return true;
    }

    return !!(browser.edgeChromium && browser.windows);
}

// ---------------------------------------------------------------------------------------------
// DecodeCapabilities
// ---------------------------------------------------------------------------------------------

function videoCodecCapability(codec: string): VideoCodecCapability {
    return { Codec: codec };
}

function audioCodecCapability(codec: string): AudioCodecCapability {
    return { Codec: codec };
}

function decodeProfile(
    type: (typeof MediaKind)[keyof typeof MediaKind],
    containers: string[],
    videoCodecs: string[],
    audioCodecs: string[]
): DecodeProfile {
    return {
        Type: type,
        Containers: containers,
        VideoCodecs: videoCodecs,
        AudioCodecs: audioCodecs
    };
}

/** All the raw yes/no codec probes `buildDecodeCapabilities` derives everything else from -
 * factored out so each of the functions below stays under the linter's cognitive-complexity
 * budget instead of one large function accumulating every branch. */
interface CodecFlags {
    hasH264: boolean;
    hasHevc: boolean;
    hasAv1: boolean;
    hasVp8: boolean;
    hasVp9: boolean;
    hasAc3: boolean;
    hasEac3: boolean;
    hasDts: boolean;
    hasAac: boolean;
    hasMp3: boolean;
    hasOpus: boolean;
    hasFlac: boolean;
    hasAlac: boolean;
}

function detectCodecFlags(resolved: ResolvedInputs): CodecFlags {
    const { videoProbe, audioProbe, browser } = resolved;
    const hasAc3 = supportsAc3(videoProbe, browser);
    return {
        hasH264: canPlayH264(videoProbe),
        hasHevc: canPlayHevc(videoProbe, browser),
        hasAv1: canPlayAv1(videoProbe, browser),
        hasVp8: canPlayVp8(videoProbe),
        hasVp9: canPlayVp9(videoProbe),
        hasAc3,
        // Mirrors browserDeviceProfile.js: EAC3 is only ever declared alongside AC3.
        hasEac3: hasAc3 && supportsEac3(videoProbe, browser),
        hasDts: canPlayDts(videoProbe),
        hasAac: canPlayAudioFormat(audioProbe, 'aac', browser),
        hasMp3: canPlayAudioFormat(audioProbe, 'mp3', browser),
        hasOpus: canPlayAudioFormat(audioProbe, 'opus', browser),
        hasFlac: canPlayAudioFormat(audioProbe, 'flac', browser),
        hasAlac: canPlayAudioFormat(audioProbe, 'alac', browser)
    };
}

// Container-agnostic codec capability - the domain's DecodeCapabilities.VideoCodecs/AudioCodecs
// describe per-codec decode limits regardless of container (see the generated model's own doc
// comment), distinct from the direct-play container combinations built below.
function buildVideoCodecList(flags: CodecFlags): VideoCodecCapability[] {
    const codecs: VideoCodecCapability[] = [];
    if (flags.hasH264) codecs.push(videoCodecCapability('h264'));
    if (flags.hasHevc) codecs.push(videoCodecCapability('hevc'));
    if (flags.hasAv1) codecs.push(videoCodecCapability('av1'));
    if (flags.hasVp8) codecs.push(videoCodecCapability('vp8'));
    if (flags.hasVp9) codecs.push(videoCodecCapability('vp9'));
    return codecs;
}

function buildAudioCodecList(flags: CodecFlags): AudioCodecCapability[] {
    const codecs: AudioCodecCapability[] = [];
    if (flags.hasAac) codecs.push(audioCodecCapability('aac'));
    if (flags.hasMp3) codecs.push(audioCodecCapability('mp3'));
    if (flags.hasAc3) codecs.push(audioCodecCapability('ac3'));
    if (flags.hasEac3) codecs.push(audioCodecCapability('eac3'));
    if (flags.hasDts) codecs.push(audioCodecCapability('dca'));
    if (flags.hasOpus) codecs.push(audioCodecCapability('opus'));
    if (flags.hasFlac) codecs.push(audioCodecCapability('flac'));
    if (flags.hasAlac) codecs.push(audioCodecCapability('alac'));
    return codecs;
}

function buildWebmVideoCodecs(
    flags: CodecFlags,
    browser: BrowserSignals
): string[] {
    const codecs: string[] = [];
    if (flags.hasVp8) codecs.push('vp8');
    if (
        flags.hasVp9 &&
        (!browser.safari ||
            ((browser.versionMajor ?? 0) >= 15 &&
                (browser.versionMajor ?? 0) < 17))
    ) {
        codecs.push('vp9');
    }
    return codecs;
}

function buildMp4VideoCodecs(
    flags: CodecFlags,
    browser: BrowserSignals
): string[] {
    const codecs: string[] = [];
    if (flags.hasH264) codecs.push('h264');
    if (flags.hasHevc) codecs.push('hevc');
    if (flags.hasVp9 && !browser.iOS && !(browser.firefox && browser.osx)) {
        codecs.push('vp9');
    }
    if (flags.hasAv1) codecs.push('av1');
    return codecs;
}

/** Video-container direct-play entries (webm/mp4,m4v/mkv/mov). `videoAudioCodecs` reuses the same
 * flat audio-codec capability set computed by `buildAudioCodecList` rather than
 * browserDeviceProfile.js's separate in-video-element audio probes (a deliberate simplification,
 * see file-level doc comment). */
function buildVideoDirectPlayProfiles(
    flags: CodecFlags,
    resolved: ResolvedInputs,
    videoAudioCodecs: string[]
): DecodeProfile[] {
    const { videoProbe, browser } = resolved;
    const webmVideoCodecs = buildWebmVideoCodecs(flags, browser);
    const mp4VideoCodecs = buildMp4VideoCodecs(flags, browser);
    const profiles: DecodeProfile[] = [];

    if (webmVideoCodecs.length) {
        profiles.push(
            decodeProfile(MediaKind.Video, ['webm'], webmVideoCodecs, [
                'vorbis'
            ])
        );
    }

    if (mp4VideoCodecs.length) {
        profiles.push(
            decodeProfile(
                MediaKind.Video,
                ['mp4', 'm4v'],
                mp4VideoCodecs,
                videoAudioCodecs
            )
        );
    }

    if (canPlayMkv(videoProbe, browser) && mp4VideoCodecs.length) {
        profiles.push(
            decodeProfile(
                MediaKind.Video,
                ['mkv'],
                mp4VideoCodecs,
                videoAudioCodecs
            )
        );
    }

    // `mov`: the one entry in browserDeviceProfile.js's "formats we can't test for" list that
    // actually has a real test (`getDirectPlayProfileForVideoContainer`) - gated on browser
    // family, not a codec probe, and hardcodes `h264` regardless of `canPlayH264()`. Ported as-is.
    if (browser.safari || browser.chrome || browser.edgeChromium) {
        profiles.push(
            decodeProfile(MediaKind.Video, ['mov'], ['h264'], videoAudioCodecs)
        );
    }

    return profiles;
}

const AUDIO_DIRECT_PLAY_FORMATS = [
    'opus',
    'mp3',
    'aac',
    'flac',
    'alac',
    'webma',
    'wma',
    'wav',
    'ogg',
    'oga'
];

function buildAudioDirectPlayProfiles(
    resolved: ResolvedInputs
): DecodeProfile[] {
    const { audioProbe, browser } = resolved;
    const profiles: DecodeProfile[] = [];
    for (const format of AUDIO_DIRECT_PLAY_FORMATS) {
        if (canPlayAudioFormat(audioProbe, format, browser)) {
            // Empty AudioCodecs = wildcard (matches any codec in this container), same semantics
            // as the legacy `{Container: audioFormat, Type: 'Audio'}` entry with no `AudioCodec`.
            profiles.push(decodeProfile(MediaKind.Audio, [format], [], []));
        }
    }
    return profiles;
}

function buildSubtitleDelivery(resolved: ResolvedInputs): SubtitleCapability[] {
    const subtitleDelivery: SubtitleCapability[] = [];
    if (resolved.supportsTextTracks) {
        subtitleDelivery.push({
            Format: 'vtt',
            Method: SubtitleDeliveryMethod.External
        });
    }
    // ass/ssa are rendered client-side independent of native <track> support, so - matching
    // browserDeviceProfile.js's default options (no retry, SSA rendering not disabled) - these are
    // unconditional here rather than gated on supportsTextTracks.
    subtitleDelivery.push({
        Format: 'ass',
        Method: SubtitleDeliveryMethod.External
    });
    subtitleDelivery.push({
        Format: 'ssa',
        Method: SubtitleDeliveryMethod.External
    });
    if (resolved.supportsCanvas2D && resolved.enablePgsSubtitles) {
        subtitleDelivery.push({
            Format: 'pgssub',
            Method: SubtitleDeliveryMethod.External
        });
    }
    return subtitleDelivery;
}

/** Builds the native `DecodeCapabilities` (what this client can read as-is) directly from browser
 * probes - see file-level doc comment for exactly which `browserDeviceProfile.js` behaviors this
 * first pass does and doesn't reproduce. */
export function buildDecodeCapabilities(
    inputs: PlaybackCapabilityInputs = {}
): DecodeCapabilities {
    const resolved = resolveInputs(inputs);
    const flags = detectCodecFlags(resolved);

    const videoCodecs = buildVideoCodecList(flags);
    const audioCodecs = buildAudioCodecList(flags);
    const videoAudioCodecs = audioCodecs.map((c) => c.Codec as string);

    const directPlayProfiles: DecodeProfile[] = [
        ...buildVideoDirectPlayProfiles(flags, resolved, videoAudioCodecs),
        ...buildAudioDirectPlayProfiles(resolved)
    ];

    return {
        DirectPlayProfiles: directPlayProfiles,
        VideoCodecs: videoCodecs,
        AudioCodecs: audioCodecs,
        SubtitleDelivery: buildSubtitleDelivery(resolved),
        SupportsHls: canPlayHls(
            resolved.videoProbe,
            resolved.supportsMediaSourceExtensions
        ),
        // browserDeviceProfile.js never declares DASH support anywhere.
        SupportsDash: false
    };
}

// ---------------------------------------------------------------------------------------------
// PlaybackOutputProfile[] (transcoding targets)
// ---------------------------------------------------------------------------------------------

/** Matches `userSettings.js#preferFmp4HlsContainer`'s default computation (enabled only on
 * platforms known to play fMP4-in-HLS reliably) without the `userSettings`/localStorage
 * dependency this pure module intentionally avoids. */
function prefersFmp4HlsContainer(browser: BrowserSignals): boolean {
    return !!(
        browser.safari ||
        browser.firefox ||
        browser.chrome ||
        browser.edgeChromium
    );
}

function outputProfile(
    type: (typeof MediaKind)[keyof typeof MediaKind],
    protocol: (typeof StreamingProtocol)[keyof typeof StreamingProtocol],
    container: string,
    videoCodecs: string[],
    audioCodecs: string[]
): PlaybackOutputProfile {
    return {
        Type: type,
        Protocol: protocol,
        Container: container,
        VideoCodecs: videoCodecs,
        AudioCodecs: audioCodecs
    };
}

function buildHlsAudioOutputProfile(
    enableFmp4Hls: boolean
): PlaybackOutputProfile {
    return outputProfile(
        MediaKind.Audio,
        StreamingProtocol.Hls,
        enableFmp4Hls ? 'mp4' : 'ts',
        [],
        ['aac']
    );
}

const HTTP_AUDIO_OUTPUT_FORMATS = ['aac', 'mp3', 'opus', 'wav'];

function buildHttpAudioOutputProfiles(
    resolved: ResolvedInputs
): PlaybackOutputProfile[] {
    const { audioProbe, browser } = resolved;
    const profiles: PlaybackOutputProfile[] = [];
    for (const format of HTTP_AUDIO_OUTPUT_FORMATS) {
        if (canPlayAudioFormat(audioProbe, format, browser)) {
            profiles.push(
                outputProfile(
                    MediaKind.Audio,
                    StreamingProtocol.Http,
                    format,
                    [],
                    [format]
                )
            );
        }
    }
    return profiles;
}

/** Same browser-family restrictions browserDeviceProfile.js applies before adding AV1/HEVC to its
 * fmp4-HLS codec list (beyond raw `canPlayType()` decodability) - omitting these would let this
 * builder claim HLS-delivered AV1/HEVC on browser families legacy excludes. */
function isAv1HlsEligible(browser: BrowserSignals): boolean {
    return (
        !!browser.safari ||
        (!browser.mobile &&
            !!(
                browser.edgeChromium ||
                browser.firefox ||
                browser.chrome ||
                browser.opera
            ))
    );
}

function isHevcHlsEligible(browser: BrowserSignals): boolean {
    return (
        !!browser.edgeChromium ||
        !!browser.safari ||
        (!!browser.chrome && !browser.android) ||
        (!!browser.opera && !browser.mobile) ||
        (!!browser.firefox && (browser.versionMajor ?? 0) >= 134)
    );
}

function buildHlsFmp4VideoOutputProfile(
    resolved: ResolvedInputs,
    enableFmp4Hls: boolean
): PlaybackOutputProfile | null {
    const { videoProbe, audioProbe, browser } = resolved;
    const videoCodecs: string[] = [];
    if (canPlayAv1(videoProbe, browser) && isAv1HlsEligible(browser))
        videoCodecs.push('av1');
    if (canPlayHevc(videoProbe, browser) && isHevcHlsEligible(browser))
        videoCodecs.push('hevc');
    if (canPlayH264(videoProbe)) videoCodecs.push('h264');

    const audioCodecs: string[] = [];
    if (canPlayAudioFormat(audioProbe, 'aac', browser)) audioCodecs.push('aac');

    if (!videoCodecs.length || !audioCodecs.length || !enableFmp4Hls) {
        return null;
    }

    return outputProfile(
        MediaKind.Video,
        StreamingProtocol.Hls,
        'mp4',
        videoCodecs,
        audioCodecs
    );
}

function buildHlsTsVideoOutputProfile(
    resolved: ResolvedInputs
): PlaybackOutputProfile | null {
    const { videoProbe, audioProbe, browser } = resolved;
    const videoCodecs: string[] = [];
    if (canPlayH264(videoProbe)) videoCodecs.push('h264');

    const audioCodecs: string[] = [];
    if (canPlayAudioFormat(audioProbe, 'aac', browser)) audioCodecs.push('aac');

    if (!videoCodecs.length || !audioCodecs.length) {
        return null;
    }

    return outputProfile(
        MediaKind.Video,
        StreamingProtocol.Hls,
        'ts',
        videoCodecs,
        audioCodecs
    );
}

function buildHlsVideoOutputProfiles(
    resolved: ResolvedInputs,
    enableFmp4Hls: boolean
): PlaybackOutputProfile[] {
    return [
        buildHlsFmp4VideoOutputProfile(resolved, enableFmp4Hls),
        buildHlsTsVideoOutputProfile(resolved)
    ].filter((profile): profile is PlaybackOutputProfile => profile != null);
}

/** Builds the native `OutputProfiles` (what the server should produce when it must transcode, in
 * preference order) - the `Streaming`-context subset of `browserDeviceProfile.js`'s
 * `TranscodingProfiles`. See file-level doc comment for what's intentionally not ported (the
 * `Static`/offline-sync context, per-profile bitrate/channel caps). */
export function buildOutputProfiles(
    inputs: PlaybackCapabilityInputs = {}
): PlaybackOutputProfile[] {
    const resolved = resolveInputs(inputs);
    const canHls = canPlayHls(
        resolved.videoProbe,
        resolved.supportsMediaSourceExtensions
    );
    const enableFmp4Hls = prefersFmp4HlsContainer(resolved.browser);

    // Matches browserDeviceProfile.js: the Streaming-context HTTP audio transcode targets
    // (aac/mp3/opus/wav) are unconditional, independent of HLS support - only the HLS-delivered
    // audio/video profiles below are gated on `canHls`.
    return [
        ...(canHls ? [buildHlsAudioOutputProfile(enableFmp4Hls)] : []),
        ...buildHttpAudioOutputProfiles(resolved),
        ...(canHls ? buildHlsVideoOutputProfiles(resolved, enableFmp4Hls) : [])
    ];
}

/** Builds the full native `ClientCapabilities` (`Decode` + `OutputProfiles`) - the payload PR116b
 * will eventually send to `POST/PUT Playback/Sessions`. Still not called anywhere in this PR. */
export function buildClientCapabilities(
    inputs: PlaybackCapabilityInputs = {}
): PlaybackClientCapabilities {
    return {
        Decode: buildDecodeCapabilities(inputs),
        OutputProfiles: buildOutputProfiles(inputs)
    };
}

// ---------------------------------------------------------------------------------------------
// PlaybackConstraints - pure request-field mapping, no browser detection involved.
// ---------------------------------------------------------------------------------------------

/** Caller-supplied overrides/preferences for a playback request - the native equivalent of the
 * flat boolean/index fields `playbackmanager.js#getPlaybackInfo()` sends today
 * (`EnableDirectPlay`/`EnableDirectStream`/`AllowVideoStreamCopy`/`AllowAudioStreamCopy`/
 * `MaxStreamingBitrate`/`AudioStreamIndex`/`SubtitleStreamIndex`/
 * `AlwaysBurnInSubtitleWhenTranscoding`, design doc §1.1 point 2). `allowTranscoding` has no direct
 * legacy field - the legacy request always implicitly allows transcoding as the fallback, so this
 * defaults to `true` to preserve that behavior natively. */
export interface PlaybackConstraintsRequest {
    allowDirectPlay?: boolean;
    allowDirectStream?: boolean;
    allowTranscoding?: boolean;
    allowVideoStreamCopy?: boolean;
    allowAudioStreamCopy?: boolean;
    maxBitrate?: number | null;
    maxAudioChannels?: number | null;
    preferredAudioStreamIndex?: number | null;
    preferredSubtitleStreamIndex?: number | null;
    subtitleMode?: (typeof SubtitlePlaybackMode)[keyof typeof SubtitlePlaybackMode];
    preferredSubtitleLanguages?: string[];
    alwaysBurnInSubtitleWhenTranscoding?: boolean;
    startTimeTicks?: number;
}

/** Builds the native `PlaybackConstraints` from a caller's request - independent of browser
 * detection (unlike `buildDecodeCapabilities`/`buildOutputProfiles`, this has nothing to probe). */
export function buildPlaybackConstraints(
    request: PlaybackConstraintsRequest = {}
): PlaybackConstraints {
    return {
        AllowDirectPlay: request.allowDirectPlay ?? true,
        AllowDirectStream: request.allowDirectStream ?? true,
        AllowTranscoding: request.allowTranscoding ?? true,
        AllowVideoStreamCopy: request.allowVideoStreamCopy ?? true,
        AllowAudioStreamCopy: request.allowAudioStreamCopy ?? true,
        MaxBitrate: request.maxBitrate ?? null,
        MaxAudioChannels: request.maxAudioChannels ?? null,
        PreferredAudioStreamIndex: request.preferredAudioStreamIndex ?? null,
        PreferredSubtitleStreamIndex:
            request.preferredSubtitleStreamIndex ?? null,
        SubtitleMode: request.subtitleMode ?? SubtitlePlaybackMode.Default,
        PreferredSubtitleLanguages: request.preferredSubtitleLanguages ?? [],
        AlwaysBurnInSubtitleWhenTranscoding:
            request.alwaysBurnInSubtitleWhenTranscoding ?? false,
        StartTimeTicks: request.startTimeTicks ?? 0
    };
}

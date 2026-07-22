import type {
    PlaybackDecisionAudioCodecCapability,
    PlaybackDecisionClientCapabilities,
    PlaybackDecisionDecodeProfile,
    PlaybackDecisionPlaybackOutputProfile,
    PlaybackDecisionSubtitleCapability,
    PlaybackDecisionVideoCodecCapability
} from 'lib/tesserafin-sdk';

/**
 * Set comparison for one capability category (video codecs, audio codecs, ...) between a native
 * declaration and a server-reconstructed one (docs/pr116-client-migration-design.md §1.3.1,
 * PR116c). `onlyInReconstructed` is the interesting side in the common case: something the server
 * derived from a `DeviceProfile` that the native builder (PR116a) doesn't declare would mean the
 * DLNA mapping is *adding* capability the client never actually claimed - normally the reverse
 * (native as a strict subset) is expected, per PR116a's own exit criteria.
 */
export interface CapabilitySetDiff {
    /** Declared natively but absent from the server-reconstructed reading. */
    onlyInNative: string[];
    /** Present in the server-reconstructed reading but not declared natively. */
    onlyInReconstructed: string[];
    /** Declared on both sides. */
    inBoth: string[];
}

/** Comparison for a single boolean capability flag (`SupportsHls`/`SupportsDash`). */
export interface CapabilityFlagDiff {
    native: boolean;
    reconstructed: boolean;
    matches: boolean;
}

/** Per-category comparison of two `ClientCapabilities`-shaped payloads - see
 * `compareClientCapabilities()` for what the two sides mean. */
export interface ClientCapabilitiesComparison {
    videoCodecs: CapabilitySetDiff;
    audioCodecs: CapabilitySetDiff;
    subtitleFormats: CapabilitySetDiff;
    directPlayContainers: CapabilitySetDiff;
    outputContainers: CapabilitySetDiff;
    supportsHls: CapabilityFlagDiff;
    supportsDash: CapabilityFlagDiff;
}

const diffSets = (
    native: string[],
    reconstructed: string[]
): CapabilitySetDiff => {
    const nativeSet = new Set(native);
    const reconstructedSet = new Set(reconstructed);
    return {
        onlyInNative: [...nativeSet]
            .filter((value) => !reconstructedSet.has(value))
            .sort(),
        onlyInReconstructed: [...reconstructedSet]
            .filter((value) => !nativeSet.has(value))
            .sort(),
        inBoth: [...nativeSet]
            .filter((value) => reconstructedSet.has(value))
            .sort()
    };
};

const diffFlag = (
    native: boolean,
    reconstructed: boolean
): CapabilityFlagDiff => ({
    native,
    reconstructed,
    matches: native === reconstructed
});

const videoCodecNames = (
    codecs: PlaybackDecisionVideoCodecCapability[] | undefined
): string[] =>
    (codecs ?? [])
        .map((codec) => codec.Codec)
        .filter((codec): codec is string => !!codec);

const audioCodecNames = (
    codecs: PlaybackDecisionAudioCodecCapability[] | undefined
): string[] =>
    (codecs ?? [])
        .map((codec) => codec.Codec)
        .filter((codec): codec is string => !!codec);

const subtitleFormatNames = (
    subtitles: PlaybackDecisionSubtitleCapability[] | undefined
): string[] =>
    (subtitles ?? [])
        .map((subtitle) => subtitle.Format)
        .filter((format): format is string => !!format);

const directPlayContainerNames = (
    profiles: PlaybackDecisionDecodeProfile[] | undefined
): string[] => (profiles ?? []).flatMap((profile) => profile.Containers ?? []);

const outputContainerNames = (
    profiles: PlaybackDecisionPlaybackOutputProfile[] | undefined
): string[] =>
    (profiles ?? [])
        .map((profile) => profile.Container)
        .filter((container): container is string => !!container);

/**
 * Compares a native `ClientCapabilities` declaration (`tesserafinPlaybackCapabilities.ts`'s
 * `buildClientCapabilities()`, built directly from browser probes) against a server-reconstructed
 * one (`PlaybackDiagnosticDetail.Capabilities` - for a legacy `PlaybackInfo`-originated session,
 * this is what `ClientCapabilitiesMapper`/`DlnaPlaybackAdapter` derived from the client's real
 * `DeviceProfile`; see `docs/pr116-client-migration-design.md` §1.2.A/§1.3.1). Pure and independent
 * of which specific session/browser either side came from - the caller decides that; this function
 * only diffs the two shapes it's given.
 *
 * Both parameters use the generated type rather than the feature's local `DeepRequired` alias:
 * `buildClientCapabilities()` returns the generated shape directly, and
 * `PlaybackDiagnosticDetail.Capabilities` is nullable independent of the rest of that DTO - the
 * caller is expected to null-guard the reconstructed side before calling this, not this function.
 *
 * Since reefin#51 the generated type declares `Decode`, `OutputProfiles` and the members below
 * them as required, so the `?.`/`?? []` guards here are no longer needed to satisfy the *compiler*.
 * They are kept deliberately: `required` describes what a conforming server sends, and this
 * function consumes data that arrived over the wire - an older server, a truncated payload or an
 * intermediary can still deliver a partial shape, and a diagnostics view is the last place that
 * should throw when it does. See the two "deliberately contract-violating input" cases in the
 * accompanying test file.
 */
export function compareClientCapabilities(
    native: PlaybackDecisionClientCapabilities,
    reconstructed: PlaybackDecisionClientCapabilities
): ClientCapabilitiesComparison {
    return {
        videoCodecs: diffSets(
            videoCodecNames(native.Decode?.VideoCodecs),
            videoCodecNames(reconstructed.Decode?.VideoCodecs)
        ),
        audioCodecs: diffSets(
            audioCodecNames(native.Decode?.AudioCodecs),
            audioCodecNames(reconstructed.Decode?.AudioCodecs)
        ),
        subtitleFormats: diffSets(
            subtitleFormatNames(native.Decode?.SubtitleDelivery),
            subtitleFormatNames(reconstructed.Decode?.SubtitleDelivery)
        ),
        directPlayContainers: diffSets(
            directPlayContainerNames(native.Decode?.DirectPlayProfiles),
            directPlayContainerNames(reconstructed.Decode?.DirectPlayProfiles)
        ),
        outputContainers: diffSets(
            outputContainerNames(native.OutputProfiles),
            outputContainerNames(reconstructed.OutputProfiles)
        ),
        supportsHls: diffFlag(
            !!native.Decode?.SupportsHls,
            !!reconstructed.Decode?.SupportsHls
        ),
        supportsDash: diffFlag(
            !!native.Decode?.SupportsDash,
            !!reconstructed.Decode?.SupportsDash
        )
    };
}

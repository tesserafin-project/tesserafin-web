/**
 * Derives `VideoCodecCapability.Profiles` from REAL `HTMLMediaElement.canPlayType` probes
 * (issue #29, the `Profiles` half - the `VideoRangeTypes` half is deliberately NOT touched here).
 *
 * WHY THIS FILE HAS NO IMPORTS. It is consumed by three very different runtimes: the app bundle
 * (through `tesserafinPlaybackCapabilities.ts`), vitest (jsdom, pure mapping tests), and a Playwright
 * spec that imports it straight from `tests/e2e/` to run the table's MIME strings through a REAL
 * Chromium. Keeping it dependency-free (no `lib/tesserafin-sdk` path alias, no `./browser`) is what
 * makes that third consumer possible without a second bundling step.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT `Profiles` MEANS ON THE SERVER, AND WHY THE SPELLING IS NOT NEGOTIABLE
 * ---------------------------------------------------------------------------------------------
 * `Reefin.Playback.Engine/PlaybackEngine.cs:190` is the entire consumer:
 *
 *     if (videoCap.Profiles.Count > 0 &&
 *         (selectedVideo.Profile is null ||
 *          !videoCap.Profiles.Contains(selectedVideo.Profile, StringComparer.OrdinalIgnoreCase)))
 *         -> VideoProfileNotSupported, transcode.
 *
 * Three consequences that shape every decision below:
 *
 *  1. IT IS AN ALLOW-LIST WITH AN "EMPTY MEANS UNRESTRICTED" ESCAPE. `Profiles: []` disables the
 *     check outright; a NON-empty list makes the server transcode anything not named in it. So
 *     emitting profiles is a RESTRICTION, not an enrichment: this change can only ever move
 *     DirectPlay decisions from "allowed" to "transcoded", never the reverse. It is still the right
 *     change - today's `[]` silently lets the server DirectPlay a High 4:4:4 stream into a browser
 *     that cannot decode it - but nobody should expect a DirectPlay *increase* from it.
 *
 *  2. THE COMPARISON IS RAW STRING EQUALITY (case-insensitive), against `MediaStream.Profile`, which
 *     is ffprobe's profile name. There is no normalization, no alias table, no enum on the server -
 *     grep for `ProfileConditionValue.VideoProfile` in `/home/alex/Repos/reefin`: the only producers
 *     are `ClientCapabilitiesMapper.cs:209` (parse) and `ReverseClientCapabilitiesMapper.cs:168`
 *     (join). A misspelt profile is not rejected, it simply never matches, and the stream transcodes
 *     forever with no error anywhere.
 *
 *  3. THEREFORE THE TABLE BELOW IS CLOSED, and every spelling in it is one already proven end-to-end
 *     through the LEGACY DLNA path: `browserDeviceProfile.js` builds `CodecProfiles` conditions with
 *     exactly these strings (`'high|main|baseline|constrained baseline'` +`'|high 10'` at :1133/:1161,
 *     `'main'`/`'main 10'` at :1165/:1189, `'main'` for AV1 at :1232), and
 *     `Reefin.Playback.Dlna/ClientCapabilitiesMapper.cs:184-211` parses those very tokens into the
 *     very same `VideoCodecCapability.Profiles` field this module now fills natively. Same field,
 *     same comparison, same strings - that is the cross-check. Inventing a spelling the legacy path
 *     never sent would be an untested guess, and per point 2 an invisible one.
 *
 * ---------------------------------------------------------------------------------------------
 * THE EVIDENCE RULE
 * ---------------------------------------------------------------------------------------------
 * A profile is emitted ONLY when one of its own exact MIME strings answers `'probably'`.
 *
 *  - A GENERIC PROBE PROVES NOTHING SPECIFIC. `canPlayType('video/mp4; codecs="avc1.42E01E"')`
 *    proves Constrained Baseline and Constrained Baseline only. `tesserafinPlaybackCapabilities.ts`
 *    uses that same string as its "can this browser do H.264 at all" gate; it is NOT evidence for
 *    `high`, and the two uses are kept textually separate here for that reason.
 *
 *  - `'maybe'` IS INCONCLUSIVE AND IS NEVER ACCEPTED. There is no documented exception in this
 *    table; if one is ever added it must name the exact MIME string and the reason, inline.
 *    This is not a theoretical stance - measured on Playwright Chromium 149.0.7827.55,
 *    `video/mp4; codecs="avc1.F4001E"` (High 4:4:4 Predictive) answers `'maybe'` while every
 *    genuinely decodable H.264 profile answers `'probably'`. Chromium cannot decode 4:4:4 H.264.
 *    Accepting `'maybe'` would claim it, and per consequence 1 the server would then DirectPlay a
 *    stream that fails at the user. `'maybe'` on a fully-qualified codec string means "I did not
 *    recognize this well enough to say", which is exactly "unknown".
 *
 *  - NO EVIDENCE YIELDS `[]`, WHICH IS "NO RESTRICTION EXPRESSED", NOT "NO PROFILE SUPPORTED".
 *    That distinction is the whole point of issue #29 §3. A browser whose probes are all `'maybe'`
 *    (or a codec absent from the table, like VP8/VP9) lands on exactly today's conservative
 *    behavior - the server keeps full latitude - rather than on a false negative claim.
 *
 * Order is the table's order (weakest profile first) and every profile appears at most once, so the
 * emitted list is deterministic and deduplicated regardless of probe answers or MIME-alias overlap.
 */

/** The three values `HTMLMediaElement.canPlayType` is specified to return. Modelled as a plain
 * `string` at the call boundary because that is what the DOM lib declares. */
export type CanPlayType = (type: string) => string;

export interface ProfileProbeSpec {
    /** The canonical profile name as the server compares it - see the file doc's point 3. */
    readonly profile: string;
    /** Exact `codecs=`-bearing MIME strings. ANY of them answering `'probably'` proves `profile`;
     * several are listed only where the same profile has genuinely interchangeable spellings
     * (`hvc1`/`hev1`, or a second level for browsers that gate on level rather than profile). */
    readonly mimeTypes: readonly string[];
}

/**
 * THE CLOSED TABLE. codec -> ordered profile specs. A codec absent from this table (vp8, vp9, and
 * everything else) always yields `[]`: neither `browserDeviceProfile.js` nor the DLNA mapper has
 * ever sent a profile token for them, so no spelling of theirs is cross-checked against the server.
 * VP9's ffprobe profile names in particular (`"Profile 0"` .. `"Profile 3"`) have never crossed this
 * wire, and guessing them would be exactly the invisible mismatch of the file doc's point 2.
 */
export const VIDEO_CODEC_PROFILE_PROBES: Readonly<
    Record<string, readonly ProfileProbeSpec[]>
> = {
    // avc1.PPCCLL - PP = profile_idc, CC = constraint flags, LL = level_idc. Level is pinned low
    // (0x1E = 3.0) wherever possible so a positive answer is about the PROFILE, not the level;
    // MaxLevel is a separate field this module does not touch.
    h264: [
        {
            // profile_idc 66 + constraint_set1 -> Constrained Baseline.
            profile: 'constrained baseline',
            mimeTypes: ['video/mp4; codecs="avc1.42E01E"']
        },
        {
            // profile_idc 66, no constraint flags -> plain Baseline.
            profile: 'baseline',
            mimeTypes: ['video/mp4; codecs="avc1.42001E"']
        },
        {
            // profile_idc 77 -> Main.
            profile: 'main',
            mimeTypes: [
                'video/mp4; codecs="avc1.4D401E"',
                'video/mp4; codecs="avc1.4D001E"'
            ]
        },
        {
            // profile_idc 100 -> High. Both levels 3.0 and 4.0 listed: some browsers answer on the
            // (profile, level) pair rather than the profile alone.
            profile: 'high',
            mimeTypes: [
                'video/mp4; codecs="avc1.64001E"',
                'video/mp4; codecs="avc1.640028"'
            ]
        },
        {
            // profile_idc 110 -> High 10. `avc1.6E0033` is the exact string
            // browserDeviceProfile.js:1153 already probes; the level-3.0 variant is added so a
            // browser that decodes High 10 only below level 5.1 is still detected.
            profile: 'high 10',
            mimeTypes: [
                'video/mp4; codecs="avc1.6E001E"',
                'video/mp4; codecs="avc1.6E0033"'
            ]
        }
    ],
    // hvc1/hev1.PROFILE.COMPAT.LEVEL - PROFILE 1 = Main, 2 = Main 10. Both the four-field short form
    // used by browserDeviceProfile.js:1170 and the fully-qualified form are listed; they name the
    // same profile, and the dedup below guarantees one entry out regardless of how many hit.
    hevc: [
        {
            profile: 'main',
            mimeTypes: [
                'video/mp4; codecs="hvc1.1.4.L123"',
                'video/mp4; codecs="hev1.1.4.L123"',
                'video/mp4; codecs="hvc1.1.6.L93.B0"',
                'video/mp4; codecs="hev1.1.6.L93.B0"'
            ]
        },
        {
            profile: 'main 10',
            mimeTypes: [
                'video/mp4; codecs="hvc1.2.4.L123"',
                'video/mp4; codecs="hev1.2.4.L123"',
                'video/mp4; codecs="hvc1.2.4.L120.B0"',
                'video/mp4; codecs="hev1.2.4.L120.B0"'
            ]
        }
    ],
    // av01.SEQPROFILE.LEVELTIER.DEPTH - seq_profile 0 = Main (4:2:0, 8 and 10 bit), which is the
    // only AV1 profile browserDeviceProfile.js:1232 has ever declared, hence the only cross-checked
    // spelling. Measured on Playwright Chromium 149, `av01.1.05M.08` (High) and `av01.2.05M.10`
    // (Professional) BOTH answer `'probably'` - they are deliberately left out anyway, because the
    // evidence rule governs whether a row fires, not whether a row exists: an uncross-checked
    // spelling that never matches on the server is worse than an unexpressed restriction.
    av1: [
        {
            profile: 'main',
            mimeTypes: [
                'video/mp4; codecs="av01.0.05M.08"',
                'video/mp4; codecs="av01.0.15M.08"'
            ]
        }
    ]
};

/** The browser-family signals the vetoes below read. Structurally a subset of
 * `tesserafinPlaybackCapabilities.ts`'s `BrowserSignals`, redeclared to keep this module import-free. */
export interface ProfileBrowserSignals {
    safari?: boolean;
    iOS?: boolean;
    edge?: boolean;
    mobile?: boolean;
}

/**
 * The ONE documented case where a `'probably'` answer is knowingly not believed.
 *
 * `browserDeviceProfile.js:1151-1162` adds `high 10` to its H.264 profile list only when
 * `avc1.6e0033` probes positive AND the browser is not Safari/iOS/Edge/mobile, with the comment
 * "These tests are passing in safari, but playback is failing". That is a field-observed false
 * positive in the probe itself, and per the file doc's consequence 1 believing it would have the
 * server hand a High 10 stream to a decoder that stalls - the exact user-visible failure issue #29
 * warns against. Ported verbatim rather than reinvented, so the native and legacy paths agree.
 *
 * Nothing else is vetoed: this is a list of known-bad probes, not a place to encode preferences.
 */
function isVetoed(
    codec: string,
    profile: string,
    browser: ProfileBrowserSignals
): boolean {
    if (codec === 'h264' && profile === 'high 10') {
        return !!(
            browser.safari ||
            browser.iOS ||
            browser.edge ||
            browser.mobile
        );
    }
    return false;
}

/**
 * Derives the profile allow-list for one codec from real probes.
 *
 * @param codec normalized codec name (`'h264'`, `'hevc'`, `'av1'`, ...). Unknown codecs yield `[]`.
 * @param canPlayType the REAL `HTMLMediaElement.canPlayType`, bound to a media element by the
 *   caller. Injectable so the pure mapping is testable without a DOM, never so it can be faked in
 *   production.
 * @param browser browser-family signals, read only by the documented veto above.
 * @returns the supported profiles, deduplicated, in table order. `[]` means "no restriction
 *   expressed" - see the file doc. NEVER read it as "no profile supported".
 */
export function deriveCodecProfiles(
    codec: string,
    canPlayType: CanPlayType,
    browser: ProfileBrowserSignals = {}
): string[] {
    const specs = VIDEO_CODEC_PROFILE_PROBES[codec];
    if (!specs) {
        return [];
    }

    const emitted = new Set<string>();
    const profiles: string[] = [];

    for (const spec of specs) {
        if (
            emitted.has(spec.profile) ||
            isVetoed(codec, spec.profile, browser)
        ) {
            continue;
        }
        // `=== 'probably'` and nothing else: `'maybe'` and `''` are both "no evidence".
        const proven = spec.mimeTypes.some(
            (mimeType) => canPlayType(mimeType) === 'probably'
        );
        if (proven) {
            emitted.add(spec.profile);
            profiles.push(spec.profile);
        }
    }

    return profiles;
}

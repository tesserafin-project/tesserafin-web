/**
 * HDR capability probe - DORMANT FOUNDATION for issue #29, `VideoRangeTypes` half.
 *
 * ## What this file is, and what it deliberately is NOT
 *
 * It is a pure, dependency-injected description of *how* a browser's HDR support could be
 * measured. It is NOT wired into anything: nothing in `src/` imports it, it does not read a
 * single global, and it does not emit or influence `VideoRangeTypes` anywhere.
 * `tesserafinPlaybackCapabilities.ts` keeps returning the conservative `['SDR']` constant, and issue
 * #29 stays open. Only a *conjunction positive* observed on identified real HDR hardware may ever
 * justify changing that, and that change is not this change.
 *
 * Because nothing imports it, this module is proven absent from every emitted bundle - see
 * `docs/tesserafin/bench-hdr/hdr-detection-feasibility.md` for the build-and-grep evidence.
 *
 * ## The rule the design is held to: HDR10 is a CONJUNCTION
 *
 * Two independent facts, both required, neither sufficient:
 *
 * - DECODE - can this browser decode the exact codec + profile + transfer function + colour
 *   space? Measured with `navigator.mediaCapabilities.decodingInfo()`.
 * - DISPLAY - can the display chain actually *render* high dynamic range? Measured with
 *   `matchMedia('(dynamic-range: high)')`.
 *
 * A browser that decodes PQ/BT.2020 into a 6-bit SDR laptop panel supports neither more nor less
 * than SDR *as far as the user is concerned*, so claiming HDR10 off the decode half alone would
 * produce exactly the failure issue #29 warns about: the server plans a DirectPlay the client
 * cannot honour, and the breakage lands on the user rather than in CI.
 *
 * ## Four outcomes, never collapsed into three
 *
 * `positive` / `negative` / `absent` / `unknown` are distinct on purpose. `negative` is a
 * *measurement* ("asked, and this machine said no"). `absent` means the browser does not
 * implement the feature - nothing was measured. `unknown` means the API answered but the answer
 * does not discriminate the property, so it is not evidence in either direction. Folding
 * `absent`/`unknown` into `negative` would be a quiet lie about how much is known; folding either
 * into `positive` would be the dangerous over-claim. Only `positive` may ever support a claim.
 *
 * ## Two techniques, both forced by measured Blink behaviour
 *
 * 1. SEMANTIC PARTITION (display). The tempting way to detect an unimplemented media feature is
 *    the syntactic round-trip - an unknown feature is *supposed* to serialise back as `not all`.
 *    Measured on Chromium 149: it does not. `matchMedia('(totally-bogus-feature: high)').media`
 *    round-trips verbatim, so that signal carries no information and any probe relying on it
 *    silently reports ABSENT as NEGATIVE. What does work is asking an enumerated feature for
 *    *both* of its values: an implemented feature must match exactly one. `high` xor `standard`
 *    -> implemented, answer trusted. Neither -> the feature is not implemented -> `absent`. Both
 *    -> incoherent, so `unknown`. This is why the display probe needs two queries, not one.
 *
 * 2. TWIN CONFIGURATIONS (decode). A lone `decodingInfo({...HDR fields})` returning `supported`
 *    does not prove the HDR fields were honoured - an engine that ignored them entirely would
 *    answer the same way. So the HDR config is always paired with an otherwise byte-identical SDR
 *    twin differing ONLY in `transferFunction`/`colorGamut`/`hdrMetadataType`. If the twins answer
 *    differently, the fields are load-bearing and an HDR `supported` is a real signal. If they
 *    answer identically the API is not discriminating on this platform, which is `unknown` - not
 *    a decode win, and not a decode loss either.
 *
 * ## No inference beyond HDR10
 *
 * `hdrMetadataType: 'smpteSt2086'` (HDR10 static metadata) is measurably narrower than
 * `smpteSt2094-40` (HDR10+) and `smpteSt2094-10`: on Chromium 149 the first passes where the
 * other two are refused, on identical codec strings. HDR10+, HLG and Dolby Vision therefore have
 * no derivable relationship to an HDR10 positive and this module never infers them. It reports
 * HDR10 or it reports nothing.
 */

/** Outcome of a single measurement. See the file header - these four are not interchangeable and
 * in particular `absent`/`unknown` must never be read as `negative`. */
export type HdrProbeOutcome = 'positive' | 'negative' | 'absent' | 'unknown';

/** The `matchMedia` surface, injected rather than read off `window`. Injection is what makes the
 * four outcomes unit-testable at all: a real browser cannot be asked to pretend a media feature is
 * unimplemented, and jsdom implements neither `matchMedia` nor `mediaCapabilities`. */
export type MediaQueryProbe = (query: string) => { matches: boolean };

/** The subset of `VideoConfiguration` this module varies. Deliberately structural rather than
 * imported from `lib.dom`, so the twin construction below is explicit about which members are the
 * HDR members. */
export interface HdrVideoConfiguration {
    contentType: string;
    width: number;
    height: number;
    bitrate: number;
    framerate: number;
    transferFunction?: string;
    colorGamut?: string;
    hdrMetadataType?: string;
}

export interface DecodingInfoQuery {
    type: 'file' | 'media-source';
    video: HdrVideoConfiguration;
}

export interface DecodingInfoAnswer {
    supported: boolean;
}

/** The `navigator.mediaCapabilities.decodingInfo` surface, injected. May reject - a bogus
 * `transferFunction` makes Chromium throw `TypeError` rather than answer `supported: false`, which
 * is a rejection to absorb, never a negative to report. */
export type DecodingInfoProbe = (
    query: DecodingInfoQuery
) => Promise<DecodingInfoAnswer>;

/** Everything the probe is allowed to touch. There is no fallback to globals on purpose: a caller
 * that has no probe surface must say so by passing `undefined`, which yields `absent` - it must not
 * accidentally get a `negative` from a missing API. */
export interface HdrProbeDependencies {
    matchMedia?: MediaQueryProbe;
    decodingInfo?: DecodingInfoProbe;
}

/** The HDR members of a `VideoConfiguration` for HDR10: PQ transfer, BT.2020 primaries, SMPTE
 * ST 2086 static metadata. Note `smpteSt2086` specifically - see the file header on why this must
 * not be extrapolated to HDR10+ (`smpteSt2094-40`) or Dolby Vision (`smpteSt2094-10`). */
const HDR10_FIELDS = {
    transferFunction: 'pq',
    colorGamut: 'rec2020',
    hdrMetadataType: 'smpteSt2086'
} as const;

/** The SDR twin's HDR members. `hdrMetadataType` is *removed*, not set to some SDR value, because
 * there is no SDR metadata type; the twin must be the same request minus the HDR claim. */
const SDR_TWIN_FIELDS = {
    transferFunction: 'srgb',
    colorGamut: 'srgb'
} as const;

/**
 * Display half, by semantic partition (technique 1 in the file header).
 *
 * Asks the enumerated `dynamic-range` feature for *both* of its values and reads the pair:
 * exactly one match means the feature is implemented and its answer is a measurement; no match
 * means it is not implemented (`absent`); both matching is incoherent (`unknown`).
 *
 * `video-dynamic-range` is deliberately not consulted: on Chromium 149 it matches neither `high`
 * nor `standard`, i.e. it is unimplemented, so feeding it into a decision could only manufacture a
 * false negative.
 */
export function probeHdrDisplay(deps: HdrProbeDependencies): HdrProbeOutcome {
    const { matchMedia } = deps;
    if (!matchMedia) {
        return 'absent';
    }

    let high: boolean;
    let standard: boolean;
    try {
        high = matchMedia('(dynamic-range: high)').matches;
        standard = matchMedia('(dynamic-range: standard)').matches;
    } catch {
        // A throwing `matchMedia` measured nothing. Not a negative.
        return 'unknown';
    }

    if (high && !standard) {
        return 'positive';
    }
    if (!high && standard) {
        return 'negative';
    }
    if (!high && !standard) {
        // Matches neither value of an enumerated feature -> the engine does not implement it.
        return 'absent';
    }
    // Matches both -> the partition is broken, so the answer discriminates nothing.
    return 'unknown';
}

function withFields(
    base: HdrVideoConfiguration,
    fields: {
        transferFunction: string;
        colorGamut: string;
        hdrMetadataType?: string;
    }
): HdrVideoConfiguration {
    const next: HdrVideoConfiguration = {
        ...base,
        transferFunction: fields.transferFunction,
        colorGamut: fields.colorGamut
    };
    if (fields.hdrMetadataType === undefined) {
        delete next.hdrMetadataType;
    } else {
        next.hdrMetadataType = fields.hdrMetadataType;
    }
    return next;
}

/**
 * Decode half, by twin configurations (technique 2 in the file header).
 *
 * Issues two `decodingInfo` calls that differ only in the HDR members of `VideoConfiguration`.
 * The SDR twin is not there to be reported - it is the control that proves the engine actually
 * read the HDR fields. Identical answers mean the fields were not discriminating, so nothing was
 * learned: `unknown`.
 */
export async function probeHdr10Decode(
    deps: HdrProbeDependencies,
    base: HdrVideoConfiguration,
    type: 'file' | 'media-source' = 'file'
): Promise<HdrProbeOutcome> {
    const { decodingInfo } = deps;
    if (!decodingInfo) {
        return 'absent';
    }

    let hdr: DecodingInfoAnswer;
    let sdrTwin: DecodingInfoAnswer;
    try {
        hdr = await decodingInfo({
            type,
            video: withFields(base, HDR10_FIELDS)
        });
        sdrTwin = await decodingInfo({
            type,
            video: withFields(base, SDR_TWIN_FIELDS)
        });
    } catch {
        // Chromium throws `TypeError` on an unparseable enum member. A rejection is an
        // instrument failure, so it is `unknown` - never a capability negative.
        return 'unknown';
    }

    if (hdr.supported === sdrTwin.supported) {
        // The HDR members changed nothing, so this API is not discriminating them here. An
        // apparent HDR `supported` in this state would be indistinguishable from the engine
        // ignoring the fields, and must not be counted as a decode win.
        return 'unknown';
    }

    return hdr.supported ? 'positive' : 'negative';
}

export interface Hdr10Conjunction {
    display: HdrProbeOutcome;
    decode: HdrProbeOutcome;
    /** True only when BOTH halves are `positive`. Any other combination - including
     * `positive` + `unknown` - yields false, meaning "no claim", which is not the same as
     * "HDR10 is unsupported". */
    hdr10Claimable: boolean;
}

/**
 * The conjunction, written so it is hard to misuse: there is exactly one way to reach
 * `hdr10Claimable: true`, and it requires two independent positives. Both raw outcomes are
 * returned alongside so a caller can tell "measured no" from "did not measure", which a bare
 * boolean would destroy.
 *
 * This function returns evidence. It does not build `VideoRangeTypes`, and no caller in `src/`
 * invokes it today.
 */
export function concludeHdr10(
    display: HdrProbeOutcome,
    decode: HdrProbeOutcome
): Hdr10Conjunction {
    return {
        display,
        decode,
        hdr10Claimable: display === 'positive' && decode === 'positive'
    };
}

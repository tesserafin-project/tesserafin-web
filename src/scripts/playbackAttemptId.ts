/**
 * Client half of `reefin` issue #43 (server half: `reefin` PR #47, which added an optional,
 * opaque, client-generated `PlaybackAttemptId` to six serialized playback types). This module owns
 * the value's whole lifecycle on the client: minting one id per playback ATTEMPT and handing that
 * same id to every request that belongs to the attempt.
 *
 * What an "attempt" is (the only definition that matters here): one user-initiated playback start,
 * i.e. one `playbackmanager.js#playInternal()` invocation. Everything that follows from it -
 * the `PlaybackInfo` POST, the v2 `POST Playback/Sessions`, and every transcoding retry
 * (`changeStream()`, which re-enters `getPlaybackInfo()` but deliberately never re-enters
 * `playInternal()`) - is the SAME attempt and therefore carries the SAME id. Starting the next
 * item, or the user pressing play again, is a NEW attempt and mints a NEW id. That asymmetry is
 * the entire point: it is what lets the server stitch a retry chain back to the one user action
 * that caused it.
 *
 * Diagnostics ONLY, and this is load-bearing rather than a nicety: the value is never an
 * authorization key, the server imposes no structure on it, and NO client behavior may branch on
 * it. Nothing in this module returns a decision - it returns a string or nothing, and every call
 * site does exactly one thing with it (attach it to an outbound payload). A missing id must always
 * be as valid as a present one, which is why every emit path here degrades to "omit the field"
 * rather than to an error or a placeholder.
 *
 * Deliberately zero imports - same constraint `playbackExecutionDecision.ts` documents for itself.
 * `playbackmanager.js` imports this module statically, so anything it pulled in would land in the
 * main chunk; keeping it dependency-free (`crypto` only, a platform global) keeps it off the
 * bundle budget and keeps the `lib/tesserafin-sdk` scope behind the existing lazy `playback-v2-url`
 * boundary where PR #21 put it.
 *
 * NO module-level current attempt, and this is the correctness core of the module. An earlier
 * revision kept the live id in a module global on the theory that "only one attempt is ever in its
 * starting phase at a time". That theory is false: `playInternal()` is invoked fire-and-forget from
 * `nextTrack()`, `previousTrack()` and `setCurrentPlaylistItem()`, with no await and no lock, so a
 * double-click on Play or an autoplay landing mid-start gives two overlapping `playInternal()`
 * calls. The second one's mint would overwrite the global while the first one's `getPlaybackInfo()`
 * was still awaiting - and attempt A would then stamp attempt B's id onto its own `PlaybackInfo`
 * and its own v2 `POST`, silently fusing two attempts in the server's diagnostics. Exactly the
 * correlation this feature exists to provide.
 *
 * So the id is a VALUE, threaded explicitly: minted in `playInternal()`, passed down the start path
 * as a parameter, and parked on the per-player state (`getPlayerData(player)`) so the retry path can
 * recover the right attempt. Two overlapping attempts therefore hold two distinct values and cannot
 * observe each other's.
 *
 * Why per-player state and not `streamInfo`: `changeStream()`'s transcoding retry does not re-enter
 * `playInternal()` - it is driven by a player error event, so it has no lexical access to the
 * minting call frame and must recover the id from somewhere. `changeStream()` REPLACES
 * `playerData.streamInfo` wholesale, so stashing the id there would lose it on exactly the retry
 * being correlated; `playerData` itself survives, which is why it is the home.
 */

/** Injectable seam for tests - production callers use the default. */
export interface PlaybackAttemptIdDeps {
    /** Defaults to {@link generatePlaybackAttemptId}. */
    generate?: () => string;
}

/**
 * Mints an opaque attempt id. `crypto.randomUUID()` is the intended source and is available in
 * every browser this app supports plus every secure context.
 *
 * Documented fallback, for the two cases where `randomUUID` is genuinely absent - a non-secure
 * context (plain `http://` on a non-localhost host, which some self-hosted deployments still use)
 * and older embedded webviews: a timestamp plus two blocks of `Math.random()` entropy. This is NOT
 * cryptographically strong and deliberately does not pretend to be - it does not need to be,
 * because the value authorizes nothing. It only needs to be unique enough that two attempts from
 * the same client are very unlikely to collide in a diagnostics log, and printable/non-blank so
 * the server's length-and-printability validation accepts it.
 */
export function generatePlaybackAttemptId(): string {
    if (
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
    ) {
        return crypto.randomUUID();
    }

    const entropy = () => Math.random().toString(36).slice(2, 10);

    return `pa-${Date.now().toString(36)}-${entropy()}${entropy()}`;
}

/**
 * Normalizes any candidate id to something that is safe to send, or to `undefined`.
 *
 * The server validates printability and length and rejects empty/whitespace with a `400`, while
 * treating an absent field as perfectly valid. So a blank value is strictly worse than no value,
 * and this function is the single place that collapses "blank" into "absent". Every emit path goes
 * through it, which is what makes it impossible for an empty string to reach the wire.
 */
export function sanitizePlaybackAttemptId(
    value: string | null | undefined
): string | undefined {
    const trimmed = value?.trim();

    return trimmed ? trimmed : undefined;
}

/**
 * Mints a NEW attempt's id and RETURNS it - it is stored nowhere. Called once per `playInternal()`,
 * whose caller owns the returned value and threads it to every request of that attempt.
 *
 * Returning rather than storing is what makes concurrent attempts safe: two overlapping
 * `playInternal()` calls receive two independent values and neither can observe the other's. See
 * the file-level comment for the interleaving this replaced.
 *
 * Defensive re-sanitize of the generated value: a caller-injected `generate` seam could in
 * principle hand back something blank, and this function must never be the reason a `400`-inducing
 * value reaches the wire. If generation somehow yields nothing usable, the attempt proceeds with no
 * id at all - which the server accepts - rather than with a bad one.
 */
export function beginPlaybackAttempt(
    deps: PlaybackAttemptIdDeps = {}
): string | undefined {
    const generate = deps.generate ?? generatePlaybackAttemptId;

    return sanitizePlaybackAttemptId(generate());
}

/**
 * Attaches a specific attempt's id to an outbound payload, in place, and returns that same payload
 * so this can be dropped into an existing expression.
 *
 * `attemptId` is a required parameter with no fallback to any ambient state - that absence is the
 * point. A call site that cannot name which attempt it belongs to cannot stamp one, which is what
 * structurally prevents attempt A's request from picking up attempt B's id.
 *
 * The key is set ONLY when the id is usable: an absent `PlaybackAttemptId` is a valid request, an
 * empty one is a `400`. This is why the field is never pre-initialized to `''` and never assigned
 * unconditionally - the property simply does not appear on the payload when there is no attempt id,
 * which serializes to an omitted field exactly as the server expects.
 *
 * Used for the two payload types the client actually sends today (`PlaybackInfoDto` and
 * `CreatePlaybackSessionRequest`); it is intentionally shape-agnostic so a future
 * `ReplacePlaybackSessionRequest` call site can reuse it unchanged.
 */
export function applyPlaybackAttemptId<
    T extends { PlaybackAttemptId?: string }
>(payload: T, attemptId: string | null | undefined): T {
    const sanitized = sanitizePlaybackAttemptId(attemptId);

    if (sanitized) {
        payload.PlaybackAttemptId = sanitized;
    }

    return payload;
}

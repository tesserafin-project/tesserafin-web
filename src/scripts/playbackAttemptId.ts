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
 * bundle budget and keeps the `lib/reefin-sdk` scope behind the existing lazy `playback-v2-url`
 * boundary where PR #21 put it.
 *
 * Single module-level current attempt, rather than per-player state: only one attempt is ever in
 * its *starting* phase at a time (`playInternal()` is the sole mint site and the retry path never
 * re-enters it), so a singleton is sufficient and survives the `streamInfo` rebuild that
 * `changeStream()` performs - stashing the id on `streamInfo` would silently lose it on exactly
 * the retry this feature exists to correlate.
 */

/** Injectable seam for tests - production callers use the default. */
export interface PlaybackAttemptIdDeps {
    /** Defaults to {@link generatePlaybackAttemptId}. */
    generate?: () => string;
}

/**
 * The current attempt's id, or `undefined` before the first attempt of the session. Never an empty
 * or blank string: the server rejects those with a `400` (absent is explicitly fine, blank is
 * not), so "no id" is represented by the absence of a value at every layer of this module.
 */
let currentPlaybackAttemptId: string | undefined;

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
 * Starts a NEW attempt and returns its id. Called once per `playInternal()`; the previous
 * attempt's id is simply replaced (there is nothing to clean up - the value is inert).
 *
 * Defensive re-sanitize of the generated value: a caller-injected `generate` seam could in
 * principle hand back something blank, and this function must never be the reason a `400`-inducing
 * value becomes current. If generation somehow yields nothing usable, the attempt proceeds with no
 * id at all - which the server accepts - rather than with a bad one.
 */
export function beginPlaybackAttempt(
    deps: PlaybackAttemptIdDeps = {}
): string | undefined {
    const generate = deps.generate ?? generatePlaybackAttemptId;

    currentPlaybackAttemptId = sanitizePlaybackAttemptId(generate());

    return currentPlaybackAttemptId;
}

/**
 * The current attempt's id, or `undefined` if no attempt has started (or the minted value was
 * unusable). Callers must treat `undefined` as an ordinary, valid outcome - never as an error.
 */
export function getCurrentPlaybackAttemptId(): string | undefined {
    return sanitizePlaybackAttemptId(currentPlaybackAttemptId);
}

/**
 * Attaches the current attempt's id to an outbound payload, in place, and returns that same
 * payload so this can be dropped into an existing expression.
 *
 * The key is set ONLY when there is a usable id: an absent `PlaybackAttemptId` is a valid request,
 * an empty one is a `400`. This is why the field is never pre-initialized to `''` and never
 * assigned unconditionally - the property simply does not appear on the payload when there is no
 * attempt id, which serializes to an omitted field exactly as the server expects.
 *
 * Used for the two payload types the client actually sends today (`PlaybackInfoDto` and
 * `CreatePlaybackSessionRequest`); it is intentionally shape-agnostic so a future
 * `ReplacePlaybackSessionRequest` call site can reuse it unchanged.
 */
export function applyPlaybackAttemptId<
    T extends { PlaybackAttemptId?: string }
>(payload: T): T {
    const attemptId = getCurrentPlaybackAttemptId();

    if (attemptId) {
        payload.PlaybackAttemptId = attemptId;
    }

    return payload;
}

/** Test-only reset of the module-level attempt state. Not called from production code. */
export function resetPlaybackAttemptIdForTests(): void {
    currentPlaybackAttemptId = undefined;
}

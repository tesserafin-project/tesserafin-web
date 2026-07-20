/**
 * The `playbackmanager.js` wiring for `reefin` issue #43's session teardown - kept out of the
 * manager itself for the same reason `playbackSessionV2UrlTrigger.ts` is: the manager gets two
 * one-line calls, and the conditions under which they do anything are testable here.
 *
 * ## This activates nothing
 *
 * Both entry points below are no-ops unless `streamInfo.executionDecision.source === 'v2'` AND
 * that decision carries a server-assigned `playbackSessionId`. Only
 * `applyV2PlaybackUrlToStreamInfo` produces such a decision, and only when
 * `appSettings.enableV2PlaybackPath()` is on - which is OFF by default. Legacy playback builds
 * a `'legacy'` decision and therefore never creates a tracker, never registers an unload
 * listener and never issues a request.
 *
 * That gate is why wiring this into the manager's GENERIC stop path is safe: the stop path is
 * shared with legacy playback, and this must not change legacy behaviour in any way.
 */

import {
    PlaybackSessionTracker,
    registerTeardownFlush,
    type TeardownApi
} from './playbackSessionTeardown';

/** The subset of `playerData` this module reads and writes. The tracker lives here rather
 * than on `streamInfo` because `changeStream()` replaces `streamInfo` wholesale, which would
 * drop the tracker on exactly the retry whose old session needs releasing - the same reasoning
 * `playbackAttemptId.ts` documents for the attempt id. */
export interface TeardownPlayerData {
    playbackSessionTracker?: PlaybackSessionTracker;
    playbackSessionTeardownOff?: () => void;
    streamInfo?: {
        executionDecision?: {
            source?: string;
            playbackSessionId?: string;
        } | null;
    } | null;
}

function v2SessionIdOf(
    streamInfo: TeardownPlayerData['streamInfo']
): string | undefined {
    const decision = streamInfo?.executionDecision;

    if (!decision || decision.source !== 'v2') {
        return undefined;
    }

    return decision.playbackSessionId || undefined;
}

/**
 * Names the v2 session the player CURRENTLY holds, for the retry path's re-plan fork
 * (`playbackSessionV2ReplanTrigger.ts`), or `undefined` when there is nothing to re-plan.
 *
 * Two conditions, both required, because each can be true without the other:
 *
 * - The current `streamInfo`'s decision must be a v2 one carrying a `playbackSessionId` - the same
 *   `v2SessionIdOf()` read the stop path uses. A player that fell back to legacy at start (or
 *   whose previous item was v2 but whose current one is not) has no session its retry could
 *   re-plan.
 * - The tracker must still hold that same id LIVE (`liveSessionId`, not `ownedSessionId`, which
 *   keeps reporting an already-released record). A session the tracker has released (or never
 *   adopted) is one whose `DELETE` is at least in flight and which the server may already have
 *   reaped; issuing a `PUT` against it would at best 404 and at worst re-animate a session the
 *   stop path will never tear down again.
 *
 * Deliberately in THIS module rather than the re-plan trigger: the fork's question is "what does
 * the teardown owner think this player holds?", and answering it here keeps `v2SessionIdOf()`'s
 * source-of-truth reading in one place.
 */
export function adoptedV2PlaybackSessionId(
    playerData: TeardownPlayerData
): string | undefined {
    const sessionId = v2SessionIdOf(playerData.streamInfo);

    if (!sessionId) {
        return undefined;
    }

    return playerData.playbackSessionTracker?.liveSessionId === sessionId
        ? sessionId
        : undefined;
}

/**
 * Called right after the manager parks a new `streamInfo` on `playerData`. Takes ownership of
 * the v2 session that `streamInfo` was built from, releasing whatever the player previously
 * held - a replacement IS a teardown of the outgoing session.
 *
 * A legacy `streamInfo` releases the previous v2 session (correct: that session is over) but
 * adopts nothing, so a player that falls back to legacy mid-queue does not leak the session it
 * held before.
 */
export function adoptPlaybackSessionForTeardown(
    playerData: TeardownPlayerData,
    api: TeardownApi | null | undefined,
    globalTarget:
        | Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
        | undefined = typeof window === 'undefined' ? undefined : window,
    doc: { visibilityState: string } | undefined = typeof document ===
    'undefined'
        ? undefined
        : document
): void {
    const sessionId = v2SessionIdOf(playerData.streamInfo);
    const existing = playerData.playbackSessionTracker;

    if (!sessionId) {
        // Nothing to own. Release anything previously held, but do NOT create a tracker: a
        // purely legacy player must end this function exactly as it entered it.
        existing?.release('replaced-by-legacy');
        return;
    }

    const tracker = existing ?? new PlaybackSessionTracker();
    playerData.playbackSessionTracker = tracker;

    tracker.adopt(api, sessionId);

    // Registered once per player, only once a v2 session actually exists.
    if (!playerData.playbackSessionTeardownOff && globalTarget) {
        playerData.playbackSessionTeardownOff = registerTeardownFlush(
            tracker,
            globalTarget,
            doc
        );
    }
}

/**
 * Called from the manager's stop path. Ends the v2 session the player holds, if any.
 *
 * `expectSessionId` is deliberately taken from the `streamInfo` the stop is FOR, not from the
 * tracker: a stop event that fires late, after the next item has already been adopted, must
 * not tear down the session that replaced it. Naming the session makes that a no-op instead.
 */
export function releasePlaybackSessionOnStop(
    playerData: TeardownPlayerData,
    reason = 'stopped'
): void {
    const tracker = playerData.playbackSessionTracker;

    if (!tracker) {
        return;
    }

    tracker.release(reason, {
        expectSessionId: v2SessionIdOf(playerData.streamInfo)
    });

    playerData.playbackSessionTeardownOff?.();
    playerData.playbackSessionTeardownOff = undefined;
}

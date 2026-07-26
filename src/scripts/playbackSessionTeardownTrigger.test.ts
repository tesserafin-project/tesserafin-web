import { describe, expect, it, vi } from 'vitest';

import {
    PlaybackSessionTracker,
    registerTeardownFlush
} from './playbackSessionTeardown';
import {
    adoptPlaybackSessionForTeardown,
    adoptedV2PlaybackSessionId,
    releasePlaybackSessionOnStop,
    type TeardownPlayerData
} from './playbackSessionTeardownTrigger';

const api = {
    basePath: 'https://server.example',
    authorizationHeader: 'MediaBrowser Token="t"'
};

function fakeTarget() {
    const handlers: Record<string, Array<() => void>> = {};
    return {
        handlers,
        addEventListener: (t: string, h: () => void) => {
            handlers[t] = handlers[t] ?? [];
            handlers[t].push(h);
        },
        removeEventListener: (t: string, h: () => void) => {
            handlers[t] = (handlers[t] ?? []).filter((x) => x !== h);
        },
        fire: (t: string) => {
            for (const h of handlers[t] ?? []) {
                h();
            }
        }
    };
}

function v2StreamInfo(playbackSessionId: string) {
    return { executionDecision: { source: 'v2', playbackSessionId } };
}

function legacyStreamInfo() {
    return { executionDecision: { source: 'legacy' } };
}

describe('legacy playback is completely untouched', () => {
    it('creates no tracker and registers no listener for a legacy decision', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: legacyStreamInfo()
        };

        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        expect(playerData.playbackSessionTracker).toBeUndefined();
        expect(playerData.playbackSessionTeardownOff).toBeUndefined();
        expect(Object.keys(target.handlers)).toEqual([]);
    });

    it('releasing a legacy player issues nothing', () => {
        const playerData: TeardownPlayerData = {
            streamInfo: legacyStreamInfo()
        };

        expect(() => releasePlaybackSessionOnStop(playerData)).not.toThrow();
        expect(playerData.playbackSessionTracker).toBeUndefined();
    });

    it('creates no tracker when a v2 decision carries no session id', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: { executionDecision: { source: 'v2' } }
        };

        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        expect(playerData.playbackSessionTracker).toBeUndefined();
    });
});

describe('v2 session ownership', () => {
    it('adopts the session and registers the unload flush', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-1')
        };

        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        expect(playerData.playbackSessionTracker?.ownedSessionId).toBe(
            'sess-1'
        );
        expect(Object.keys(target.handlers).sort()).toEqual([
            'pagehide',
            'visibilitychange'
        ]);
    });

    it('releases on stop and unregisters the flush', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-1')
        };
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        releasePlaybackSessionOnStop(playerData);

        expect(playerData.playbackSessionTracker?.hasPendingRelease).toBe(
            false
        );
        expect(playerData.playbackSessionTeardownOff).toBeUndefined();
        expect(target.handlers.pagehide).toEqual([]);
    });

    it('a v2 player that falls back to legacy releases the session it held', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-1')
        };
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });
        const tracker = playerData.playbackSessionTracker;

        playerData.streamInfo = legacyStreamInfo();
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        expect(tracker?.hasPendingRelease).toBe(false);
    });

    it('registers the unload flush only once across several adoptions', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-1')
        };

        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });
        playerData.streamInfo = v2StreamInfo('sess-2');
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        expect(target.handlers.pagehide).toHaveLength(1);
        expect(playerData.playbackSessionTracker?.ownedSessionId).toBe(
            'sess-2'
        );
    });
});

describe('transcoding retry (changeStream) keeps the initial session releasable', () => {
    /**
     * Pins the SHIPPED wiring, which is narrower than "a retry establishes a new v2 session".
     * `applyV2PlaybackUrlIfEnabled` is reached only from `playAfterBitrateDetect()` (i.e. only
     * from `playInternal()`); the retry path `changeStream() -> changeStreamToUrl() ->
     * setSrcIntoPlayer()` assigns a LEGACY `streamInfo` to `playerData.streamInfo` directly and
     * never re-adopts.
     *
     * The tracker lives on `playerData`, not on `streamInfo`, so it survives that replacement
     * still holding the session the initial attempt established - and the final stop must
     * still release it. If the tracker were parked on `streamInfo`, this is exactly where the
     * session would leak until the server's 6h TTL swept it.
     */
    it('releases the initial v2 session even though the retry left a legacy streamInfo', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-initial')
        };
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });
        const tracker = playerData.playbackSessionTracker;
        expect(tracker?.ownedSessionId).toBe('sess-initial');

        // changeStream()'s retry: setSrcIntoPlayer replaces streamInfo with a legacy one.
        playerData.streamInfo = legacyStreamInfo();

        releasePlaybackSessionOnStop(playerData, 'stopped');

        // expectSessionId is undefined (legacy streamInfo), so the name guard is skipped and
        // the held session is released rather than leaked.
        expect(tracker?.hasPendingRelease).toBe(false);
        expect(tracker?.ownedSessionId).toBe('sess-initial');
    });
});

describe('late stop cannot tear down the session that replaced it', () => {
    it('is a no-op when streamInfo already names a different session', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-A')
        };
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        // The next item is adopted before attempt A's stop event lands.
        playerData.streamInfo = v2StreamInfo('sess-B');
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        // A's stop finally fires - but streamInfo now names B, and the tracker holds B, so
        // the guard means the stop for A cannot end B.
        releasePlaybackSessionOnStop(playerData, 'stopped-late');

        // B is still the owned session and is still torn down by its OWN stop, which is the
        // point: A's late stop neither released B early nor left B unreleasable.
        expect(playerData.playbackSessionTracker?.ownedSessionId).toBe(
            'sess-B'
        );
    });
});

describe('adoptedV2PlaybackSessionId (the retry re-plan fork)', () => {
    it('is undefined for a legacy streamInfo, tracker or not', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-1')
        };
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        // The retry fell back to legacy before this read (or playback was legacy all along).
        playerData.streamInfo = legacyStreamInfo();

        expect(adoptedV2PlaybackSessionId(playerData)).toBeUndefined();
    });

    it('is undefined when no tracker exists, even for a v2 streamInfo', () => {
        // A v2 decision without an adoption is a state the manager never produces on its own,
        // but the fork must not trust streamInfo alone: only the teardown owner of record can
        // say what this player holds.
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-1')
        };

        expect(adoptedV2PlaybackSessionId(playerData)).toBeUndefined();
    });

    it('names the session when the decision and the live tracker agree', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-1')
        };
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        expect(adoptedV2PlaybackSessionId(playerData)).toBe('sess-1');
    });

    it('is undefined when the tracker holds a DIFFERENT session than streamInfo names', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-A')
        };
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        // The next item was adopted while an older streamInfo still lingers on this read.
        playerData.streamInfo = v2StreamInfo('sess-B');
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });
        playerData.streamInfo = v2StreamInfo('sess-A');

        expect(adoptedV2PlaybackSessionId(playerData)).toBeUndefined();
    });

    it('is undefined once the session has been released - a DELETE in flight must not be re-planned', () => {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-1')
        };
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });

        releasePlaybackSessionOnStop(playerData, 'stopped');

        // `ownedSessionId` still reports the released record (that is deliberate - see
        // `PlaybackSessionTracker`); the fork must read `liveSessionId` and decline here.
        expect(playerData.playbackSessionTracker?.ownedSessionId).toBe(
            'sess-1'
        );
        expect(adoptedV2PlaybackSessionId(playerData)).toBeUndefined();
    });
});

// -------------------------------------------------------------------------------------------
// tesserafin-web#60 — the teardown must precede navigation, and must be the primary route.
//
// The defect these cover: the stop path issued an ordinary (non-keepalive) `fetch`, which a
// navigation destroying the document aborts, AND it marked the session released before the
// request left, so the `pagehide` backstop found nothing to do and issued nothing. The server
// saw no request at all and held the session to its TTL.
// -------------------------------------------------------------------------------------------
describe('teardown ordering under navigation (#60)', () => {
    /** Records `fetch` and `navigate` into one sequence, so ordering is asserted rather than
     * inferred. `navigate` stands for whatever destroys the playback context - the video view's
     * `appRouter.back()`, a link, a reload, the E2E rig's `page.goto`. */
    function orderRig() {
        const order: string[] = [];
        const fetchImpl = vi.fn().mockImplementation((url: string) => {
            order.push(`fetch:${String(url).split('/').pop()}`);
            return Promise.resolve({ ok: true, status: 204 });
        });
        return {
            order,
            fetchImpl,
            navigate: () => order.push('navigate')
        };
    }

    function v2PlayerData(rig: ReturnType<typeof orderRig>, sessionId: string) {
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo(sessionId)
        };
        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });
        // Production constructs its own tracker; the deps seam is per-tracker, so the rig's
        // fetch is injected by rebuilding the tracker the same way the module does.
        const tracker = new PlaybackSessionTracker({
            fetchImpl: rig.fetchImpl,
            logger: { debug: vi.fn() }
        } as never);
        tracker.adopt(api, sessionId);
        playerData.playbackSessionTracker = tracker;
        playerData.playbackSessionTeardownOff = registerTeardownFlush(
            tracker,
            target,
            { visibilityState: 'visible' }
        );
        return { playerData, target };
    }

    it('an explicit stop dispatches the DELETE before navigation is initiated', () => {
        const rig = orderRig();
        const { playerData } = v2PlayerData(rig, 'sess-1');

        // Exactly the manager's shape: the stop handler releases, then the view navigates.
        expect(releasePlaybackSessionOnStop(playerData)).toBe(true);
        rig.navigate();

        expect(rig.order).toEqual(['fetch:sess-1', 'navigate']);
    });

    it('navigation cannot race ahead of the dispatch even when unload follows immediately', () => {
        const rig = orderRig();
        const { playerData, target } = v2PlayerData(rig, 'sess-1');

        releasePlaybackSessionOnStop(playerData);
        rig.navigate();
        target.fire('pagehide');

        // One request, and it left before the navigation. The `pagehide` that follows the
        // navigation adds nothing - which is the point: it is a backstop, not the route.
        expect(rig.order).toEqual(['fetch:sess-1', 'navigate']);
        expect(rig.fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('overlapping stop, unmount and unload triggers share one single-flight teardown', () => {
        const rig = orderRig();
        const { playerData, target } = v2PlayerData(rig, 'sess-1');

        releasePlaybackSessionOnStop(playerData);
        releasePlaybackSessionOnStop(playerData, 'unmount');
        target.fire('pagehide');
        target.fire('visibilitychange');

        expect(rig.fetchImpl).toHaveBeenCalledTimes(1);
        expect(rig.fetchImpl.mock.calls[0][1]).toMatchObject({
            method: 'DELETE',
            keepalive: true
        });
    });

    it('a duplicate trigger after a successful deletion issues nothing and reports no error', async () => {
        const rig = orderRig();
        const { playerData, target } = v2PlayerData(rig, 'sess-1');

        expect(releasePlaybackSessionOnStop(playerData)).toBe(true);
        await Promise.resolve();
        await Promise.resolve();

        expect(() => target.fire('pagehide')).not.toThrow();
        expect(releasePlaybackSessionOnStop(playerData, 'late')).toBe(false);
        expect(rig.fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('unload remains a real backstop when no stop was ever reported', () => {
        const rig = orderRig();
        const { playerData, target } = v2PlayerData(rig, 'sess-1');

        // The tab is closed mid-playback: the player never reports a stop, so the primary path
        // never runs. The backstop must still hand the session back.
        target.fire('pagehide');

        expect(rig.order).toEqual(['fetch:sess-1']);
        expect(playerData.playbackSessionTracker?.liveSessionId).toBeNull();
    });

    it('no active v2 session produces no teardown request at all', () => {
        const rig = orderRig();
        const target = fakeTarget();
        const playerData: TeardownPlayerData = {
            streamInfo: legacyStreamInfo()
        };

        adoptPlaybackSessionForTeardown(playerData, api, target, {
            visibilityState: 'visible'
        });
        expect(releasePlaybackSessionOnStop(playerData)).toBe(false);
        target.fire('pagehide');

        expect(rig.fetchImpl).not.toHaveBeenCalled();
        expect(rig.order).toEqual([]);
    });

    it('a transport that refuses the request keeps the backstop registered', () => {
        const target = fakeTarget();
        const calls: string[] = [];
        let refuse = true;
        const fetchImpl = vi.fn().mockImplementation((url: string) => {
            if (refuse) {
                throw new Error('transport refused');
            }
            calls.push(String(url).split('/').pop() as string);
            return Promise.resolve({ ok: true, status: 204 });
        });
        const playerData: TeardownPlayerData = {
            streamInfo: v2StreamInfo('sess-1')
        };
        const tracker = new PlaybackSessionTracker({
            fetchImpl,
            logger: { debug: vi.fn() }
        } as never);
        tracker.adopt(api, 'sess-1');
        playerData.playbackSessionTracker = tracker;
        playerData.playbackSessionTeardownOff = registerTeardownFlush(
            tracker,
            target,
            { visibilityState: 'visible' }
        );

        expect(releasePlaybackSessionOnStop(playerData)).toBe(false);
        expect(playerData.playbackSessionTeardownOff).toBeDefined();

        // The unload path then succeeds where the stop path could not.
        refuse = false;
        target.fire('pagehide');
        expect(calls).toEqual(['sess-1']);
    });
});

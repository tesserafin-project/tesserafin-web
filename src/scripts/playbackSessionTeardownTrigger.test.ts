import { describe, expect, it, vi } from 'vitest';

import {
    adoptPlaybackSessionForTeardown,
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

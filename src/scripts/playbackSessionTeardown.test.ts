import { describe, expect, it, vi } from 'vitest';

import {
    PlaybackSessionTracker,
    registerTeardownFlush,
    type TeardownApi
} from './playbackSessionTeardown';

const api: TeardownApi = {
    basePath: 'https://server.example/reefin',
    authorizationHeader: 'MediaBrowser Token="t"'
};

function okFetch() {
    return vi.fn().mockResolvedValue({ ok: true, status: 204 });
}

function deps(fetchImpl: ReturnType<typeof vi.fn>) {
    return { fetchImpl, logger: { debug: vi.fn() } } as never;
}

function urlsFrom(fetchImpl: ReturnType<typeof vi.fn>): string[] {
    return fetchImpl.mock.calls.map((c) => c[0] as string);
}

describe('PlaybackSessionTracker', () => {
    it('DELETEs the owned session id, not the play session id', () => {
        const fetchImpl = okFetch();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));

        tracker.adopt(api, 'server-session-1');
        tracker.release('stopped');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe(
            'https://server.example/reefin/Playback/Sessions/server-session-1'
        );
        expect(init).toMatchObject({ method: 'DELETE' });
        expect(init.headers).toMatchObject({
            Authorization: 'MediaBrowser Token="t"'
        });
    });

    it('is idempotent - a second release issues no second request', () => {
        const fetchImpl = okFetch();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));

        tracker.adopt(api, 'server-session-1');
        tracker.release('stopped');
        tracker.release('pagehide');
        tracker.release('visibilitychange');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no session was ever established (legacy playback)', () => {
        const fetchImpl = okFetch();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));

        tracker.adopt(api, undefined);
        tracker.release('stopped');

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(tracker.ownedSessionId).toBeNull();
    });

    it('treats a blank session id as no session', () => {
        const fetchImpl = okFetch();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));

        tracker.adopt(api, '   ');
        tracker.release('stopped');

        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('releases the outgoing session when a new one is adopted', () => {
        const fetchImpl = okFetch();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));

        tracker.adopt(api, 'server-session-1');
        tracker.adopt(api, 'server-session-2');

        expect(urlsFrom(fetchImpl)).toEqual([
            'https://server.example/reefin/Playback/Sessions/server-session-1'
        ]);
        expect(tracker.ownedSessionId).toBe('server-session-2');
    });

    it('forget() drops the session without contacting the server', () => {
        const fetchImpl = okFetch();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));

        tracker.adopt(api, 'server-session-1');
        tracker.forget();
        tracker.release('stopped');

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(tracker.ownedSessionId).toBeNull();
    });

    it('sends keepalive only when asked', () => {
        const fetchImpl = okFetch();
        const a = new PlaybackSessionTracker(deps(fetchImpl));
        a.adopt(api, 's1');
        a.release('stopped');

        const b = new PlaybackSessionTracker(deps(fetchImpl));
        b.adopt(api, 's2');
        b.release('pagehide', { keepalive: true });

        expect(fetchImpl.mock.calls[0][1]).toMatchObject({ keepalive: false });
        expect(fetchImpl.mock.calls[1][1]).toMatchObject({ keepalive: true });
    });
});

describe('error handling', () => {
    it('never throws when the DELETE rejects', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
        const logger = { debug: vi.fn() };
        const tracker = new PlaybackSessionTracker({
            fetchImpl,
            logger
        } as never);

        tracker.adopt(api, 's1');
        expect(() => tracker.release('stopped')).not.toThrow();

        await Promise.resolve();
        await Promise.resolve();
        expect(logger.debug).toHaveBeenCalled();
    });

    it('does not log a 404 as a failure - the session being gone is the goal', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
        const logger = { debug: vi.fn() };
        const tracker = new PlaybackSessionTracker({
            fetchImpl,
            logger
        } as never);

        tracker.adopt(api, 's1');
        tracker.release('stopped');

        await Promise.resolve();
        await Promise.resolve();
        expect(logger.debug).not.toHaveBeenCalled();
    });

    it('logs a 403 without retrying', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
        const logger = { debug: vi.fn() };
        const tracker = new PlaybackSessionTracker({
            fetchImpl,
            logger
        } as never);

        tracker.adopt(api, 's1');
        tracker.release('stopped');

        await Promise.resolve();
        await Promise.resolve();
        expect(logger.debug).toHaveBeenCalled();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('survives a synchronously throwing fetch', () => {
        const fetchImpl = vi.fn().mockImplementation(() => {
            throw new Error('nope');
        });
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));

        tracker.adopt(api, 's1');
        expect(() => tracker.release('stopped')).not.toThrow();
    });
});

describe('concurrent attempts', () => {
    it('two overlapping attempts hold independent sessions', () => {
        const fetchImpl = okFetch();
        const a = new PlaybackSessionTracker(deps(fetchImpl));
        const b = new PlaybackSessionTracker(deps(fetchImpl));

        a.adopt(api, 'session-A');
        b.adopt(api, 'session-B');

        a.release('stopped');

        expect(urlsFrom(fetchImpl)).toEqual([
            'https://server.example/reefin/Playback/Sessions/session-A'
        ]);
        expect(b.ownedSessionId).toBe('session-B');
    });

    it('a stale teardown cannot delete the attempt that replaced it', () => {
        const fetchImpl = okFetch();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));

        // Attempt A establishes, then is replaced by attempt B before A's stop path runs.
        tracker.adopt(api, 'session-A');
        tracker.adopt(api, 'session-B');

        // A's stop path finally fires, naming the session IT started. It must not touch B.
        tracker.release('stopped-late', { expectSessionId: 'session-A' });

        const urls = urlsFrom(fetchImpl);
        // Exactly one DELETE, for A (issued by the replacement), and none for B.
        expect(urls).toEqual([
            'https://server.example/reefin/Playback/Sessions/session-A'
        ]);
        expect(urls.some((u) => u.endsWith('session-B'))).toBe(false);
        expect(tracker.ownedSessionId).toBe('session-B');
    });

    it('a re-POST reusing the same server id is still torn down exactly once', () => {
        const fetchImpl = okFetch();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));

        // The server returns the SAME PlaybackSessionId when a POST reuses a PlaySessionId,
        // so ids alone cannot separate the old record from the new - the generation does.
        tracker.adopt(api, 'same-session');
        tracker.adopt(api, 'same-session');
        tracker.release('stopped');

        expect(urlsFrom(fetchImpl)).toEqual([
            'https://server.example/reefin/Playback/Sessions/same-session',
            'https://server.example/reefin/Playback/Sessions/same-session'
        ]);
        // The record is deliberately RETAINED after release rather than cleared: it is what
        // makes a second trigger a no-op instead of a duplicate DELETE.
        expect(tracker.hasPendingRelease).toBe(false);
        tracker.release('again');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});

describe('registerTeardownFlush', () => {
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

    it('registers pagehide and visibilitychange, but not beforeunload', () => {
        const target = fakeTarget();
        registerTeardownFlush(new PlaybackSessionTracker(), target, {
            visibilityState: 'visible'
        });

        expect(Object.keys(target.handlers).sort()).toEqual([
            'pagehide',
            'visibilitychange'
        ]);
    });

    it('pagehide tears down a live session with keepalive', () => {
        const fetchImpl = okFetch();
        const target = fakeTarget();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));
        tracker.adopt(api, 's1');
        registerTeardownFlush(tracker, target, { visibilityState: 'visible' });

        target.fire('pagehide');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][1]).toMatchObject({ keepalive: true });
    });

    it('visibilitychange->hidden does NOT tear down a session still playing', () => {
        const fetchImpl = okFetch();
        const target = fakeTarget();
        const doc = { visibilityState: 'visible' };
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));
        tracker.adopt(api, 's1');
        registerTeardownFlush(tracker, target, doc);

        // The mobile tab-switch case: hidden, but playback has not ended.
        doc.visibilityState = 'hidden';
        target.fire('visibilitychange');

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(tracker.ownedSessionId).toBe('s1');
    });

    it('visibilitychange->hidden DOES flush a teardown already owed', () => {
        const fetchImpl = okFetch();
        const target = fakeTarget();
        const doc = { visibilityState: 'visible' };
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));
        tracker.adopt(api, 's1');
        registerTeardownFlush(tracker, target, doc);

        tracker.markEnded();
        doc.visibilityState = 'hidden';
        target.fire('visibilitychange');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('unregister removes both listeners', () => {
        const fetchImpl = okFetch();
        const target = fakeTarget();
        const tracker = new PlaybackSessionTracker(deps(fetchImpl));
        tracker.adopt(api, 's1');
        const off = registerTeardownFlush(tracker, target, {
            visibilityState: 'visible'
        });

        off();
        target.fire('pagehide');

        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

/**
 * #153-A1 — the eager boot shim.
 *
 * This is the half that runs before anything else, so its failure mode is the worst one available:
 * if it does not hold `Api.webSocket` synchronously, `@jellyfin/sdk` builds its own service and the
 * whole migration is bypassed with no error anywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const socketSubscribe = vi.fn(
    (_messageTypes: string[], _onMessage: unknown, _intervals?: unknown) =>
        vi.fn()
);
const socketDisconnect = vi.fn();
const socketDispose = vi.fn();
const socketUpdateUrl = vi.fn();
const brokerDispose = vi.fn();

interface FakeRuntime {
    broker: { dispose: () => void; isDisposed: boolean };
    socket: {
        subscribe: typeof socketSubscribe;
        disconnect: () => void;
        dispose: () => void;
        updateUrl: (uri?: string) => void;
    };
}

interface RuntimeHost {
    _credentialRuntime?: FakeRuntime;
}

/**
 * The mock models the REAL caching contract of `install.ts`, not just its signature.
 *
 * `createCredentialRuntime` caches on `apiClient._credentialRuntime` and returns the cached pair
 * for a client it has already served. A mock that returns a fresh object every call cannot see the
 * defect this file exists to pin: a teardown that leaves that field set hands the NEXT session the
 * PREVIOUS session's disposed broker.
 */
const createCredentialRuntime = vi.fn((apiClient: RuntimeHost) => {
    const existing = apiClient._credentialRuntime;
    if (existing && !existing.broker.isDisposed) return existing;
    const runtime: FakeRuntime = {
        broker: {
            isDisposed: false,
            dispose() {
                runtime.broker.isDisposed = true;
                brokerDispose();
            }
        },
        socket: {
            subscribe: socketSubscribe,
            disconnect: socketDisconnect,
            dispose: socketDispose,
            updateUrl: socketUpdateUrl
        }
    };
    apiClient._credentialRuntime = runtime;
    return runtime;
});

vi.mock('./install', () => ({
    createCredentialRuntime: (...args: unknown[]) =>
        createCredentialRuntime(...(args as [RuntimeHost])),
    createBroker: vi.fn()
}));

import {
    brokerFor,
    disposePlaybackCredentials,
    installPlaybackCredentials
} from './boot';

function apiClient() {
    return {
        serverId: () => 'server-1',
        serverAddress: () => 'http://server.example:8096',
        _sdk: {} as { webSocket?: unknown },
        _credentialRuntime: undefined as FakeRuntime | undefined
    };
}

/** Let the shim's own `import('./install')` settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('installation', () => {
    it('occupies Api.webSocket synchronously', () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        // Synchronously, before any await: this is what stops `Api.subscribe()` building its own.
        expect(client._sdk.webSocket).toBeDefined();
        expect(
            typeof (client._sdk.webSocket as { subscribe: unknown }).subscribe
        ).toBe('function');
    });

    it('is idempotent', () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        const first = client._sdk.webSocket;
        installPlaybackCredentials(client as never);
        expect(client._sdk.webSocket).toBe(first);
    });

    it('builds exactly one runtime per ApiClient even when brokerFor races the import', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        await Promise.all([
            brokerFor(client as never),
            brokerFor(client as never)
        ]);
        await settle();
        expect(createCredentialRuntime).toHaveBeenCalledTimes(1);
    });
});

describe('queued subscriptions', () => {
    it('replays a subscription made before the implementation resolved', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        const socket = client._sdk.webSocket as {
            subscribe: (t: string[], h: () => void) => () => void;
        };
        const handler = vi.fn();
        socket.subscribe(['Sessions'], handler);
        expect(socketSubscribe).not.toHaveBeenCalled();

        await settle();
        expect(socketSubscribe).toHaveBeenCalledTimes(1);
        expect(socketSubscribe.mock.calls[0][0]).toEqual(['Sessions']);
    });

    it('does NOT replay a subscription that was cancelled while the import was in flight', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        const socket = client._sdk.webSocket as {
            subscribe: (t: string[], h: () => void) => () => void;
        };
        const unsubscribe = socket.subscribe(['Sessions'], vi.fn());
        unsubscribe();

        await settle();
        // Replaying it would open a socket for a component that has already gone away.
        expect(socketSubscribe).not.toHaveBeenCalled();
    });

    it('passes a later subscription straight through', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        await settle();
        const socket = client._sdk.webSocket as {
            subscribe: (t: string[], h: () => void) => () => void;
        };
        socket.subscribe(['Sessions'], vi.fn());
        expect(socketSubscribe).toHaveBeenCalledTimes(1);
    });

    it('honours a disconnect issued before the implementation resolved', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        (client._sdk.webSocket as { disconnect: () => void }).disconnect();
        await settle();
        expect(socketDisconnect).toHaveBeenCalledTimes(1);
        expect(socketSubscribe).not.toHaveBeenCalled();
    });
});

describe('teardown', () => {
    it('disposes the socket and the broker', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        await settle();
        const broker = await brokerFor(client as never);

        disposePlaybackCredentials(client as never);
        await settle();

        expect(socketDispose).toHaveBeenCalledTimes(1);
        expect(brokerDispose).toHaveBeenCalledTimes(1);
        expect((broker as unknown as FakeRuntime['broker']).isDisposed).toBe(
            true
        );
    });

    it('never leaves Api.webSocket empty for the stock service to claim', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        await settle();
        const first = client._sdk.webSocket;

        disposePlaybackCredentials(client as never);

        // Synchronously, in the same tick as the sign-out. `Api.subscribe()` builds its own
        // unticketed `WebSocketService` the moment it finds this field unset, and a subscriber can
        // run before any await here resolves.
        expect(client._sdk.webSocket).toBeDefined();
        expect(client._sdk.webSocket).not.toBe(first);
    });

    it('tolerates teardown before the implementation resolved', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        disposePlaybackCredentials(client as never);
        await settle();
        // The seam holds the re-armed shim, and the import issued by the session that ended
        // installed nothing behind it.
        expect(client._sdk.webSocket).toBeDefined();
        expect(socketSubscribe).not.toHaveBeenCalled();
    });

    it('does not let an import in flight at teardown resurrect the credentials', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        // Torn down while the FIRST shim's `import('./install')` is still in flight.
        disposePlaybackCredentials(client as never);
        const runtimeCalls = createCredentialRuntime.mock.calls.length;
        await settle();

        // The stale import must build nothing at all: one runtime for the re-armed generation,
        // never a second for the generation that ended.
        expect(
            createCredentialRuntime.mock.calls.length - runtimeCalls
        ).toBeLessThanOrEqual(1);
        expect(client._credentialRuntime?.broker.isDisposed).toBe(false);
    });
});

/**
 * `ConnectionManager._getOrAddApiClient` returns the SAME `ApiClient` for a server it has already
 * seen, and `apiclientcreated` fires only when one is BUILT. So this sequence — the ordinary one
 * for a person who signs out and signs back in — never re-enters the install path, and every field
 * teardown forgets to clear is inherited by the second session.
 */
describe('sign out, then sign in again on the same ApiClient', () => {
    it('hands the second session a LIVE broker', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        await settle();
        const first = await brokerFor(client as never);

        disposePlaybackCredentials(client as never);
        await settle();

        const second = await brokerFor(client as never);
        expect(second).not.toBe(first);
        expect((second as unknown as FakeRuntime['broker']).isDisposed).toBe(
            false
        );
    });

    it('gives the second session a live socket on the seam', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        await settle();

        disposePlaybackCredentials(client as never);
        await settle();

        const socket = client._sdk.webSocket as {
            subscribe: (t: string[], h: () => void) => () => void;
        };
        socket.subscribe(['Sessions'], vi.fn());
        // Reaches the runtime's socket rather than sitting in a queue nothing will ever drain.
        expect(socketSubscribe).toHaveBeenCalledTimes(1);
    });
});

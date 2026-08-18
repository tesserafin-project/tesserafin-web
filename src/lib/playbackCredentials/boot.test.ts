/**
 * #153-A1 — the eager boot shim.
 *
 * This is the half that runs before anything else, so its failure mode is the worst one available:
 * if it does not hold `Api.webSocket` synchronously, `@jellyfin/sdk` builds its own service and the
 * whole migration is bypassed with no error anywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const socketSubscribe = vi.fn(() => vi.fn());
const socketDisconnect = vi.fn();
const socketDispose = vi.fn();
const socketUpdateUrl = vi.fn();
const brokerDispose = vi.fn();
const createCredentialRuntime = vi.fn(() => ({
    broker: { dispose: brokerDispose },
    socket: {
        subscribe: socketSubscribe,
        disconnect: socketDisconnect,
        dispose: socketDispose,
        updateUrl: socketUpdateUrl
    }
}));

vi.mock('./install', () => ({
    createCredentialRuntime: (...args: unknown[]) =>
        createCredentialRuntime(...(args as [])),
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
        _sdk: {} as { webSocket?: unknown }
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
    it('disposes the socket and the broker and clears the seam', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        await settle();

        disposePlaybackCredentials(client as never);
        await settle();

        expect(socketDispose).toHaveBeenCalledTimes(1);
        expect(brokerDispose).toHaveBeenCalledTimes(1);
        expect(client._sdk.webSocket).toBeUndefined();
    });

    it('tolerates teardown before the implementation resolved', async () => {
        const client = apiClient();
        installPlaybackCredentials(client as never);
        disposePlaybackCredentials(client as never);
        await settle();
        expect(client._sdk.webSocket).toBeUndefined();
    });
});

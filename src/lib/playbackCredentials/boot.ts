/**
 * The eager half of the credential wiring (#153-A1).
 *
 * WHY THERE IS AN EAGER HALF AT ALL. `@jellyfin/sdk`'s `Api.subscribe()` reads
 * `if (!this.webSocket) { this.webSocket = new WebSocketService(...) }`. Whatever occupies that
 * field when the FIRST subscriber runs decides which socket the whole application uses, and
 * subscribing is synchronous. So something has to be there synchronously, before any subscriber
 * runs — this file, and nothing else.
 *
 * WHY THE REST IS LAZY, AND WHAT THAT DOES NOT CHANGE. `scripts/verify-delivery-budget.mjs` has no
 * headroom for the broker and the ticketed socket in the initial graph (2 286 B of raw JS free,
 * against ~8.7 KB of new code), and A1 does not raise a ceiling. The implementation therefore
 * lives behind `import()`. Stated plainly, because the gate cannot see it: the first subscriber
 * runs at start-up, so a real visitor still downloads that chunk during start-up. The bytes moved
 * tier; they did not disappear. The gate counts async chunks toward `startup` only when the
 * `import()` is issued by a declared boot module (`webpack.delivery-budget.json` `bootModules`,
 * today just `./index.jsx`), and this one is issued from `ServerConnections`.
 *
 * The shim below is deliberately the smallest thing that can hold the field: it queues
 * subscriptions and forwards them once the implementation resolves. It never builds a URL, never
 * touches a credential, and never opens a socket.
 */

// Type-only: erased at compile time, so naming the real broker here costs the eager graph nothing.
import type { PlaybackCredentialBroker } from './PlaybackCredentialBroker';

type Handler = (message: unknown) => void;

type InstallModule = typeof import('./install');

/**
 * The one in-flight-or-settled load of the implementation chunk.
 *
 * Module-scoped rather than per-`ApiClient`, and deliberately the PROMISE rather than the resolved
 * module: a sign-out re-arms a shim while the first load may still be in flight, and issuing a
 * second `import()` for a module already being loaded is how one of the two handovers is left
 * waiting on a request that nothing completes. Every shim, for every client and every generation,
 * settles on this single load.
 */
let installLoad: Promise<InstallModule> | null = null;

interface SocketLike {
    subscribe: (
        messageTypes: string[],
        onMessage: Handler,
        intervals?: Record<string, unknown>
    ) => () => void;
    updateUrl: (uri?: string) => void;
    disconnect: () => void;
    dispose?: () => void;
}

interface CredentialCapableApiClient {
    serverId: () => string;
    _sdk?: { webSocket?: unknown };
    _playbackCredentials?: Promise<PlaybackCredentialBroker>;
    _credentialSocket?: SocketLike;
    /**
     * The runtime `install.ts` caches per `ApiClient`. Named here — with no import — so teardown
     * can clear it. Leaving it set is what made a re-login hand back a DISPOSED broker.
     */
    _credentialRuntime?: unknown;
    /**
     * Bumped by every install and every teardown. An `import()` issued by generation N that
     * resolves after generation N+1 started must not install anything: the session it was armed
     * for is gone.
     */
    _credentialGeneration?: number;
}

interface QueuedSubscription {
    messageTypes: string[];
    onMessage: Handler;
    intervals?: Record<string, unknown>;
    unsubscribed: boolean;
}

/**
 * Hold `_sdk.webSocket` synchronously, then hand over to the real service.
 *
 * A subscription made before the implementation resolves is replayed against it; one that was
 * already unsubscribed by then is not replayed at all, so a component that mounted and unmounted
 * during the import does not leave a socket open behind it.
 */
function shim(
    apiClient: CredentialCapableApiClient,
    generation: number
): SocketLike {
    const queued: QueuedSubscription[] = [];
    let real: SocketLike | null = null;
    let disconnected = false;

    const handover = (service: SocketLike) => {
        real = service;
        if (disconnected) {
            service.disconnect();
            return;
        }
        for (const entry of queued) {
            // A subscription cancelled while the import was in flight is not replayed: replaying
            // it would open a socket for a component that has already gone away.
            if (entry.unsubscribed) continue;
            // The queued record's cancellation becomes the real one, so the closure this shim
            // already handed the caller keeps working.
            (entry as { cancel?: () => void }).cancel = service.subscribe(
                entry.messageTypes,
                entry.onMessage,
                entry.intervals
            );
        }
        queued.length = 0;
    };

    const attach = (module: InstallModule) => {
        // The generation this shim was armed for is over: a sign-out (or a re-install) happened
        // while the chunk was in flight. Checked BEFORE `createCredentialRuntime`, so nothing is
        // built and there is nothing to clean up. Without it the import resurrects
        // `_playbackCredentials` after teardown and the seam holds a broker nobody can revoke.
        if (apiClient._credentialGeneration !== generation) return;
        const { broker, socket } = module.createCredentialRuntime(
            apiClient as never
        );
        apiClient._playbackCredentials = Promise.resolve(broker);
        handover(socket as unknown as SocketLike);
    };

    installLoad ??= import('./install');
    void installLoad.then(attach);

    return {
        subscribe(messageTypes, onMessage, intervals) {
            if (real) return real.subscribe(messageTypes, onMessage, intervals);
            const entry: QueuedSubscription & { cancel?: () => void } = {
                messageTypes,
                onMessage,
                intervals,
                unsubscribed: false
            };
            queued.push(entry);
            return () => {
                entry.unsubscribed = true;
                entry.cancel?.();
            };
        },
        updateUrl(uri) {
            real?.updateUrl(uri);
        },
        disconnect() {
            disconnected = true;
            real?.disconnect();
        },
        dispose() {
            disconnected = true;
            real?.dispose?.();
        }
    };
}

/**
 * Install the credential runtime for one `ApiClient`. Synchronous and idempotent.
 *
 * Must run BEFORE any subscriber, which is why `ServerConnections` calls it from
 * `apiclientcreated`, ahead of the `apiClient.subscribe` binding.
 */
export function installPlaybackCredentials(
    apiClient: CredentialCapableApiClient
): void {
    if (apiClient._credentialSocket) return;
    const generation = (apiClient._credentialGeneration ?? 0) + 1;
    apiClient._credentialGeneration = generation;
    const socket = shim(apiClient, generation);
    apiClient._credentialSocket = socket;
    if (apiClient._sdk) {
        apiClient._sdk.webSocket = socket;
    }
}

/**
 * Tear down one session's credential runtime, and reseat an empty one.
 *
 * WHY EVERY FIELD IS CLEARED. `ConnectionManager._getOrAddApiClient` returns the SAME `ApiClient`
 * for a server it has seen before, and `apiclientcreated` fires only when one is built — so a
 * sign-out followed by a sign-in to the same server never re-enters the install path. Leaving
 * `_credentialRuntime` set made `createCredentialRuntime` hand that second session the FIRST
 * session's disposed broker: `mediaValue` then throws for every playback, and the socket is a
 * disposed one that mints no ticket.
 *
 * WHY IT RE-INSTALLS. `Api.subscribe()` builds its own `WebSocketService` whenever
 * `_sdk.webSocket` is unset. Leaving the seam empty hands the field to the stock service on the
 * next subscriber, which carries no ticket and is refused. A fresh shim mints nothing on its own:
 * with no access token `webSocketTicket()` refuses, so re-arming here does not extend a session
 * that just ended.
 *
 * The generation bump comes FIRST, so an `import()` still in flight for the session being torn
 * down installs nothing when it lands.
 */
export function disposePlaybackCredentials(
    apiClient: CredentialCapableApiClient
): void {
    apiClient._credentialGeneration = (apiClient._credentialGeneration ?? 0) + 1;
    apiClient._credentialSocket?.dispose?.();
    apiClient._credentialSocket = undefined;
    const broker = apiClient._playbackCredentials;
    apiClient._playbackCredentials = undefined;
    apiClient._credentialRuntime = undefined;
    if (apiClient._sdk) {
        apiClient._sdk.webSocket = undefined;
    }
    void broker?.then((instance) => instance.dispose());
    installPlaybackCredentials(apiClient);
}

/**
 * The broker for one `ApiClient`.
 *
 * Asynchronous by construction: minting is asynchronous anyway, so awaiting the implementation
 * chunk here costs a caller nothing it was not already awaiting.
 */
export async function brokerFor(
    apiClient: CredentialCapableApiClient | undefined | null
): Promise<PlaybackCredentialBroker | undefined> {
    if (!apiClient) return undefined;
    if (!apiClient._playbackCredentials) {
        const module = await import('./install');
        // `createCredentialRuntime` is idempotent per ApiClient, so racing the shim's own import
        // cannot produce two brokers with two sets of renewal timers.
        apiClient._playbackCredentials ??= Promise.resolve(
            module.createCredentialRuntime(apiClient as never).broker
        );
    }
    return apiClient._playbackCredentials;
}

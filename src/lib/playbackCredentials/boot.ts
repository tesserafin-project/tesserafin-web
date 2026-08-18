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

type Handler = (message: unknown) => void;

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

interface BrokerLike {
    dispose: () => void;
}

interface CredentialCapableApiClient {
    serverId: () => string;
    _sdk?: { webSocket?: unknown };
    _playbackCredentials?: Promise<BrokerLike>;
    _credentialSocket?: SocketLike;
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
function shim(apiClient: CredentialCapableApiClient): SocketLike {
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

    void import('./install').then((module) => {
        const { broker, socket } = module.createCredentialRuntime(
            apiClient as never
        );
        apiClient._playbackCredentials = Promise.resolve(broker);
        handover(socket as unknown as SocketLike);
    });

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
    const socket = shim(apiClient);
    apiClient._credentialSocket = socket;
    if (apiClient._sdk) {
        apiClient._sdk.webSocket = socket;
    }
}

/** Tear down: close the socket, cancel every renewal, and forget the broker. */
export function disposePlaybackCredentials(
    apiClient: CredentialCapableApiClient
): void {
    apiClient._credentialSocket?.dispose?.();
    apiClient._credentialSocket = undefined;
    const broker = apiClient._playbackCredentials;
    apiClient._playbackCredentials = undefined;
    if (apiClient._sdk) {
        apiClient._sdk.webSocket = undefined;
    }
    void broker?.then((instance) => instance.dispose());
}

/**
 * The broker for one `ApiClient`.
 *
 * Asynchronous by construction: minting is asynchronous anyway, so awaiting the implementation
 * chunk here costs a caller nothing it was not already awaiting.
 */
export async function brokerFor(
    apiClient: CredentialCapableApiClient | undefined | null
): Promise<BrokerLike | undefined> {
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

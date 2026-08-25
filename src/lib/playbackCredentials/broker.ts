/**
 * Reaching the playback-credential broker (#153-A1, reshaped by #153-A1-R2).
 *
 * WHY THIS FILE IS THE WHOLE EAGER SURFACE NOW.
 *
 * The first revision needed an eager half for a different reason: it replaced `@jellyfin/sdk`'s
 * `WebSocketService` with a first-party one, and `Api.subscribe()` is synchronous, so something had
 * to occupy `Api.webSocket` before the first subscriber ran. That shim pulled the broker, the
 * duplicate socket runtime and the identity helpers into a chunk that a real visitor downloaded
 * during start-up — ~9.8 KB in its own file, which the delivery budget has no room for and for
 * which no ceiling may be raised.
 *
 * There is no seam any more. `scripts/patch-jellyfin-sdk.mjs` teaches the SHIPPED service to mint a
 * fresh ticket for every physical connection attempt, so the socket needs nothing from this module
 * and start-up needs nothing from the broker. What is left is the media half, and the media half is
 * only ever wanted once playback begins — so it stays behind `import()`, issued from here, and
 * `./install` is reached from nowhere else.
 *
 * `ci/verify-credential-startup-boundary.mjs` is what keeps that true: the broker, `install` and
 * `identity` may not be statically imported from outside this directory, and may not appear in the
 * measured start-up asset set.
 */
import type { PlaybackCredentialBroker } from './PlaybackCredentialBroker';

/** The `ApiClient` fields this module reads. Deliberately narrow; no import of the runtime. */
interface CredentialCapableApiClient {
    _playbackCredentials?: Promise<PlaybackCredentialBroker>;
    /**
     * The per-`ApiClient` cache `install.ts` writes. Named here — with no import — so teardown can
     * clear it. Leaving it set is what made a re-login hand back a DISPOSED broker.
     */
    _credentialRuntime?: unknown;
}

/**
 * The broker for one `ApiClient`, built on first use.
 *
 * Asynchronous by construction: minting is asynchronous anyway, so awaiting the implementation
 * chunk here costs a caller nothing it was not already awaiting. The `import()` is issued from this
 * module rather than from a boot module, and it is reached only from playback call sites, so the
 * chunk is genuinely requested when playback starts and not before.
 */
export async function brokerFor(
    apiClient: CredentialCapableApiClient | undefined | null
): Promise<PlaybackCredentialBroker | undefined> {
    if (!apiClient) return undefined;
    if (!apiClient._playbackCredentials) {
        const module = await import('./install');
        // `createCredentialRuntime` is idempotent per ApiClient, so two callers racing this import
        // cannot produce two brokers with two sets of renewal timers.
        apiClient._playbackCredentials ??= Promise.resolve(
            module.createCredentialRuntime(apiClient as never).broker
        );
    }
    return apiClient._playbackCredentials;
}

/**
 * Drop one session's media credentials.
 *
 * WHY IT IMPORTS NOTHING. This runs from `ServerConnections`'s `localusersignedout` handler, which
 * is in the eager graph. An `import()` here would be issued unconditionally at sign-out and would
 * pull the broker chunk in for a session that has just ended — and, if this module were ever
 * declared a boot module, would put those bytes back in the start-up tier. It only clears fields
 * and disposes a broker that already exists.
 *
 * WHY IT DOES NOT TOUCH THE SOCKET. It no longer has to. `ConnectionManager` calls `Api.update()`
 * with an empty access token on sign-out, and the patched `WebSocketService` disconnects and
 * cancels any mint in flight; the next sign-in calls `updateUrl()`, which mints again with the
 * CURRENT authorization. The socket's lifecycle belongs to the sdk, which is the point of the
 * reshape.
 *
 * WHY EVERY FIELD IS CLEARED. `ConnectionManager._getOrAddApiClient` returns the SAME `ApiClient`
 * for a server it has seen before, so a sign-out followed by a sign-in to the same server reuses
 * this instance. Leaving `_credentialRuntime` set made `createCredentialRuntime` hand that second
 * session the FIRST session's disposed broker: `mediaValue` then throws for every playback.
 */
export function disposePlaybackCredentials(
    apiClient: CredentialCapableApiClient
): void {
    const broker = apiClient._playbackCredentials;
    apiClient._playbackCredentials = undefined;
    apiClient._credentialRuntime = undefined;
    void broker?.then((instance) => instance.dispose());
}

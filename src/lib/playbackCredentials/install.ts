/**
 * Attaching the credential machinery to one `ApiClient` (#153-A1).
 *
 * Loaded behind `import()` from `./boot`, which is the eager half. See that file for why the split
 * exists and what it does not change about the bytes a visitor downloads.
 *
 * THE SEAM IS THE ONE THAT ALREADY EXISTS. `connectionManager.js` caches a `@jellyfin/sdk` `Api` on
 * every `ApiClient` as `_sdk` and a `TesserafinApi` as `_tesserafinSdk`, and calls `.update()` on both
 * at every re-login and token refresh. `ServerConnections`'s `apiclientcreated` handler is where
 * per-instance wiring already happens (it is where `apiClient.subscribe` is bound). Everything here
 * hangs off that, so there is no module-level state and no way for two servers or two users to
 * reach each other's credentials.
 *
 * THE GENERATED CLIENTS ARE IMPORTED LAZILY. `ServerConnections` is reached eagerly from the
 * application's entry chunk; `lib/tesserafin-sdk/client.ts` already points at concrete generated
 * modules rather than the barrel for exactly that reason. `import()` inside the async mint keeps
 * both generated API classes out of the eager graph entirely.
 */
import type { PlaybackCapabilityRequestDto } from 'lib/tesserafin-sdk/generated/models/playback-capability-request-dto';

import { PlaybackCredentialBroker } from './PlaybackCredentialBroker';
import { TicketedWebSocketService } from './TicketedWebSocketService';

/** The `ApiClient` shape this module reads. Deliberately narrow. */
interface CredentialCapableApiClient {
    serverId: () => string;
    getCurrentUserId: () => string;
    deviceId: () => string;
    accessToken: () => string;
    serverAddress: () => string;
    _sdk?: {
        webSocket?: unknown;
    };
    _tesserafinSdk?: {
        basePath: string;
        configuration: unknown;
    };
    _credentialRuntime?: {
        broker: PlaybackCredentialBroker;
        socket: TicketedWebSocketService;
    };
}

function requireTesserafinApi(apiClient: CredentialCapableApiClient) {
    const api = apiClient._tesserafinSdk;
    if (!api) {
        // Failed initialisation is a refusal, not a silent degrade to the durable token.
        throw new Error(
            '[playbackCredentials] the tesserafin-sdk instance is not initialised for this ApiClient'
        );
    }
    return api;
}

/**
 * Build the broker for one `ApiClient`.
 *
 * Every dependency is a getter rather than a captured value: an `ApiClient`'s user, device and
 * access token all change in place across re-login, and a captured token is how a broker keeps
 * minting for a session that ended.
 */
export function createBroker(
    apiClient: CredentialCapableApiClient
): PlaybackCredentialBroker {
    return new PlaybackCredentialBroker({
        serverId: () => apiClient.serverId(),
        userId: () => apiClient.getCurrentUserId(),
        deviceId: () => apiClient.deviceId(),
        accessToken: () => apiClient.accessToken(),
        mintCapability: async (request: PlaybackCapabilityRequestDto) => {
            const api = requireTesserafinApi(apiClient);
            const { PlaybackCredentialsApi } = await import(
                'lib/tesserafin-sdk/generated/api/playback-credentials-api'
            );
            const client = new PlaybackCredentialsApi(
                api.configuration as never,
                api.basePath
            );
            const response = await client.mintPlaybackCapability({
                playbackCapabilityRequestDto: request
            });
            return response.data;
        },
        renewCapability: async (capabilityId: string) => {
            const api = requireTesserafinApi(apiClient);
            const { PlaybackCredentialsApi } = await import(
                'lib/tesserafin-sdk/generated/api/playback-credentials-api'
            );
            const client = new PlaybackCredentialsApi(
                api.configuration as never,
                api.basePath
            );
            const response = await client.renewPlaybackCapability({
                capabilityId
            });
            return response.data;
        },
        mintWebSocketTicket: async () => {
            const api = requireTesserafinApi(apiClient);
            const { WebSocketTicketsApi } = await import(
                'lib/tesserafin-sdk/generated/api/web-socket-tickets-api'
            );
            const client = new WebSocketTicketsApi(
                api.configuration as never,
                api.basePath
            );
            const response = await client.mintWebSocketTicket();
            return response.data;
        }
    });
}

/**
 * The broker and the ticketed socket for one `ApiClient`, built once.
 *
 * `Api.subscribe()` reads `if (!this.webSocket) { this.webSocket = new WebSocketService(...) }`, so
 * assigning `_sdk.webSocket` HERE — before any caller subscribes — is what diverts every subscriber
 * onto the ticketed service. No call site changes, and `Api.update()`'s `webSocket?.updateUrl(...)`
 * lands on the ticketed service too, which ignores the url it is handed.
 *
 * Idempotent: called again for the same `ApiClient`, it returns the existing broker rather than
 * building a second one, because two brokers on one connection would each keep their own renewal
 * timers.
 */
export function createCredentialRuntime(
    apiClient: CredentialCapableApiClient
): { broker: PlaybackCredentialBroker; socket: TicketedWebSocketService } {
    const existing = apiClient._credentialRuntime;
    if (existing) return existing;

    const broker = createBroker(apiClient);
    const socket = new TicketedWebSocketService({
        basePath: () => apiClient.serverAddress(),
        mintTicket: () => broker.webSocketTicket()
    });

    const runtime = { broker, socket };
    apiClient._credentialRuntime = runtime;
    return runtime;
}

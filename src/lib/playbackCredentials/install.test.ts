/**
 * #153-A1 — the per-`ApiClient` runtime cache.
 *
 * `createCredentialRuntime` is the only thing that builds a broker, and it caches what it built on
 * the `ApiClient`. That cache is what a second session inherits, so its liveness rule is a
 * SEPARATE defence from the teardown in `boot.ts` and is proven separately here: `boot.test.ts`
 * deliberately models a cache WITHOUT this rule, so neither file can pass on the other's work.
 */
import { describe, expect, it } from 'vitest';

import { createCredentialRuntime } from './install';

function apiClient() {
    return {
        serverId: () => 'server-1',
        getCurrentUserId: () => 'user-1',
        deviceId: () => 'device-1',
        accessToken: () => 'token-1',
        serverAddress: () => 'http://server.example:8096',
        _sdk: {} as { webSocket?: unknown },
        _tesserafinSdk: {
            basePath: 'http://server.example:8096',
            configuration: {}
        }
    };
}

describe('createCredentialRuntime', () => {
    it('builds one runtime per ApiClient', () => {
        const client = apiClient();
        const first = createCredentialRuntime(client as never);
        const second = createCredentialRuntime(client as never);
        // Two brokers on one connection would each keep their own renewal timers.
        expect(second).toBe(first);
    });

    it('keeps two ApiClients apart', () => {
        const a = createCredentialRuntime(apiClient() as never);
        const b = createCredentialRuntime(apiClient() as never);
        expect(b).not.toBe(a);
    });

    it('never hands back a runtime whose broker has been disposed', () => {
        const client = apiClient();
        const first = createCredentialRuntime(client as never);
        first.broker.dispose();

        const second = createCredentialRuntime(client as never);

        // A disposed broker refuses every mint, so returning it would refuse every playback of the
        // NEXT session with no way to recover short of a reload.
        expect(second).not.toBe(first);
        expect(second.broker.isDisposed).toBe(false);
    });

    it('reports disposal through isDisposed', () => {
        const { broker } = createCredentialRuntime(apiClient() as never);
        expect(broker.isDisposed).toBe(false);
        broker.dispose();
        expect(broker.isDisposed).toBe(true);
    });
});

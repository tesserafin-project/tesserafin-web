import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MINIMUM_VERSION as TESSERAFIN_MINIMUM_VERSION } from 'lib/tesserafin-sdk/versions';

import { ConnectionState } from './connectionState';

/**
 * Regression coverage for the release blocker in tesserafin-web#65: `ConnectionManager` used to take
 * its default minimum server version from `@jellyfin/sdk/lib/versions` (`10.10.0`, a Jellyfin
 * release number), so every Tesserafin server - which reports `1.0.0` - was rejected with
 * `ConnectionState.ServerUpdateNeeded` and the browser rendered the `Update Required` page instead
 * of the onboarding wizard.
 *
 * These tests exercise the real `connectToServer` path, not the constant in isolation: the
 * `/System/Info/Public` probe is stubbed at `utils/fetch`, so what is asserted is the connection
 * outcome the browser would actually observe.
 */

const ajax = vi.fn();

vi.mock('utils/fetch', () => ({
    ajax: (...args: unknown[]) => ajax(...args)
}));

/**
 * `onSuccessfulConnection` reaches deep into the legacy `ApiClient`. None of that is under test
 * here, so the accepted-server path is given a permissive stub whose every member is a no-op
 * function - the assertions only care which `ConnectionState` comes back.
 */
const createApiClientStub = () =>
    new Proxy(
        {},
        {
            get: (target: Record<string, unknown>, prop: string | symbol) => {
                if (prop in target) return target[prop as string];
                if (typeof prop === 'symbol') return undefined;
                // Private members such as `_sdk`/`_tesserafinSdk` are assigned with `??=`
                // and must stay undefined until then; everything else is called as a method.
                if (prop.startsWith('_')) return undefined;
                const method = vi.fn();
                target[prop] = method;
                return method;
            },
            set: (target: Record<string, unknown>, prop: string, value) => {
                target[prop] = value;
                return true;
            }
        }
    );

vi.mock('utils/jellyfin-apiclient/createApiClient', () => ({
    createApiClient: () => createApiClientStub()
}));

vi.mock('utils/jellyfin-apiclient/compat', () => ({
    toApi: () => ({ update: vi.fn() }),
    toTesserafinApi: () => ({ update: vi.fn() })
}));

const SERVER_ID = 'server-under-test';

const createCredentialProvider = () => {
    const credentials = { Servers: [] as Record<string, unknown>[] };

    return {
        credentials: (val?: typeof credentials) => {
            if (val) Object.assign(credentials, val);
            return credentials;
        },
        addOrUpdateServer: (
            servers: Record<string, unknown>[],
            server: Record<string, unknown>
        ) => {
            servers.push(server);
            return server;
        }
    };
};

const createConnectionManager = async () => {
    const { default: ConnectionManager } = await import('./connectionManager');

    return new ConnectionManager(
        createCredentialProvider(),
        'Tesserafin Web',
        '1.0.0',
        'Test Device',
        'test-device-id',
        {}
    );
};

/** A server that only ever answers on its manual address, as the bundled web app does. */
const manualServer = () => ({
    Id: SERVER_ID,
    ManualAddress: 'http://tesserafin.test:8096',
    manualAddressOnly: true
});

const respondWithVersion = (version: string) => {
    ajax.mockResolvedValue({
        Id: SERVER_ID,
        ServerName: 'Tesserafin Test Server',
        Version: version,
        StartupWizardCompleted: false
    });
};

describe('ConnectionManager minimum server version', () => {
    beforeEach(() => {
        ajax.mockReset();
    });

    it('defaults to the Tesserafin-owned minimum, not the Jellyfin SDK one', async () => {
        const connectionManager = await createConnectionManager();

        expect(connectionManager.minServerVersion()).toBe(
            TESSERAFIN_MINIMUM_VERSION
        );
        // Guards the regression directly: `@jellyfin/sdk/lib/versions` exports '10.10.0'.
        expect(connectionManager.minServerVersion()).not.toBe('10.10.0');
    });

    it('resolves the Tesserafin-owned minimum to the pinned contract version 1.0.0', () => {
        expect(TESSERAFIN_MINIMUM_VERSION).toBe('1.0.0');
    });

    it('accepts a Tesserafin server reporting 1.0.0', async () => {
        const connectionManager = await createConnectionManager();
        respondWithVersion('1.0.0');

        const result = await connectionManager.connectToServer(manualServer());

        expect(result.State).not.toBe(ConnectionState.ServerUpdateNeeded);
        expect(result.State).toBe(ConnectionState.ServerSignIn);
    });

    it('rejects a server below the Tesserafin public epoch', async () => {
        const connectionManager = await createConnectionManager();
        respondWithVersion('0.9.0');

        const result = await connectionManager.connectToServer(manualServer());

        expect(result.State).toBe(ConnectionState.ServerUpdateNeeded);
    });

    it('still honours an explicit override through the minServerVersion seam', async () => {
        const connectionManager = await createConnectionManager();
        connectionManager.minServerVersion('2.0.0');
        expect(connectionManager.minServerVersion()).toBe('2.0.0');

        respondWithVersion('1.0.0');

        const result = await connectionManager.connectToServer(manualServer());

        expect(result.State).toBe(ConnectionState.ServerUpdateNeeded);
    });
});

import { Credentials } from 'jellyfin-apiclient';

import { appHost } from 'components/apphost';
import appSettings from 'scripts/settings/appSettings';
import { setUserInfo } from 'scripts/settings/userSettings';
import { detectBitrate } from 'utils/bitrateTest';
import Dashboard from 'utils/dashboard';
import Events from 'utils/events';
import { createApiClient } from 'utils/jellyfin-apiclient/createApiClient';

import {
    disposePlaybackCredentials,
    installPlaybackCredentials
} from 'lib/playbackCredentials/boot';

import ConnectionManager from './connectionManager';

const normalizeImageOptions = (options) => {
    if (
        !options.quality &&
        (options.maxWidth ||
            options.width ||
            options.maxHeight ||
            options.height ||
            options.fillWidth ||
            options.fillHeight)
    ) {
        options.quality = 90;
    }
};

const getMaxBandwidth = () => {
    if (navigator.connection) {
        let max = navigator.connection.downlinkMax;
        if (max && max > 0 && max < Number.POSITIVE_INFINITY) {
            max /= 8;
            max *= 1000000;
            max *= 0.7;
            return parseInt(max, 10);
        }
    }

    return null;
};

class ServerConnections extends ConnectionManager {
    firstConnection = false;

    constructor() {
        super(...arguments);
        this.localApiClient = null;
        this.firstConnection = null;

        Events.on(this, 'localusersignedout', (_e, logoutInfo) => {
            // #153-A1: the capabilities and the socket ticket belong to the session that just
            // ended. Dropping them here cancels every renewal timer and closes the socket, so
            // nothing keeps extending a credential for a user who signed out.
            for (const apiClient of this.getApiClients()) {
                disposePlaybackCredentials(apiClient);
            }
            setUserInfo(null, null);
            // Ensure the updated credentials are persisted to storage
            credentialProvider.credentials(credentialProvider.credentials());

            if (
                window.NativeShell &&
                typeof window.NativeShell.onLocalUserSignedOut === 'function'
            ) {
                window.NativeShell.onLocalUserSignedOut(logoutInfo);
            }
        });

        Events.on(this, 'apiclientcreated', (_e, apiClient) => {
            apiClient.getMaxBandwidth = getMaxBandwidth;
            apiClient.normalizeImageOptions = normalizeImageOptions;

            // Calling getApi will ensure apiClient._sdk is initialized.
            this.getApi(apiClient.serverId());
            // ...and getTesserafinApi the same for _tesserafinSdk, which is what the credential
            // broker mints through.
            this.getTesserafinApi(apiClient.serverId());

            // #153-A1: install BEFORE the subscribe binding below. `Api.subscribe()` only builds
            // its own WebSocketService when `this.webSocket` is unset, so assigning the ticketed
            // service here is what diverts every subscriber - both this binding and the direct
            // `api.subscribe(...)` call sites - onto a socket that mints a fresh ticket for every
            // physical upgrade attempt.
            installPlaybackCredentials(apiClient);

            apiClient.subscribe = apiClient._sdk.subscribe.bind(apiClient._sdk);
        });
    }

    initApiClient(server) {
        console.debug('creating ApiClient singleton');

        const apiClient = createApiClient(
            server,
            appHost.appName(),
            appHost.appVersion(),
            appHost.deviceName(),
            appHost.deviceId()
        );

        apiClient.enableAutomaticNetworking = false;
        apiClient.manualAddressOnly = true;

        this.addApiClient(apiClient);

        this.setLocalApiClient(apiClient);

        console.debug('loaded ApiClient singleton');
    }

    /**
     * @returns {Promise<import('jellyfin-apiclient').ConnectResponse>} The result of the connection attempt.
     */
    connect(options) {
        return super.connect({
            enableAutoLogin: appSettings.enableAutoLogin(),
            ...options
        });
    }

    setLocalApiClient(apiClient) {
        if (apiClient) {
            this.localApiClient = apiClient;
            window.ApiClient = apiClient;
            // Calling getApi will ensure apiClient._sdk is initialized.
            this.getApi(apiClient.serverId());
        }
    }

    getLocalApiClient() {
        return this.localApiClient;
    }

    /**
     * Gets the ApiClient that is currently connected.
     * @returns {import('jellyfin-apiclient').ApiClient|undefined} apiClient
     */
    currentApiClient() {
        let apiClient = this.getLocalApiClient();

        if (!apiClient) {
            const server = this.getLastUsedServer();

            if (server) {
                apiClient = this.getApiClient(server.Id);
            }
        }

        return apiClient;
    }

    /**
     * Gets the ApiClient that is currently connected or throws if not defined.
     * @async
     * @returns {Promise<ApiClient>} The current ApiClient instance.
     */
    async getCurrentApiClientAsync() {
        const apiClient = this.currentApiClient();
        if (!apiClient)
            throw new Error('[ServerConnection] No current ApiClient instance');

        return apiClient;
    }

    onLocalUserSignedIn(user) {
        const apiClient = this.getApiClient(user.ServerId);
        this.setLocalApiClient(apiClient);
        setTimeout(() => detectBitrate(this.getApi(user.ServerId), true), 6000);
        return setUserInfo(user.Id, apiClient).then(() => {
            if (
                window.NativeShell &&
                typeof window.NativeShell.onLocalUserSignedIn === 'function'
            ) {
                return window.NativeShell.onLocalUserSignedIn(
                    user,
                    apiClient.accessToken()
                );
            }
            return Promise.resolve();
        });
    }
}

const credentialProvider = new Credentials();

const capabilities = Dashboard.capabilities(appHost);

export default new ServerConnections(
    credentialProvider,
    () => appHost.appName(),
    () => appHost.appVersion(),
    () => appHost.deviceName(),
    () => appHost.deviceId(),
    capabilities
);

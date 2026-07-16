/**
 * Barrel for the generated Reefin API client (src/lib/reefin-sdk/generated/, produced by
 * `npm run generate:reefin-sdk` - see README.md in this directory) PLUS the hand-written
 * construction wrapper below (`ReefinSdk`/`ReefinApi`/`createReefinApi`), which mirrors
 * `@jellyfin/sdk`'s own `Jellyfin`/`Api`/`createApi` shape (see `node_modules/@jellyfin/sdk/lib/
 * jellyfin.js`, `api.js`) so migrating a call site is a construction-point swap, not a rewrite -
 * see docs/reefin/design-reefin-api-layer.md §3/§4.1.
 */
export * from './generated';

import globalAxios, { type AxiosInstance } from 'axios';

import { Configuration, SystemApi } from './generated';

/**
 * The protocol-level client identity sent to the server as part of the `Authorization` header
 * (`MediaBrowser Client="...", Device="...", ...`) - what the server-side session list, Quick
 * Connect, and per-device capability negotiation all key off.
 *
 * docs/reefin/branding-audit.md categorie 1 documents why this is still `'Jellyfin Web'` today:
 * renaming it requires a coordinated server-side migration of existing sessions (Quick Connect,
 * device management), not just a client-side string change. `src/components/apphost.js:11`
 * (`const appName = 'Jellyfin Web'`) and `src/utils/image.ts:84` (`case 'Jellyfin Web':`, the
 * device-icon lookup keyed on this exact string) are the two places that currently have to change
 * together if this value ever does - see the design doc §4.4 for the full articulation-point
 * rationale.
 *
 * This constant is the single point a future rename touches on the `reefin-sdk` side.
 * `utils/jellyfin-apiclient/compat.ts`'s `toReefinApi()` (design doc §8 PR3) reads it when building
 * the parallel `ReefinApi` instance described on the `ReefinApi` class below; `toApi()` (the
 * `@jellyfin/sdk` instance every existing call site still uses) is untouched and keeps deriving the
 * *same* literal from `appHost.appName()` - both paths send an identical `Authorization` header
 * today, so wiring this constant in changed nothing observable server-side. It gives a future
 * connection-layer PR one constant to edit instead of the two coupled call sites
 * (`apphost.js:11`/`image.ts:84`) once a real rename is coordinated with the server.
 */
export const REEFIN_CLIENT_IDENTITY = {
    /** Sent as `Client="..."` in the `Authorization` header. */
    name: 'Jellyfin Web'
} as const;

/** Client name/version pair sent as `Client="..."`/`Version="..."` in the `Authorization` header. */
export interface ReefinClientInfo {
    name: string;
    version: string;
}

/** Device name/id pair sent as `Device="..."`/`DeviceId="..."` in the `Authorization` header. */
export interface ReefinDeviceInfo {
    name: string;
    id: string;
}

/**
 * Builds the `MediaBrowser ...` `Authorization` header value. Same format/field order as
 * `@jellyfin/sdk`'s `getAuthorizationHeader` (`lib/utils/authentication.js`) - the server-side
 * parser (`Reefin.Server.Authentication`, inherited from Jellyfin) expects this exact shape
 * regardless of which SDK produced it.
 */
const buildAuthorizationHeader = (
    clientInfo: ReefinClientInfo,
    deviceInfo: ReefinDeviceInfo,
    accessToken: string
): string =>
    [
        `MediaBrowser Client="${encodeURIComponent(clientInfo.name)}"`,
        `Device="${encodeURIComponent(deviceInfo.name)}"`,
        `DeviceId="${encodeURIComponent(deviceInfo.id)}"`,
        `Version="${encodeURIComponent(clientInfo.version)}"`,
        `Token="${encodeURIComponent(accessToken)}"`
    ].join(', ');

/**
 * Configured access to the generated Reefin API client for one server connection - the
 * `reefin-sdk` equivalent of `@jellyfin/sdk`'s `Api` class. Deliberately narrower: no WebSocket
 * (`subscribe`), no deprecated `authenticateUserByName`/`logout` convenience methods - those are
 * connection/session lifecycle concerns (design doc §4.2, "successor of `jellyfin-apiclient`"),
 * out of scope for the SDK construction wrapper itself.
 *
 * **Exposed in parallel, not as a replacement (design doc §8 PR3).** `useApi()`
 * (`hooks/useApi.tsx`) exposes this as `reefinApi`, alongside the still-primary `@jellyfin/sdk`
 * `api` field it has always exposed. `api` is NOT being replaced in this PR: an audit before this
 * change found ~134 files calling `useApi()` and ~15+ files calling `api.subscribe(...)`
 * (WebSocket - SyncPlay, live sessions/tasks dashboards, item-refresh indicators, cache
 * invalidation, playback remote control, guide timers) - `ReefinApi` has no WebSocket support, so
 * swapping the primary `api` field today would silently break all of that. `reefinApi` is additive:
 * a second, fully independent field new call sites can opt into (this PR's proof is
 * `apps/dashboard/features/storage`), while every existing `api`/`__legacyApiClient__` consumer
 * keeps working completely unchanged. `utils/jellyfin-apiclient/connectionManager.js` caches this
 * instance on the legacy `ApiClient` as `_reefinSdk` (mirroring the existing `_sdk` cache for
 * `@jellyfin/sdk`) and calls `.update()` on it at the same two points it already updates `_sdk`, so
 * it stays current across re-login/token refresh without needing its own reconnect logic.
 */
export class ReefinApi {
    private _basePath: string;
    private _clientInfo: ReefinClientInfo;
    private _deviceInfo: ReefinDeviceInfo;
    private _accessToken: string;

    /** The underlying axios instance every generated `*Api` class ends up calling through. */
    public readonly axiosInstance: AxiosInstance;

    constructor(
        basePath: string,
        clientInfo: ReefinClientInfo,
        deviceInfo: ReefinDeviceInfo,
        accessToken = '',
        axiosInstance: AxiosInstance = globalAxios
    ) {
        this._basePath = basePath.endsWith('/')
            ? basePath.slice(0, -1)
            : basePath;
        this._clientInfo = clientInfo;
        this._deviceInfo = deviceInfo;
        this._accessToken = accessToken;
        this.axiosInstance = axiosInstance;
    }

    get basePath(): string {
        return this._basePath;
    }

    get accessToken(): string {
        return this._accessToken;
    }

    get clientInfo(): ReefinClientInfo {
        return this._clientInfo;
    }

    get deviceInfo(): ReefinDeviceInfo {
        return this._deviceInfo;
    }

    /** The `Authorization` header value for this connection - see `buildAuthorizationHeader`. */
    get authorizationHeader(): string {
        return buildAuthorizationHeader(
            this._clientInfo,
            this._deviceInfo,
            this._accessToken
        );
    }

    /**
     * A `generated/configuration.ts` `Configuration` pre-populated with `basePath` and the
     * `Authorization` header, ready to pass into any generated `*Api`/`*ApiFactory` constructor
     * alongside `basePath`/`axiosInstance`. Same shape as `@jellyfin/sdk`'s `Api.configuration`
     * getter.
     */
    get configuration(): Configuration {
        return new Configuration({
            basePath: this._basePath,
            baseOptions: {
                headers: {
                    Authorization: this.authorizationHeader
                }
            }
        });
    }

    /**
     * Updates this instance's identity/session fields in place - same purpose as `@jellyfin/sdk`'s
     * `Api.update()`, minus the WebSocket reconnection it also does there (`ReefinApi` has no
     * WebSocket, by design - see the class doc comment). Exists so `utils/jellyfin-apiclient/
     * connectionManager.js` can keep a long-lived `ReefinApi` (cached on the legacy `ApiClient`,
     * mirroring how it already caches the `@jellyfin/sdk` instance as `_sdk`) current across
     * re-login/token refresh, instead of every reader risking a stale `accessToken`.
     */
    update(data: {
        basePath?: string;
        clientInfo?: ReefinClientInfo;
        deviceInfo?: ReefinDeviceInfo;
        accessToken?: string;
    }): void {
        if (data.basePath) {
            this._basePath = data.basePath;
        }
        if (data.clientInfo) {
            this._clientInfo = data.clientInfo;
        }
        if (data.deviceInfo) {
            this._deviceInfo = data.deviceInfo;
        }
        if (data.accessToken !== undefined) {
            this._accessToken = data.accessToken;
        }
    }
}

/** The `reefin-sdk` equivalent of `@jellyfin/sdk`'s `Jellyfin` class: holds the identity for a
 * client instance and mints `ReefinApi`s for individual server connections from it. */
export class ReefinSdk {
    public readonly clientInfo: ReefinClientInfo;
    public readonly deviceInfo: ReefinDeviceInfo;

    constructor(parameters: {
        clientInfo: ReefinClientInfo;
        deviceInfo: ReefinDeviceInfo;
    }) {
        this.clientInfo = parameters.clientInfo;
        this.deviceInfo = parameters.deviceInfo;
    }

    createApi(
        basePath: string,
        accessToken?: string,
        axiosInstance?: AxiosInstance
    ): ReefinApi {
        return new ReefinApi(
            basePath,
            this.clientInfo,
            this.deviceInfo,
            accessToken,
            axiosInstance
        );
    }
}

/**
 * Convenience one-shot equivalent of `new ReefinSdk({ clientInfo, deviceInfo }).createApi(...)`.
 * `clientInfo.name` defaults to `REEFIN_CLIENT_IDENTITY.name` (today's `'Jellyfin Web'`) so callers
 * that don't need to override it - which, until the connection layer migrates, is everyone - get
 * the single point of truth for free.
 */
export const createReefinApi = (
    basePath: string,
    accessToken: string,
    deviceInfo: ReefinDeviceInfo,
    clientInfo: ReefinClientInfo = {
        name: REEFIN_CLIENT_IDENTITY.name,
        version: '0.0.0'
    },
    axiosInstance?: AxiosInstance
): ReefinApi =>
    new ReefinSdk({ clientInfo, deviceInfo }).createApi(
        basePath,
        accessToken,
        axiosInstance
    );

/**
 * Per-tag generated-client convenience factories, one per `*Api` class actually consumed so far -
 * same naming/shape as `@jellyfin/sdk`'s own `get*Api(api)` helpers
 * (`node_modules/@jellyfin/sdk/lib/utils/api/system-api.js`: `new SystemApi(api.configuration,
 * undefined, api.axiosInstance)`), so a call site migrating from `@jellyfin/sdk` to `reefin-sdk`
 * changes its import source, not its call shape (design doc §3's "mechanical swap" claim - this is
 * what makes it true in practice). Add one of these per generated `*Api` class as a second/third
 * consumer needs it, rather than inlining `new XApi(api.configuration, ...)` at every call site.
 */
export const getSystemApi = (api: ReefinApi): SystemApi =>
    new SystemApi(api.configuration, undefined, api.axiosInstance);

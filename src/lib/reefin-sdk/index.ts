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

import { Configuration } from './generated';

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
 * This constant is the single point that a future rename touches on the `reefin-sdk` side. It is
 * NOT wired into `useApi()`/the connection layer yet (see the class doc comments below) - today's
 * requests still carry the identity `utils/jellyfin-apiclient/compat.ts` (`toApi()`) computes from
 * `appHost.appName()`, which resolves to this exact same literal by a different path. Centralizing
 * it here does not change what is sent to the server; it gives the future connection-layer PR
 * (design doc §4.2/§8 PR3) one constant to edit instead of two coupled call sites.
 */
export const REEFIN_CLIENT_IDENTITY = {
    /** Sent as `Client="..."` in the `Authorization` header. */
    name: 'Jellyfin Web'
} as const;

/** Client name/version pair sent as `Client="..."`/`Version="..."` in the `Authorization` header. */
export interface ReefinClientInfo {
    name: string
    version: string
}

/** Device name/id pair sent as `Device="..."`/`DeviceId="..."` in the `Authorization` header. */
export interface ReefinDeviceInfo {
    name: string
    id: string
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
): string => [
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
 * **Not used by any consumer yet.** `useApi()` (`hooks/useApi.tsx`) still builds and exposes a
 * `@jellyfin/sdk` `Api` instance via `utils/jellyfin-apiclient/compat.ts`'s `toApi()`. This class
 * exists so that swap has a concrete target: a later PR replaces the body of `toApi()` (or its
 * caller) with `createReefinApi(...)`, at which point every generated-client call site already
 * written against the shape this class exposes (`basePath`/`axiosInstance`/`authorizationHeader`/
 * `configuration`) keeps working unchanged.
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
        this._basePath = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
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
        return buildAuthorizationHeader(this._clientInfo, this._deviceInfo, this._accessToken);
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
}

/** The `reefin-sdk` equivalent of `@jellyfin/sdk`'s `Jellyfin` class: holds the identity for a
 * client instance and mints `ReefinApi`s for individual server connections from it. */
export class ReefinSdk {
    public readonly clientInfo: ReefinClientInfo;
    public readonly deviceInfo: ReefinDeviceInfo;

    constructor(parameters: { clientInfo: ReefinClientInfo, deviceInfo: ReefinDeviceInfo }) {
        this.clientInfo = parameters.clientInfo;
        this.deviceInfo = parameters.deviceInfo;
    }

    createApi(basePath: string, accessToken?: string, axiosInstance?: AxiosInstance): ReefinApi {
        return new ReefinApi(basePath, this.clientInfo, this.deviceInfo, accessToken, axiosInstance);
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
    clientInfo: ReefinClientInfo = { name: REEFIN_CLIENT_IDENTITY.name, version: '0.0.0' },
    axiosInstance?: AxiosInstance
): ReefinApi => new ReefinSdk({ clientInfo, deviceInfo }).createApi(basePath, accessToken, axiosInstance);

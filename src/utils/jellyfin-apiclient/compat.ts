import { Api, Jellyfin } from '@jellyfin/sdk';
import { ApiClient } from 'jellyfin-apiclient';

import {
    TESSERAFIN_CLIENT_IDENTITY,
    TesserafinApi,
    TesserafinSdk
} from 'lib/tesserafin-sdk/client';
import { safeDecodeURIComponent } from 'utils/url';

/**
 * Returns an SDK Api instance using the same parameters as the provided ApiClient.
 * @param {ApiClient} apiClient The (legacy) ApiClient.
 * @returns {Api} An equivalent SDK Api instance.
 */
export const toApi = (apiClient: ApiClient): Api => {
    return new Jellyfin({
        // The SDK encodes these values when creating the authorization header,
        // so we need to decode them here to avoid double encoding.
        clientInfo: {
            name: safeDecodeURIComponent(apiClient.appName()),
            version: safeDecodeURIComponent(apiClient.appVersion())
        },
        deviceInfo: {
            name: safeDecodeURIComponent(apiClient.deviceName()),
            id: safeDecodeURIComponent(apiClient.deviceId())
        }
    }).createApi(apiClient.serverAddress(), apiClient.accessToken());
};

/**
 * `toApi()`'s `tesserafin-sdk` counterpart (docs/tesserafin/design-tesserafin-api-layer.md §8 PR3) - builds a
 * `TesserafinApi` from the same (legacy) `ApiClient`, so it targets the identical session: same
 * `serverAddress`/`accessToken`/`deviceName`/`deviceId` as `toApi()` reads, which is what
 * guarantees the exact same `DeviceId` the server already knows about, not a second device
 * identity. The one deliberate difference is `clientInfo.name`: sourced from the centralized
 * `TESSERAFIN_CLIENT_IDENTITY.name` rather than re-derived through `apiClient.appName()` (which itself
 * traces to `appHost.appName()`) - both resolve to the same `'Tesserafin Web'` literal today, so this
 * changes nothing observable server-side, but it is the single point a future rename touches on
 * this side (see `TESSERAFIN_CLIENT_IDENTITY`'s doc comment in `lib/tesserafin-sdk`).
 *
 * Callers needing to keep this fresh across re-login/token refresh should call `.update(...)` on
 * the returned instance the same way `utils/jellyfin-apiclient/connectionManager.js` already does
 * for `toApi()`'s result (`apiClient._sdk?.update(...)`) - see that file's `apiClient._tesserafinSdk`
 * handling for the concrete pattern.
 */
export const toTesserafinApi = (apiClient: ApiClient): TesserafinApi => {
    return new TesserafinSdk({
        clientInfo: {
            name: TESSERAFIN_CLIENT_IDENTITY.name,
            version: safeDecodeURIComponent(apiClient.appVersion())
        },
        deviceInfo: {
            name: safeDecodeURIComponent(apiClient.deviceName()),
            id: safeDecodeURIComponent(apiClient.deviceId())
        }
    }).createApi(apiClient.serverAddress(), apiClient.accessToken());
};

/**
 * Barrel for the generated Reefin API client (src/lib/reefin-sdk/generated/, produced by
 * `npm run generate:reefin-sdk` - see README.md in this directory) PLUS the hand-written
 * construction wrapper in `./client` (`ReefinSdk`/`ReefinApi`/`createReefinApi`), which mirrors
 * `@jellyfin/sdk`'s own `Jellyfin`/`Api`/`createApi` shape (see `node_modules/@jellyfin/sdk/lib/
 * jellyfin.js`, `api.js`) so migrating a call site is a construction-point swap, not a rewrite -
 * see docs/reefin/design-reefin-api-layer.md §3/§4.1.
 */
export * from './generated';
export * from './client';

import type { ReefinApi } from './client';
import { LibraryApi } from './generated/api/library-api';
import { ShowApi } from './generated/api/show-api';
import { SystemApi } from './generated/api/system-api';
import { UserViewApi } from './generated/api/user-view-api';

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

export const getLibraryApi = (api: ReefinApi): LibraryApi =>
    new LibraryApi(api.configuration, undefined, api.axiosInstance);

export const getUserViewApi = (api: ReefinApi): UserViewApi =>
    new UserViewApi(api.configuration, undefined, api.axiosInstance);

export const getShowApi = (api: ReefinApi): ShowApi =>
    new ShowApi(api.configuration, undefined, api.axiosInstance);

/**
 * Version metadata for the generated Reefin API client, derived from the pinned spec
 * (spec/version.json, written by `npm run generate:tesserafin-sdk`).
 *
 * Corrects a gap identified in docs/tesserafin/design-tesserafin-api-layer.md §2.1: the current
 * `@jellyfin/sdk`-based stack checks server compatibility against
 * `@jellyfin/sdk/lib/versions`' `MINIMUM_VERSION` ('10.10.0'), a Jellyfin version number that has
 * nothing to do with the `reefin` server this app actually targets. `ConnectionManager` now takes
 * its default minimum from here instead - see `lib/jellyfin-apiclient/connectionManager.js` and its
 * regression suite `connectionManager.minServerVersion.test.ts` (tesserafin-web#65).
 */

import pinnedVersion from './spec/version.json';

/** `info.version` (== `x-tesserafin-version`) of the OpenAPI spec the SDK was last generated from. */
export const TESSERAFIN_SPEC_VERSION: string =
    pinnedVersion.xTesserafinVersion ?? pinnedVersion.version ?? '0.0.0';

/**
 * Minimum `reefin` server version this client is known to work against, and the value
 * `ConnectionManager` compares `/System/Info/Public`'s `Version` against before emitting
 * `ConnectionState.ServerUpdateNeeded`. For now this simply tracks the spec version the client was
 * generated from; a real compatibility window rather than an exact pin is a follow-up, not part of
 * the tesserafin-web#65 fix.
 */
export const MINIMUM_VERSION: string = TESSERAFIN_SPEC_VERSION;

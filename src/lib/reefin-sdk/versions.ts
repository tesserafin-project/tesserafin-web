/**
 * Version metadata for the generated Reefin API client, derived from the pinned spec
 * (spec/version.json, written by `npm run generate:reefin-sdk`).
 *
 * Corrects a gap identified in docs/reefin/design-reefin-api-layer.md §2.1: the current
 * `@jellyfin/sdk`-based stack checks server compatibility against
 * `@jellyfin/sdk/lib/versions`' `MINIMUM_VERSION` ('10.10.0'), a Jellyfin version number that has
 * nothing to do with the `reefin` server this app actually targets. Once a consumer switches to
 * this module (not done in this PR - see README.md), it should check against `REEFIN_SPEC_VERSION`
 * instead.
 */

import pinnedVersion from './spec/version.json';

/** `info.version` (== `x-reefin-version`) of the OpenAPI spec the SDK was last generated from. */
export const REEFIN_SPEC_VERSION: string = pinnedVersion.xReefinVersion ?? pinnedVersion.version ?? '0.0.0';

/**
 * Minimum `reefin` server version this client is known to work against. For now this simply
 * tracks the spec version the client was generated from - once the connection layer (see design
 * doc §4.2) actually enforces this, it may need its own compatibility window rather than an exact
 * pin.
 */
export const MINIMUM_VERSION: string = REEFIN_SPEC_VERSION;

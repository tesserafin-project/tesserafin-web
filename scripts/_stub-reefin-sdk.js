/**
 * TEMPORARY measurement stub for issue #23 (LANE B item 1). Not for merge, never imported by src.
 *
 * Aliased over `lib/reefin-sdk` by webpack.stubsdk.js to measure the CEILING of what the real SDK
 * costs in main.jellyfin.bundle.js: build with the alias, diff the asset against the baseline.
 * Exports every name any eager issuer value-imports, so webpack resolves them and the build
 * succeeds; each is trivial so the SDK's real code contributes nothing.
 */
export const REEFIN_CLIENT_IDENTITY = {};

export class Configuration {}
export class SystemApi {}
export class LibraryApi {}
export class ShowApi {}
export class UserViewApi {}
export class ReefinApi {}
export class ReefinSdk {}

export const createReefinApi = () => new ReefinApi();
export const getSystemApi = () => new SystemApi();
export const getLibraryApi = () => new LibraryApi();
export const getShowApi = () => new ShowApi();
export const getUserViewApi = () => new UserViewApi();

export const BaseItemKind = {};
export const CollectionType = {};
export const ImageType = {};
export const ItemFilter = {};
export const ItemSortBy = {};
export const PlaybackDecisionMediaKind = {};
export const PlaybackDecisionPlaybackMethod = {};
export const PlaybackDecisionStreamingProtocol = {};
export const PlaybackDecisionTransformKind = {};
export const PlaybackDecisionSubtitleDeliveryMethod = {};
export const PlaybackDecisionReasonSubjectKind = {};
export const PlaybackDecisionReasonCode = {};
export const SortOrder = {};
export const ItemFields = {};
export const MediaType = {};
export const VideoRangeType = {};
export const ImageOrientation = {};
export const PlayMethod = {};

import type { BaseItemDto } from 'lib/reefin-sdk';
import { CollectionType, ImageType } from 'lib/reefin-sdk';
import type { MediaCardImageAspect, MediaCardProps } from 'ui';

/**
 * The slice of `jellyfin-apiclient`'s `ApiClient` this adapter needs (RFC-0005 §11 W13.6, WP4) -
 * `useApi().__legacyApiClient__`'s type, narrowed so tests can pass a plain object instead of a
 * full `ApiClient`. Deliberately not `@jellyfin/sdk`'s `Api`/`getImageApi` (forbidden import for
 * this slice, RFC-0005 §4.2) nor `components/cardbuilder/utils/url.ts`'s `getCardImageUrl`
 * (forbidden `components/cardbuilder/*` import) - both are still `apiClient`/`getImageUrl`-based
 * under the hood, so this mirrors the same mechanism the mission text calls out as the reuse target.
 */
export interface ImageApiClient {
    getImageUrl(itemId: string, options?: Record<string, unknown>): string;
    serverId?(): string;
}

export interface MediaCardPropsOptions {
    imageAspect: MediaCardImageAspect;
    /** Try an episode/series thumb image before the item's own primary image. */
    preferThumb?: boolean;
}

interface ImageSelection {
    itemId: string;
    type: string;
    tag: string;
}

/** The `preferThumb`-only candidates of `selectImage`, tried before any primary-image candidate. */
const selectThumbImage = (item: BaseItemDto): ImageSelection | undefined => {
    if (item.ImageTags?.Thumb) {
        return {
            itemId: item.Id ?? '',
            type: ImageType.Thumb,
            tag: item.ImageTags.Thumb
        };
    }

    if (item.SeriesId && item.SeriesThumbImageTag) {
        return {
            itemId: item.SeriesId,
            type: ImageType.Thumb,
            tag: item.SeriesThumbImageTag
        };
    }

    if (item.ParentThumbItemId && item.ParentThumbImageTag) {
        return {
            itemId: item.ParentThumbItemId,
            type: ImageType.Thumb,
            tag: item.ParentThumbImageTag
        };
    }

    if (item.BackdropImageTags?.length) {
        return {
            itemId: item.Id ?? '',
            type: ImageType.Backdrop,
            tag: item.BackdropImageTags[0] ?? ''
        };
    }

    return undefined;
};

/** The primary-image candidates of `selectImage`, tried once no thumb candidate matched. */
const selectPrimaryImage = (item: BaseItemDto): ImageSelection | undefined => {
    if (item.ImageTags?.Primary) {
        return {
            itemId: item.Id ?? '',
            type: ImageType.Primary,
            tag: item.ImageTags.Primary
        };
    }

    if (item.SeriesId && item.SeriesPrimaryImageTag) {
        return {
            itemId: item.SeriesId,
            type: ImageType.Primary,
            tag: item.SeriesPrimaryImageTag
        };
    }

    if (item.ParentPrimaryImageItemId && item.ParentPrimaryImageTag) {
        return {
            itemId: item.ParentPrimaryImageItemId,
            type: ImageType.Primary,
            tag: item.ParentPrimaryImageTag
        };
    }

    if (item.BackdropImageTags?.length) {
        return {
            itemId: item.Id ?? '',
            type: ImageType.Backdrop,
            tag: item.BackdropImageTags[0] ?? ''
        };
    }

    if (item.ImageTags?.Thumb) {
        return {
            itemId: item.Id ?? '',
            type: ImageType.Thumb,
            tag: item.ImageTags.Thumb
        };
    }

    return undefined;
};

/**
 * Picks which image to display for `item`, mirroring the field-priority order of
 * `components/cardbuilder/utils/url.ts`'s `getCardImageUrl` - trimmed to the branches `/home`'s
 * sections actually exercise (own thumb/primary, series-inherited thumb/primary, item backdrop);
 * banner/disc/logo/album-art branches are dropped since no `/home` section ever requests them.
 */
const selectImage = (
    item: BaseItemDto,
    preferThumb: boolean
): ImageSelection | undefined =>
    (preferThumb && selectThumbImage(item)) || selectPrimaryImage(item);

const getItemImageUrl = (
    item: BaseItemDto,
    apiClient: ImageApiClient | undefined,
    preferThumb: boolean
): string | undefined => {
    if (!apiClient) return undefined;

    const selection = selectImage(item, preferThumb);
    if (!selection?.itemId) return undefined;

    return apiClient.getImageUrl(selection.itemId, {
        type: selection.type,
        tag: selection.tag,
        quality: 96
    });
};

/** Route segment for each `CollectionType` with a dedicated library page (`RootAppRouter`/legacy routes). */
const LIBRARY_ROUTE_BY_COLLECTION_TYPE: Partial<
    Record<CollectionType, string>
> = {
    [CollectionType.Movies]: 'movies',
    [CollectionType.Tvshows]: 'tv',
    [CollectionType.Music]: 'music',
    [CollectionType.Books]: 'books',
    [CollectionType.Musicvideos]: 'musicvideos',
    [CollectionType.Boxsets]: 'boxsets',
    [CollectionType.Playlists]: 'playlists'
};

/**
 * Mirrors the subset of `components/router/appRouter.js`'s `getRouteUrl()` that `/home`'s cards
 * actually exercise: library tiles ("Mes médias", incl. Live TV/homevideos/mixed-content libraries)
 * route to their dedicated library page, and every other media item (movies/episodes/series from
 * Continue Watching, Next Up, Latest Media, Favorites) routes to the generic details page. This is
 * reimplemented locally instead of importing the `appRouter` singleton, which transitively pulls in
 * `RootAppRouter`'s full route tree and its side-effecting `history` construction - far more than a
 * details/library href needs, and a real risk of a circular import back into `routes/home.tsx`
 * (RFC-0005 §11 W13.6, WP4 - autonomous decision, see mission report).
 */
const getItemHref = (item: BaseItemDto, fallbackServerId?: string): string => {
    const id = item.Id ?? '';
    const serverId = item.ServerId ?? fallbackServerId ?? '';

    if (item.CollectionType === CollectionType.Livetv) {
        return `#/livetv?collectionType=${CollectionType.Livetv}`;
    }

    if (item.CollectionType === CollectionType.Homevideos) {
        return `#/homevideos?topParentId=${id}`;
    }

    const libraryRoute = item.CollectionType
        ? LIBRARY_ROUTE_BY_COLLECTION_TYPE[item.CollectionType]
        : undefined;

    if (libraryRoute) {
        return `#/${libraryRoute}?topParentId=${id}&collectionType=${item.CollectionType}`;
    }

    // Mixed-content library (a folder tile with no specific `CollectionType`), mirrors
    // `appRouter.getRouteUrl`'s `CollectionType == null && Type === 'CollectionFolder'` branch.
    if (
        !item.CollectionType &&
        item.IsFolder &&
        item.Type === 'CollectionFolder'
    ) {
        return `#/mixed?topParentId=${id}&collectionType=mixed`;
    }

    if (item.IsFolder) {
        return `#/list?parentId=${id}&serverId=${serverId}`;
    }

    return `#/details?id=${id}&serverId=${serverId}`;
};

/**
 * Adapts one `reefin-sdk` `BaseItemDto` to `ui`'s `MediaCardProps` (RFC-0005 §6/§11 W13.6, WP4).
 * `subtitle` follows a single rule that happens to reproduce every `/home` section's previous
 * per-card configuration: episodes show their series name, everything else falls back to its
 * production year (movies/series), or nothing (library tiles, which have neither).
 */
export const toMediaCardProps = (
    item: BaseItemDto,
    apiClient: ImageApiClient | undefined,
    options: MediaCardPropsOptions
): MediaCardProps => {
    const playedPercentage = item.UserData?.PlayedPercentage ?? undefined;

    return {
        title: item.Name ?? '',
        subtitle:
            item.SeriesName ??
            (item.ProductionYear ? String(item.ProductionYear) : undefined),
        imageUrl: getItemImageUrl(item, apiClient, !!options.preferThumb),
        imageAspect: options.imageAspect,
        progressPercent:
            playedPercentage && playedPercentage > 0 && playedPercentage < 100
                ? playedPercentage
                : undefined,
        href: getItemHref(item, apiClient?.serverId?.())
    };
};

export const toMediaCardPropsArray = (
    items: BaseItemDto[] | null | undefined,
    apiClient: ImageApiClient | undefined,
    options: MediaCardPropsOptions
): MediaCardProps[] =>
    (items ?? []).map((item) => toMediaCardProps(item, apiClient, options));

/** Portrait-shaped library collection types (mirrors legacy `recentlyAdded.ts`'s shape grouping). */
const PORTRAIT_COLLECTION_TYPES: ReadonlySet<string> = new Set([
    CollectionType.Movies,
    CollectionType.Books,
    CollectionType.Tvshows
]);
const SQUARE_COLLECTION_TYPES: ReadonlySet<string> = new Set([
    CollectionType.Music,
    CollectionType.Homevideos
]);
const NO_PREFER_THUMB_COLLECTION_TYPES: ReadonlySet<string> = new Set([
    CollectionType.Movies,
    CollectionType.Tvshows,
    CollectionType.Music
]);

/**
 * Per-library "ajouts récents" card options - the `MediaCardPropsOptions` equivalent of the former
 * `latestMediaCardOptions.ts` (deleted: it imported `components/cardbuilder/utils/shape`, now
 * forbidden in this slice per RFC-0005 §4.2/§11). Mirrors the same collection-type groupings, minus
 * `components/cardbuilder`'s `CardShape` enum which `ui`'s `MediaCard` has no equivalent of.
 */
export const getLatestMediaCardOptions = (
    collectionType: string | null | undefined
): MediaCardPropsOptions => {
    const isPortrait =
        !!collectionType && PORTRAIT_COLLECTION_TYPES.has(collectionType);
    const isSquare =
        !!collectionType && SQUARE_COLLECTION_TYPES.has(collectionType);

    let imageAspect: MediaCardImageAspect;
    if (isPortrait) {
        imageAspect = 'poster';
    } else if (isSquare) {
        imageAspect = 'square';
    } else {
        imageAspect = 'backdrop';
    }

    return {
        imageAspect,
        preferThumb: !(
            collectionType &&
            NO_PREFER_THUMB_COLLECTION_TYPES.has(collectionType)
        )
    };
};

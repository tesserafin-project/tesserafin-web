import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';

/**
 * v1-supported collection types for `/library/:libraryId` (RFC-0005 §11 WP-C mission scope:
 * "v1 : collections movies et tvshows seulement"). Everything else redirects to its existing
 * per-type library page (`appRouter.getRouteUrl`'s route table, `src/components/router/appRouter.js`
 * ~L370-450) via `<Navigate replace>` until those pages get their own `src/ui` rewrite.
 */
const SUPPORTED_COLLECTION_TYPES: ReadonlySet<CollectionType> = new Set([
    CollectionType.Movies,
    CollectionType.Tvshows
]);

export const isSupportedLibraryCollectionType = (
    collectionType: CollectionType | string | null | undefined
): boolean =>
    !!collectionType &&
    SUPPORTED_COLLECTION_TYPES.has(collectionType as CollectionType);

/** Route segment for each `CollectionType` with a dedicated (still-legacy-CSS) library page. */
const ROUTE_BY_COLLECTION_TYPE: Partial<Record<CollectionType, string>> = {
    [CollectionType.Music]: 'music',
    [CollectionType.Books]: 'books',
    [CollectionType.Musicvideos]: 'musicvideos',
    [CollectionType.Boxsets]: 'boxsets',
    [CollectionType.Playlists]: 'playlists'
};

/**
 * Builds the redirect target for a library `/library/:libraryId` doesn't (yet) render itself,
 * mirroring `appRouter.getRouteUrl()`'s per-`CollectionType` branches (see module doc). `Homevideos`
 * and `Livetv` have their own URL shapes there (no `collectionType` param, no `topParentId` for
 * `Livetv`); every other/unknown type (incl. `Photos`/`Folders`/`Trailers`/`Unknown`, all marked
 * "unused" in `LibraryPage.tsx`'s `PAGE_IDS`) falls back to the mixed-content library page, same as
 * `appRouter`'s catch-all "folder tile with no specific `CollectionType`" branch.
 */
export const getLibraryRedirectPath = (
    libraryId: string,
    collectionType: CollectionType | string | null | undefined
): string => {
    if (collectionType === CollectionType.Homevideos) {
        return `/homevideos?topParentId=${libraryId}`;
    }

    if (collectionType === CollectionType.Livetv) {
        return `/livetv?collectionType=${CollectionType.Livetv}`;
    }

    const route = collectionType
        ? ROUTE_BY_COLLECTION_TYPE[collectionType as CollectionType]
        : undefined;

    if (route) {
        return `/${route}?topParentId=${libraryId}&collectionType=${collectionType}`;
    }

    return `/mixed?topParentId=${libraryId}&collectionType=mixed`;
};

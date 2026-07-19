import type { AxiosRequestConfig } from 'axios';

import {
    BaseItemKind,
    getGenreApi,
    getLibraryApi,
    getShowApi,
    getStudioApi,
    ImageType,
    ItemFields,
    ItemSortBy,
    type ReefinApi,
    SortOrder
} from 'lib/reefin-sdk';
import type { ItemDtoQueryResult } from 'types/base/models/item-dto-query-result';

/**
 * The non-Browse destinations of `/library/:libraryId`, as real Reefin SDK requests (issue #15,
 * L15a — structural parity). One fetcher per destination named in
 * `docs/reefin/design-library-navigation.md` §3.2, plus the Studios *filter*'s option list and the
 * Upcoming *shelf*, neither of which is a destination.
 *
 * **Not routed.** L15a delivers the queries and proves each one emits the request the design claims
 * it does; L15b wires them to `/library/:libraryId/:destination` and repoints
 * `appRouter.getRouteUrl()`. Nothing here is mounted, so the only consumer today is
 * `libraryDestinationQueries.test.ts`.
 *
 * Every request goes through `lib/reefin-sdk`'s generated client — no `@jellyfin/sdk` import
 * appears in this slice, which is the migration rule issue #15 enforces.
 */

/**
 * Shared image/field options, matching what `fetchLibraryItems` already asks for so cards render
 * identically across destinations. Built per call (rather than a shared frozen literal) because the
 * generated request types take mutable arrays.
 */
const cardImageOptions = () => ({
    fields: [ItemFields.PrimaryImageAspectRatio],
    enableImageTypes: [ImageType.Primary],
    imageTypeLimit: 1
});

/* -------------------------------------------------------------------------- */
/* Genres (destination)                                                       */
/* -------------------------------------------------------------------------- */

export interface LibraryGenresParams {
    parentId: string;
    /** The library's primary kind — genres are scoped to the items they aggregate. */
    includeItemTypes: BaseItemKind[];
}

/**
 * Genres is a destination because a genre is an *aggregate*, not an item (design §3.1 criterion 1):
 * `getGenres` returns genre entries, each of which then opens Browse pre-filtered — a different
 * endpoint, not a predicate on `getItems`.
 */
export const fetchLibraryGenres = async (
    api: ReefinApi,
    userId: string,
    params: LibraryGenresParams,
    options?: AxiosRequestConfig
): Promise<ItemDtoQueryResult> => {
    const response = await getGenreApi(api).getGenres(
        {
            userId,
            parentId: params.parentId,
            includeItemTypes: params.includeItemTypes,
            sortBy: [ItemSortBy.SortName],
            sortOrder: [SortOrder.Ascending],
            ...cardImageOptions()
        },
        { signal: options?.signal }
    );

    return response.data as ItemDtoQueryResult;
};

/* -------------------------------------------------------------------------- */
/* Collections (destination)                                                  */
/* -------------------------------------------------------------------------- */

export interface LibraryCollectionsParams {
    parentId: string;
    startIndex: number;
    limit: number;
}

/**
 * Collections is a destination because `BoxSet` is an item of another *nature* than `Movie`/`Series`
 * (design §3.1 criterion 1). It reuses `getItems` — the endpoint is the same, the item kind is not,
 * which is precisely the line §3.1 draws between a destination and a filter.
 */
export const fetchLibraryCollections = async (
    api: ReefinApi,
    userId: string,
    params: LibraryCollectionsParams,
    options?: AxiosRequestConfig
): Promise<ItemDtoQueryResult> => {
    const response = await getLibraryApi(api).getItems(
        {
            userId,
            parentId: params.parentId,
            includeItemTypes: [BaseItemKind.BoxSet],
            recursive: true,
            sortBy: [ItemSortBy.SortName],
            sortOrder: [SortOrder.Ascending],
            startIndex: params.startIndex,
            limit: params.limit,
            ...cardImageOptions()
        },
        { signal: options?.signal }
    );

    return response.data as ItemDtoQueryResult;
};

/* -------------------------------------------------------------------------- */
/* Studios (filter on Browse — not a destination)                             */
/* -------------------------------------------------------------------------- */

export interface LibraryStudiosParams {
    parentId: string;
    includeItemTypes: BaseItemKind[];
}

/**
 * Feeds the Studios *filter*'s option list only. Selecting a studio does not navigate: it adds
 * `studioIds` to the Browse query (`fetchLibraryItems`), which is why design §3.2 demotes the legacy
 * Studios tab to a control. The legacy tab itself already disabled grid/list and sort — it was never
 * a real list.
 */
export const fetchLibraryStudios = async (
    api: ReefinApi,
    userId: string,
    params: LibraryStudiosParams,
    options?: AxiosRequestConfig
): Promise<ItemDtoQueryResult> => {
    // `getStudios` exposes no `sortBy`/`sortOrder` (unlike `getGenres`) — the endpoint returns its
    // own order. Passing them would be silently dropped, so they are omitted rather than implied.
    const response = await getStudioApi(api).getStudios(
        {
            userId,
            parentId: params.parentId,
            includeItemTypes: params.includeItemTypes,
            ...cardImageOptions()
        },
        { signal: options?.signal }
    );

    return response.data as ItemDtoQueryResult;
};

/* -------------------------------------------------------------------------- */
/* Upcoming (shelf inside Suggestions — not a destination)                    */
/* -------------------------------------------------------------------------- */

export interface LibraryUpcomingParams {
    parentId: string;
    limit?: number;
}

/** Matches `hooks/useFetchItems.ts`'s existing `getUpcomingEpisodes` call, so the shelf shows the same 25 episodes the legacy Upcoming tab did. */
export const UPCOMING_LIMIT = 25;

/**
 * Upcoming becomes a shelf of Suggestions rather than its own destination (design §3.2):
 * `upcomingTabContent` carries no `itemType` — it was already an editorialised sections view, so its
 * natural home is among the Suggestions shelves.
 */
export const fetchLibraryUpcoming = async (
    api: ReefinApi,
    userId: string,
    params: LibraryUpcomingParams,
    options?: AxiosRequestConfig
): Promise<ItemDtoQueryResult> => {
    const response = await getShowApi(api).getUpcomingEpisodes(
        {
            userId,
            parentId: params.parentId,
            limit: params.limit ?? UPCOMING_LIMIT,
            fields: [ItemFields.AirTime],
            enableImageTypes: [
                ImageType.Primary,
                ImageType.Backdrop,
                ImageType.Thumb
            ],
            imageTypeLimit: 1
        },
        { signal: options?.signal }
    );

    return response.data as ItemDtoQueryResult;
};

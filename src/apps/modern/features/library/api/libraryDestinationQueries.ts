import type { AxiosRequestConfig } from 'axios';

import {
    BaseItemKind,
    getGenreApi,
    getLibraryApi,
    getMovieApi,
    getShowApi,
    getStudioApi,
    ImageType,
    ItemFields,
    ItemSortBy,
    type RecommendationDto,
    type TesserafinApi,
    SortOrder
} from 'lib/tesserafin-sdk';
import type { ItemDto } from 'types/base/models/item-dto';
import type { ItemDtoQueryResult } from 'types/base/models/item-dto-query-result';

/**
 * The non-Browse destinations of `/library/:libraryId`, as real Reefin SDK requests (issue #15,
 * L15a — structural parity). One fetcher per destination named in
 * `docs/tesserafin/design-library-navigation.md` §3.2, plus the Studios *filter*'s option list and the
 * Upcoming *shelf*, neither of which is a destination.
 *
 * **Routed as of L15b.** L15a delivered these queries dormant and proved each one emits the request
 * its design entry claims; L15b mounts them under `/library/:libraryId/:destination` through
 * `useLibraryDestinations.ts` and repoints `appRouter.getRouteUrl()`. The requests themselves did
 * not change — `libraryDestinationQueries.test.ts` still asserts every one of them against the URL
 * axios actually emits.
 *
 * Every request goes through `lib/tesserafin-sdk`'s generated client — no `@jellyfin/sdk` import
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
    api: TesserafinApi,
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
    api: TesserafinApi,
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
    api: TesserafinApi,
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
    api: TesserafinApi,
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

/* -------------------------------------------------------------------------- */
/* Suggestions shelves (L15b — the destination is now mounted)                */
/* -------------------------------------------------------------------------- */

/**
 * L15a delivered Upcoming (above) because design §3.2 *moves* it — it was a legacy tab losing its
 * home. The remaining shelves below were already inside the legacy Suggestions tab
 * (`suggestionsTabContent.sectionsView.suggestionSections`), so they had nothing to move; they are
 * added by L15b, when the destination stopped being dormant and had to actually render.
 *
 * They are added *here*, through `lib/tesserafin-sdk`, rather than by importing the existing
 * `apps/legacy/features/libraries/api/use{ResumeItems,LatestMedia,NextUp}.ts` hooks. Those hooks are
 * `@jellyfin/sdk`-based, and reusing them would have put a direct `@jellyfin/sdk` type dependency
 * back into a slice L15a deliberately cleared of them — trading a migration invariant for three
 * saved fetchers.
 */

export interface LibraryShelfParams {
    parentId: string;
    includeItemTypes: BaseItemKind[];
    limit?: number;
}

/** The legacy suggestion shelves request 12 items each (`SuggestionsSectionView.tsx`'s section limits). */
export const SHELF_LIMIT = 12;

const shelfImageOptions = () => ({
    fields: [ItemFields.PrimaryImageAspectRatio],
    enableImageTypes: [ImageType.Primary],
    imageTypeLimit: 1
});

/** `ContinueWatchingMovies` / `ContinueWatchingEpisode` — the same endpoint, differing only by item kind. */
export const fetchLibraryResumeItems = async (
    api: TesserafinApi,
    userId: string,
    params: LibraryShelfParams,
    options?: AxiosRequestConfig
): Promise<ItemDtoQueryResult> => {
    const response = await getLibraryApi(api).getResumeItems(
        {
            userId,
            parentId: params.parentId,
            includeItemTypes: params.includeItemTypes,
            limit: params.limit ?? SHELF_LIMIT,
            ...shelfImageOptions()
        },
        { signal: options?.signal }
    );

    return response.data as ItemDtoQueryResult;
};

/**
 * `LatestMovies` / `LatestEpisode`. Note the return type: `getLatestMedia` answers with a bare
 * `Array<BaseItemDto>`, not a `QueryResult` — so this normalizes to the same `{ Items }` shape the
 * other shelves produce, keeping one rendering path for all of them.
 */
export const fetchLibraryLatestItems = async (
    api: TesserafinApi,
    userId: string,
    params: LibraryShelfParams,
    options?: AxiosRequestConfig
): Promise<ItemDtoQueryResult> => {
    const response = await getLibraryApi(api).getLatestMedia(
        {
            userId,
            parentId: params.parentId,
            includeItemTypes: params.includeItemTypes,
            limit: params.limit ?? SHELF_LIMIT,
            ...shelfImageOptions()
        },
        { signal: options?.signal }
    );

    return { Items: (response.data ?? []) as ItemDto[] };
};

/** `NextUp` — tvshows only; the shelf list in `librarySections.ts` is what decides that. */
export const fetchLibraryNextUp = async (
    api: TesserafinApi,
    userId: string,
    params: LibraryShelfParams,
    options?: AxiosRequestConfig
): Promise<ItemDtoQueryResult> => {
    const response = await getShowApi(api).getNextUp(
        {
            userId,
            parentId: params.parentId,
            limit: params.limit ?? SHELF_LIMIT,
            ...shelfImageOptions()
        },
        { signal: options?.signal }
    );

    return response.data as ItemDtoQueryResult;
};

/**
 * `MovieRecommendations` — the one shelf that is not a flat item list: the endpoint returns
 * *categories* (`RecommendationDto[]`, each with its own `Items` and a `BaselineItemName` like
 * "Because you watched X"). It is returned in its native shape rather than flattened, because
 * flattening would discard exactly the editorial framing that made Suggestions a destination
 * instead of a query (design §3.1 criterion 2).
 */
export const fetchLibraryMovieRecommendations = async (
    api: TesserafinApi,
    userId: string,
    params: LibraryShelfParams,
    options?: AxiosRequestConfig
): Promise<RecommendationDto[]> => {
    const response = await getMovieApi(api).getMovieRecommendations(
        {
            userId,
            parentId: params.parentId,
            itemLimit: params.limit ?? SHELF_LIMIT,
            fields: [ItemFields.PrimaryImageAspectRatio]
        },
        { signal: options?.signal }
    );

    return response.data ?? [];
};

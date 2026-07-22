import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import { getLibraryApi, ImageType, ItemFields } from 'lib/tesserafin-sdk';
import type {
    BaseItemKind,
    ItemSortBy,
    TesserafinApi,
    SortOrder
} from 'lib/tesserafin-sdk';
import type { ItemDtoQueryResult } from 'types/base/models/item-dto-query-result';

import {
    NON_ALPHA_LETTER,
    NON_ALPHA_NAME_LESS_THAN
} from '../constants/librarySections';

/**
 * `getItems` params for the `/library/:libraryId` grid (RFC-0005 §11 WP-C step 2). Mirrors
 * `hooks/useFetchItems.ts`'s `fetchGetItemsViewByType` default branch (same endpoint), trimmed to
 * the v1 controls this route exposes: one sort field/order, one genre, one production year - no
 * `Filters`-object grab bag (`types/library.ts`'s `LibraryViewSettings`), since that type is the
 * existing `ItemsView` slice's local state shape, not a wire format worth reusing here.
 *
 * Issued through `lib/tesserafin-sdk`'s generated `LibraryApi` (issue #15): the generated client covers
 * this endpoint, so no hand-written wrapper is warranted. The request shape is identical to
 * `@jellyfin/sdk`'s - both are `openapi-generator` `typescript-axios` output over the same contract
 * - so this is an import and client swap, not a call-site rewrite.
 */
export interface LibraryItemsParams {
    parentId: string;
    /**
     * The Series/Episodes granularity toggle rides on this field (design §3.2): Episodes is the same
     * query at a different depth (`[Episode]` instead of `[Series]`), not a separate view.
     */
    includeItemTypes: BaseItemKind[];
    sortBy: ItemSortBy;
    sortOrder: SortOrder;
    startIndex: number;
    limit: number;
    genre?: string;
    year?: number;
    /**
     * Studios filter (design §3.2): `studioIds` is a *parameter of this query*, which is exactly why
     * Studios is a control on Browse rather than a first-level destination.
     */
    studioIds?: string[];
    /**
     * Favorites filter (design §3.2): `isFavorite: true` is a pure predicate, so a dedicated tab
     * would duplicate Browse to a boolean. Left `undefined` (not `false`) when off, so the request
     * carries no `isFavorite` at all rather than explicitly asking for non-favorites.
     */
    isFavorite?: boolean;
    /**
     * AlphaPicker selection (design §4.1). `#` is the non-alphabetic bucket and maps to
     * `nameLessThan: 'A'` rather than `nameStartsWith` - the same translation `utils/items.ts`
     * already applies for the legacy pages, kept identical so the two produce the same result set.
     */
    letter?: string;
}

export const fetchLibraryItems = async (
    api: TesserafinApi,
    userId: string,
    params: LibraryItemsParams,
    options?: AxiosRequestConfig
): Promise<ItemDtoQueryResult> => {
    const response = await getLibraryApi(api).getItems(
        {
            userId,
            parentId: params.parentId,
            includeItemTypes: params.includeItemTypes,
            recursive: true,
            sortBy: [params.sortBy],
            sortOrder: [params.sortOrder],
            startIndex: params.startIndex,
            limit: params.limit,
            genres: params.genre ? [params.genre] : undefined,
            years: params.year ? [params.year] : undefined,
            studioIds: params.studioIds?.length ? params.studioIds : undefined,
            isFavorite: params.isFavorite ? true : undefined,
            nameStartsWith:
                params.letter && params.letter !== NON_ALPHA_LETTER
                    ? params.letter
                    : undefined,
            nameLessThan:
                params.letter === NON_ALPHA_LETTER
                    ? NON_ALPHA_NAME_LESS_THAN
                    : undefined,
            fields: [ItemFields.PrimaryImageAspectRatio],
            enableImageTypes: [ImageType.Primary],
            imageTypeLimit: 1
        },
        { signal: options?.signal }
    );

    return response.data as ItemDtoQueryResult;
};

/** Query key for one `parentId`/params combination; changes whenever any param does, so TanStack Query refetches on sort/filter/page changes and keeps each combination cached independently. Must accept `undefined` params: the key is evaluated eagerly on every render, including the initial ones where the library's `CollectionType` (and therefore the params) is still loading and `enabled` is false. */
export const getLibraryItemsQueryKey = (
    userId: string | undefined,
    params: LibraryItemsParams | undefined
) => ['User', userId, 'Items', params?.parentId, 'LibraryItems', params];

/**
 * Fetches one page of a movies/tvshows library's items (RFC-0005 §11 WP-C step 2).
 * `placeholderData: keepPreviousData` keeps the current page's cards on screen while the next page
 * loads, instead of flashing `LoadingState` on every pagination click (mission step 2).
 */
export const useLibraryItems = (params: LibraryItemsParams | undefined) => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: getLibraryItemsQueryKey(user?.Id, params),
        queryFn: ({ signal }) =>
            fetchLibraryItems(reefinApi!, user!.Id!, params!, { signal }),
        enabled: !!reefinApi && !!user?.Id && !!params,
        placeholderData: keepPreviousData
    });
};

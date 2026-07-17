import type { Api } from '@jellyfin/sdk/lib/api';
import type { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import type { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import type { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import type { ItemDtoQueryResult } from 'types/base/models/item-dto-query-result';

/**
 * `getItems` params for the `/library/:libraryId` grid (RFC-0005 §11 WP-C step 2). Mirrors
 * `hooks/useFetchItems.ts`'s `fetchGetItemsViewByType` default branch (same `@jellyfin/sdk` endpoint,
 * mission: "Migration reefin-sdk NON requise"), trimmed to the v1 controls this route exposes: one
 * sort field/order, one genre, one production year - no alphabet picker, no `Filters`-object grab
 * bag (`types/library.ts`'s `LibraryViewSettings`), since that type is the existing `ItemsView`
 * slice's local state shape, not a wire format worth reusing here.
 */
export interface LibraryItemsParams {
    parentId: string;
    includeItemTypes: BaseItemKind[];
    sortBy: ItemSortBy;
    sortOrder: SortOrder;
    startIndex: number;
    limit: number;
    genre?: string;
    year?: number;
}

export const fetchLibraryItems = async (
    api: Api,
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
            fields: [ItemFields.PrimaryImageAspectRatio],
            enableImageTypes: [ImageType.Primary],
            imageTypeLimit: 1
        },
        { signal: options?.signal }
    );

    return response.data as ItemDtoQueryResult;
};

/** Query key for one `parentId`/params combination; changes whenever any param does, so TanStack Query refetches on sort/filter/page changes and keeps each combination cached independently. */
export const getLibraryItemsQueryKey = (
    userId: string | undefined,
    params: LibraryItemsParams
) => ['User', userId, 'Items', params.parentId, 'LibraryItems', params];

/**
 * Fetches one page of a movies/tvshows library's items (RFC-0005 §11 WP-C step 2).
 * `placeholderData: keepPreviousData` keeps the current page's cards on screen while the next page
 * loads, instead of flashing `LoadingState` on every pagination click (mission step 2).
 */
export const useLibraryItems = (params: LibraryItemsParams | undefined) => {
    const { api, user } = useApi();

    return useQuery({
        queryKey: getLibraryItemsQueryKey(user?.Id, params!),
        queryFn: ({ signal }) =>
            fetchLibraryItems(api!, user!.Id!, params!, { signal }),
        enabled: !!api && !!user?.Id && !!params,
        placeholderData: keepPreviousData
    });
};

import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import {
    type BaseItemKind,
    ItemFilter,
    ItemSortBy,
    type LibraryApiGetItemsRequest,
    type ReefinApi,
    getLibraryApi
} from 'lib/reefin-sdk';

const FAVORITE_ITEMS_LIMIT = 20;

export const fetchFavoriteItems = async (
    api: ReefinApi,
    params: LibraryApiGetItemsRequest,
    options?: AxiosRequestConfig
) => {
    const response = await getLibraryApi(api).getItems(params, options);
    return response.data;
};

/** Query options for fetching the current user's favorite items on the home page. */
export const getFavoriteItemsQuery = (
    api?: ReefinApi,
    params: LibraryApiGetItemsRequest = {}
) =>
    queryOptions({
        queryKey: ['Home', params.userId, 'FavoriteItems', params],
        queryFn: ({ signal }) => fetchFavoriteItems(api!, params, { signal }),
        enabled: !!api
    });

/** Hook for fetching the current user's favorite items on the home page. */
export const useFavoriteItems = (includeItemTypes?: BaseItemKind[]) => {
    const { reefinApi, user } = useApi();
    return useQuery(
        getFavoriteItemsQuery(reefinApi, {
            userId: user?.Id,
            filters: [ItemFilter.IsFavorite],
            recursive: true,
            includeItemTypes,
            limit: FAVORITE_ITEMS_LIMIT,
            sortBy: [ItemSortBy.SortName]
        })
    );
};

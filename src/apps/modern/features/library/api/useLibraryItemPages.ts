import { useQueries } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import {
    fetchLibraryItems,
    getLibraryItemsQueryKey,
    type LibraryItemsParams
} from './useLibraryItems';

/** Pages leave memory and the persisted cache soon after scrolling away, unlike the 24 h default. */
const CONTINUOUS_PAGE_GC_TIME = 5 * 60 * 1000;

/**
 * One independent query per page of one result set: identical requests share a query, a page that
 * leaves the window is aborted, and a response can only ever land on the filters it was asked for.
 */
export const useLibraryItemPages = (
    params: Omit<LibraryItemsParams, 'startIndex' | 'limit'>,
    limit: number,
    starts: number[]
) => {
    const { reefinApi, user } = useApi();

    return useQueries({
        queries: starts.map((startIndex) => {
            const page = { ...params, startIndex, limit, stableOrder: true };
            return {
                queryKey: getLibraryItemsQueryKey(user?.Id, page),
                queryFn: ({ signal }: { signal: AbortSignal }) =>
                    fetchLibraryItems(reefinApi!, user!.Id!, page, { signal }),
                enabled: !!reefinApi && !!user?.Id,
                gcTime: CONTINUOUS_PAGE_GC_TIME
            };
        })
    });
};

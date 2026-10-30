import {
    useQuery,
    useQueryClient,
    type UseQueryResult
} from '@tanstack/react-query';
import React, {
    type FC,
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useState
} from 'react';

import { useApi } from 'hooks/useApi';
import type { ItemDtoQueryResult } from 'types/base/models/item-dto-query-result';

import {
    fetchLibraryItems,
    getLibraryItemsQueryKey,
    type LibraryItemsParams
} from './useLibraryItems';
import {
    markLibraryPageIdle,
    markLibraryPageObserved
} from './libraryPageRetention';

/**
 * Pages leave memory and the persisted cache soon after scrolling away, unlike the 24 h default.
 * How many stay until then is bounded separately, in `libraryPageRetention`.
 */
const CONTINUOUS_PAGE_GC_TIME = 5 * 60 * 1000;

export type LibraryPage = UseQueryResult<ItemDtoQueryResult, Error>;
type PageParams = Omit<LibraryItemsParams, 'startIndex' | 'limit'>;

const PageObserver: FC<{
    params: PageParams;
    limit: number;
    start: number;
    report: (start: number, page: LibraryPage | undefined) => void;
}> = ({ params, limit, start, report }) => {
    const { reefinApi, user } = useApi();
    const client = useQueryClient();
    const page = { ...params, startIndex: start, limit, stableOrder: true };
    const queryKey = getLibraryItemsQueryKey(user?.Id, page);
    const queryHash = JSON.stringify(queryKey);
    const result = useQuery({
        queryKey,
        queryFn: ({ signal }) =>
            fetchLibraryItems(reefinApi!, user!.Id!, page, { signal }),
        enabled: !!reefinApi && !!user?.Id,
        gcTime: CONTINUOUS_PAGE_GC_TIME,
        notifyOnChangeProps: 'all'
    });
    // Runs after useQuery's own cleanup, so this page no longer counts as observed when it is left.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the hash stands for the key
    useEffect(() => {
        markLibraryPageObserved(queryKey);
        return () => markLibraryPageIdle(client, queryKey);
    }, [client, queryHash]);
    // The result object is rebuilt on each render of this observer; these say when it changed.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
    useLayoutEffect(
        () => report(start, result),
        [
            report,
            start,
            result.dataUpdatedAt,
            result.errorUpdatedAt,
            result.status,
            result.fetchStatus
        ]
    );
    useLayoutEffect(() => () => report(start, undefined), [report, start]);
    return null;
};

/**
 * One independent query per page of one result set: identical requests share a query, a page that
 * leaves the window is aborted, and a response can only ever land on the filters it was asked for.
 *
 * One observing component per page, rendered by the caller, rather than `useQueries`: that hook's
 * observer would enter the shared query-core chunk and so the initial bundle of every route.
 */
export const useLibraryItemPages = (
    params: PageParams,
    limit: number,
    starts: number[]
): {
    pages: (LibraryPage | undefined)[];
    observers: ReactNode;
    /** This library's pages in the query cache, observed or not. */
    cachedPages: number;
} => {
    const { user } = useApi();
    const client = useQueryClient();
    const [results, setResults] = useState<Record<number, LibraryPage>>({});
    const report = useCallback(
        (start: number, page: LibraryPage | undefined) =>
            setResults((current) => {
                if (current[start] === page) return current;
                const next = { ...current };
                if (page) next[start] = page;
                else delete next[start];
                return next;
            }),
        []
    );

    return {
        pages: starts.map((start) => results[start]),
        cachedPages: client.getQueryCache().findAll({
            queryKey: getLibraryItemsQueryKey(user?.Id, {
                parentId: params.parentId
            } as LibraryItemsParams).slice(0, 5)
        }).length,
        observers: starts.map((start) => (
            <PageObserver
                key={start}
                params={params}
                limit={limit}
                start={start}
                report={report}
            />
        ))
    };
};

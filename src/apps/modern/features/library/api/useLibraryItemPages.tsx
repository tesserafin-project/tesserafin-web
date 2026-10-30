import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import React, {
    type FC,
    type ReactNode,
    useCallback,
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

/** Pages leave memory and the persisted cache soon after scrolling away, unlike the 24 h default. */
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
    const page = { ...params, startIndex: start, limit, stableOrder: true };
    const result = useQuery({
        queryKey: getLibraryItemsQueryKey(user?.Id, page),
        queryFn: ({ signal }) =>
            fetchLibraryItems(reefinApi!, user!.Id!, page, { signal }),
        enabled: !!reefinApi && !!user?.Id,
        gcTime: CONTINUOUS_PAGE_GC_TIME,
        notifyOnChangeProps: 'all'
    });
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
): { pages: (LibraryPage | undefined)[]; observers: ReactNode } => {
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

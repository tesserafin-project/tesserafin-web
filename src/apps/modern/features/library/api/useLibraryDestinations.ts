import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import {
    fetchLibraryCollections,
    fetchLibraryGenres,
    fetchLibraryLatestItems,
    fetchLibraryMovieRecommendations,
    fetchLibraryNextUp,
    fetchLibraryResumeItems,
    fetchLibraryStudios,
    fetchLibraryUpcoming,
    type LibraryCollectionsParams,
    type LibraryGenresParams,
    type LibraryShelfParams,
    type LibraryStudiosParams,
    type LibraryUpcomingParams
} from './libraryDestinationQueries';

/**
 * React Query bindings for the destination fetchers L15a delivered dormant
 * (`libraryDestinationQueries.ts`). L15b mounts them, so each fetcher now needs a hook with a cache
 * key; the *requests* are unchanged and stay proven by `libraryDestinationQueries.test.ts`.
 *
 * Every key is namespaced under the same `['User', userId, 'Items', parentId, ...]` prefix
 * `useLibraryItems.ts` uses, so a library's destinations invalidate together.
 */

const enabled = (
    api: unknown,
    userId: string | undefined,
    params: unknown
): boolean => !!api && !!userId && !!params;

export const useLibraryGenres = (params: LibraryGenresParams | undefined) => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: [
            'User',
            user?.Id,
            'Items',
            params?.parentId,
            'LibraryGenres',
            params
        ],
        queryFn: ({ signal }) =>
            fetchLibraryGenres(reefinApi!, user!.Id!, params!, { signal }),
        enabled: enabled(reefinApi, user?.Id, params)
    });
};

export const useLibraryCollections = (
    params: LibraryCollectionsParams | undefined
) => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: [
            'User',
            user?.Id,
            'Items',
            params?.parentId,
            'LibraryCollections',
            params
        ],
        queryFn: ({ signal }) =>
            fetchLibraryCollections(reefinApi!, user!.Id!, params!, { signal }),
        enabled: enabled(reefinApi, user?.Id, params),
        // Collections paginate, so keep the current page on screen while the next one loads —
        // the same reason `useLibraryItems` does it.
        placeholderData: keepPreviousData
    });
};

/**
 * The Studios *filter*'s option list. Note what this hook is not: it does not drive a destination.
 * Selecting a studio adds `studioIds` to the Browse query (design §3.2), which is the whole reason
 * Studios is a control here rather than a tab.
 */
export const useLibraryStudios = (params: LibraryStudiosParams | undefined) => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: [
            'User',
            user?.Id,
            'Items',
            params?.parentId,
            'LibraryStudios',
            params
        ],
        queryFn: ({ signal }) =>
            fetchLibraryStudios(reefinApi!, user!.Id!, params!, { signal }),
        enabled: enabled(reefinApi, user?.Id, params)
    });
};

/** The Upcoming *shelf* of Suggestions (design §3.2), not a destination of its own. */
export const useLibraryUpcoming = (
    params: LibraryUpcomingParams | undefined
) => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: [
            'User',
            user?.Id,
            'Items',
            params?.parentId,
            'LibraryUpcoming',
            params
        ],
        queryFn: ({ signal }) =>
            fetchLibraryUpcoming(reefinApi!, user!.Id!, params!, { signal }),
        enabled: enabled(reefinApi, user?.Id, params)
    });
};

/* -------------------------------------------------------------------------- */
/* Suggestions shelves                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The shelf hooks below are all called *unconditionally* by `SuggestionsDestination`, with
 * `undefined` params for the shelves a given library type does not have (React's rules of hooks
 * forbid the obvious `if (isTvshows)` alternative). `enabled` then keeps the disabled ones from
 * ever issuing a request, so a movies library never calls `getNextUp` — the shelf list in
 * `constants/librarySections.ts` remains the single place that decides which shelves exist.
 */

export const useLibraryResumeItems = (
    params: LibraryShelfParams | undefined
) => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: [
            'User',
            user?.Id,
            'Items',
            params?.parentId,
            'LibraryResume',
            params
        ],
        queryFn: ({ signal }) =>
            fetchLibraryResumeItems(reefinApi!, user!.Id!, params!, { signal }),
        enabled: enabled(reefinApi, user?.Id, params)
    });
};

export const useLibraryLatestItems = (
    params: LibraryShelfParams | undefined
) => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: [
            'User',
            user?.Id,
            'Items',
            params?.parentId,
            'LibraryLatest',
            params
        ],
        queryFn: ({ signal }) =>
            fetchLibraryLatestItems(reefinApi!, user!.Id!, params!, { signal }),
        enabled: enabled(reefinApi, user?.Id, params)
    });
};

export const useLibraryNextUp = (params: LibraryShelfParams | undefined) => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: [
            'User',
            user?.Id,
            'Items',
            params?.parentId,
            'LibraryNextUp',
            params
        ],
        queryFn: ({ signal }) =>
            fetchLibraryNextUp(reefinApi!, user!.Id!, params!, { signal }),
        enabled: enabled(reefinApi, user?.Id, params)
    });
};

export const useLibraryMovieRecommendations = (
    params: LibraryShelfParams | undefined
) => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: [
            'User',
            user?.Id,
            'Items',
            params?.parentId,
            'LibraryMovieRecommendations',
            params
        ],
        queryFn: ({ signal }) =>
            fetchLibraryMovieRecommendations(reefinApi!, user!.Id!, params!, {
                signal
            }),
        enabled: enabled(reefinApi, user?.Id, params)
    });
};

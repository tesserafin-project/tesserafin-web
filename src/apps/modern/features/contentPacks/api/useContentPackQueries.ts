/**
 * The slice's four reads (#138 §3).
 *
 * Each one is `adapters/contentPacksApi.ts` plus a key from `contentPackKeys.ts` plus the guard
 * that keeps it from firing before it can succeed. No transformation happens here beyond the
 * page-shape normalisation the adapter already did: the server owns ordering, `VisibleItemCount`
 * and `RepresentativeItemId`, and a hook that recomputed any of them would quietly become the
 * product's answer the first time it disagreed with the server's.
 */
import { useQuery, type QueryKey } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import {
    fetchContentPack,
    fetchContentPackItems,
    fetchContentPacks,
    fetchContentPacksForItem,
    type ContentPackDto,
    type ContentPackItemsPage
} from '../adapters/contentPacksApi';
import {
    contentPackKeys,
    ITEMS_KEY_PACK_ID_INDEX,
    type ContentPackItemsPageArgs
} from './contentPackKeys';
import { retryUnlessNotFound } from './contentPackErrors';

/**
 * The pack list, in the server's order.
 *
 * `enabled` is the whole of the "no request before the required state exists" requirement: the
 * hook is called unconditionally by the mosaic, and the query simply does not run until there is
 * an api client and a signed-in user. `select` is deliberately absent — re-sorting, filtering or
 * re-counting the list here is exactly what §3.8 reserves to the server.
 */
export const useContentPacks = () => {
    const { reefinApi, user } = useApi();

    return useQuery({
        queryKey: contentPackKeys.list(user?.Id),
        queryFn: () => fetchContentPacks(reefinApi!),
        enabled: !!reefinApi && !!user?.Id
    });
};

/**
 * One pack's metadata.
 *
 * `retryUnlessNotFound` is what makes the not-found surface immediate rather than arriving after
 * two backoffs. There is no `placeholderData`: a pack's name and visible count belong to THAT
 * pack, and showing the previous pack's while a new id loads is the "stale route transition paints
 * the previous pack" failure this route is required not to have.
 */
export const useContentPack = (packId: string | undefined) => {
    const { reefinApi, user } = useApi();

    return useQuery<ContentPackDto>({
        queryKey: contentPackKeys.detail(user?.Id, packId),
        queryFn: () => fetchContentPack(reefinApi!, packId!),
        enabled: !!reefinApi && !!user?.Id && !!packId,
        retry: retryUnlessNotFound
    });
};

/**
 * Keep the CURRENT page's items on screen while the NEXT page of the SAME pack loads, and nothing
 * else.
 *
 * `keepPreviousData` — what `features/library/api/useLibraryItems.ts` uses for the same paging
 * convention — would also hold the previous data across a change of `packId`, because to TanStack
 * Query "the previous query" is whatever ran last, not "the previous page of this pack". On a
 * route transition that paints pack A's items under pack B's heading until B answers. This
 * placeholder reads the previous query's own key and keeps its data only when the pack id in it is
 * the one being asked for now.
 */
const keepPreviousPageOfSamePack =
    (packId: string | undefined) =>
    (
        previousData: ContentPackItemsPage | undefined,
        previousQuery: { queryKey: QueryKey } | undefined
    ): ContentPackItemsPage | undefined => {
        const previousPackId = (previousQuery?.queryKey as unknown[])?.[
            ITEMS_KEY_PACK_ID_INDEX
        ];
        return previousPackId === packId ? previousData : undefined;
    };

/**
 * One page of one pack's items.
 *
 * The paging arguments are part of the key, so every page caches independently and a back
 * navigation to page 1 is a cache hit rather than a refetch.
 */
export const useContentPackItems = (
    packId: string | undefined,
    page: ContentPackItemsPageArgs,
    options?: { enabled?: boolean }
) => {
    const { reefinApi, user } = useApi();

    return useQuery<ContentPackItemsPage>({
        queryKey: contentPackKeys.items(user?.Id, packId, page),
        queryFn: () =>
            fetchContentPackItems(reefinApi!, {
                packId: packId!,
                startIndex: page.startIndex,
                limit: page.limit
            }),
        enabled:
            !!reefinApi && !!user?.Id && !!packId && (options?.enabled ?? true),
        retry: retryUnlessNotFound,
        placeholderData: keepPreviousPageOfSamePack(packId)
    });
};

/**
 * The packs the current user can see one item in.
 *
 * `options.enabled` is how the Item Details affordance stays silent for a user without
 * `EnableContentPackManagement`: the assignment surface is not rendered at all, so this hook is
 * not called, and where it is called under a hidden or capability-less surface the guard keeps it
 * from issuing a request that would be refused anyway.
 */
export const useContentPacksForItem = (
    itemId: string | undefined,
    options?: { enabled?: boolean }
) => {
    const { reefinApi, user } = useApi();

    return useQuery<ContentPackDto[]>({
        queryKey: contentPackKeys.forItem(user?.Id, itemId),
        queryFn: () => fetchContentPacksForItem(reefinApi!, itemId!),
        enabled:
            !!reefinApi && !!user?.Id && !!itemId && (options?.enabled ?? true)
    });
};

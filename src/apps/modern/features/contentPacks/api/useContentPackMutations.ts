/**
 * The slice's six writes, and the exact cache frontier each one moves (#138 §3).
 *
 * ## Why none of these is optimistic
 *
 * Every value a content-pack surface shows is a SERVER PROJECTION: the pack order, the visible
 * item count, the representative artwork, and which packs an item is in are all computed for the
 * acting user from data the Web cannot see. An optimistic update would therefore have to guess a
 * projection — increment a count whose authorized value it does not know, pick artwork the server
 * did not choose — and a rollback would restore a guess rather than the truth. The requirement is
 * explicit that correctness wins, so each mutation waits for success and then invalidates.
 *
 * The one thing that IS written directly is a DTO the server just returned (`create`, `update`):
 * seeding `detail` with the response body is not a guess, it is the answer, and it saves the
 * detail route a round-trip it would otherwise make immediately.
 *
 * ## The frontier
 *
 * | mutation | list | detail | items | forItem |
 * | --- | --- | --- | --- | --- |
 * | create | invalidate | seed created id | — | — |
 * | update | invalidate | seed + invalidate same id | — | — |
 * | reorder | invalidate | — | — | — |
 * | delete | invalidate | REMOVE deleted id | REMOVE that pack's pages | invalidate all |
 * | addItem | invalidate | invalidate that pack | invalidate that pack's pages | invalidate that item |
 * | removeItem | invalidate | invalidate that pack | invalidate that pack's pages | invalidate that item |
 *
 * `addItem`/`removeItem` touch ONE pack's `detail`/`items` and ONE item's `forItem`, which is what
 * "without affecting other packs" means concretely — the other packs' cached detail and pages are
 * left alone and keep serving.
 *
 * `delete` uses `removeQueries` rather than `invalidateQueries` for the deleted pack: an
 * invalidation would refetch a pack that is gone and turn a successful delete into a 404 render.
 * It invalidates the whole `forItem` family because a deleted pack may have contained any item,
 * and the Web is not entitled to know which ones it could see.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import {
    addContentPackItem,
    createContentPack,
    deleteContentPack,
    removeContentPackItem,
    reorderContentPacks,
    updateContentPack,
    type ContentPackDto
} from '../adapters/contentPacksApi';
import { contentPackKeys } from './contentPackKeys';

export interface ContentPackWriteBody {
    Name: string;
    Description?: string | null;
}

export interface ContentPackMembership {
    packId: string;
    itemId: string;
}

export const useCreateContentPack = () => {
    const { reefinApi, user } = useApi();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (body: ContentPackWriteBody) =>
            createContentPack(reefinApi!, body),
        onSuccess: async (created: ContentPackDto) => {
            if (created.Id) {
                queryClient.setQueryData(
                    contentPackKeys.detail(user?.Id, created.Id),
                    created
                );
            }
            await queryClient.invalidateQueries({
                queryKey: contentPackKeys.list(user?.Id)
            });
        }
    });
};

export const useUpdateContentPack = () => {
    const { reefinApi, user } = useApi();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            packId,
            body
        }: {
            packId: string;
            body: ContentPackWriteBody;
        }) => updateContentPack(reefinApi!, packId, body),
        /*
         * `packId` comes from the REQUEST, not from the response: the identifier is the server's
         * guarantee to keep stable, and reading it back off the response body would make a
         * hypothetical server that returned a different one silently re-key the cache instead of
         * failing visibly. The route is untouched for the same reason — nothing here navigates.
         */
        onSuccess: async (updated: ContentPackDto, { packId }) => {
            queryClient.setQueryData(
                contentPackKeys.detail(user?.Id, packId),
                updated
            );
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: contentPackKeys.detail(user?.Id, packId)
                }),
                queryClient.invalidateQueries({
                    queryKey: contentPackKeys.list(user?.Id)
                })
            ]);
        }
    });
};

/**
 * Persist the WHOLE ordering.
 *
 * The server has no per-pack "move" operation and none is synthesised: the caller sends every id
 * exactly once, in the order it wants, and the list is then re-read rather than assumed — the
 * order the mosaic shows after a reorder is the order the server reports, not the array the client
 * sent.
 */
export const useReorderContentPacks = () => {
    const { reefinApi, user } = useApi();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (packIds: string[]) =>
            reorderContentPacks(reefinApi!, packIds),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: contentPackKeys.list(user?.Id)
            });
        }
    });
};

export const useDeleteContentPack = () => {
    const { reefinApi, user } = useApi();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (packId: string) => deleteContentPack(reefinApi!, packId),
        onSuccess: async (_result, packId) => {
            queryClient.removeQueries({
                queryKey: contentPackKeys.detail(user?.Id, packId)
            });
            queryClient.removeQueries({
                queryKey: contentPackKeys.itemsForPack(user?.Id, packId)
            });
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: contentPackKeys.list(user?.Id)
                }),
                queryClient.invalidateQueries({
                    queryKey: contentPackKeys.forItemAll(user?.Id)
                })
            ]);
        }
    });
};

/** The frontier `addContentPackItem` and `removeContentPackItem` share. */
const invalidateMembership = async (
    queryClient: ReturnType<typeof useQueryClient>,
    userId: string | undefined,
    { packId, itemId }: ContentPackMembership
) => {
    await Promise.all([
        // The pack's own metadata: `VisibleItemCount` and `RepresentativeItemId` are both server
        // projections over its membership, so both change here and neither is computed locally.
        queryClient.invalidateQueries({
            queryKey: contentPackKeys.detail(userId, packId)
        }),
        // Every cached page of THIS pack, whatever its paging arguments. Not `itemsForPack` of any
        // other pack: a membership change is scoped to the pack it names.
        queryClient.invalidateQueries({
            queryKey: contentPackKeys.itemsForPack(userId, packId)
        }),
        // The item's own membership answer, which is what the Item Details affordance reads.
        queryClient.invalidateQueries({
            queryKey: contentPackKeys.forItem(userId, itemId)
        }),
        // The mosaic's per-pack count and artwork come from the list projection, so the list is
        // stale too even though no pack was created, renamed, reordered or removed.
        queryClient.invalidateQueries({
            queryKey: contentPackKeys.list(userId)
        })
    ]);
};

/**
 * Add one item to one pack.
 *
 * A repeated add is a successful no-op at the server (composite uniqueness on `(pack, item)`), so
 * nothing here pre-checks membership: asking first would be a second request that can disagree
 * with the write it guards.
 */
export const useAddContentPackItem = () => {
    const { reefinApi, user } = useApi();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ packId, itemId }: ContentPackMembership) =>
            addContentPackItem(reefinApi!, packId, itemId),
        onSuccess: (_result, membership) =>
            invalidateMembership(queryClient, user?.Id, membership)
    });
};

export const useRemoveContentPackItem = () => {
    const { reefinApi, user } = useApi();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ packId, itemId }: ContentPackMembership) =>
            removeContentPackItem(reefinApi!, packId, itemId),
        onSuccess: (_result, membership) =>
            invalidateMembership(queryClient, user?.Id, membership)
    });
};

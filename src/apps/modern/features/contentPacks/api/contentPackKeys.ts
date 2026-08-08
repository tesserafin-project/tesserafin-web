/**
 * The canonical query keys of the content-pack slice (#138).
 *
 * One module, four families, no key literal anywhere else. A key that is spelled at its call site
 * is a key an invalidation can miss, and the mutation frontier in `useContentPackMutations.ts` is
 * only checkable because every read and every invalidation names the same function.
 *
 * ## Shape
 *
 * `['User', userId, 'ContentPacks', <family>, ...]` — the same `['User', userId, …]` prefix
 * `features/library/api/useLibraryItems.ts` already uses, for the same reason: every projection the
 * server returns here (visible count, representative artwork, membership, even whether a pack
 * exists at all) is computed FOR ONE USER. Two accounts sharing one cache entry would show one
 * user the other's authorized view — so the acting user is part of the identity of the data, not
 * an incidental request parameter.
 *
 * `userId` is `string | undefined` on purpose: keys are evaluated on every render, including the
 * ones before the session exists and `enabled` is still false.
 *
 * ## Opaque identifiers
 *
 * `packId` and `itemId` are the server's identifiers, carried through verbatim. Nothing here
 * parses one, normalises its case, splits it, or reconstructs it from a name — §3.8 makes the
 * identifier opaque, and a key that derived meaning from it would be the first place that stopped
 * being true.
 */

/** Paging arguments of one `getContentPackItems` page. Part of the key, so each page caches separately. */
export interface ContentPackItemsPageArgs {
    startIndex: number;
    limit: number;
}

const ROOT = 'ContentPacks' as const;

/** Position of `packId` inside {@link contentPackKeys.items}; see `keepPreviousPageOfSamePack`. */
export const ITEMS_KEY_PACK_ID_INDEX = 4;

export const contentPackKeys = {
    /** Everything the slice caches for one user. The invalidation of last resort. */
    all: (userId: string | undefined) => ['User', userId, ROOT] as const,

    /** `getContentPacks` — the user's packs, in the server's order. */
    list: (userId: string | undefined) =>
        ['User', userId, ROOT, 'list'] as const,

    /** `getContentPack` — one pack's metadata, by opaque id. */
    detail: (userId: string | undefined, packId: string | undefined) =>
        ['User', userId, ROOT, 'detail', packId] as const,

    /** Every cached page of one pack's items, whatever the paging arguments. */
    itemsForPack: (userId: string | undefined, packId: string | undefined) =>
        ['User', userId, ROOT, 'items', packId] as const,

    /** `getContentPackItems` — one page of one pack. */
    items: (
        userId: string | undefined,
        packId: string | undefined,
        page: ContentPackItemsPageArgs
    ) => ['User', userId, ROOT, 'items', packId, page] as const,

    /** Every cached "which packs contain this item" answer, for any item. */
    forItemAll: (userId: string | undefined) =>
        ['User', userId, ROOT, 'forItem'] as const,

    /** `getContentPacksForItem` — the packs this user can see one item in. */
    forItem: (userId: string | undefined, itemId: string | undefined) =>
        ['User', userId, ROOT, 'forItem', itemId] as const
};

export type ContentPackListKey = ReturnType<typeof contentPackKeys.list>;
export type ContentPackDetailKey = ReturnType<typeof contentPackKeys.detail>;
export type ContentPackItemsKey = ReturnType<typeof contentPackKeys.items>;
export type ContentPackForItemKey = ReturnType<typeof contentPackKeys.forItem>;

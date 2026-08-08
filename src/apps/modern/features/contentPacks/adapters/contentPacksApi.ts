/**
 * The one place the content-pack slice reaches the server (#138).
 *
 * Every call below goes through the **generated** `ContentPacksApi`
 * (`lib/tesserafin-sdk/generated/api/content-packs-api`). Nothing here re-types a request or
 * response body, re-declares a URL, or re-implements a permission rule or an authorization filter:
 * the server owns identity, membership, authorization, ordering, visible counts, representative
 * artwork and query semantics (`docs/content-pack-contract.md` §3.8), and this module is the thin
 * typed seam between that contract and React Query.
 *
 * **Why the factory lives here and not in `lib/tesserafin-sdk/index.ts`,** where `getLibraryApi`
 * and its siblings live. That barrel is eagerly reachable from
 * `utils/jellyfin-apiclient/compat.ts` and therefore from `main.tesserafin.bundle.js`; adding a
 * `getContentPacksApi` there would pull the 61 KB generated `content-packs-api.ts` into the initial
 * bundle. The measured initial-delivery headroom on `main` is 880 B gzip and *zero* assets, so that
 * is not a stylistic preference — it is the difference between the delivery-budget gate passing and
 * failing (#138 gate 11). Importing the concrete generated module from inside this slice keeps
 * `ContentPacksApi` in the `contentpacks` route chunk, which is where it belongs.
 *
 * Nothing here renders. Nothing that renders imports this.
 */
import { ContentPacksApi } from 'lib/tesserafin-sdk/generated/api/content-packs-api';
import type { BaseItemDto } from 'lib/tesserafin-sdk/generated/models/base-item-dto';
import type { BaseItemDtoQueryResult } from 'lib/tesserafin-sdk/generated/models/base-item-dto-query-result';
import type { ContentPackDto } from 'lib/tesserafin-sdk/generated/models/content-pack-dto';
import type { TesserafinApi } from 'lib/tesserafin-sdk/client';

export type { BaseItemDto, BaseItemDtoQueryResult, ContentPackDto };

/**
 * Same construction shape as `lib/tesserafin-sdk`'s own `get*Api(api)` helpers
 * (`new XApi(api.configuration, undefined, api.axiosInstance)`), so a reader who knows those knows
 * this one.
 */
export const getContentPacksApi = (api: TesserafinApi): ContentPacksApi =>
    new ContentPacksApi(api.configuration, undefined, api.axiosInstance);

/** Page of a pack's items, as `getContentPackItems` returns it. */
export interface ContentPackItemsPage {
    items: BaseItemDto[];
    totalRecordCount: number;
    startIndex: number;
}

export interface ContentPackItemsQuery {
    packId: string;
    startIndex: number;
    limit: number;
}

/**
 * Operation 1 — list the packs this user may see.
 *
 * Returned verbatim, in the server's order. The list is NOT re-sorted here, not even by
 * `SortOrder`: §3.8 makes ordering the server's, and a client-side sort would silently become the
 * product's ordering the first time the two disagreed.
 */
export const fetchContentPacks = async (
    api: TesserafinApi
): Promise<ContentPackDto[]> => {
    const { data } = await getContentPacksApi(api).getContentPacks();
    return data;
};

/**
 * Operation 2 — one pack's metadata.
 *
 * A `404` here means "absent **or** wholly inaccessible to this caller", and the contract
 * (§4.4.3) makes those two deliberately indistinguishable. The error is propagated unchanged so
 * the surface can say "this pack is not available" without ever claiming to know which it was.
 */
export const fetchContentPack = async (
    api: TesserafinApi,
    packId: string
): Promise<ContentPackDto> => {
    const { data } = await getContentPacksApi(api).getContentPack({ packId });
    return data;
};

/**
 * Operation 9 — the authorized items in a pack.
 *
 * Answers `200` with an empty page for a pack that exists but shows this caller nothing, and
 * `404` only for a pack that does not exist (§4.4.3). `TotalRecordCount` is the paging total for
 * *visible* items; it is used for paging and nothing else. In particular the browse surface never
 * compares it against `ContentPackDto.VisibleItemCount` to infer that hidden items exist — that
 * inference is exactly what gate 7 forbids.
 */
export const fetchContentPackItems = async (
    api: TesserafinApi,
    query: ContentPackItemsQuery
): Promise<ContentPackItemsPage> => {
    const { data }: { data: BaseItemDtoQueryResult } = await getContentPacksApi(
        api
    ).getContentPackItems({
        packId: query.packId,
        startIndex: query.startIndex,
        limit: query.limit,
        enableImages: true,
        enableUserData: true
    });

    return {
        items: data.Items ?? [],
        totalRecordCount: data.TotalRecordCount ?? 0,
        startIndex: data.StartIndex ?? query.startIndex
    };
};

/** Operation 10 — the packs the current user can see this item in. */
export const fetchContentPacksForItem = async (
    api: TesserafinApi,
    itemId: string
): Promise<ContentPackDto[]> => {
    const { data } = await getContentPacksApi(api).getContentPacksForItem({
        itemId
    });
    return data;
};

/** Operation 3 — create. `409` on a duplicate name, `400` on an invalid one; both propagate. */
export const createContentPack = async (
    api: TesserafinApi,
    body: { Name: string; Description?: string | null }
): Promise<ContentPackDto> => {
    const { data } = await getContentPacksApi(api).createContentPack({
        createContentPackRequest: body
    });
    return data;
};

/**
 * Operation 4 — rename / update metadata.
 *
 * "The identifier never changes" is the server's guarantee, and the returned DTO is what the cache
 * is updated from, so the Web never has to assume it.
 */
export const updateContentPack = async (
    api: TesserafinApi,
    packId: string,
    body: { Name: string; Description?: string | null }
): Promise<ContentPackDto> => {
    const { data } = await getContentPacksApi(api).updateContentPack({
        packId,
        updateContentPackRequest: body
    });
    return data;
};

/**
 * Operation 5 — reorder.
 *
 * The whole ordering, every id exactly once, in one transaction. There is no per-pack "move"
 * endpoint and none is synthesised here.
 */
export const reorderContentPacks = async (
    api: TesserafinApi,
    packIds: string[]
): Promise<void> => {
    await getContentPacksApi(api).reorderContentPacks({
        reorderContentPacksRequest: { PackIds: packIds }
    });
};

/** Operation 6 — delete the pack and its membership links. Never deletes media (§3.1). */
export const deleteContentPack = async (
    api: TesserafinApi,
    packId: string
): Promise<void> => {
    await getContentPacksApi(api).deleteContentPack({ packId });
};

/**
 * Operation 7 — add a membership.
 *
 * Idempotent at the storage layer (composite uniqueness on `(pack, item)`), so a repeated add is a
 * successful no-op and is NOT pre-checked here. Provenance is left unset so the server applies its
 * documented `Manual` default rather than the Web asserting a provenance it does not own.
 */
export const addContentPackItem = async (
    api: TesserafinApi,
    packId: string,
    itemId: string
): Promise<void> => {
    await getContentPacksApi(api).addContentPackItem({ packId, itemId });
};

/** Operation 8 — remove one membership. Idempotent; affects no other pack. */
export const removeContentPackItem = async (
    api: TesserafinApi,
    packId: string,
    itemId: string
): Promise<void> => {
    await getContentPacksApi(api).removeContentPackItem({ packId, itemId });
};

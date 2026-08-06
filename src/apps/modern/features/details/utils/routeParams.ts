/**
 * Route parameter resolution for `/details`.
 *
 * The precedence is frozen by `docs/tesserafin/item-details-legacy-contract.md` §1 and reproduced
 * here exactly: `id`, then `seriesTimerId`, then `genre`, then `musicgenre`, then `musicartist`.
 * First match wins; nothing further is consulted.
 *
 * Two parameters never select the lookup:
 *   - `serverId` chooses the API client, never the item;
 *   - `context` is forwarded to link building only.
 *
 * Unlike the legacy `getPromise`, an unrecognised parameter set is a VALUE here, not a synchronous
 * throw. The legacy throw escaped its own `.catch` and left a permanent spinner — `SUSPECT` #1,
 * which the migration is required to fix rather than reproduce.
 */

export const DETAILS_LOOKUP_ORDER = [
    'id',
    'seriesTimerId',
    'genre',
    'musicgenre',
    'musicartist'
] as const;

export type DetailsLookupKind = (typeof DETAILS_LOOKUP_ORDER)[number];

export interface DetailsRouteParams {
    /** Which parameter selected the primary read, or `null` when none matched. */
    kind: DetailsLookupKind | null;
    /** The value of that parameter. Empty when `kind` is `null`. */
    value: string;
    /** Selects the server. Never the item. */
    serverId?: string;
    /** Forwarded to link building only. Never changes which requests are issued. */
    context?: string;
}

type ParamSource = Pick<URLSearchParams, 'get'>;

/** Resolve the route parameters in their frozen precedence order. */
export function parseDetailsRouteParams(
    search: ParamSource
): DetailsRouteParams {
    const serverId = search.get('serverId') ?? undefined;
    const context = search.get('context') ?? undefined;

    for (const kind of DETAILS_LOOKUP_ORDER) {
        const value = search.get(kind);
        if (value) {
            return { kind, value, serverId, context };
        }
    }

    return { kind: null, value: '', serverId, context };
}

/** A stable key for React Query, so a route change cannot show the previous item's response. */
export function detailsQueryKey(params: DetailsRouteParams) {
    return [
        'itemDetails',
        params.serverId ?? 'current',
        params.kind ?? 'invalid',
        params.value
    ] as const;
}

import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';

import { FIRST_PAGE } from './pagination';

/**
 * URL query-param parsing/serialization for `/library/:libraryId` (RFC-0005 §11 WP-C step 5) -
 * sort/order/page/genre/year are mirrored to `useSearchParams` so a link can be shared/refreshed
 * with the same view. Density is handled separately (`density.ts`) since it also persists to
 * `localStorage`. Kept framework-free (`URLSearchParams` in, plain object out) so the parsing rules
 * are unit-testable without React Router.
 */

/** Sort fields exposed by the v1 `SortSelect` (mission scope: "SortName/DateCreated/CommunityRating/ProductionYear/Random au minimum"). */
export const SUPPORTED_SORT_BY: readonly ItemSortBy[] = [
    ItemSortBy.SortName,
    ItemSortBy.DateCreated,
    ItemSortBy.CommunityRating,
    ItemSortBy.ProductionYear,
    ItemSortBy.Random
];

export const SUPPORTED_SORT_ORDER: readonly SortOrder[] = [
    SortOrder.Ascending,
    SortOrder.Descending
];

/** Sentinel query-param value for "no filter" (genre/year `SortSelect`'s "All" option). */
export const FILTER_ALL_VALUE = 'all';

export const DEFAULT_SORT_BY = ItemSortBy.SortName;
export const DEFAULT_SORT_ORDER = SortOrder.Ascending;

export interface LibraryQueryState {
    sortBy: ItemSortBy;
    sortOrder: SortOrder;
    /** 1-indexed, mirrors `ui`'s `Pagination`. */
    page: number;
    /** A single genre (multi-select is documented debt, mission scope). */
    genre?: string;
    /** A single production year (multi-select is documented debt, mission scope). */
    year?: number;
}

const QUERY_PARAM = {
    sort: 'sort',
    order: 'order',
    page: 'page',
    genre: 'genre',
    year: 'year'
} as const;

const isSupportedSortBy = (value: string | null): value is ItemSortBy =>
    !!value && (SUPPORTED_SORT_BY as string[]).includes(value);

const isSupportedSortOrder = (value: string | null): value is SortOrder =>
    !!value && (SUPPORTED_SORT_ORDER as string[]).includes(value);

const parsePage = (value: string | null): number => {
    if (!value) return FIRST_PAGE;
    const page = Number.parseInt(value, 10);
    return Number.isInteger(page) && page >= FIRST_PAGE ? page : FIRST_PAGE;
};

const parseGenre = (value: string | null): string | undefined =>
    value && value !== FILTER_ALL_VALUE ? value : undefined;

const parseYear = (value: string | null): number | undefined => {
    if (!value || value === FILTER_ALL_VALUE) return undefined;
    const year = Number.parseInt(value, 10);
    return Number.isInteger(year) ? year : undefined;
};

/** Reads the sort/order/page/genre/year state from the URL, falling back to defaults for anything absent or invalid. */
export const parseLibraryQueryState = (
    searchParams: URLSearchParams
): LibraryQueryState => {
    const sortByParam = searchParams.get(QUERY_PARAM.sort);
    const sortOrderParam = searchParams.get(QUERY_PARAM.order);

    return {
        sortBy: isSupportedSortBy(sortByParam) ? sortByParam : DEFAULT_SORT_BY,
        sortOrder: isSupportedSortOrder(sortOrderParam)
            ? sortOrderParam
            : DEFAULT_SORT_ORDER,
        page: parsePage(searchParams.get(QUERY_PARAM.page)),
        genre: parseGenre(searchParams.get(QUERY_PARAM.genre)),
        year: parseYear(searchParams.get(QUERY_PARAM.year))
    };
};

/**
 * Writes `state` onto a copy of `searchParams`, dropping any param that's back at its default so a
 * default-state view has a clean URL (mission: "état par défaut propre sans params"). Any other
 * existing param (e.g. `density`) is preserved untouched.
 */
export const withLibraryQueryState = (
    searchParams: URLSearchParams,
    state: Partial<LibraryQueryState>
): URLSearchParams => {
    const next = new URLSearchParams(searchParams);
    const merged = { ...parseLibraryQueryState(searchParams), ...state };

    if (merged.sortBy === DEFAULT_SORT_BY) {
        next.delete(QUERY_PARAM.sort);
    } else {
        next.set(QUERY_PARAM.sort, merged.sortBy);
    }

    if (merged.sortOrder === DEFAULT_SORT_ORDER) {
        next.delete(QUERY_PARAM.order);
    } else {
        next.set(QUERY_PARAM.order, merged.sortOrder);
    }

    if (merged.page === FIRST_PAGE) {
        next.delete(QUERY_PARAM.page);
    } else {
        next.set(QUERY_PARAM.page, String(merged.page));
    }

    if (!merged.genre) {
        next.delete(QUERY_PARAM.genre);
    } else {
        next.set(QUERY_PARAM.genre, merged.genre);
    }

    if (!merged.year) {
        next.delete(QUERY_PARAM.year);
    } else {
        next.set(QUERY_PARAM.year, String(merged.year));
    }

    return next;
};

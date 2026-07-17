import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order';
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SORT_BY,
    DEFAULT_SORT_ORDER,
    parseLibraryQueryState,
    withLibraryQueryState
} from './queryParams';

describe('parseLibraryQueryState()', () => {
    it('defaults to SortName/Ascending/page 1/no filters for an empty URL', () => {
        const state = parseLibraryQueryState(new URLSearchParams());

        expect(state).toEqual({
            sortBy: DEFAULT_SORT_BY,
            sortOrder: DEFAULT_SORT_ORDER,
            page: 1,
            genre: undefined,
            year: undefined
        });
    });

    it('reads a supported sort/order/page/genre/year combination', () => {
        const state = parseLibraryQueryState(
            new URLSearchParams(
                'sort=CommunityRating&order=Descending&page=3&genre=Action&year=1999'
            )
        );

        expect(state).toEqual({
            sortBy: ItemSortBy.CommunityRating,
            sortOrder: SortOrder.Descending,
            page: 3,
            genre: 'Action',
            year: 1999
        });
    });

    it('falls back to the default sort field for an unsupported value', () => {
        const state = parseLibraryQueryState(
            new URLSearchParams('sort=NotARealField')
        );

        expect(state.sortBy).toBe(DEFAULT_SORT_BY);
    });

    it('falls back to the default order for an unsupported value', () => {
        const state = parseLibraryQueryState(
            new URLSearchParams('order=Sideways')
        );

        expect(state.sortOrder).toBe(DEFAULT_SORT_ORDER);
    });

    it('falls back to page 1 for a non-numeric or non-positive page', () => {
        expect(
            parseLibraryQueryState(new URLSearchParams('page=abc')).page
        ).toBe(1);
        expect(parseLibraryQueryState(new URLSearchParams('page=0')).page).toBe(
            1
        );
        expect(
            parseLibraryQueryState(new URLSearchParams('page=-2')).page
        ).toBe(1);
    });

    it('treats genre=all as no filter', () => {
        expect(
            parseLibraryQueryState(new URLSearchParams('genre=all')).genre
        ).toBeUndefined();
    });

    it('treats year=all or a non-numeric year as no filter', () => {
        expect(
            parseLibraryQueryState(new URLSearchParams('year=all')).year
        ).toBeUndefined();
        expect(
            parseLibraryQueryState(new URLSearchParams('year=abc')).year
        ).toBeUndefined();
    });
});

describe('withLibraryQueryState()', () => {
    it('produces an empty query string for the all-default state', () => {
        const next = withLibraryQueryState(new URLSearchParams(), {
            sortBy: DEFAULT_SORT_BY,
            sortOrder: DEFAULT_SORT_ORDER,
            page: 1
        });

        expect(next.toString()).toBe('');
    });

    it('only writes params that differ from their default', () => {
        const next = withLibraryQueryState(new URLSearchParams(), {
            sortBy: ItemSortBy.Random
        });

        expect(next.get('sort')).toBe('Random');
        expect(next.has('order')).toBe(false);
        expect(next.has('page')).toBe(false);
    });

    it('merges a partial update onto the existing state instead of resetting it', () => {
        const current = new URLSearchParams('sort=CommunityRating&genre=Drama');

        const next = withLibraryQueryState(current, { page: 2 });

        expect(next.get('sort')).toBe('CommunityRating');
        expect(next.get('genre')).toBe('Drama');
        expect(next.get('page')).toBe('2');
    });

    it('removes a filter when the update clears it back to undefined', () => {
        const current = new URLSearchParams('genre=Drama&page=2');

        const next = withLibraryQueryState(current, { genre: undefined });

        expect(next.has('genre')).toBe(false);
        // Untouched params are preserved.
        expect(next.get('page')).toBe('2');
    });

    it('preserves unrelated params it does not own, e.g. density', () => {
        const current = new URLSearchParams('density=compact');

        const next = withLibraryQueryState(current, { page: 2 });

        expect(next.get('density')).toBe('compact');
        expect(next.get('page')).toBe('2');
    });
});

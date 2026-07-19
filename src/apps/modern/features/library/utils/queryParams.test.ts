import { ItemSortBy, SortOrder } from 'lib/reefin-sdk';
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

/**
 * The Browse controls L15a delivered as vocabulary and L15b wires into the URL (design §3.2/§4.1).
 * These four params are what make Studios, Favorites, Episodes and the AlphaPicker *shareable*:
 * without them in the URL they would be local state, and the arbitration that demoted them from
 * tabs to controls would have cost the user a bookmarkable view.
 */
describe('parseLibraryQueryState() — Browse controls', () => {
    it('reads the letter, normalising case and rejecting non-letters', () => {
        expect(
            parseLibraryQueryState(new URLSearchParams('letter=b')).letter
        ).toBe('B');
        expect(
            parseLibraryQueryState(new URLSearchParams('letter=%23')).letter
        ).toBe('#');
        expect(
            parseLibraryQueryState(new URLSearchParams('letter=AB')).letter
        ).toBeUndefined();
        expect(
            parseLibraryQueryState(new URLSearchParams('letter=7')).letter
        ).toBeUndefined();
    });

    it('reads the granularity, ignoring anything that is not a known depth', () => {
        expect(
            parseLibraryQueryState(new URLSearchParams('granularity=episodes'))
                .granularity
        ).toBe('episodes');
        expect(
            parseLibraryQueryState(new URLSearchParams('granularity=seasons'))
                .granularity
        ).toBeUndefined();
    });

    /** `?favorite=1` is a single truthy sentinel: absent means "no filter", never "show non-favorites". */
    it('reads favorite only from the "1" sentinel', () => {
        expect(
            parseLibraryQueryState(new URLSearchParams('favorite=1')).favorite
        ).toBe(true);
        expect(
            parseLibraryQueryState(new URLSearchParams('favorite=0')).favorite
        ).toBeUndefined();
        expect(
            parseLibraryQueryState(new URLSearchParams('favorite=true'))
                .favorite
        ).toBeUndefined();
        expect(
            parseLibraryQueryState(new URLSearchParams('')).favorite
        ).toBeUndefined();
    });

    it('reads comma-separated studio ids, dropping blanks', () => {
        expect(
            parseLibraryQueryState(new URLSearchParams('studio=s1,s2'))
                .studioIds
        ).toEqual(['s1', 's2']);
        expect(
            parseLibraryQueryState(new URLSearchParams('studio=,, ,')).studioIds
        ).toBeUndefined();
    });
});

describe('withLibraryQueryState() — Browse controls', () => {
    const serialize = (
        search: string,
        state: Parameters<typeof withLibraryQueryState>[1]
    ) => withLibraryQueryState(new URLSearchParams(search), state).toString();

    it('writes each control and clears it again when unset', () => {
        expect(serialize('', { letter: 'C' })).toContain('letter=C');
        expect(serialize('letter=C', { letter: undefined })).not.toContain(
            'letter'
        );

        expect(serialize('', { favorite: true })).toContain('favorite=1');
        expect(serialize('favorite=1', { favorite: undefined })).not.toContain(
            'favorite'
        );

        expect(serialize('', { studioIds: ['s1', 's2'] })).toContain(
            'studio=s1%2Cs2'
        );
        expect(serialize('studio=s1', { studioIds: [] })).not.toContain(
            'studio'
        );
    });

    /** `primary` is the default depth, so it is written as absence — the same clean-URL rule sort/order/page follow. */
    it('writes granularity only when it is not the default depth', () => {
        expect(serialize('', { granularity: 'episodes' })).toContain(
            'granularity=episodes'
        );
        expect(
            serialize('granularity=episodes', { granularity: 'primary' })
        ).not.toContain('granularity');
    });

    it('leaves an untouched control alone', () => {
        expect(serialize('letter=C&studio=s1', { page: 3 })).toContain(
            'letter=C'
        );
        expect(serialize('letter=C&studio=s1', { page: 3 })).toContain(
            'studio=s1'
        );
    });
});

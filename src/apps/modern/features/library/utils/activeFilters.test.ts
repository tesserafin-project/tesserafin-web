import { describe, expect, it } from 'vitest';
import {
    clearedLibraryFilters,
    getActiveLibraryFilters,
    withoutLibraryFilter
} from './activeFilters';
import { parseLibraryQueryState, withLibraryQueryState } from './queryParams';

const query =
    'genre=Drama&year=2026&letter=%23&favorite=1&studio=s1,s2,s1&page=4&sort=DateCreated&order=Descending&granularity=episodes&density=compact&view=list&other=keep';

describe('library filter recovery URL semantics', () => {
    it('describes every effective predicate, deduplicating studio IDs, excluding presentation and sort', () => {
        const filters = getActiveLibraryFilters(
            parseLibraryQueryState(new URLSearchParams(query))
        );
        expect(filters.map((f) => [f.kind, f.value])).toEqual([
            ['genre', 'Drama'],
            ['year', '2026'],
            ['letter', '#'],
            ['favorite', ''],
            ['studio', 's1'],
            ['studio', 's2']
        ]);
        expect(new Set(filters.map((f) => f.id)).size).toBe(6);
    });
    it('clears only the filters and resets pagination, preserving depth, sort, display and unrelated params', () => {
        const result = withLibraryQueryState(
            new URLSearchParams(query),
            clearedLibraryFilters
        );
        expect([...result]).toEqual([
            ['sort', 'DateCreated'],
            ['order', 'Descending'],
            ['granularity', 'episodes'],
            ['density', 'compact'],
            ['view', 'list'],
            ['other', 'keep']
        ]);
        expect(getActiveLibraryFilters(parseLibraryQueryState(result))).toEqual(
            []
        );
    });
    it.each(['genre', 'year', 'letter', 'favorite', 'studio'])(
        'removes a single %s predicate without disturbing the others',
        (kind) => {
            const params = new URLSearchParams(query);
            const state = parseLibraryQueryState(params);
            const filters = getActiveLibraryFilters(state);
            const target = filters.find((f) => f.kind === kind)!;
            const next = withLibraryQueryState(
                params,
                withoutLibraryFilter(state, target)
            );
            expect(
                getActiveLibraryFilters(parseLibraryQueryState(next))
            ).toEqual(filters.filter((f) => f.id !== target.id));
            expect(next.has('page')).toBe(false);
            expect(next.get('sort')).toBe('DateCreated');
            expect(next.get('density')).toBe('compact');
        }
    );
    it('does not call defaults, malformed or unsent values active filters', () => {
        expect(
            getActiveLibraryFilters(
                parseLibraryQueryState(
                    new URLSearchParams(
                        'genre=all&year=bad&letter=invalid&favorite=no&studio=,,, &page=2&view=list'
                    )
                )
            )
        ).toEqual([]);
        expect(
            getActiveLibraryFilters(
                parseLibraryQueryState(new URLSearchParams('year=0'))
            )
        ).toEqual([]);
    });
});

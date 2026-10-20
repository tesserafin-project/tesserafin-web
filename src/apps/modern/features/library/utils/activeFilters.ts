import type { LibraryQueryState } from './queryParams';
import { FIRST_PAGE } from './pagination';

export interface ActiveLibraryFilter {
    id: string;
    kind: 'genre' | 'year' | 'letter' | 'favorite' | 'studio';
    value: string;
}

/** Only predicates actually sent by useLibraryItems; sort, depth and display are not filters. */
export function getActiveLibraryFilters(
    state: LibraryQueryState
): ActiveLibraryFilter[] {
    const filters: ActiveLibraryFilter[] = [];
    if (state.genre)
        filters.push({ id: 'genre', kind: 'genre', value: state.genre });
    if (state.year)
        filters.push({ id: 'year', kind: 'year', value: String(state.year) });
    if (state.letter)
        filters.push({ id: 'letter', kind: 'letter', value: state.letter });
    if (state.favorite)
        filters.push({ id: 'favorite', kind: 'favorite', value: '' });
    for (const id of new Set(state.studioIds))
        filters.push({ id: `studio:${id}`, kind: 'studio', value: id });
    return filters;
}

export const clearedLibraryFilters: Partial<LibraryQueryState> = {
    genre: undefined,
    year: undefined,
    letter: undefined,
    favorite: undefined,
    studioIds: undefined,
    page: FIRST_PAGE
};

export function withoutLibraryFilter(
    state: LibraryQueryState,
    filter: ActiveLibraryFilter
): Partial<LibraryQueryState> {
    if (filter.kind === 'studio')
        return {
            studioIds: state.studioIds?.filter((id) => id !== filter.value),
            page: FIRST_PAGE
        };
    return { [filter.kind]: undefined, page: FIRST_PAGE };
}

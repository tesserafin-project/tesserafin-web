import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { describe, expect, it } from 'vitest';

import moviesViews from 'apps/modern/features/libraries/constants/views/movies';
import tvShowsViews from 'apps/modern/features/libraries/constants/views/tvshows';
import { getViewContent } from 'apps/modern/features/libraries/utils/viewContent';

import {
    ALPHA_PICKER_LETTERS,
    DEFAULT_DESTINATION,
    DEFAULT_VIEW_MODE,
    FIRST_LIBRARY_PAGE,
    getSuggestionsShelves,
    getViewModeStorageKey,
    isAlphaPickerEnabled,
    LEGACY_MOVIE_TABS,
    LEGACY_TAB_FATE,
    LEGACY_TVSHOWS_TABS,
    LIBRARY_DESTINATIONS,
    NON_ALPHA_LETTER,
    parseFavorite,
    parseLetter,
    parseStudioIds,
    resolveDestination,
    resolveGranularity,
    resolveViewMode,
    selectLetter,
    toggleLetter,
    toggleViewMode
} from './librarySections';

/**
 * Behavioural spec for the Library navigation model (structure delivered, not routed)
 * (`docs/reefin/design-library-navigation.md`). Nothing here activates a route; these assertions
 * pin the arbitration so a later activation slice cannot silently drop a legacy tab or ship a
 * misleading AlphaPicker.
 */
describe('library navigation model (not routed)', () => {
    describe('the legacy tab inventory this arbitration must cover', () => {
        it('matches the real movies view constants', () => {
            const actual = Object.values(moviesViews).map((v) => v.viewType);
            expect(actual).toEqual(LEGACY_MOVIE_TABS);
            expect(actual).toHaveLength(7);
        });

        it('matches the real tvshows view constants', () => {
            const actual = Object.values(tvShowsViews).map((v) => v.viewType);
            expect(actual).toEqual(LEGACY_TVSHOWS_TABS);
            expect(actual).toHaveLength(8);
        });

        // The measurement that makes AlphaPicker + grid/list non-negotiable targets: they are live
        // on exactly the two tabs `/library/:libraryId` would take over (defaults.ts enables both,
        // and neither tab 0 overrides them).
        it('confirms AlphaPicker and grid/list are live on both tab 0s', () => {
            for (const collectionType of [
                CollectionType.Movies,
                CollectionType.Tvshows
            ]) {
                const tabZero = getViewContent(collectionType, 0);
                expect(tabZero.isAlphabetPickerEnabled).toBe(true);
                expect(tabZero.isBtnGridListEnabled).toBe(true);
            }
        });
    });

    describe('arbitration: four destinations, every legacy tab assigned', () => {
        it('exposes exactly four first-level destinations', () => {
            expect(LIBRARY_DESTINATIONS).toEqual([
                'browse',
                'genres',
                'collections',
                'suggestions'
            ]);
        });

        it('assigns a fate to every legacy tab of both library types', () => {
            const allTabs = new Set([
                ...LEGACY_MOVIE_TABS,
                ...LEGACY_TVSHOWS_TABS
            ]);
            for (const tab of allTabs) {
                expect(
                    LEGACY_TAB_FATE[tab],
                    `legacy tab "${tab}" has no assigned fate`
                ).toBeDefined();
            }
        });

        // The load-bearing constraint of the mission: Studios is a query predicate, not a place.
        it('keeps Studios a Browse filter, never a destination', () => {
            expect(LEGACY_TAB_FATE.studios).toEqual({
                kind: 'filter',
                destination: 'browse',
                control: 'studio'
            });
            expect(LIBRARY_DESTINATIONS).not.toContain('studios');
        });

        it('folds Favorites into a Browse filter and Upcoming into a Suggestions shelf', () => {
            expect(LEGACY_TAB_FATE.favorites.kind).toBe('filter');
            expect(LEGACY_TAB_FATE.upcoming).toEqual({
                kind: 'shelf',
                destination: 'suggestions'
            });
        });

        it('treats Episodes as a granularity of Browse, not a tab', () => {
            expect(LEGACY_TAB_FATE.episodes.kind).toBe('granularity');
        });

        it('takes Playlists out of library scope', () => {
            expect(LEGACY_TAB_FATE.playlists.kind).toBe('out-of-scope');
        });

        it('never routes a fate to a destination outside the four', () => {
            for (const fate of Object.values(LEGACY_TAB_FATE)) {
                if (fate.kind === 'out-of-scope') continue;
                expect(LIBRARY_DESTINATIONS).toContain(fate.destination);
            }
        });
    });

    describe('destination resolution', () => {
        it('defaults to browse', () => {
            expect(DEFAULT_DESTINATION).toBe('browse');
            expect(resolveDestination(undefined)).toBe('browse');
            expect(resolveDestination(null)).toBe('browse');
            expect(resolveDestination('')).toBe('browse');
        });

        it('resolves known segments and rejects unknown ones', () => {
            expect(resolveDestination('genres')).toBe('genres');
            expect(resolveDestination('collections')).toBe('collections');
            expect(resolveDestination('studios')).toBe('browse');
            expect(resolveDestination('playlists')).toBe('browse');
        });
    });

    describe('grid/list toggle', () => {
        it('prefers the URL, then storage, then grid', () => {
            expect(resolveViewMode('list', 'grid')).toBe('list');
            expect(resolveViewMode(null, 'list')).toBe('list');
            expect(resolveViewMode(null, undefined)).toBe(DEFAULT_VIEW_MODE);
            expect(resolveViewMode('bogus', undefined)).toBe('grid');
        });

        it('toggles between the two modes', () => {
            expect(toggleViewMode('grid')).toBe('list');
            expect(toggleViewMode('list')).toBe('grid');
        });
    });

    describe('AlphaPicker', () => {
        it('offers # plus A–Z', () => {
            expect(ALPHA_PICKER_LETTERS).toHaveLength(27);
            expect(ALPHA_PICKER_LETTERS[0]).toBe(NON_ALPHA_LETTER);
            expect(ALPHA_PICKER_LETTERS.at(-1)).toBe('Z');
        });

        it('is enabled only under SortName', () => {
            expect(isAlphaPickerEnabled('SortName')).toBe(true);
            expect(isAlphaPickerEnabled('DateCreated')).toBe(false);
            expect(isAlphaPickerEnabled('Random')).toBe(false);
        });

        it('is inert at episode granularity, as the legacy tab already is', () => {
            expect(isAlphaPickerEnabled('SortName', 'episodes')).toBe(false);
            expect(isAlphaPickerEnabled('SortName', 'primary')).toBe(true);
        });

        it('parses a letter param, case-insensitively', () => {
            expect(parseLetter('a')).toBe('A');
            expect(parseLetter('Z')).toBe('Z');
            expect(parseLetter(NON_ALPHA_LETTER)).toBe(NON_ALPHA_LETTER);
        });

        it('rejects anything that is not a single letter or #', () => {
            expect(parseLetter(null)).toBeUndefined();
            expect(parseLetter('')).toBeUndefined();
            expect(parseLetter('AB')).toBeUndefined();
            expect(parseLetter('4')).toBeUndefined();
        });

        it('clears the filter when the active letter is picked again', () => {
            expect(toggleLetter('A', 'A')).toBeUndefined();
            expect(toggleLetter('A', 'B')).toBe('B');
            expect(toggleLetter(undefined, 'A')).toBe('A');
        });

        it('resets pagination to page 1 on every letter change', () => {
            expect(selectLetter(undefined, 'Q')).toEqual({
                letter: 'Q',
                page: FIRST_LIBRARY_PAGE
            });
            expect(selectLetter('A', 'B')).toEqual({
                letter: 'B',
                page: FIRST_LIBRARY_PAGE
            });
        });

        it('resets pagination even when the letter is being cleared', () => {
            // Clearing widens the result set, so a stale deep page is just as wrong as after a
            // narrowing change.
            expect(selectLetter('A', 'A')).toEqual({
                letter: undefined,
                page: FIRST_LIBRARY_PAGE
            });
        });
    });

    describe('Series/Episodes granularity', () => {
        it('accepts episodes only for a tvshows library', () => {
            expect(resolveGranularity('episodes', true)).toBe('episodes');
            expect(resolveGranularity('primary', true)).toBe('primary');
        });

        it('ignores the param entirely for a movies library, which has no depth below Movie', () => {
            expect(resolveGranularity('episodes', false)).toBe('primary');
        });

        it('falls back to primary for anything unrecognised', () => {
            expect(resolveGranularity(null, true)).toBe('primary');
            expect(resolveGranularity('seasons', true)).toBe('primary');
        });
    });

    describe('Browse filters (Studios, Favorites)', () => {
        it('reads ?favorite=1 as on, and anything else as no filter', () => {
            expect(parseFavorite('1')).toBe(true);
            expect(parseFavorite('0')).toBeUndefined();
            expect(parseFavorite(null)).toBeUndefined();
        });

        it('parses a comma-separated studio list', () => {
            expect(parseStudioIds('a,b')).toEqual(['a', 'b']);
            expect(parseStudioIds(' a , b ')).toEqual(['a', 'b']);
        });

        it('treats an empty or blank studio param as no filter', () => {
            expect(parseStudioIds(null)).toBeUndefined();
            expect(parseStudioIds('')).toBeUndefined();
            expect(parseStudioIds(',,')).toBeUndefined();
        });
    });

    describe('view mode is per-library and orthogonal to density', () => {
        it('keys storage per library, so two libraries do not share a mode', () => {
            expect(getViewModeStorageKey('lib-a')).not.toBe(
                getViewModeStorageKey('lib-b')
            );
            expect(getViewModeStorageKey('lib-a')).toContain('lib-a');
        });

        it('lets the URL win over the stored preference', () => {
            expect(resolveViewMode('list', 'grid')).toBe('list');
            expect(resolveViewMode('grid', 'list')).toBe('grid');
        });

        it('falls back to the stored preference, then to grid', () => {
            expect(resolveViewMode(null, 'list')).toBe('list');
            expect(resolveViewMode(null, undefined)).toBe(DEFAULT_VIEW_MODE);
            expect(resolveViewMode('sideways', undefined)).toBe(
                DEFAULT_VIEW_MODE
            );
        });

        // Orthogonality: view mode resolves from its own param/key and never consults density, so
        // all four (grid|list) x (comfortable|compact) combinations are reachable. The density
        // half of the pair is pinned by `utils/density.test.ts`.
        it('resolves without reference to density', () => {
            expect(getViewModeStorageKey('lib-a')).not.toContain('density');
            expect(resolveViewMode('list', undefined)).toBe('list');
        });
    });

    describe('Suggestions shelves', () => {
        it('carries the legacy movie suggestion sections', () => {
            const shelves = getSuggestionsShelves('movies');
            expect(shelves).toContain('ContinueWatchingMovies');
            expect(shelves).toContain('LatestMovies');
        });

        it('folds Upcoming into the tvshows shelves rather than leaving it a tab', () => {
            const shelves = getSuggestionsShelves('tvshows');
            expect(shelves).toContain('NextUp');
            expect(shelves).toContain('UpcomingEpisodes');
        });

        it('has no shelves for a library type outside v1 scope', () => {
            expect(getSuggestionsShelves('music')).toEqual([]);
            expect(getSuggestionsShelves(undefined)).toEqual([]);
        });
    });
});

/**
 * Navigation model for `/library/:libraryId` — the four-destination alternative to the 7–8 legacy
 * tabs, specified in `docs/reefin/design-library-navigation.md` (issue #15, arbitrage §8-C of
 * reefin#44).
 *
 * **ROUTED AND ACTIVATED (L15b).** The destinations are mounted, `appRouter.getRouteUrl()` points
 * movies/tvshows libraries at the canonical route, and the legacy tab redirects are live in
 * `utils/legacyLibraryRedirect.ts` — including its four deliberate `null` cells: bare Studios URLs
 * (movies tab 5, tvshows tab 4) and Playlists (movies tab 6, tvshows tab 7) STAY on their legacy
 * pages, per `LEGACY_TAB_FATE` below and `UNREDIRECTED_LEGACY_TABS`' recorded reasons. A bare
 * Studios URL names no studio, so it cannot become `?studio=<id>` on Browse without losing its
 * meaning; a playlist crosses libraries, so it is out of library scope.
 *
 * The slice still costs 0 bytes on the main bundle: `library/:libraryId` is declared in
 * `apps/modern/routes/asyncRoutes/user.ts` and loaded by `AsyncRoute.tsx` via
 * `lazy: () => import(...)`, so it lives in an async chunk outside `main.jellyfin.bundle.js`.
 *
 * Deliberately free of `@jellyfin/sdk` / `reefin-sdk` imports: this is the navigation vocabulary,
 * not a query builder, and it must not pre-empt the SDK migration that PR #22 carries.
 */

/** The four first-level destinations. Everything else is a filter, a shelf, or out of scope. */
export const LIBRARY_DESTINATIONS = [
    'browse',
    'genres',
    'collections',
    'suggestions'
] as const;

export type LibraryDestination = (typeof LIBRARY_DESTINATIONS)[number];

export const DEFAULT_DESTINATION: LibraryDestination = 'browse';

/**
 * What happens to each legacy tab. Every one of the 15 tab entries across
 * `constants/views/movies.ts` (7) and `constants/views/tvshows.ts` (8) is accounted for — an
 * arbitration that leaves a tab unnamed is an arbitration left open.
 */
export type LegacyTabFate =
    /** Promoted to a first-level destination. */
    | { kind: 'destination'; destination: LibraryDestination }
    /** Expressible as a predicate on the Browse query — a control, not a view. */
    | { kind: 'filter'; destination: 'browse'; control: string }
    /** A depth change on the same query (Series ↔ Episodes). */
    | { kind: 'granularity'; destination: 'browse'; control: string }
    /** Editorialised content folded into a Suggestions shelf. */
    | { kind: 'shelf'; destination: 'suggestions' }
    /** Not a library-scoped concept at all; stays on its existing page. */
    | { kind: 'out-of-scope'; reason: string };

/**
 * Legacy `LibraryTab` value → its fate. Keys are the `types/libraryTab.ts` string values, so this
 * map can be checked against the real enum without importing it (and thus without coupling this
 * vocabulary module to the legacy slice).
 */
export const LEGACY_TAB_FATE: Record<string, LegacyTabFate> = {
    movies: { kind: 'destination', destination: 'browse' },
    series: { kind: 'destination', destination: 'browse' },
    genres: { kind: 'destination', destination: 'genres' },
    collections: { kind: 'destination', destination: 'collections' },
    suggestions: { kind: 'destination', destination: 'suggestions' },
    studios: { kind: 'filter', destination: 'browse', control: 'studio' },
    favorites: { kind: 'filter', destination: 'browse', control: 'favorite' },
    upcoming: { kind: 'shelf', destination: 'suggestions' },
    episodes: {
        kind: 'granularity',
        destination: 'browse',
        control: 'granularity'
    },
    playlists: {
        kind: 'out-of-scope',
        reason: 'A playlist crosses libraries; it is not scoped to one.'
    }
};

/** The legacy tabs of each library type, in their legacy index order. */
export const LEGACY_MOVIE_TABS: readonly string[] = [
    'movies',
    'suggestions',
    'favorites',
    'collections',
    'genres',
    'studios',
    'playlists'
];

export const LEGACY_TVSHOWS_TABS: readonly string[] = [
    'series',
    'suggestions',
    'upcoming',
    'genres',
    'studios',
    'episodes',
    'collections',
    'playlists'
];

export const isLibraryDestination = (
    value: string | null | undefined
): value is LibraryDestination =>
    !!value && (LIBRARY_DESTINATIONS as readonly string[]).includes(value);

/** Resolves the destination from a route segment, falling back to Browse for anything unknown. */
export const resolveDestination = (
    segment: string | null | undefined
): LibraryDestination =>
    isLibraryDestination(segment) ? segment : DEFAULT_DESTINATION;

/* -------------------------------------------------------------------------- */
/* Browse: view mode (grid/list)                                              */
/* -------------------------------------------------------------------------- */

export type LibraryViewMode = 'grid' | 'list';

export const DEFAULT_VIEW_MODE: LibraryViewMode = 'grid';

export const VIEW_MODE_QUERY_PARAM = 'view';

/** Per-library `localStorage` key, mirroring `utils/density.ts`'s convention. */
export const getViewModeStorageKey = (libraryId: string): string =>
    `library-view-${libraryId}`;

export const isLibraryViewMode = (
    value: string | null | undefined
): value is LibraryViewMode => value === 'grid' || value === 'list';

/**
 * URL param wins, then the stored preference, then `grid` — the same precedence
 * `resolveLibraryDensity` already applies, so a shared link reproduces the view exactly.
 *
 * View mode is **orthogonal to density**: density keeps meaning "how tight" within whichever mode
 * is active, which is what yields four combinations instead of three ad-hoc modes.
 */
export const resolveViewMode = (
    urlValue: string | null,
    storedValue: LibraryViewMode | undefined
): LibraryViewMode => {
    if (isLibraryViewMode(urlValue)) return urlValue;
    if (isLibraryViewMode(storedValue)) return storedValue;
    return DEFAULT_VIEW_MODE;
};

export const toggleViewMode = (mode: LibraryViewMode): LibraryViewMode =>
    mode === 'grid' ? 'list' : 'grid';

/* -------------------------------------------------------------------------- */
/* Browse: AlphaPicker                                                        */
/* -------------------------------------------------------------------------- */

export const LETTER_QUERY_PARAM = 'letter';

/** 1-indexed, mirroring `utils/pagination.ts`'s `FIRST_PAGE` (duplicated, not imported, to keep this vocabulary module free of app-side deps). */
export const FIRST_LIBRARY_PAGE = 1;

/** Sentinel for the non-alphabetic bucket. */
export const NON_ALPHA_LETTER = '#';

/**
 * `#` is not a `nameStartsWith` value: the server expresses "sorts before A" as `nameLessThan: 'A'`.
 * `utils/items.ts` already applies exactly this translation for the legacy pages
 * (`nameLessThan: alphabetValue === '#' ? 'A' : undefined`); reusing the same constant is what makes
 * the ported picker return the *same* set as the legacy one rather than a plausible-looking
 * approximation.
 */
export const NON_ALPHA_NAME_LESS_THAN = 'A';

export const ALPHA_PICKER_LETTERS: readonly string[] = [
    NON_ALPHA_LETTER,
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
];

export type LibraryGranularity = 'primary' | 'episodes';

/**
 * The AlphaPicker is only truthful under `SortName`: on any other sort the visual order is not
 * alphabetical, so jumping to a letter would scroll to an arbitrary place. It is disabled rather
 * than hidden (hiding it would reflow the control bar on every sort change), and it is inert at
 * `episodes` granularity — matching `episodesTabContent`, which already sets
 * `isAlphabetPickerEnabled: false`.
 */
export const isAlphaPickerEnabled = (
    sortBy: string,
    granularity: LibraryGranularity = 'primary'
): boolean => sortBy === 'SortName' && granularity !== 'episodes';

/**
 * Normalizes a raw letter param: a single A–Z letter (case-insensitively) or `#`. Anything else —
 * multi-character, digits, empty — means "no letter filter".
 */
export const parseLetter = (value: string | null): string | undefined => {
    if (!value) return undefined;
    if (value === NON_ALPHA_LETTER) return NON_ALPHA_LETTER;
    const upper = value.toUpperCase();
    return upper.length === 1 && upper >= 'A' && upper <= 'Z'
        ? upper
        : undefined;
};

/** Selecting the already-selected letter clears the filter — the picker is a toggle, not a radio. */
export const toggleLetter = (
    current: string | undefined,
    letter: string
): string | undefined => (current === letter ? undefined : letter);

/**
 * A letter change always returns to page 1. Keeping the old page would land the user on, say, page 7
 * of a "Q" result set that has two pages — the same out-of-range window `useCanonicalPage` has to
 * repair after the fact. Resetting at the source avoids opening it at all.
 *
 * Returns the next `{ letter, page }` pair, so a caller cannot apply the letter and forget the page.
 */
export const selectLetter = (
    current: string | undefined,
    letter: string
): { letter: string | undefined; page: number } => ({
    letter: toggleLetter(current, letter),
    page: FIRST_LIBRARY_PAGE
});

/* -------------------------------------------------------------------------- */
/* Browse: Series/Episodes granularity                                        */
/* -------------------------------------------------------------------------- */

export const GRANULARITY_QUERY_PARAM = 'granularity';

export const isLibraryGranularity = (
    value: string | null | undefined
): value is LibraryGranularity => value === 'primary' || value === 'episodes';

/**
 * Granularity only exists for tvshows: a movies library has no depth below `Movie`, so the control
 * is absent there rather than disabled. Callers resolve the *primary* kind from the collection type
 * as they already do, then let this swap in `Episode`.
 */
export const resolveGranularity = (
    value: string | null | undefined,
    isTvshows: boolean
): LibraryGranularity =>
    isTvshows && isLibraryGranularity(value) ? value : 'primary';

/* -------------------------------------------------------------------------- */
/* Browse: Favorites and Studios filters                                      */
/* -------------------------------------------------------------------------- */

export const FAVORITE_QUERY_PARAM = 'favorite';

export const STUDIO_QUERY_PARAM = 'studio';

/** `?favorite=1` — a single truthy sentinel, so an absent param means "no filter", not "false". */
export const parseFavorite = (value: string | null): boolean | undefined =>
    value === '1' ? true : undefined;

/** Studio ids arrive comma-separated so one param carries a multi-select without repeating keys. */
export const parseStudioIds = (value: string | null): string[] | undefined => {
    if (!value) return undefined;
    const ids = value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    return ids.length ? ids : undefined;
};

/* -------------------------------------------------------------------------- */
/* Suggestions: shelves                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The shelves of the Suggestions destination, per library type. These are exactly the
 * `sectionsView.suggestionSections` the legacy `suggestionsTabContent` already requests
 * (`constants/views/movies.ts`, `constants/views/tvshows.ts`) — plus `upcoming` on tvshows, which
 * design §3.2 folds in from its own legacy tab (`upcomingTabContent` carries no `itemType`: it was
 * already a sections view, not a list).
 *
 * Section names are the `types/sections.ts` `SectionType` string values, matched without importing
 * the enum so this vocabulary module stays decoupled from the legacy slice.
 */
export const SUGGESTIONS_SHELVES: Record<string, readonly string[]> = {
    movies: ['ContinueWatchingMovies', 'LatestMovies', 'MovieRecommendations'],
    tvshows: [
        'ContinueWatchingEpisode',
        'LatestEpisode',
        'NextUp',
        'UpcomingEpisodes'
    ]
};

export const getSuggestionsShelves = (
    collectionType: string | null | undefined
): readonly string[] => SUGGESTIONS_SHELVES[collectionType ?? ''] ?? [];

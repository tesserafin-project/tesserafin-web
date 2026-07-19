/**
 * Navigation model for `/library/:libraryId` — the four-destination alternative to the 7–8 legacy
 * tabs, specified in `docs/reefin/design-library-navigation.md` (issue #15, arbitrage §8-C of
 * reefin#44).
 *
 * **DORMANT — imported by its test only.** Nothing in the app imports this module, so webpack never
 * reaches it from an entry point and it contributes 0 bytes to the main bundle. Activation (routing
 * the destinations, repointing `appRouter.getRouteUrl()`, adding legacy redirects) is gated on
 * **LANE B** (bundle margin, target 30 KiB — now measured at 84.7 KiB / 86 737 B, so the numeric
 * threshold is met) **and** **LANE E2E** (cross gate, itself blocked on reefin#39, still closed).
 * Both are required, so activation remains blocked. See §7 of the design doc.
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
 * map can be checked against the real enum without importing it (and thus without coupling a
 * dormant module to a live one).
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

/** Sentinel for the non-alphabetic bucket. */
export const NON_ALPHA_LETTER = '#';

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

import { CollectionType } from 'lib/tesserafin-sdk';

/**
 * Legacy `#/movies` / `#/tv` URL → canonical `/library/:libraryId` destination (issue #15, L15b —
 * activation).
 *
 * ## Why this module exists at all
 *
 * L15b repoints `appRouter.getRouteUrl()` at `/library/:libraryId`, so nothing *emits* the legacy
 * shapes any more. But they were emitted for years: they sit in bookmarks, in shared links, in
 * browser history. Dropping them would turn every one of those into a blank legacy page whose tab
 * bar no longer matches the model. This map keeps them working for one version.
 *
 * ## The tab table is measured, not guessed
 *
 * The indices come from `apps/modern/features/libraries/constants/views/movies.ts` and
 * `.../tvshows.ts` — the `Record<number, LibraryTabContent>` each file default-exports — and each
 * target comes from `docs/tesserafin/design-library-navigation.md` §3.2's fate table. Read them
 * together: index → legacy tab → fate → URL.
 *
 * ## Two cells deliberately have NO redirect
 *
 * `undefined` here means "leave the legacy URL alone, it still renders its legacy page". That is a
 * decision, not an omission, and it is taken exactly twice:
 *
 * - **Studios** (movies `tab=5`, tvshows `tab=4`). The legacy tab is a *browsable grid of studio
 *   cards*; design §3.2 demotes Studios to a Browse filter keyed by `studioIds`. A bare studios URL
 *   names no studio, so there is no id to put in `?studio=`. Redirecting it to plain Browse would
 *   silently answer "show me the studios" with "here are all your movies" — the URL would resolve
 *   but its *meaning* would be gone. Per the mission's human-stop rule this is documented and left
 *   un-redirected rather than pointed at an improvised destination.
 * - **Playlists** (movies `tab=6`, tvshows `tab=7`). Design §3.2's verdict is "hors library … reste
 *   sur sa page existante, **inchangée**". The existing page for a library's playlists tab *is*
 *   this legacy URL, so honouring the design here means not touching it.
 *
 * Every other legacy tab has a named, design-conforming destination and is redirected.
 */

export const LEGACY_TOP_PARENT_PARAM = 'topParentId';
export const LEGACY_TAB_PARAM = 'tab';

/**
 * Params the canonical route understands, so a legacy URL that happens to carry one keeps it
 * (mission: "conservation des paramètres compatibles"). `topParentId`, `collectionType` and `tab`
 * are deliberately absent: they are *consumed* by this redirect — `topParentId` becomes the path
 * segment, `tab` becomes the destination — so carrying them through would leave dead params on a
 * canonical URL.
 */
const FORWARDED_PARAMS: readonly string[] = [
    'sort',
    'order',
    'page',
    'genre',
    'year',
    'density',
    'view',
    'letter',
    'granularity',
    'favorite',
    'studio'
];

/** A legacy tab that maps onto the canonical route. */
interface LegacyTabTarget {
    /** Destination segment, or `undefined` for Browse (whose canonical URL is the short one). */
    destination?: 'genres' | 'collections' | 'suggestions';
    /** Params the *fate* itself implies — Favorites is `?favorite=1`, Episodes `?granularity=episodes`. */
    params?: Readonly<Record<string, string>>;
}

/**
 * `null` marks a tab with no redirect (see the module doc for the two cases and why). It is spelled
 * `null` rather than "missing key" so the table stays exhaustive: every legacy index appears, and a
 * reader can tell "decided not to redirect" from "forgot".
 */
type LegacyTabEntry = LegacyTabTarget | null;

/** `constants/views/movies.ts`: 0 movies, 1 suggestions, 2 favorites, 3 collections, 4 genres, 5 studios, 6 playlists. */
const MOVIES_TABS: Record<number, LegacyTabEntry> = {
    0: {},
    1: { destination: 'suggestions' },
    2: { params: { favorite: '1' } },
    3: { destination: 'collections' },
    4: { destination: 'genres' },
    5: null,
    6: null
};

/** `constants/views/tvshows.ts`: 0 series, 1 suggestions, 2 upcoming, 3 genres, 4 studios, 5 episodes, 6 collections, 7 playlists. */
const TVSHOWS_TABS: Record<number, LegacyTabEntry> = {
    0: {},
    1: { destination: 'suggestions' },
    // Upcoming is a *shelf* of Suggestions (design §3.2), so its URL lands on Suggestions — the
    // page that now contains it — rather than nowhere.
    2: { destination: 'suggestions' },
    3: { destination: 'genres' },
    4: null,
    5: { params: { granularity: 'episodes' } },
    6: { destination: 'collections' },
    7: null
};

const TABS_BY_COLLECTION_TYPE: Partial<
    Record<CollectionType, Record<number, LegacyTabEntry>>
> = {
    [CollectionType.Movies]: MOVIES_TABS,
    [CollectionType.Tvshows]: TVSHOWS_TABS
};

/** Legacy tabs that keep their legacy page, keyed for the report/tests to assert against. */
export const UNREDIRECTED_LEGACY_TABS: ReadonlyArray<{
    collectionType: CollectionType;
    tab: number;
    legacyTab: string;
    reason: string;
}> = [
    {
        collectionType: CollectionType.Movies,
        tab: 5,
        legacyTab: 'studios',
        reason: 'A bare Studios URL names no studio, so it cannot become `?studio=<id>` on Browse without losing its meaning.'
    },
    {
        collectionType: CollectionType.Movies,
        tab: 6,
        legacyTab: 'playlists',
        reason: 'Design §3.2: out of library scope, stays on its existing page unchanged.'
    },
    {
        collectionType: CollectionType.Tvshows,
        tab: 4,
        legacyTab: 'studios',
        reason: 'A bare Studios URL names no studio, so it cannot become `?studio=<id>` on Browse without losing its meaning.'
    },
    {
        collectionType: CollectionType.Tvshows,
        tab: 7,
        legacyTab: 'playlists',
        reason: 'Design §3.2: out of library scope, stays on its existing page unchanged.'
    }
];

const parseTab = (value: string | null): number => {
    if (!value) return 0;
    const tab = Number.parseInt(value, 10);
    return Number.isInteger(tab) && tab >= 0 ? tab : 0;
};

/**
 * Resolves the canonical target for a legacy `#/movies` / `#/tv` URL, or `undefined` when the URL
 * must keep rendering its legacy page.
 *
 * Returns `undefined` — no redirect — when:
 * - there is no `topParentId` (nothing to build `/library/:libraryId` from);
 * - the collection type is not one of the two this route renders (which is also what makes a
 *   redirect *loop* structurally impossible: `/library/:libraryId` only bounces types it does not
 *   render, and those are exactly the types not redirected here);
 * - the tab is one of the two documented no-redirect cells, or an index the legacy table never had.
 */
export const getLegacyLibraryRedirect = (
    collectionType: CollectionType,
    searchParams: URLSearchParams
): string | undefined => {
    const libraryId = searchParams.get(LEGACY_TOP_PARENT_PARAM);
    if (!libraryId) return undefined;

    const tabs = TABS_BY_COLLECTION_TYPE[collectionType];
    if (!tabs) return undefined;

    const entry = tabs[parseTab(searchParams.get(LEGACY_TAB_PARAM))];
    if (!entry) return undefined;

    const nextParams = new URLSearchParams();
    for (const key of FORWARDED_PARAMS) {
        const value = searchParams.get(key);
        if (value !== null) nextParams.set(key, value);
    }
    for (const [key, value] of Object.entries(entry.params ?? {})) {
        nextParams.set(key, value);
    }

    const path = entry.destination
        ? `/library/${libraryId}/${entry.destination}`
        : `/library/${libraryId}`;
    const search = nextParams.toString();

    return search ? `${path}?${search}` : path;
};

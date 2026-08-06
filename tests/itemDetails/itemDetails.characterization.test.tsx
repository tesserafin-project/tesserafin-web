/**
 * Characterization of the MIGRATED Item Details route, judged by the P5 contract.
 *
 * This is the same evidence Step 1a froze, pointed at Step 1b's route. The expectations still live
 * in `tests/fixtures/item-details/legacy-contract.json` — unchanged, because a rewritten fixture
 * would prove nothing. What changed is the subject: `apps/modern/features/details`, not
 * `apps/legacy/controllers/itemDetails`.
 *
 * WHAT IS ASSERTED, per equivalence class
 *   - the rendered semantic sections, in DOCUMENT order;
 *   - the rendered principal actions;
 *   - the request inventory, on BOTH surfaces, through the same fail-closed proxies;
 *   - which track/version selectors are offered and which user-data controls are bound;
 *   - that the route creates NO nested React root;
 *   - permission-dependent and capability-dependent behaviour.
 *
 * THE TWO PLACES THIS DIFFERS FROM P5, both deliberate and both enumerated rather than relaxed:
 *
 *   1. `serverId` is no longer touched (delta D14). Its only caller was
 *      `components/cardbuilder/cardImage`, which invariant 11 forbids the migrated route to import.
 *      The poster is still rendered, through `getScaledImageUrl`. Every OTHER member of every
 *      class's recorded read set must still be touched, and nothing beyond it.
 *   2. Sections whose legacy heading lived outside `h2.sectionTitle` now carry a semantic heading
 *      (delta D9). The frozen headings must all still appear, in order; the additions are
 *      enumerated per class in {@link HEADING_ADDITIONS} and asserted exactly, so they cannot grow
 *      silently.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import contract from '../fixtures/item-details/legacy-contract.json';
import { ITEM_DETAILS_CASES } from '../fixtures/item-details/cases';
import { createFailClosedApi, pick } from './support/failClosedApi';
import {
    createTestQueryClient,
    renderedActions,
    renderedHeadings,
    renderedSections,
    renderedSelectors,
    renderRoute,
    settle,
    unmountAll,
    touched
} from './support/modernHarness';
import { legacyResponders, sdkResponders } from './support/responders';

vi.setConfig({ testTimeout: 30_000 });

vi.stubGlobal('__WEBPACK_SERVE__', false);

vi.mock('webcomponents.js/webcomponents-lite', () => ({}));

/**
 * Translations resolve to their key — the same rule P5 used, and the reason a heading assertion is
 * a statement about section identity rather than about this week's English.
 */
vi.mock('../../src/lib/globalize', () => {
    const translate = (key: string, ...args: unknown[]) =>
        args.length ? [key, ...args].join(' ') : key;
    const api = {
        translate,
        translateHtml: (html: string) => html,
        loadStrings: () => Promise.resolve(),
        defaultModule: () => 'core',
        getCurrentLocale: () => 'en-us',
        getCurrentDateTimeLocale: () => 'en-us',
        getDefaultLanguage: () => 'en-us',
        register: () => undefined,
        updateCurrentCulture: () => undefined,
        getIsRTL: () => false,
        getIsElementRTL: () => false,
        normalizeLocaleName: (culture: string) => culture
    };
    return { ...api, FALLBACK_CULTURE: 'en-us', default: api };
});

const serverConnections = {
    getApiClient: vi.fn(),
    currentApiClient: vi.fn(),
    getApi: vi.fn()
};

vi.mock('../../src/lib/jellyfin-apiclient', () => ({
    ServerConnections: serverConnections,
    ConnectionState: {
        SignedIn: 'SignedIn',
        ServerMismatch: 'ServerMismatch',
        ServerSignIn: 'ServerSignIn',
        ServerSelection: 'ServerSelection',
        ServerUpdateNeeded: 'ServerUpdateNeeded',
        Unavailable: 'Unavailable'
    },
    ConnectionMode: { Local: 0, Remote: 1, Manual: 2 }
}));
vi.mock('../../src/lib/jellyfin-apiclient/ServerConnections', () => ({
    default: serverConnections
}));

const libraryApiRef: { current: Record<string, unknown> } = { current: {} };
vi.mock('@jellyfin/sdk/lib/utils/api/library-api', () => ({
    getLibraryApi: () => libraryApiRef.current
}));

const libraryMenu = { setTitle: vi.fn(), setTransparentMenu: vi.fn() };
vi.mock('../../src/scripts/libraryMenu', () => ({ default: libraryMenu }));

const loading = { show: vi.fn(), hide: vi.fn() };
vi.mock('../../src/components/loading/loading', () => ({ default: loading }));

const backdrop = {
    setBackdrops: vi.fn(),
    clearBackdrop: vi.fn(),
    setBackdropTransparency: vi.fn()
};
vi.mock('../../src/components/backdrop/backdrop', () => backdrop);

const playbackManager = {
    canPlay: vi.fn(
        (item: { Type?: string; MediaType?: string }) =>
            ['Video', 'Audio'].includes(item?.MediaType ?? '') ||
            [
                'Series',
                'Season',
                'MusicAlbum',
                'MusicArtist',
                'Playlist',
                'BoxSet',
                'MusicGenre',
                'Genre'
            ].includes(item?.Type ?? '')
    ),
    getSupportedCommands: vi.fn(() => ['PlayMediaSource', 'PlayTrailers']),
    play: vi.fn(),
    playTrailers: vi.fn(),
    instantMix: vi.fn(),
    shuffle: vi.fn()
};
vi.mock('../../src/components/playback/playbackmanager', () => ({
    playbackManager
}));

const itemContextMenu = {
    getCommands: vi.fn(() => Promise.resolve(['delete'])),
    show: vi.fn(() => Promise.resolve({}))
};
vi.mock('../../src/components/itemContextMenu', () => ({
    default: itemContextMenu
}));

/**
 * The user-data mutation seam.
 *
 * `PlayedButton`/`FavoriteButton` drive `hooks/useFetchItems`, which reaches the Api CONTEXT rather
 * than the two surfaces this suite declares. Stubbing the mutation keeps the fail-closed contract
 * honest: an unmocked path would reach a third surface the read inventory says nothing about.
 * The BINDING — which control is rendered for which item — is what this suite asserts, and that is
 * the route's decision, not the mutation's.
 */
vi.mock('../../src/hooks/useFetchItems', () => ({
    useTogglePlayedMutation: () => ({ mutateAsync: vi.fn() }),
    useToggleFavoriteMutation: () => ({ mutateAsync: vi.fn() })
}));

/** Counts nested React roots without replacing the real `renderComponent`. Must stay at zero. */
const roots = { mounted: 0 };
vi.mock('../../src/utils/reactUtils', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../src/utils/reactUtils')>();
    return {
        ...actual,
        renderComponent: (
            ...args: Parameters<typeof actual.renderComponent>
        ) => {
            roots.mounted += 1;
            return actual.renderComponent(...args);
        }
    };
});

interface ContractClass {
    id: string;
    description: string;
    itemTypes: string[];
    routeParams: Record<string, string>;
    sections: string[];
    headings: string[];
    actions: string[];
    trackSelectors: string[];
    userDataControls: string[];
    reads: { legacy: string[]; sdk: string[] };
    nestedReactRoots: number;
    nestedReactRootsUnmounted: number;
    platformDefaultComparison: string;
}

const CLASSES = contract.classes as ContractClass[];

/**
 * Delta D14. The one recorded member the migrated route cannot touch.
 *
 * `apiClient.serverId()` was reached only from `components/cardbuilder/cardImage`, on the poster
 * path. Invariant 11 forbids the migrated route to import `cardbuilder`, and `item.ServerId` is
 * already on the DTO, so calling it would be a fake call made to keep a test green.
 */
const RETIRED_READS = ['serverId'];

/**
 * Delta D6, enumerated per class.
 *
 * `SUSPECT` #10: the legacy route revealed `#specialsCollapsible` from `SpecialFeatureCount`
 * BEFORE fetching, so a class whose special-features read returned nothing still showed an empty
 * section. The migrated route renders the section FROM the result, which is `MUST PRESERVE` #10
 * ("absent data never manufactures a section") applied to the surface that violated it.
 *
 * Only these three classes are affected, and only this one section. `movie` itself still shows it,
 * because its read returns a special feature.
 */
const SECTION_REMOVALS: Record<string, string[]> = {
    'movie-resumable': ['specialsCollapsible'],
    'movie-grouped-admin': ['specialsCollapsible'],
    'movie-grouped-regular': ['specialsCollapsible']
};

const expectedSections = (recorded: ContractClass) => {
    const removed = SECTION_REMOVALS[recorded.id] ?? [];
    return recorded.sections.filter((section) => !removed.includes(section));
};

/**
 * Delta D9, enumerated. Headings the migrated route renders that the legacy markup put outside
 * `h2.sectionTitle`, so P5 could not see them.
 *
 * Filled from measurement, then frozen: this list may only change with a recorded reason.
 */
const HEADING_ADDITIONS: Record<string, string[]> = {
    // The children section's own title. `renderChildren` wrote it into a `.sectionTitle > span`
    // that P5's `h2.sectionTitle` reader did not see, so the frozen record has no heading for it.
    series: ['HeaderSeasons'],
    'music-artist': ['Items'],
    playlist: ['Items'],
    person: ['Items'],
    genre: ['Items'],
    'music-genre': ['Items'],
    // `renderMoreFromSeason` / `renderMoreFromArtist` set `section.querySelector('h2').innerText`
    // on an `h2` that carries no `.sectionTitle` class, so the same reader missed these too.
    episode: ['MoreFromValue Season 1'],
    'music-album': ['MoreFromValue An Artist']
};

/** Headings that disappear with the sections {@link SECTION_REMOVALS} removes. */
const HEADING_REMOVALS: Record<string, string[]> = {
    'movie-resumable': ['SpecialFeatures'],
    'movie-grouped-admin': ['SpecialFeatures'],
    'movie-grouped-regular': ['SpecialFeatures']
};

const expectedHeadings = (recorded: ContractClass) => {
    const removed = HEADING_REMOVALS[recorded.id] ?? [];
    return recorded.headings.filter((heading) => !removed.includes(heading));
};

function classFor(id: string): ContractClass {
    const found = CLASSES.find((entry) => entry.id === id);
    if (!found) {
        throw new Error(
            `[item-details characterization] no class "${id}" in legacy-contract.json.`
        );
    }
    return found;
}

const expectedReads = (recorded: ContractClass) =>
    [...recorded.reads.legacy]
        .filter((member) => !RETIRED_READS.includes(member))
        .sort();

interface MountResult {
    view: HTMLElement;
    api: ReturnType<typeof createFailClosedApi>;
    consoleErrors: string[];
    unmount: () => void;
}

async function mountCase(
    caseId: string,
    overrides: { legacyReads?: string[]; sdkReads?: string[] } = {}
): Promise<MountResult> {
    const testCase = ITEM_DETAILS_CASES.find((entry) => entry.id === caseId);
    if (!testCase) throw new Error(`no case fixture for "${caseId}"`);
    const recorded = classFor(caseId);

    const consoleErrors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(
            args
                .map((a) => (a instanceof Error ? a.message : String(a)))
                .join(' ')
        );
    });

    const responderOptions = {
        item: testCase.item,
        user: testCase.user,
        lists: testCase.lists
    };
    const api = createFailClosedApi({
        legacy: pick(
            legacyResponders(responderOptions),
            overrides.legacyReads ?? expectedReads(recorded)
        ),
        sdk: pick(
            sdkResponders(responderOptions),
            overrides.sdkReads ?? recorded.reads.sdk
        )
    });
    libraryApiRef.current = api.libraryApi;
    serverConnections.getApiClient.mockReturnValue(api.apiClient);
    serverConnections.currentApiClient.mockReturnValue(api.apiClient);
    serverConnections.getApi.mockReturnValue({});

    const { default: ItemDetailsPage } = await import(
        '../../src/apps/modern/features/details/components/ItemDetailsPage'
    );

    const searchParams = new URLSearchParams(testCase.params);
    const mounted = await renderRoute(
        <ItemDetailsPage searchParams={searchParams} />,
        createTestQueryClient()
    );

    return {
        view: mounted.container,
        api,
        consoleErrors,
        unmount: mounted.unmount
    };
}

afterEach(() => {
    // A route left mounted keeps its effects alive and can resolve a dynamic import inside the
    // next test, against a fail-closed API that declares a different read set.
    unmountAll();
});

beforeEach(() => {
    document.body.innerHTML = '';
    roots.mounted = 0;
    vi.clearAllMocks();
});

describe('migrated Item Details — composition per equivalence class', () => {
    for (const recorded of CLASSES) {
        it(`${recorded.id} renders the recorded section order`, async () => {
            const mounted = await mountCase(recorded.id);

            expect(renderedSections(mounted.view)).toEqual(
                expectedSections(recorded)
            );
            expect(mounted.consoleErrors).toEqual([]);
        });

        it(`${recorded.id} keeps every recorded heading, and adds only the enumerated ones`, async () => {
            const mounted = await mountCase(recorded.id);
            const rendered = renderedHeadings(mounted.view);

            // Every frozen heading still present, in the frozen order, apart from the ones whose
            // whole section is an enumerated defect fix. Nothing lost by accident.
            expect(
                rendered.filter((heading) =>
                    recorded.headings.includes(heading)
                )
            ).toEqual(expectedHeadings(recorded));

            // And nothing added that is not on the record.
            expect(
                rendered.filter(
                    (heading) => !recorded.headings.includes(heading)
                )
            ).toEqual(HEADING_ADDITIONS[recorded.id] ?? []);
        });

        it(`${recorded.id} offers the recorded actions and controls`, async () => {
            const mounted = await mountCase(recorded.id);

            expect(renderedActions(mounted.view)).toEqual(recorded.actions);
            expect(renderedSelectors(mounted.view).sort()).toEqual(
                [...recorded.trackSelectors].sort()
            );
            expect(
                renderedActions(mounted.view).filter((action) =>
                    recorded.userDataControls.includes(action)
                )
            ).toEqual(recorded.userDataControls);
        });

        it(`${recorded.id} issues exactly the recorded reads`, async () => {
            const mounted = await mountCase(recorded.id);

            expect(mounted.api.refused).toEqual([]);
            expect(touched(mounted.api.calls, 'legacy')).toEqual(
                expectedReads(recorded)
            );
            expect(touched(mounted.api.calls, 'sdk')).toEqual(
                [...recorded.reads.sdk].sort()
            );
        });

        /**
         * `MUST PRESERVE` #9, first clause: "A poster is always rendered."
         *
         * The frozen `sections` list cannot express this — `.detailImageContainer` was a template
         * element, never an entry in the legacy `VIEW_SECTION_ORDER`, so the P5 reader was blind to
         * it. The first migrated route shipped with no item image at all and every section
         * assertion stayed green. This is the assertion that would have caught it, added per
         * invariant 15: adapt the evidence to the new route, do not weaken it.
         */
        it(`${recorded.id} always renders a poster`, async () => {
            const mounted = await mountCase(recorded.id);

            expect(
                mounted.view.querySelectorAll('[data-detail-image="poster"]')
            ).toHaveLength(1);
        });

        it(`${recorded.id} creates no nested React root`, async () => {
            await mountCase(recorded.id);
            // The reason #129 exists. Six per render became zero.
            expect(roots.mounted).toBe(0);
        });
    }
});

describe('migrated Item Details — hero and image rules', () => {
    /**
     * `MUST PRESERVE` #9, second clause: `Person` and `Book` never get a backdrop, because they
     * only ever have a primary image. The legacy rule lived in `renderHeaderBackdrop`, which
     * returned false for those two types before looking at anything else.
     */
    it('never requests a backdrop for a Person or a Book', async () => {
        for (const id of ['person', 'book']) {
            const mounted = await mountCase(id);
            expect(
                mounted.view.querySelector('[data-detail-backdrop]'),
                `${id} rendered a backdrop`
            ).toBeNull();
            unmountAll();
        }
    });

    it('offers a backdrop for the types that can have one', async () => {
        const mounted = await mountCase('movie');
        expect(
            mounted.view.querySelector('[data-detail-backdrop]')
        ).not.toBeNull();
    });

    it('renders a logo slot only when the item declares one', async () => {
        // The frozen fixtures carry `ImageTags: {}`, so no class has a logo and none may render
        // one. A route that emitted an empty logo element for every item would fail here.
        const mounted = await mountCase('movie');
        expect(mounted.view.querySelector('[data-detail-image="logo"]')).toBeNull();
    });
});

describe('migrated Item Details — the mock is still fail-closed', () => {
    it('refuses and records an API member the class did not declare', async () => {
        const withheld = expectedReads(classFor('movie')).filter(
            (member) => member !== 'getSpecialFeatures'
        );
        const mounted = await mountCase('movie', { legacyReads: withheld });

        expect(mounted.api.refused).toContain('legacy.getSpecialFeatures');
        /*
         * Delta D6. `SUSPECT` #10 in the legacy route: `#specialsCollapsible` was revealed from
         * `SpecialFeatureCount` BEFORE the fetch, so a failed read left a visible empty section.
         * The section now renders FROM the result, so a failed read shows nothing at all —
         * `MUST PRESERVE` #10, "absent data never manufactures a section".
         */
        expect(renderedSections(mounted.view)).not.toContain(
            'specialsCollapsible'
        );
    });

    it('accepts exactly the declared members and nothing more', async () => {
        const mounted = await mountCase('movie');
        expect(mounted.api.refused).toEqual([]);
    });
});

describe('migrated Item Details — absent data never manufactures a section', () => {
    it('a video with no optional data shows no optional section', async () => {
        const mounted = await mountCase('minimal-video');

        for (const section of [
            'tagline',
            'overview',
            'itemTags',
            'itemExternalLinks',
            'castCollapsible',
            'guestCastCollapsible',
            'specialsCollapsible',
            'scenesCollapsible',
            'additionalPartsCollapsible',
            'similarCollapsible',
            'collectionsCollapsible'
        ]) {
            expect(renderedSections(mounted.view)).not.toContain(section);
        }
    });

    it('an empty related result hides the related surface it would otherwise fill', async () => {
        const withResults = await mountCase('movie');
        expect(renderedSections(withResults.view)).toContain(
            'similarCollapsible'
        );

        const withoutResults = await mountCase('movie-resumable');
        expect(renderedSections(withoutResults.view)).not.toContain(
            'similarCollapsible'
        );
    });

    it('still ISSUES the related read for a class that renders no related section', async () => {
        // Invariant 16. `minimal-video` fetches similar items and shows nothing; the migration must
        // not turn "renders nothing" into "asks for nothing".
        const mounted = await mountCase('minimal-video');
        expect(touched(mounted.api.calls, 'legacy')).toContain(
            'getSimilarItems'
        );
        expect(renderedSections(mounted.view)).not.toContain(
            'similarCollapsible'
        );
    });
});

describe('migrated Item Details — playback capability gates the action bar', () => {
    it('offers resume alongside replay only when there is a resume position', async () => {
        const unstarted = await mountCase('movie');
        expect(renderedActions(unstarted.view)).not.toContain('btnReplay');

        const resumable = await mountCase('movie-resumable');
        expect(renderedActions(resumable.view)).toContain('btnPlay');
        expect(renderedActions(resumable.view)).toContain('btnReplay');
    });

    it('offers instant mix only for the music types and shuffle only for containers', async () => {
        const album = await mountCase('music-album');
        expect(renderedActions(album.view)).toContain('btnInstantMix');
        expect(renderedActions(album.view)).toContain('btnShuffle');

        const movie = await mountCase('movie');
        expect(renderedActions(movie.view)).not.toContain('btnInstantMix');
        expect(renderedActions(movie.view)).not.toContain('btnShuffle');
    });

    it('offers the trailer action only when the item has one and the player supports it', async () => {
        const movie = await mountCase('movie');
        expect(renderedActions(movie.view)).toContain('btnPlayTrailer');

        const minimal = await mountCase('minimal-video');
        expect(renderedActions(minimal.view)).not.toContain('btnPlayTrailer');
    });

    it('hides the whole action bar for a programme outside its airing window', async () => {
        const program = await mountCase('program');
        expect(renderedSections(program.view)).not.toContain(
            'mainDetailButtons'
        );
        expect(renderedActions(program.view)).toEqual([]);
    });
});

describe('migrated Item Details — track and version selection', () => {
    const optionValues = (view: HTMLElement, name: string) =>
        [
            ...view.querySelectorAll<HTMLOptionElement>(
                `[data-detail-select="${name}"] option`
            )
        ].map((option) => option.value);

    const selectValue = (view: HTMLElement, name: string) =>
        view.querySelector<HTMLSelectElement>(`[data-detail-select="${name}"]`)
            ?.value;

    it('lists every media source, video, audio and subtitle track of the item', async () => {
        const mounted = await mountCase('movie');

        expect(optionValues(mounted.view, 'selectSource')).toEqual([
            'movie-1',
            'movie-1-alt'
        ]);
        expect(optionValues(mounted.view, 'selectVideo')).toEqual(['0']);
        expect(optionValues(mounted.view, 'selectAudio')).toEqual(['1', '2']);
        // `-1` is the explicit "off" choice the route always offers. The remaining order is
        // `itemHelper.sortTracks`: embedded before external, so the internal PGS track (index 4)
        // precedes the external SRT (index 3) even though the SRT is the default.
        expect(optionValues(mounted.view, 'selectSubtitles')).toEqual([
            '-1',
            '4',
            '3'
        ]);
    });

    it('defaults to the source, audio and subtitle stream the item declares', async () => {
        const mounted = await mountCase('movie');

        expect(selectValue(mounted.view, 'selectSource')).toBe('movie-1');
        expect(selectValue(mounted.view, 'selectAudio')).toBe('1');
        expect(selectValue(mounted.view, 'selectSubtitles')).toBe('3');
    });

    it('hides the selector form entirely when the item has no selectable source', async () => {
        const mounted = await mountCase('music-album');
        expect(renderedSections(mounted.view)).not.toContain('trackSelections');
    });
});

describe('migrated Item Details — administrative and permission-dependent actions', () => {
    it('shows split-versions only to an administrator with grouped sources', async () => {
        const admin = await mountCase('movie-grouped-admin');
        expect(renderedActions(admin.view)).toContain('btnSplitVersions');

        const regular = await mountCase('movie-grouped-regular');
        expect(renderedActions(regular.view)).not.toContain('btnSplitVersions');

        // An administrator with no grouped source is still refused.
        const adminNoGrouping = await mountCase('movie');
        expect(renderedActions(adminNoGrouping.view)).not.toContain(
            'btnSplitVersions'
        );
    });

    it('offers the context menu only when the menu has commands', async () => {
        const mounted = await mountCase('movie');
        expect(renderedActions(mounted.view)).toContain('btnMoreCommands');
        expect(itemContextMenu.getCommands).toHaveBeenCalled();
        const options = itemContextMenu.getCommands.mock.calls[0][0] as {
            deleteItem: boolean;
            play: boolean;
            share: boolean;
        };
        // Deletion is gated on the item's own permission flag, not on the user's role.
        expect(options.deleteItem).toBe(true);
        expect(options.play).toBe(false);
        expect(options.share).toBe(true);
    });

    it('does not offer deletion for an item the server marked undeletable', async () => {
        await mountCase('photo');
        const options = itemContextMenu.getCommands.mock.calls[0][0] as {
            deleteItem: boolean;
        };
        expect(options.deleteItem).toBe(false);
    });

    it('offers download only for a downloadable book on a host that supports it', async () => {
        const book = await mountCase('book');
        expect(renderedActions(book.view)).toContain('btnDownload');

        const movie = await mountCase('movie');
        expect(renderedActions(movie.view)).not.toContain('btnDownload');
    });

    it('offers the live-TV timer actions only to a user with live-TV management', async () => {
        const recording = await mountCase('recording');
        expect(renderedActions(recording.view)).toContain('btnCancelTimer');

        const recordingNoPermission = await mountCase('recording-no-livetv');
        expect(renderedActions(recordingNoPermission.view)).not.toContain(
            'btnCancelTimer'
        );

        const timer = await mountCase('series-timer');
        expect(renderedActions(timer.view)).toContain('btnCancelSeriesTimer');
        expect(renderedSections(timer.view)).toContain(
            'seriesTimerScheduleSection'
        );

        const timerNoPermission = await mountCase('series-timer-no-livetv');
        expect(renderedActions(timerNoPermission.view)).not.toContain(
            'btnCancelSeriesTimer'
        );
        expect(renderedSections(timerNoPermission.view)).not.toContain(
            'seriesTimerScheduleSection'
        );
    });

    it('withholds the live-TV schedule read from a user without the permission', async () => {
        const permitted = await mountCase('series-timer');
        expect(permitted.api.calls.map((call) => call.method)).toContain(
            'getLiveTvTimers'
        );

        const refused = await mountCase('series-timer-no-livetv');
        expect(refused.api.calls.map((call) => call.method)).not.toContain(
            'getLiveTvTimers'
        );
        expect(refused.api.refused).toEqual([]);
    });
});

describe('migrated Item Details — episodic hierarchy', () => {
    it('renders seasons for a series and episodes for a season, in server order', async () => {
        const series = await mountCase('series');
        expect(renderedSections(series.view)).toContain(
            'listChildrenCollapsible'
        );

        const season = await mountCase('season');
        const ids = [
            ...season.view.querySelectorAll(
                '[data-detail-section="listChildrenCollapsible"] a[href*="id="]'
            )
        ].map((element) =>
            new URL(
                (element.getAttribute('href') ?? '').replace(
                    '#/',
                    'https://x/'
                ),
                'https://x/'
            ).searchParams.get('id')
        );
        expect(ids).toEqual(['episode-1', 'episode-2']);
    });

    it('links an episode back to its series and season', async () => {
        const mounted = await mountCase('episode');
        const links = [
            ...mounted.view.querySelectorAll(
                '[data-detail-section="nameContainer"] [data-id]'
            )
        ].map((element) => [
            element.getAttribute('data-type'),
            element.getAttribute('data-id')
        ]);
        expect(links).toEqual([
            ['Series', 'series-1'],
            ['Season', 'season-1']
        ]);
    });

    it('offers Next Up for a series and never for a season', async () => {
        const series = await mountCase('series');
        expect(renderedSections(series.view)).toContain('nextUpSection');

        const season = await mountCase('season');
        expect(renderedSections(season.view)).not.toContain('nextUpSection');
    });
});

describe('migrated Item Details — loading and failure', () => {
    /**
     * Delta D3. `SUSPECT` #2 in the legacy route: a failed primary read rendered nothing, showed no
     * error, and never hid the spinner. The migrated route renders an explicit error and no page.
     */
    it('renders a bounded error and no page when the primary item read fails', async () => {
        const api = createFailClosedApi({
            legacy: {
                getCurrentUserId: () => 'user-1',
                getCurrentUser: () =>
                    Promise.resolve({ Id: 'user-1', Policy: {} }),
                getItem: () => Promise.reject(new Error('boom')),
                subscribe: () => () => undefined
            },
            sdk: {}
        });
        libraryApiRef.current = api.libraryApi;
        serverConnections.getApiClient.mockReturnValue(api.apiClient);
        serverConnections.currentApiClient.mockReturnValue(api.apiClient);
        serverConnections.getApi.mockReturnValue({});

        const { default: ItemDetailsPage } = await import(
            '../../src/apps/modern/features/details/components/ItemDetailsPage'
        );
        const mounted = await renderRoute(
            <ItemDetailsPage
                searchParams={new URLSearchParams({ id: 'movie-1' })}
            />,
            createTestQueryClient()
        );
        await settle();

        expect(
            mounted.container.querySelector('[data-rf-slot="state-error"]')
        ).not.toBeNull();
        expect(
            mounted.container.querySelector('[data-rf-slot="state-loading"]')
        ).toBeNull();
        expect(renderedActions(mounted.container)).toEqual([]);
        expect(renderedSections(mounted.container)).toEqual([]);
    });

    /**
     * Delta D2. `SUSPECT` #1: a `/details` URL with no recognised parameter threw synchronously
     * past its own `.catch` and left a permanent spinner. The brief forbids preserving that.
     */
    it('renders a bounded error and no spinner for a malformed route', async () => {
        const { default: ItemDetailsPage } = await import(
            '../../src/apps/modern/features/details/components/ItemDetailsPage'
        );
        const mounted = await renderRoute(
            <ItemDetailsPage
                searchParams={new URLSearchParams({ nonsense: 'x' })}
            />,
            createTestQueryClient()
        );

        expect(
            mounted.container.querySelector('[data-rf-slot="state-error"]')
        ).not.toBeNull();
        expect(
            mounted.container.querySelector('[data-rf-slot="state-loading"]')
        ).toBeNull();
    });
});

describe('migrated Item Details — websocket subscription lifecycle', () => {
    it('subscribes on mount and unsubscribes on unmount', async () => {
        let unsubscribed = 0;
        const testCase = ITEM_DETAILS_CASES.find((c) => c.id === 'photo');
        if (!testCase) throw new Error('missing case');

        const responderOptions = {
            item: testCase.item,
            user: testCase.user,
            lists: testCase.lists
        };
        const menu = legacyResponders(responderOptions);
        const api = createFailClosedApi({
            legacy: {
                ...pick(menu, expectedReads(classFor('photo'))),
                subscribe: () => () => {
                    unsubscribed += 1;
                }
            },
            sdk: pick(
                sdkResponders(responderOptions),
                classFor('photo').reads.sdk
            )
        });
        libraryApiRef.current = api.libraryApi;
        serverConnections.getApiClient.mockReturnValue(api.apiClient);
        serverConnections.currentApiClient.mockReturnValue(api.apiClient);
        serverConnections.getApi.mockReturnValue({});

        const { default: ItemDetailsPage } = await import(
            '../../src/apps/modern/features/details/components/ItemDetailsPage'
        );
        const mounted = await renderRoute(
            <ItemDetailsPage
                searchParams={new URLSearchParams(testCase.params)}
            />,
            createTestQueryClient()
        );

        expect(api.calls.map((call) => call.method)).toContain('subscribe');
        expect(unsubscribed).toBe(0);

        mounted.unmount();
        expect(unsubscribed).toBe(1);
    });
});

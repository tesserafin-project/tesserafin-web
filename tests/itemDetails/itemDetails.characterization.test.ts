/**
 * Characterization of the LEGACY Item Details route, before any React migration.
 *
 * This is Step 1a of tesserafin-web#129. It does not migrate anything and it does not bind
 * `presentation.page.itemDetails`. It records, executably, what `/details` does today, so a
 * rewrite can be judged against a fact rather than against memory.
 *
 * WHAT IS ASSERTED
 *   - the visible semantic sections, in document order, per equivalence class;
 *   - the visible principal actions;
 *   - the request inventory — every API member the route touched, on BOTH surfaces;
 *   - which track/version selectors are offered and which user-data controls are bound;
 *   - the nested React roots and that each is unmounted;
 *   - permission-dependent and capability-dependent behaviour.
 *
 * WHAT IS NOT ASSERTED, deliberately
 *   - translated prose (translations resolve to their KEY here, so `HeaderCastAndCrew` is what a
 *     test sees — a stable identifier, not a product promise about wording);
 *   - class names, whitespace or markup shape;
 *   - anything about layout, which jsdom does not model.
 *
 * The expectations live in `tests/fixtures/item-details/legacy-contract.json`, alongside the prose
 * record in `docs/tesserafin/item-details-legacy-contract.md`. `legacyContract.consistency.test.ts`
 * keeps those two from disagreeing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import contract from '../fixtures/item-details/legacy-contract.json';
import { ITEM_DETAILS_CASES } from '../fixtures/item-details/cases';
import {
    createElementStubLedger,
    createFailClosedApi,
    installElementStubs,
    loadViewHtml,
    settle,
    visibleActions,
    visibleHeadings,
    visibleSections
} from './support/harness';
import { legacyResponders, pick, sdkResponders } from './support/responders';

/**
 * Mounting the controller pulls in the legacy component graph — card builders, list views, the
 * `emby-*` elements, MUI and React — and each case then drains ~10 dynamic-import chains. The first
 * mount in the file pays the whole transform cost, which on a loaded machine exceeds vitest's 5 s
 * default. The budget is generous on purpose: a timeout here is a machine-speed artifact, and a
 * suite that goes red for that reason teaches people to re-run CI rather than to read it.
 */
vi.setConfig({ testTimeout: 30_000 });

vi.stubGlobal('__WEBPACK_SERVE__', false);

/**
 * `webcomponents.js/webcomponents-lite` is the Custom Elements v0 polyfill several `emby-*`
 * modules import. It cannot run under jsdom (a document-wide MutationObserver that dereferences
 * `window` after teardown), and it is not what is under test. See `support/harness.ts`.
 */
vi.mock('webcomponents.js/webcomponents-lite', () => ({}));

/**
 * Translations resolve to their key. This is what keeps the suite from freezing English prose as a
 * product contract while still letting it assert that the RIGHT heading appeared.
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

/**
 * Both specifiers matter: the controller imports `{ ServerConnections }` from the barrel, while
 * `components/cardbuilder/cardImage` imports the default export from the module directly. Mocking
 * only one leaves a live connection manager in the graph.
 */
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
 * Image loading is a browser concern (IntersectionObserver, a blurhash web worker) and the worker
 * import is a webpack construct with no vitest equivalent. Card MARKUP is still produced by the
 * real `cardBuilder`/`cardImage`; only the lazy-load step is stubbed.
 */
vi.mock('../../src/components/images/imageLoader', () => ({
    default: {
        lazyImage: vi.fn(),
        setLazyImage: vi.fn(),
        lazyChildren: vi.fn(),
        fillImages: vi.fn(),
        getPrimaryImageAspectRatio: vi.fn(() => null)
    }
}));

/** Counts the nested React roots without replacing the real `renderComponent`. */
const roots = { mounted: 0, unmounted: 0 };
vi.mock('../../src/utils/reactUtils', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../src/utils/reactUtils')>();
    return {
        ...actual,
        renderComponent: (
            ...args: Parameters<typeof actual.renderComponent>
        ) => {
            roots.mounted += 1;
            const unmount = actual.renderComponent(...args);
            return () => {
                roots.unmounted += 1;
                return unmount();
            };
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

function classFor(id: string): ContractClass {
    const found = CLASSES.find((entry) => entry.id === id);
    if (!found) {
        throw new Error(
            `[item-details characterization] no class "${id}" in legacy-contract.json. Every case ` +
                'must correspond to a recorded equivalence class.'
        );
    }
    return found;
}

interface MountResult {
    view: HTMLElement;
    ledger: ReturnType<typeof createElementStubLedger>;
    api: ReturnType<typeof createFailClosedApi>;
    consoleErrors: string[];
    destroy: () => Promise<void>;
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

    const view = document.createElement('div');
    view.innerHTML = loadViewHtml();
    document.body.appendChild(view);
    const ledger = createElementStubLedger();
    installElementStubs(view, ledger);

    const responderOptions = {
        item: testCase.item,
        user: testCase.user,
        lists: testCase.lists
    };
    const api = createFailClosedApi({
        legacy: pick(
            legacyResponders(responderOptions),
            overrides.legacyReads ?? recorded.reads.legacy
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

    const { default: controllerFactory } = await import(
        '../../src/apps/legacy/controllers/itemDetails/index.js'
    );
    new (controllerFactory as new (v: HTMLElement, p: unknown) => void)(
        view,
        testCase.params
    );
    view.dispatchEvent(
        new CustomEvent('viewshow', { detail: { isRestored: false } })
    );
    await settle(view, ledger);

    return {
        view,
        ledger,
        api,
        consoleErrors,
        destroy: async () => {
            view.dispatchEvent(new CustomEvent('viewbeforehide'));
            view.dispatchEvent(new CustomEvent('viewdestroy'));
            await settle(view, ledger, 3);
        }
    };
}

/** Distinct API members touched on one surface, in first-call order. */
function touched(
    api: ReturnType<typeof createFailClosedApi>,
    surface: 'legacy' | 'sdk'
) {
    return [
        ...new Set(
            api.calls.filter((c) => c.surface === surface).map((c) => c.method)
        )
    ].sort();
}

beforeEach(() => {
    document.body.innerHTML = '';
    roots.mounted = 0;
    roots.unmounted = 0;
    vi.clearAllMocks();
});

describe('legacy Item Details — composition per equivalence class', () => {
    for (const recorded of CLASSES) {
        it(`${recorded.id} renders the recorded section order`, async () => {
            const mounted = await mountCase(recorded.id);

            expect(visibleSections(mounted.view)).toEqual(recorded.sections);
            expect(visibleHeadings(mounted.view)).toEqual(recorded.headings);
            expect(mounted.consoleErrors).toEqual([]);
        });

        it(`${recorded.id} offers the recorded actions and controls`, async () => {
            const mounted = await mountCase(recorded.id);

            expect(visibleActions(mounted.view)).toEqual(recorded.actions);
            expect(Object.keys(mounted.ledger.selectLabels).sort()).toEqual(
                [...recorded.trackSelectors].sort()
            );
            expect(
                mounted.ledger.userDataItems
                    .filter((entry) => entry.itemId)
                    .map((entry) => entry.control)
            ).toEqual(recorded.userDataControls);
        });

        it(`${recorded.id} issues exactly the recorded reads`, async () => {
            const mounted = await mountCase(recorded.id);

            expect(mounted.api.refused).toEqual([]);
            expect(touched(mounted.api, 'legacy')).toEqual(
                [...recorded.reads.legacy].sort()
            );
            expect(touched(mounted.api, 'sdk')).toEqual(
                [...recorded.reads.sdk].sort()
            );
        });

        it(`${recorded.id} unmounts every nested React root it created`, async () => {
            const mounted = await mountCase(recorded.id);

            expect(roots.mounted).toBe(recorded.nestedReactRoots);
            const beforeDestroy = roots.unmounted;
            await mounted.destroy();
            expect(roots.unmounted - beforeDestroy).toBe(
                recorded.nestedReactRootsUnmounted
            );
        });
    }
});

describe('legacy Item Details — the mock is fail-closed', () => {
    /**
     * The point of the fail-closed proxy is that a request the contract does not record cannot
     * pass as a success. Withhold one member the `movie` class genuinely uses and the route's own
     * error path is entered — a refusal is recorded and the page stops short of the surface that
     * member feeds.
     */
    it('refuses and records an API member the class did not declare', async () => {
        const withheld = classFor('movie').reads.legacy.filter(
            (member) => member !== 'getSpecialFeatures'
        );
        const mounted = await mountCase('movie', { legacyReads: withheld });

        expect(mounted.api.refused).toContain('legacy.getSpecialFeatures');
        // The section container is revealed from `SpecialFeatureCount` BEFORE the fetch, so a
        // failed read leaves it visible and empty rather than hidden. Recorded as SUSPECT in the
        // contract document, asserted here only as the measured consequence of a refused read.
        expect(mounted.view.querySelector('#specialsContent')?.innerHTML).toBe(
            ''
        );
    });

    it('accepts exactly the declared members and nothing more', async () => {
        const mounted = await mountCase('movie');
        expect(mounted.api.refused).toEqual([]);
    });
});

describe('legacy Item Details — absent data never manufactures a section', () => {
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
            expect(visibleSections(mounted.view)).not.toContain(section);
        }
    });

    it('an empty related result hides the related surface it would otherwise fill', async () => {
        const withResults = await mountCase('movie');
        expect(visibleSections(withResults.view)).toContain(
            'similarCollapsible'
        );

        document.body.innerHTML = '';
        const withoutResults = await mountCase('movie-resumable');
        expect(visibleSections(withoutResults.view)).not.toContain(
            'similarCollapsible'
        );
    });
});

describe('legacy Item Details — playback capability gates the action bar', () => {
    it('offers resume alongside replay only when there is a resume position', async () => {
        const unstarted = await mountCase('movie');
        expect(visibleActions(unstarted.view)).not.toContain('btnReplay');

        document.body.innerHTML = '';
        const resumable = await mountCase('movie-resumable');
        expect(visibleActions(resumable.view)).toContain('btnPlay');
        expect(visibleActions(resumable.view)).toContain('btnReplay');
    });

    it('offers instant mix only for the music types and shuffle only for containers', async () => {
        const album = await mountCase('music-album');
        expect(visibleActions(album.view)).toContain('btnInstantMix');
        expect(visibleActions(album.view)).toContain('btnShuffle');

        document.body.innerHTML = '';
        const movie = await mountCase('movie');
        expect(visibleActions(movie.view)).not.toContain('btnInstantMix');
        expect(visibleActions(movie.view)).not.toContain('btnShuffle');
    });

    it('offers the trailer action only when the item has one and the player supports it', async () => {
        const movie = await mountCase('movie');
        expect(visibleActions(movie.view)).toContain('btnPlayTrailer');

        document.body.innerHTML = '';
        const minimal = await mountCase('minimal-video');
        expect(visibleActions(minimal.view)).not.toContain('btnPlayTrailer');
    });

    it('hides the whole action bar for a programme outside its airing window', async () => {
        const program = await mountCase('program');
        expect(visibleSections(program.view)).not.toContain(
            'mainDetailButtons'
        );
        expect(visibleActions(program.view)).toEqual([]);
    });

    it('sends the selected media source, audio and subtitle stream when play is pressed', async () => {
        const mounted = await mountCase('movie');

        const play = mounted.view.querySelector(
            '.btnPlay'
        ) as HTMLButtonElement;
        play.click();

        expect(playbackManager.play).toHaveBeenCalledTimes(1);
        const options = playbackManager.play.mock.calls[0][0] as {
            items: { Id: string }[];
            mediaSourceId: string;
            audioStreamIndex: string | null;
            subtitleStreamIndex: string;
            startPositionTicks: number;
        };
        expect(options.items[0].Id).toBe('movie-1');
        expect(options.mediaSourceId).toBe('movie-1');
        expect(options.audioStreamIndex).toBe('1');
        expect(options.subtitleStreamIndex).toBe('3');
        expect(options.startPositionTicks).toBe(0);
    });

    it('resumes from the stored position when the resume action is pressed', async () => {
        const mounted = await mountCase('movie-resumable');

        const play = mounted.view.querySelector(
            '.btnPlay'
        ) as HTMLButtonElement;
        play.click();

        const options = playbackManager.play.mock.calls[0][0] as {
            startPositionTicks: number;
        };
        expect(options.startPositionTicks).toBe(6000000000);
    });

    it('replays from zero even when a resume position exists', async () => {
        const mounted = await mountCase('movie-resumable');

        const replay = mounted.view.querySelector(
            '.btnReplay'
        ) as HTMLButtonElement;
        replay.click();

        const options = playbackManager.play.mock.calls[0][0] as {
            startPositionTicks: number;
        };
        expect(options.startPositionTicks).toBe(0);
    });

    it('routes instant mix and shuffle to the player, not to play()', async () => {
        const mounted = await mountCase('music-album');

        (
            mounted.view.querySelector('.btnInstantMix') as HTMLButtonElement
        ).click();
        (
            mounted.view.querySelector('.btnShuffle') as HTMLButtonElement
        ).click();
        (
            mounted.view.querySelector('.btnPlayTrailer') as HTMLButtonElement
        ).click();

        expect(playbackManager.instantMix).toHaveBeenCalledTimes(1);
        expect(playbackManager.shuffle).toHaveBeenCalledTimes(1);
        expect(playbackManager.play).not.toHaveBeenCalled();
    });
});

describe('legacy Item Details — track and version selection', () => {
    it('lists every media source, video, audio and subtitle track of the item', async () => {
        const mounted = await mountCase('movie');
        const values = (selector: string) =>
            [
                ...mounted.view.querySelectorAll<HTMLOptionElement>(
                    `${selector} option`
                )
            ].map((option) => option.value);

        expect(values('.selectSource')).toEqual(['movie-1', 'movie-1-alt']);
        expect(values('.selectVideo')).toEqual(['0']);
        expect(values('.selectAudio')).toEqual(['1', '2']);
        // `-1` is the explicit "off" choice the route always offers. The remaining order is
        // `itemHelper.sortTracks`: embedded before external, so the internal PGS track (index 4)
        // precedes the external SRT (index 3) even though the SRT is the default.
        expect(values('.selectSubtitles')).toEqual(['-1', '4', '3']);
    });

    it('defaults to the source, audio and subtitle stream the item declares', async () => {
        const mounted = await mountCase('movie');
        const value = (selector: string) =>
            mounted.view.querySelector<HTMLSelectElement>(selector)?.value;

        expect(value('.selectSource')).toBe('movie-1');
        expect(value('.selectAudio')).toBe('1');
        expect(value('.selectSubtitles')).toBe('3');
    });

    it('hides the selector form entirely when the item has no selectable source', async () => {
        const mounted = await mountCase('music-album');
        expect(visibleSections(mounted.view)).not.toContain('trackSelections');
    });
});

describe('legacy Item Details — user-data controls', () => {
    it('binds the played control only for types that can be marked played', async () => {
        const movie = await mountCase('movie');
        expect(movie.ledger.userDataItems).toContainEqual({
            control: 'btnPlaystate',
            itemId: 'movie-1'
        });

        document.body.innerHTML = '';
        const track = await mountCase('audio');
        expect(track.ledger.userDataItems).toContainEqual({
            control: 'btnPlaystate',
            itemId: null
        });
    });

    it('binds the rating control for every type that carries user data', async () => {
        const movie = await mountCase('movie');
        expect(movie.ledger.userDataItems).toContainEqual({
            control: 'btnUserRating',
            itemId: 'movie-1'
        });

        document.body.innerHTML = '';
        const timer = await mountCase('series-timer');
        expect(timer.ledger.userDataItems).toContainEqual({
            control: 'btnUserRating',
            itemId: null
        });
    });
});

describe('legacy Item Details — administrative and permission-dependent actions', () => {
    it('shows split-versions only to an administrator with grouped sources', async () => {
        // The gate is `IsAdministrator && groupedVersions.length`, so isolating it needs BOTH a
        // media source of `Type: 'Grouping'` and two users. Without the grouped source the control
        // is hidden for everyone and the role half of the gate is unobservable.
        const admin = await mountCase('movie-grouped-admin');
        expect(visibleActions(admin.view)).toContain('btnSplitVersions');

        document.body.innerHTML = '';
        const regular = await mountCase('movie-grouped-regular');
        expect(visibleActions(regular.view)).not.toContain('btnSplitVersions');

        document.body.innerHTML = '';
        // An administrator with no grouped source is still refused.
        const adminNoGrouping = await mountCase('movie');
        expect(visibleActions(adminNoGrouping.view)).not.toContain(
            'btnSplitVersions'
        );
    });

    it('offers the context menu only when the menu has commands', async () => {
        const mounted = await mountCase('movie');
        expect(visibleActions(mounted.view)).toContain('btnMoreCommands');
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
        expect(visibleActions(book.view)).toContain('btnDownload');

        document.body.innerHTML = '';
        const movie = await mountCase('movie');
        expect(visibleActions(movie.view)).not.toContain('btnDownload');
    });

    it('offers the live-TV timer actions only to a user with live-TV management', async () => {
        const recording = await mountCase('recording');
        expect(visibleActions(recording.view)).toContain('btnCancelTimer');

        document.body.innerHTML = '';
        const recordingNoPermission = await mountCase('recording-no-livetv');
        expect(visibleActions(recordingNoPermission.view)).not.toContain(
            'btnCancelTimer'
        );

        document.body.innerHTML = '';
        const timer = await mountCase('series-timer');
        expect(visibleActions(timer.view)).toContain('btnCancelSeriesTimer');
        expect(visibleSections(timer.view)).toContain(
            'seriesTimerScheduleSection'
        );

        document.body.innerHTML = '';
        const timerNoPermission = await mountCase('series-timer-no-livetv');
        expect(visibleActions(timerNoPermission.view)).not.toContain(
            'btnCancelSeriesTimer'
        );
        expect(visibleSections(timerNoPermission.view)).not.toContain(
            'seriesTimerScheduleSection'
        );
    });

    it('withholds the live-TV schedule read from a user without the permission', async () => {
        const permitted = await mountCase('series-timer');
        expect(permitted.api.calls.map((call) => call.method)).toContain(
            'getLiveTvTimers'
        );

        document.body.innerHTML = '';
        const refused = await mountCase('series-timer-no-livetv');
        expect(refused.api.calls.map((call) => call.method)).not.toContain(
            'getLiveTvTimers'
        );
        expect(refused.api.refused).toEqual([]);
    });
});

describe('legacy Item Details — episodic hierarchy', () => {
    it('renders seasons for a series and episodes for a season, in server order', async () => {
        const series = await mountCase('series');
        expect(visibleSections(series.view)).toContain(
            'listChildrenCollapsible'
        );

        document.body.innerHTML = '';
        const season = await mountCase('season');
        const ids = [
            ...season.view.querySelectorAll(
                '#listChildrenCollapsible [data-id]'
            )
        ].map((element) => element.getAttribute('data-id'));
        expect(ids).toEqual(['episode-1', 'episode-2']);
    });

    it('links an episode back to its series and season', async () => {
        const mounted = await mountCase('episode');
        const links = [
            ...mounted.view.querySelectorAll('.nameContainer [data-id]')
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
        expect(visibleSections(series.view)).toContain('nextUpSection');

        document.body.innerHTML = '';
        const season = await mountCase('season');
        expect(visibleSections(season.view)).not.toContain('nextUpSection');
    });
});

describe('legacy Item Details — loading and failure', () => {
    it('hides the loading indicator once the page has rendered', async () => {
        await mountCase('movie');
        expect(loading.show).toHaveBeenCalled();
        expect(loading.hide).toHaveBeenCalled();
    });

    it('leaves no populated page when the primary item read fails', async () => {
        const testCase = ITEM_DETAILS_CASES.find((c) => c.id === 'movie');
        if (!testCase) throw new Error('missing case');

        const consoleErrors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            consoleErrors.push(args.map(String).join(' '));
        });

        const view = document.createElement('div');
        view.innerHTML = loadViewHtml();
        document.body.appendChild(view);
        const ledger = createElementStubLedger();
        installElementStubs(view, ledger);

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

        const { default: controllerFactory } = await import(
            '../../src/apps/legacy/controllers/itemDetails/index.js'
        );
        new (controllerFactory as new (v: HTMLElement, p: unknown) => void)(
            view,
            testCase.params
        );
        view.dispatchEvent(
            new CustomEvent('viewshow', { detail: { isRestored: false } })
        );
        await settle(view, ledger);

        // The failure is reported, no action bar is offered, and nothing was rendered from a
        // previous item. NOTE: `loading.hide()` is never reached on this path — recorded as a
        // SUSPECT finding in the contract document, not asserted as desirable behaviour.
        expect(consoleErrors.join(' ')).toContain(
            'failed to get item or current user'
        );
        expect(visibleActions(view)).toEqual([]);
        expect(view.querySelector('.nameContainer')?.innerHTML).toBe('');
    });
});

describe('legacy Item Details — websocket subscription lifecycle', () => {
    it('subscribes on show and unsubscribes before hide', async () => {
        let unsubscribed = 0;
        const testCase = ITEM_DETAILS_CASES.find((c) => c.id === 'photo');
        if (!testCase) throw new Error('missing case');

        const view = document.createElement('div');
        view.innerHTML = loadViewHtml();
        document.body.appendChild(view);
        const ledger = createElementStubLedger();
        installElementStubs(view, ledger);

        const responderOptions = {
            item: testCase.item,
            user: testCase.user,
            lists: testCase.lists
        };
        const menu = legacyResponders(responderOptions);
        const api = createFailClosedApi({
            legacy: {
                ...pick(menu, classFor('photo').reads.legacy),
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

        const { default: controllerFactory } = await import(
            '../../src/apps/legacy/controllers/itemDetails/index.js'
        );
        new (controllerFactory as new (v: HTMLElement, p: unknown) => void)(
            view,
            testCase.params
        );
        view.dispatchEvent(
            new CustomEvent('viewshow', { detail: { isRestored: false } })
        );
        await settle(view, ledger);
        expect(unsubscribed).toBe(0);

        view.dispatchEvent(new CustomEvent('viewbeforehide'));
        expect(unsubscribed).toBe(1);
    });
});

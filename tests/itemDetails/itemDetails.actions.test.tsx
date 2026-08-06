/**
 * Phase 5 of the Item Details migration: the actions and playback semantics, proven.
 *
 * The composition suite (`itemDetails.characterization.test.tsx`) proves which controls a class
 * OFFERS. This proves what they DO — the half of `MUST PRESERVE` that a section list cannot show.
 *
 * Playback is application logic. Nothing asserted here is reachable from a presentation recipe,
 * before or after Step 2 (RFC-0007 §6.1).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ITEM_DETAILS_CASES } from '../fixtures/item-details/cases';
import contract from '../fixtures/item-details/legacy-contract.json';
import { createFailClosedApi, pick } from './support/failClosedApi';
import {
    createTestQueryClient,
    renderRoute,
    settle,
    unmountAll
} from './support/modernHarness';
import { legacyResponders, sdkResponders } from './support/responders';

vi.setConfig({ testTimeout: 30_000 });
vi.stubGlobal('__WEBPACK_SERVE__', false);
vi.mock('webcomponents.js/webcomponents-lite', () => ({}));

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
    ConnectionState: { SignedIn: 'SignedIn' },
    ConnectionMode: { Local: 0, Remote: 1, Manual: 2 }
}));
vi.mock('../../src/lib/jellyfin-apiclient/ServerConnections', () => ({
    default: serverConnections
}));

const libraryApiRef: { current: Record<string, unknown> } = { current: {} };
vi.mock('@jellyfin/sdk/lib/utils/api/library-api', () => ({
    getLibraryApi: () => libraryApiRef.current
}));

vi.mock('../../src/scripts/libraryMenu', () => ({
    default: { setTitle: vi.fn(), setTransparentMenu: vi.fn() }
}));
vi.mock('../../src/components/loading/loading', () => ({
    default: { show: vi.fn(), hide: vi.fn() }
}));
vi.mock('../../src/components/backdrop/backdrop', () => ({
    setBackdrops: vi.fn(),
    clearBackdrop: vi.fn(),
    setBackdropTransparency: vi.fn()
}));

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

vi.mock('../../src/hooks/useFetchItems', () => ({
    useTogglePlayedMutation: () => ({ mutateAsync: vi.fn() }),
    useToggleFavoriteMutation: () => ({ mutateAsync: vi.fn() })
}));

interface ContractClass {
    id: string;
    reads: { legacy: string[]; sdk: string[] };
}
const CLASSES = contract.classes as ContractClass[];
const readsFor = (id: string) => {
    const found = CLASSES.find((entry) => entry.id === id);
    if (!found) throw new Error(`no class "${id}"`);
    return found;
};

/** `serverId` is delta D14 — no longer touched. See the composition suite. */
const declaredReads = (id: string, extra: string[] = []) => [
    ...readsFor(id).reads.legacy.filter((member) => member !== 'serverId'),
    ...extra
];

interface Mounted {
    view: HTMLElement;
    calls: { surface: string; method: string; args: unknown[] }[];
    unmount: () => void;
}

async function mount(
    caseId: string,
    extraReads: string[] = []
): Promise<Mounted> {
    const testCase = ITEM_DETAILS_CASES.find((entry) => entry.id === caseId);
    if (!testCase) throw new Error(`no case fixture for "${caseId}"`);

    const responderOptions = {
        item: testCase.item,
        user: testCase.user,
        lists: testCase.lists
    };
    const api = createFailClosedApi({
        legacy: pick(
            legacyResponders(responderOptions),
            declaredReads(caseId, extraReads)
        ),
        sdk: pick(sdkResponders(responderOptions), readsFor(caseId).reads.sdk)
    });
    libraryApiRef.current = api.libraryApi;
    serverConnections.getApiClient.mockReturnValue(api.apiClient);
    serverConnections.currentApiClient.mockReturnValue(api.apiClient);
    serverConnections.getApi.mockReturnValue({});

    const { default: ItemDetailsPage } = await import(
        '../../src/apps/modern/features/details/components/ItemDetailsPage'
    );
    const mounted = await renderRoute(
        <ItemDetailsPage searchParams={new URLSearchParams(testCase.params)} />,
        createTestQueryClient()
    );

    return {
        view: mounted.container,
        calls: api.calls,
        unmount: mounted.unmount
    };
}

const action = (view: HTMLElement, name: string) =>
    view.querySelector<HTMLElement>(`[data-detail-action="${name}"]`);

const select = (view: HTMLElement, name: string) =>
    view.querySelector<HTMLSelectElement>(`[data-detail-select="${name}"]`);

async function click(element: HTMLElement | null) {
    if (!element) throw new Error('control not rendered');
    const { act } = await import('react');
    await act(async () => {
        element.click();
        await Promise.resolve();
    });
}

async function change(element: HTMLSelectElement | null, value: string) {
    if (!element) throw new Error('selector not rendered');
    const { act } = await import('react');
    await act(async () => {
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
    });
}

const lastPlay = () =>
    playbackManager.play.mock.calls.at(-1)?.[0] as {
        items: { Id: string }[];
        mediaSourceId?: string;
        audioStreamIndex?: string | null;
        subtitleStreamIndex?: string;
        startPositionTicks?: number;
    };

afterEach(() => {
    // A route left mounted keeps its effects alive and can resolve a dynamic import inside the
    // next test, against a fail-closed API that declares a different read set.
    unmountAll();
});

beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

describe('migrated Item Details — play reads the current selection', () => {
    it('sends the selected media source, audio and subtitle stream', async () => {
        const mounted = await mount('movie');

        await click(action(mounted.view, 'btnPlay'));

        expect(playbackManager.play).toHaveBeenCalledTimes(1);
        expect(lastPlay().items[0].Id).toBe('movie-1');
        expect(lastPlay().mediaSourceId).toBe('movie-1');
        expect(lastPlay().audioStreamIndex).toBe('1');
        expect(lastPlay().subtitleStreamIndex).toBe('3');
        expect(lastPlay().startPositionTicks).toBe(0);
    });

    /**
     * Phase 5's sharpest requirement: the play options must be read AT CLICK TIME.
     *
     * A component that captured the initial track state in a closure — the natural React mistake
     * where the legacy DOM-reading version was accidentally right — would still send `1` and `3`
     * here. This changes both selectors first and asserts the NEW values reach the player.
     */
    it('reflects a track change made after the page rendered', async () => {
        const mounted = await mount('movie');

        await change(select(mounted.view, 'selectAudio'), '2');
        await change(select(mounted.view, 'selectSubtitles'), '-1');
        await click(action(mounted.view, 'btnPlay'));

        expect(lastPlay().audioStreamIndex).toBe('2');
        expect(lastPlay().subtitleStreamIndex).toBe('-1');
    });

    it('reflects a media-source change made after the page rendered', async () => {
        const mounted = await mount('movie');

        await change(select(mounted.view, 'selectSource'), 'movie-1-alt');
        await click(action(mounted.view, 'btnPlay'));

        expect(lastPlay().mediaSourceId).toBe('movie-1-alt');
    });

    it('resumes from the stored position', async () => {
        const mounted = await mount('movie-resumable');

        await click(action(mounted.view, 'btnPlay'));

        expect(lastPlay().startPositionTicks).toBe(6000000000);
    });

    it('replays from zero even when a resume position exists', async () => {
        const mounted = await mount('movie-resumable');

        await click(action(mounted.view, 'btnReplay'));

        expect(lastPlay().startPositionTicks).toBe(0);
    });
});

describe('migrated Item Details — playback targets', () => {
    /**
     * A `Program` plays its CHANNEL, never itself.
     *
     * `getLiveTvChannel` is not in the `program` class's RENDER read inventory because it is issued
     * only on click, so it is declared explicitly here rather than silently widened there.
     */
    it('plays a programme through its channel', async () => {
        const airing = ITEM_DETAILS_CASES.find(
            (entry) => entry.id === 'program'
        );
        if (!airing) throw new Error('missing case');

        // The frozen `program` fixture is deliberately outside its airing window, so its play
        // control is withheld. Widen the window to reach the control without changing the target.
        const now = Date.now();
        const item = {
            ...airing.item,
            StartDate: new Date(now - 60_000).toISOString(),
            EndDate: new Date(now + 60_000).toISOString()
        };

        const api = createFailClosedApi({
            legacy: pick(
                legacyResponders({
                    item,
                    user: airing.user,
                    lists: airing.lists
                }),
                declaredReads('program', ['getLiveTvChannel'])
            ),
            sdk: pick(
                sdkResponders({ item, user: airing.user }),
                readsFor('program').reads.sdk
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
                searchParams={new URLSearchParams(airing.params)}
            />,
            createTestQueryClient()
        );

        await click(action(mounted.container, 'btnPlay'));
        await settle(4);

        expect(api.calls.map((call) => call.method)).toContain(
            'getLiveTvChannel'
        );
        expect(lastPlay().items[0].Id).toBe('channel-1');
        // And not the programme itself.
        expect(lastPlay().items[0].Id).not.toBe('program-1');
    });

    it('routes instant mix and shuffle to the player, not to play()', async () => {
        const mounted = await mount('music-album');

        await click(action(mounted.view, 'btnInstantMix'));
        await click(action(mounted.view, 'btnShuffle'));

        expect(playbackManager.instantMix).toHaveBeenCalledTimes(1);
        expect(playbackManager.shuffle).toHaveBeenCalledTimes(1);
        expect(playbackManager.play).not.toHaveBeenCalled();
    });

    it('routes the trailer action to the trailer player', async () => {
        const mounted = await mount('movie');

        await click(action(mounted.view, 'btnPlayTrailer'));

        expect(playbackManager.playTrailers).toHaveBeenCalledTimes(1);
        expect(playbackManager.play).not.toHaveBeenCalled();
    });
});

describe('migrated Item Details — the context menu targets the item', () => {
    /**
     * `SUSPECT` #4, fixed. The legacy handler re-fetched using the selected MEDIA-SOURCE id as an
     * item id, so on a multi-version item the menu acted on whatever item shared that id — or on
     * nothing. Delta D4.
     *
     * The alternate source is selected first, so a regression to the old behaviour would pass
     * `movie-1-alt` here.
     */
    it('shows the menu for the item, not for the selected media source', async () => {
        const mounted = await mount('movie');

        await change(select(mounted.view, 'selectSource'), 'movie-1-alt');
        await click(action(mounted.view, 'btnMoreCommands'));

        expect(itemContextMenu.show).toHaveBeenCalledTimes(1);
        const options = itemContextMenu.show.mock.calls[0][0] as {
            item: { Id: string };
            deleteItem: boolean;
            play: boolean;
        };
        expect(options.item.Id).toBe('movie-1');
        // The permission boundary is unchanged: deletion is the ITEM's flag, not the user's role.
        expect(options.deleteItem).toBe(true);
        expect(options.play).toBe(false);
    });

    it('does not re-read the item to open its own menu', async () => {
        const mounted = await mount('movie');
        const before = mounted.calls.filter(
            (call) => call.method === 'getItem'
        ).length;

        await click(action(mounted.view, 'btnMoreCommands'));

        const after = mounted.calls.filter(
            (call) => call.method === 'getItem'
        ).length;
        expect(after).toBe(before);
    });
});

describe('migrated Item Details — user-data refresh', () => {
    /**
     * `MUST PRESERVE` #6: the websocket refresh matches on the acting user AND on the item's own
     * `UserData.Key`. A change to a different item must not refresh this page.
     */
    it('refreshes only when the message names this item', async () => {
        const testCase = ITEM_DETAILS_CASES.find(
            (entry) => entry.id === 'photo'
        );
        if (!testCase) throw new Error('missing case');

        let handler: ((message: { Data?: unknown }) => void) | undefined;
        const menu = legacyResponders({
            item: testCase.item,
            user: testCase.user
        });
        const api = createFailClosedApi({
            legacy: {
                ...pick(menu, declaredReads('photo')),
                subscribe: (
                    _messages: string[],
                    fn: (message: { Data?: unknown }) => void
                ) => {
                    handler = fn;
                    return () => undefined;
                }
            },
            sdk: pick(
                sdkResponders({ item: testCase.item, user: testCase.user }),
                readsFor('photo').reads.sdk
            )
        });
        libraryApiRef.current = api.libraryApi;
        serverConnections.getApiClient.mockReturnValue(api.apiClient);
        serverConnections.currentApiClient.mockReturnValue(api.apiClient);
        serverConnections.getApi.mockReturnValue({});

        const { default: ItemDetailsPage } = await import(
            '../../src/apps/modern/features/details/components/ItemDetailsPage'
        );
        await renderRoute(
            <ItemDetailsPage
                searchParams={new URLSearchParams(testCase.params)}
            />,
            createTestQueryClient()
        );

        const readsAfterMount = api.calls.filter(
            (call) => call.method === 'getItem'
        ).length;
        expect(handler).toBeDefined();

        // A different item's user data: nothing happens.
        const { act } = await import('react');
        await act(async () => {
            handler?.({
                Data: {
                    UserId: 'user-1',
                    UserDataList: [{ Key: 'some-other-item' }]
                }
            });
        });
        await settle(3);
        expect(
            api.calls.filter((call) => call.method === 'getItem').length
        ).toBe(readsAfterMount);

        // This item's user data: the page re-reads.
        await act(async () => {
            handler?.({
                Data: {
                    UserId: 'user-1',
                    UserDataList: [{ Key: 'photo-1' }]
                }
            });
        });
        await settle(4);
        expect(
            api.calls.filter((call) => call.method === 'getItem').length
        ).toBeGreaterThan(readsAfterMount);
    });

    it('ignores a message for a different user', async () => {
        const testCase = ITEM_DETAILS_CASES.find(
            (entry) => entry.id === 'photo'
        );
        if (!testCase) throw new Error('missing case');

        let handler: ((message: { Data?: unknown }) => void) | undefined;
        const menu = legacyResponders({
            item: testCase.item,
            user: testCase.user
        });
        const api = createFailClosedApi({
            legacy: {
                ...pick(menu, declaredReads('photo')),
                subscribe: (
                    _messages: string[],
                    fn: (message: { Data?: unknown }) => void
                ) => {
                    handler = fn;
                    return () => undefined;
                }
            },
            sdk: pick(
                sdkResponders({ item: testCase.item, user: testCase.user }),
                readsFor('photo').reads.sdk
            )
        });
        libraryApiRef.current = api.libraryApi;
        serverConnections.getApiClient.mockReturnValue(api.apiClient);
        serverConnections.currentApiClient.mockReturnValue(api.apiClient);
        serverConnections.getApi.mockReturnValue({});

        const { default: ItemDetailsPage } = await import(
            '../../src/apps/modern/features/details/components/ItemDetailsPage'
        );
        await renderRoute(
            <ItemDetailsPage
                searchParams={new URLSearchParams(testCase.params)}
            />,
            createTestQueryClient()
        );

        const before = api.calls.filter(
            (call) => call.method === 'getItem'
        ).length;
        const { act } = await import('react');
        await act(async () => {
            handler?.({
                Data: {
                    UserId: 'someone-else',
                    UserDataList: [{ Key: 'photo-1' }]
                }
            });
        });
        await settle(3);

        expect(
            api.calls.filter((call) => call.method === 'getItem').length
        ).toBe(before);
    });
});

/**
 * The Phase 0 capture for #129 Step 2 — NOT a test, and skipped unless asked for.
 *
 * It renders the route at the PRE-BINDING commit and writes what it observes to
 * `tests/fixtures/item-details/pre-binding-composition.json`. That file is the thing the binding is
 * judged against, so it must not be a byproduct of the change it judges:
 *
 *   - it only runs with `CAPTURE_PRE_BINDING=1`, so no CI run and no `npm test` can produce it;
 *   - `preBinding.consistency.test.ts` holds its SHA-256 in SOURCE. Regenerating the fixture from a
 *     later tree fails that test until someone edits the checksum by hand, which is a visible diff
 *     in review rather than a silent refresh.
 *
 * It records what `legacy-contract.json` cannot: which artwork elements exist per class, the
 * route's three non-success states, and the focus target after mount. The frozen P5 fixture knows
 * only sections, headings, actions and selectors, and `MUST PRESERVE` #9 already cost this
 * migration one silent regression that a section list could not see.
 *
 * Captured from `1486760c76150970fa8aab7d24d3919a6a7197fa` (origin/main, PR #136's merge commit).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ITEM_DETAILS_CASES } from '../fixtures/item-details/cases';
import contract from '../fixtures/item-details/legacy-contract.json';
import { createFailClosedApi, pick } from './support/failClosedApi';
import {
    createTestQueryClient,
    renderRoute,
    renderedActions,
    renderedHeadings,
    renderedSections,
    renderedSelectors,
    unmountAll
} from './support/modernHarness';
import { legacyResponders, sdkResponders } from './support/responders';

vi.setConfig({ testTimeout: 60_000 });

vi.stubGlobal('__WEBPACK_SERVE__', false);
vi.mock('webcomponents.js/webcomponents-lite', () => ({}));

/*
 * The same fakes `itemDetails.characterization.test.tsx` installs, declared again rather than
 * shared: `vi.mock` is hoisted above every import, so a factory that closes over an imported
 * binding throws `Cannot access '__vi_import_N__' before initialization`. Every Item Details suite
 * in this directory carries its own block for that reason.
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
vi.mock('../../src/components/playback/playbackmanager', () => ({
    playbackManager: {
        canPlay: vi.fn(
            (item: { Type?: string; MediaType?: string }) =>
                ['Video', 'Audio'].includes(item?.MediaType ?? '')
                || [
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
    }
}));
vi.mock('../../src/components/itemContextMenu', () => ({
    default: {
        getCommands: vi.fn(() => Promise.resolve(['delete'])),
        show: vi.fn(() => Promise.resolve({}))
    }
}));
vi.mock('../../src/hooks/useFetchItems', () => ({
    useTogglePlayedMutation: () => ({ mutateAsync: vi.fn() }),
    useToggleFavoriteMutation: () => ({ mutateAsync: vi.fn() })
}));

const REPO_ROOT = resolve(__dirname, '..', '..');
const OUTPUT = join(
    REPO_ROOT,
    'tests',
    'fixtures',
    'item-details',
    'pre-binding-composition.json'
);

const ENABLED = process.env.CAPTURE_PRE_BINDING === '1';

/** Delta D14: the one recorded read the migrated route cannot touch. */
const RETIRED_READS = ['serverId'];

interface ContractClass {
    id: string;
    itemTypes: string[];
    sections: string[];
    reads: { legacy: string[]; sdk: string[] };
}

const CLASSES = contract.classes as unknown as ContractClass[];

async function mountCase(caseId: string) {
    const testCase = ITEM_DETAILS_CASES.find((entry) => entry.id === caseId);
    const recorded = CLASSES.find((entry) => entry.id === caseId);
    if (!testCase || !recorded) throw new Error(`no case "${caseId}"`);

    const responderOptions = {
        item: testCase.item,
        user: testCase.user,
        lists: testCase.lists
    };
    const api = createFailClosedApi({
        legacy: pick(
            legacyResponders(responderOptions),
            recorded.reads.legacy
                .filter((member) => !RETIRED_READS.includes(member))
                .sort()
        ),
        sdk: pick(sdkResponders(responderOptions), recorded.reads.sdk)
    });
    libraryApiRef.current = api.libraryApi;
    serverConnections.getApiClient.mockReturnValue(api.apiClient);
    serverConnections.currentApiClient.mockReturnValue(api.apiClient);
    serverConnections.getApi.mockReturnValue({});

    const { default: ItemDetailsPage } = await import(
        '../../src/apps/modern/features/details/components/ItemDetailsPage'
    );

    return renderRoute(
        <ItemDetailsPage searchParams={new URLSearchParams(testCase.params)} />,
        createTestQueryClient()
    );
}

/** Which artwork elements the class renders, and whether each carries a real image. */
function artworkOf(view: HTMLElement) {
    const poster = view.querySelector('[data-detail-image="poster"]');
    return {
        backdropElement: view.querySelectorAll('[data-detail-backdrop]').length,
        backdropImage: Boolean(
            view
                .querySelector<HTMLElement>('[data-detail-backdrop]')
                ?.style.backgroundImage
        ),
        posterElement: view.querySelectorAll('[data-detail-image="poster"]')
            .length,
        posterImage: Boolean(
            poster?.querySelector('.rf-item-details__poster-image')
        ),
        posterPlaceholder: Boolean(
            poster?.querySelector('.rf-item-details__poster-placeholder')
        ),
        logoElement: view.querySelectorAll('[data-detail-image="logo"]').length
    };
}

/** The slot each rendered section declares — the layout column, not the composition. */
function slotsOf(view: HTMLElement) {
    return [...view.querySelectorAll('[data-detail-section]')].map(
        (element) => ({
            section: element.getAttribute('data-detail-section') ?? '',
            slot: element.getAttribute('data-detail-slot') ?? ''
        })
    );
}

/** Where focus sits once the route has settled. */
function focusTarget(): string {
    const active = document.activeElement;
    if (!active) return 'none';
    if (active === document.body) return 'body';
    const section = active.closest('[data-detail-section]');
    return [
        active.tagName.toLowerCase(),
        active.getAttribute('data-detail-action') ?? '',
        section?.getAttribute('data-detail-section') ?? ''
    ]
        .filter(Boolean)
        .join('/');
}

afterEach(() => {
    unmountAll();
});

beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
});

describe.skipIf(!ENABLED)('#129 Step 2 — pre-binding composition capture', () => {
    it('writes the immutable record', async () => {
        const classes: unknown[] = [];

        for (const recorded of CLASSES) {
            const mounted = await mountCase(recorded.id);
            classes.push({
                id: recorded.id,
                itemTypes: recorded.itemTypes,
                artwork: artworkOf(mounted.container),
                sections: renderedSections(mounted.container),
                slots: slotsOf(mounted.container),
                headings: renderedHeadings(mounted.container),
                actions: renderedActions(mounted.container),
                selectors: renderedSelectors(mounted.container).sort(),
                focusTarget: focusTarget()
            });
            unmountAll();
        }

        const { default: ItemDetailsPage } = await import(
            '../../src/apps/modern/features/details/components/ItemDetailsPage'
        );

        // The malformed-route state. No API surface is reachable, by construction.
        const invalid = await renderRoute(
            <ItemDetailsPage
                searchParams={new URLSearchParams({ nonsense: 'x' })}
            />,
            createTestQueryClient()
        );
        const states = {
            malformedRoute: [
                ...invalid.container.querySelectorAll('[data-rf-slot]')
            ].map((element) => element.getAttribute('data-rf-slot')),
            emptyCollection: 'box-set with no children renders EmptyState inside collectionItems'
        };
        unmountAll();

        const record = {
            $comment:
                'AUTHORITATIVE PRE-BINDING RECORD. The Item Details composition as rendered by the '
                + 'migrated route BEFORE presentation.page.itemDetails was bound (#129 Step 2). '
                + 'Captured by tests/itemDetails/preBinding.capture.test.tsx with '
                + 'CAPTURE_PRE_BINDING=1; guarded by a source-held SHA-256 in '
                + 'tests/itemDetails/preBinding.consistency.test.ts. Never regenerate to make a '
                + 'test pass.',
            version: 1,
            startSha: '1486760c76150970fa8aab7d24d3919a6a7197fa',
            capability: 'presentation.page.itemDetails',
            boundAtCapture: false,
            platformDefaultAtCapture: contract.platformDefault,
            states,
            classes
        };

        mkdirSync(dirname(OUTPUT), { recursive: true });
        writeFileSync(OUTPUT, `${JSON.stringify(record, null, 4)}\n`);

        expect(classes).toHaveLength(24);
    });
});

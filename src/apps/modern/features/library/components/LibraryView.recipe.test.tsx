// @vitest-environment jsdom
import {
    QueryClient,
    QueryClientProvider,
    useQuery
} from '@tanstack/react-query';
import React, { type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Library page-composition vertical, asserted on the REAL route component.
 *
 * These are the gates that make `presentation.page.library` a binding rather than a schema entry,
 * and the invariant here is sharper than Home's because Library paginates and filters SERVER-SIDE:
 *
 *  - the platform default reproduces the composition Library had before the binding;
 *  - Classic and Glass — two real, shipped manifests — produce materially different compositions,
 *    through the real resolver, with no component knowing either theme's id;
 *  - **the full request ledger is identical under every recipe** — not only which endpoints are
 *    called, but every parameter of every call: `parentId`, `startIndex`, `limit`, sort field and
 *    order, and each filter. Home's ledger compared endpoint NAMES, which would not have caught a
 *    shelf layout quietly asking for a smaller page;
 *  - the returned item IDs and their ORDER are identical under every recipe;
 *  - `filters: 'drawer'` does not defer, reset, gate or alter the query, and leaves every filter
 *    reachable;
 *  - a malformed `localStorage` record cannot stop the page rendering;
 *  - an applied Theme Studio draft changes the live composition, survives a reload, and is undone
 *    by reset.
 *
 * The server is stubbed at the SDK boundary, not the network, so these are render/behaviour tests
 * and not end-to-end proof — the browser flow against a real Tesserafin server is the separate
 * acceptance evidence. Stubbing at the SDK boundary is precisely what lets the ledger observe every
 * request the page would have made, with the parameters it would have sent.
 */

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal('__WEBPACK_SERVE__', false);

vi.mock('lib/globalize', () => ({
    default: {
        translate: (key: string, ...args: string[]) =>
            [key, ...args].join(' ').trim()
    },
    translate: (key: string, ...args: string[]) =>
        [key, ...args].join(' ').trim()
}));

/** One entry per request the page actually issued, with its parameters. */
interface LedgerEntry {
    endpoint: string;
    params: Record<string, unknown>;
}

const ledger: LedgerEntry[] = [];

/**
 * Transport details that legitimately differ between two otherwise-identical runs. Dropping them is
 * the ONLY normalisation applied — every catalogue-shaping parameter is compared as sent.
 */
const TRANSPORT_KEYS = new Set(['signal', 'headers', 'correlationId']);

function record(endpoint: string, params: Record<string, unknown>) {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
        if (TRANSPORT_KEYS.has(key)) continue;
        if (value === undefined) continue;
        kept[key] = value;
    }
    ledger.push({ endpoint, params: kept });
}

/** The ledger in a stable order, so two runs compare without depending on scheduling. */
function ledgerSnapshot(): LedgerEntry[] {
    return [...ledger].sort((a, b) =>
        `${a.endpoint}${JSON.stringify(a.params)}`.localeCompare(
            `${b.endpoint}${JSON.stringify(b.params)}`
        )
    );
}

const LIBRARY = {
    Id: 'lib-movies',
    Name: 'Movies',
    CollectionType: 'movies'
};

/** Deliberately NOT in name order: an order the route preserves is an order it did not invent. */
const ITEMS = [
    {
        Id: 'item-c',
        Name: 'Cold Comfort',
        ProductionYear: 2022,
        ImageTags: { Primary: 'tag-c' }
    },
    {
        Id: 'item-a',
        Name: 'Aurora Bay',
        ProductionYear: 2024,
        ImageTags: { Primary: 'tag-a' }
    },
    {
        Id: 'item-b',
        Name: 'Between Tides',
        ProductionYear: 2023,
        ImageTags: { Primary: 'tag-b' }
    }
];

/*
 * Three items out of a hundred: a real page of a real library. The total is deliberately larger
 * than one page so `?page=2` is IN range — an out-of-range page is corrected by `useCanonicalPage`,
 * which would have made the ledger about that correction rather than about the recipe.
 */
const ITEMS_RESULT = { Items: ITEMS, TotalRecordCount: 100 };

vi.mock('lib/tesserafin-sdk', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        getLibraryApi: () => ({
            getItems: (params: Record<string, unknown>) => {
                record('getItems', params);
                return Promise.resolve({ data: ITEMS_RESULT });
            },
            getLatestMedia: (params: Record<string, unknown>) => {
                record('getLatestMedia', params);
                return Promise.resolve({ data: ITEMS });
            },
            getResumeItems: (params: Record<string, unknown>) => {
                record('getResumeItems', params);
                return Promise.resolve({
                    data: { Items: [], TotalRecordCount: 0 }
                });
            }
        }),
        getStudioApi: () => ({
            getStudios: (params: Record<string, unknown>) => {
                record('getStudios', params);
                return Promise.resolve({
                    data: {
                        Items: [{ Id: 'studio-1', Name: 'A24' }],
                        TotalRecordCount: 1
                    }
                });
            }
        }),
        getGenreApi: () => ({
            getGenres: (params: Record<string, unknown>) => {
                record('getGenres', params);
                return Promise.resolve({
                    data: {
                        Items: [{ Id: 'genre-1', Name: 'Drama' }],
                        TotalRecordCount: 1
                    }
                });
            }
        }),
        getShowApi: () => ({
            getNextUp: (params: Record<string, unknown>) => {
                record('getNextUp', params);
                return Promise.resolve({
                    data: { Items: [], TotalRecordCount: 0 }
                });
            },
            getUpcomingEpisodes: (params: Record<string, unknown>) => {
                record('getUpcomingEpisodes', params);
                return Promise.resolve({
                    data: { Items: [], TotalRecordCount: 0 }
                });
            }
        }),
        getMovieApi: () => ({
            getMovieRecommendations: (params: Record<string, unknown>) => {
                record('getMovieRecommendations', params);
                return Promise.resolve({ data: [] });
            }
        })
    };
});

/*
 * The genre/year facet list is the one Library request that still goes through the SHARED
 * `hooks/useFetchItems` (RFC-0005: a cross-cutting hook the legacy screens also use), and that
 * module's import graph reaches the legacy dialog shell and its `.template.html` files, which vitest
 * cannot parse. It is therefore recorded one level up, at the hook — but through a real `useQuery`
 * with the real cache key, so the ledger still counts REQUESTS and not renders, and the parameters
 * recorded are the ones the route passed. Leaving this query out of the ledger would leave the one
 * query a `filters: 'drawer'` recipe is most likely to gate unobserved.
 */
vi.mock('hooks/useFetchItems', () => ({
    useGetQueryFiltersLegacy: (
        parentId: string | undefined,
        itemType: string[]
    ) =>
        useQuery({
            queryKey: ['QueryFiltersLegacy', parentId, itemType],
            queryFn: () => {
                record('getQueryFiltersLegacy', {
                    userId: 'user-1',
                    parentId,
                    includeItemTypes: itemType
                });
                return Promise.resolve({
                    Genres: ['Drama', 'Comedy'],
                    Years: [2024, 2022]
                });
            },
            enabled: !!parentId
        })
}));

const legacyApiClient = {
    getImageUrl: (itemId: string) => `/image/${itemId}`,
    serverId: () => 'server-1'
};

vi.mock('hooks/useApi', () => ({
    useApi: () => ({
        api: { basePath: 'https://server' },
        reefinApi: { axiosInstance: {} },
        user: { Id: 'user-1' },
        __legacyApiClient__: legacyApiClient
    })
}));

vi.mock('hooks/useUserSettings', () => ({
    useUserSettings: () => ({ libraryPageSize: 24 })
}));

// The library's own item lookup. Stubbed at the hook rather than the SDK because it is a SHARED
// hook whose own request shape is not what these tests are about; it never varies with a recipe.
vi.mock('hooks/useItem', () => ({
    useItem: () => ({
        data: LIBRARY,
        isPending: false,
        isError: false,
        isSuccess: true,
        error: null,
        refetch: vi.fn()
    })
}));

vi.mock('components/Page', () => ({
    default: ({ children }: { children?: ReactNode }) => (
        <div data-testid='page'>{children}</div>
    )
}));

const { default: LibraryView } = await import('./LibraryView');
const { PresentationProvider } = await import(
    'ui/presentation/PresentationContext'
);
const { PLATFORM_DEFAULT_PRESENTATION } = await import(
    'themes/platform/resolvePresentation'
);
const { saveAppliedPresentation, clearAppliedPresentation } = await import(
    'themes/platform/localPresentation'
);

let container: HTMLDivElement;
let root: Root;

function makeClient() {
    return new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } }
    });
}

/**
 * Mounts the route at a real URL through a real router, so the query state under test is the one
 * the route parses rather than one handed to it.
 */
async function render(children: ReactNode, url = '/library/lib-movies') {
    const client = makeClient();
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={[url]}>
                    <Routes>
                        <Route path='/library/:libraryId' element={children} />
                        <Route
                            path='/library/:libraryId/:destination'
                            element={children}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
    // Macrotask ticks: React Query batches subscriber notifications through its own scheduler, so a
    // bare microtask flush records the request but leaves the page in its loading state.
    for (let pass = 0; pass < 8; pass++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

/** The composition root's resolved recipe, read off the published slot. */
function composition(): Record<string, string | null> {
    const rootEl = container.querySelector(
        '[data-rf-slot="library-composition"]'
    );
    return {
        layout: rootEl?.getAttribute('data-rf-library-layout') ?? null,
        cardAspect: rootEl?.getAttribute('data-rf-library-card-aspect') ?? null,
        filters: rootEl?.getAttribute('data-rf-library-filters') ?? null
    };
}

/** The rendered items, in DOM order — the user-visible answer to "which media did I get?". */
function renderedItemHrefs(): string[] {
    return [...container.querySelectorAll('[data-rf-slot="media-card"]')].map(
        (card) => card.getAttribute('href') ?? ''
    );
}

function containerText(): string {
    return container.textContent ?? '';
}

beforeEach(() => {
    ledger.length = 0;
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
});

/** The composition `/library/:libraryId` rendered before `presentation.page.library` was bound. */
const PRE_BINDING_COMPOSITION = {
    layout: 'grid',
    cardAspect: 'poster',
    filters: 'inline'
};

describe('Library composition — the platform default', () => {
    it('reproduces the composition Library had before the binding', async () => {
        await render(<LibraryView />);

        expect(composition()).toEqual(PRE_BINDING_COMPOSITION);
        // A grid, laid out by `MediaGrid`, with the filter controls in the always-visible bar —
        // the three facts the pre-binding route was made of.
        expect(
            container.querySelector('[data-rf-slot="media-grid"]')
        ).not.toBeNull();
        expect(
            container.querySelector('[data-rf-slot="media-shelf"]')
        ).toBeNull();
        expect(
            container.querySelector('[data-rf-slot="filter-drawer"]')
        ).toBeNull();
        expect(
            container.querySelector('.rf-media-card--poster')
        ).not.toBeNull();
    });

    it('is what the platform default recipe says, so the two cannot drift', () => {
        expect(PLATFORM_DEFAULT_PRESENTATION.page.library).toEqual(
            PRE_BINDING_COMPOSITION
        );
    });

    it('publishes the composition root as a durable slot', async () => {
        await render(<LibraryView />);
        expect(
            container.querySelector('[data-rf-slot="library-composition"]')
        ).not.toBeNull();
    });
});

describe('Library composition — two shipped themes, two compositions', () => {
    it('renders Classic as a poster grid with inline filters', async () => {
        await render(
            <PresentationProvider themeId='official.classic'>
                <LibraryView />
            </PresentationProvider>
        );

        expect(composition()).toEqual(PRE_BINDING_COMPOSITION);
        expect(
            container.querySelector('[data-rf-slot="media-grid"]')
        ).not.toBeNull();
    });

    it('renders Glass as a backdrop shelf with a filter drawer', async () => {
        await render(
            <PresentationProvider themeId='official.glass'>
                <LibraryView />
            </PresentationProvider>
        );

        expect(composition()).toEqual({
            layout: 'shelf',
            cardAspect: 'backdrop',
            filters: 'drawer'
        });
        expect(
            container.querySelector('[data-rf-slot="media-shelf"]')
        ).not.toBeNull();
        expect(
            container.querySelector('[data-rf-slot="media-grid"]')
        ).toBeNull();
        expect(
            container.querySelector('.rf-media-card--backdrop')
        ).not.toBeNull();
        expect(
            container.querySelector('.rf-filter-drawer__trigger')
        ).not.toBeNull();
    });

    // "No component names a theme id" is asserted over the source of the whole Library vertical by
    // `tests/boundary/presentationBoundary.ratchet.test.ts`, which reads files from disk.
});

/**
 * The recipes the ledger is compared across. Every one is materially different on screen, and the
 * malformed record is included because a recipe that FAILS to parse must land on the same requests
 * as one that parses to the default.
 */
const RECIPES = [
    { name: 'platform default', themeId: undefined, applied: undefined },
    {
        name: "Classic's recipe",
        themeId: 'official.classic',
        applied: undefined
    },
    { name: "Glass's recipe", themeId: 'official.glass', applied: undefined },
    {
        name: 'grid / poster / inline',
        themeId: 'official.classic',
        applied: {
            page: {
                library: {
                    layout: 'grid' as const,
                    cardAspect: 'poster' as const,
                    filters: 'inline' as const
                }
            }
        }
    },
    {
        name: 'shelf / backdrop / drawer',
        themeId: 'official.classic',
        applied: {
            page: {
                library: {
                    layout: 'shelf' as const,
                    cardAspect: 'backdrop' as const,
                    filters: 'drawer' as const
                }
            }
        }
    },
    {
        name: 'square cards in a shelf, filters inline',
        themeId: 'official.glass',
        applied: {
            page: {
                library: {
                    layout: 'shelf' as const,
                    cardAspect: 'square' as const,
                    filters: 'inline' as const
                }
            }
        }
    }
];

const MALFORMED_RECORD =
    '{"page":{"library":{"layout":"enormous","cardAspect":42,"filters":null}}}';

async function renderRecipe(
    recipe: (typeof RECIPES)[number],
    url = '/library/lib-movies'
) {
    if (recipe.applied) saveAppliedPresentation(recipe.applied);
    await render(
        recipe.themeId ? (
            <PresentationProvider themeId={recipe.themeId}>
                <LibraryView />
            </PresentationProvider>
        ) : (
            <LibraryView />
        ),
        url
    );
}

describe('Library composition — a recipe cannot change the catalogue query', () => {
    /**
     * THE gate. Every recipe, plus a malformed record that falls back, must issue exactly the same
     * requests with exactly the same parameters. If a recipe could reach `limit`, `startIndex`,
     * a sort field or a filter, "how the library looks" would be a theme deciding what the client
     * asks the server for.
     */
    async function ledgerFor(
        recipe: (typeof RECIPES)[number] | 'malformed',
        url?: string
    ) {
        if (recipe === 'malformed') {
            localStorage.setItem(
                'tesserafin.themeStudio.appliedPresentation',
                MALFORMED_RECORD
            );
            await render(
                <PresentationProvider themeId='official.classic'>
                    <LibraryView />
                </PresentationProvider>,
                url
            );
        } else {
            await renderRecipe(recipe, url);
        }
        return ledgerSnapshot();
    }

    it('issues the expected request set at all, so an empty ledger cannot pass', async () => {
        const entries = await ledgerFor(RECIPES[0]);

        expect(entries.map((entry) => entry.endpoint).sort()).toEqual([
            'getItems',
            'getQueryFiltersLegacy',
            'getStudios'
        ]);
        const items = entries.find((entry) => entry.endpoint === 'getItems');
        expect(items?.params).toMatchObject({
            userId: 'user-1',
            parentId: 'lib-movies',
            includeItemTypes: ['Movie'],
            recursive: true,
            sortBy: ['SortName'],
            sortOrder: ['Ascending'],
            startIndex: 0,
            limit: 24
        });
    });

    it.each(RECIPES)('issues the same ledger under "$name"', async (recipe) => {
        const baseline = await ledgerFor(RECIPES[0]);

        // A fresh root, so the second render is a first render and not a re-render.
        act(() => root.unmount());
        container.remove();
        ledger.length = 0;
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        expect(await ledgerFor(recipe)).toEqual(baseline);
    });

    it('issues the same ledger under a malformed record that falls back', async () => {
        const baseline = await ledgerFor(RECIPES[0]);

        act(() => root.unmount());
        container.remove();
        ledger.length = 0;
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        expect(await ledgerFor('malformed')).toEqual(baseline);
    });

    it('keeps a non-default sort, filter and page identical under every recipe', async () => {
        // A URL carrying real query state: page 2, descending release date, one genre, one studio,
        // favorites only, and a letter. Every one of these is a `getItems` parameter, and none of
        // them may move because of a layout or filter-placement value.
        const url =
            '/library/lib-movies?page=2&sort=ProductionYear&order=Descending&genre=Drama&studio=studio-1&favorite=1&letter=B';

        const baseline = await ledgerFor(RECIPES[0], url);
        expect(
            baseline.find((entry) => entry.endpoint === 'getItems')?.params
        ).toMatchObject({
            startIndex: 24,
            limit: 24,
            sortBy: ['ProductionYear'],
            sortOrder: ['Descending'],
            genres: ['Drama'],
            studioIds: ['studio-1'],
            isFavorite: true,
            nameStartsWith: 'B'
        });

        for (const recipe of RECIPES.slice(1)) {
            act(() => root.unmount());
            container.remove();
            ledger.length = 0;
            localStorage.clear();
            container = document.createElement('div');
            document.body.appendChild(container);
            root = createRoot(container);

            expect(
                await ledgerFor(recipe, url),
                `recipe "${recipe.name}" changed the ledger`
            ).toEqual(baseline);
        }
    });
});

describe('Library composition — a recipe cannot change the result set', () => {
    it.each(RECIPES)(
        'renders the same item IDs in the same order under "$name"',
        async (recipe) => {
            await renderRecipe(recipe);

            // Server order, preserved. Not sorted here on purpose: a route that re-ordered its
            // response would pass a set comparison and fail its users.
            expect(renderedItemHrefs()).toEqual([
                '#/details?id=item-c&serverId=server-1',
                '#/details?id=item-a&serverId=server-1',
                '#/details?id=item-b&serverId=server-1'
            ]);
        }
    );

    it('exposes the same media set through a grid and through a shelf', async () => {
        await renderRecipe(RECIPES[3]); // grid / poster / inline
        const fromGrid = renderedItemHrefs();

        act(() => root.unmount());
        container.remove();
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await renderRecipe(RECIPES[4]); // shelf / backdrop / drawer
        expect(renderedItemHrefs()).toEqual(fromGrid);
    });

    it('draws the same image request whatever the card aspect is', async () => {
        await renderRecipe(RECIPES[3]);
        const posterImages = [
            ...container.querySelectorAll('.rf-media-card__image')
        ].map((img) => img.getAttribute('src'));

        act(() => root.unmount());
        container.remove();
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await renderRecipe(RECIPES[4]);
        expect(
            [...container.querySelectorAll('.rf-media-card__image')].map(
                (img) => img.getAttribute('src')
            )
        ).toEqual(posterImages);
    });
});

describe('Library composition — every destination the recipe governs', () => {
    /**
     * The recipe is a PAGE recipe, and `/library/:libraryId` is four destinations. Which of them
     * each key governs is a decision (`utils/libraryRecipe.ts`), and a decision nobody asserts is a
     * decision that quietly changes: `layout` and `cardAspect` govern the item list — Browse and
     * Collections — `cardAspect` also shapes Suggestions' media cards, and Genres is exempt because
     * its cards are aggregates carrying a name and no artwork.
     */
    function freshRoot() {
        act(() => root.unmount());
        container.remove();
        ledger.length = 0;
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    }

    it('composes Collections with the same recipe as Browse', async () => {
        await renderRecipe(RECIPES[4], '/library/lib-movies/collections');

        expect(
            container.querySelector('[data-rf-slot="media-shelf"]')
        ).not.toBeNull();
        expect(
            container.querySelector('.rf-media-card--backdrop')
        ).not.toBeNull();
    });

    it('issues the same Collections ledger under every recipe', async () => {
        const url = '/library/lib-movies/collections';
        await renderRecipe(RECIPES[0], url);
        const baseline = ledgerSnapshot();
        expect(baseline.length).toBeGreaterThan(0);

        for (const recipe of RECIPES.slice(1)) {
            freshRoot();
            await renderRecipe(recipe, url);
            expect(
                ledgerSnapshot(),
                `recipe "${recipe.name}" changed the Collections ledger`
            ).toEqual(baseline);
        }
    });

    it('shapes Suggestions cards, and issues the same Suggestions ledger under every recipe', async () => {
        const url = '/library/lib-movies/suggestions';
        await renderRecipe(RECIPES[0], url);
        const baseline = ledgerSnapshot();
        expect(baseline.length).toBeGreaterThan(0);
        expect(
            container.querySelector('.rf-media-card--poster')
        ).not.toBeNull();

        freshRoot();
        await renderRecipe(RECIPES[4], url); // backdrop
        expect(
            container.querySelector('.rf-media-card--backdrop')
        ).not.toBeNull();
        expect(container.querySelector('.rf-media-card--poster')).toBeNull();
        expect(
            ledgerSnapshot(),
            'a recipe changed what Suggestions asks for'
        ).toEqual(baseline);
    });

    it('leaves Genres alone, because a genre tile is not a media item', async () => {
        // `square` everywhere else; Genres keeps the `backdrop` shape its name-only cards were
        // given for a layout reason that has nothing to do with artwork.
        await renderRecipe(RECIPES[5], '/library/lib-movies/genres');

        expect(
            container.querySelector('.rf-media-card--backdrop')
        ).not.toBeNull();
        expect(container.querySelector('.rf-media-card--square')).toBeNull();
    });
});

describe('Library composition — which key wins for a card aspect', () => {
    it('lets the page recipe override the app-wide media-card aspect', async () => {
        // Both published keys name the shape of a card on this route. The MORE SPECIFIC one wins.
        // Under the platform default both are `poster`, so this is the only place the precedence
        // is observable — and therefore the only place it can be pinned.
        saveAppliedPresentation({
            mediaCard: { imageAspect: 'square' },
            page: { library: { cardAspect: 'backdrop' } }
        });
        await render(
            <PresentationProvider themeId='official.classic'>
                <LibraryView />
            </PresentationProvider>
        );

        expect(
            container.querySelector('.rf-media-card--backdrop')
        ).not.toBeNull();
        expect(container.querySelector('.rf-media-card--square')).toBeNull();
    });
});

describe('Library composition — the filter drawer is a place, not a condition', () => {
    const DRAWER = RECIPES[4];

    it('issues the catalogue query before the drawer is ever opened', async () => {
        await renderRecipe(DRAWER);

        expect(
            container.querySelector('[data-rf-slot="filter-drawer"]')
        ).toBeNull();
        expect(ledger.some((entry) => entry.endpoint === 'getItems')).toBe(
            true
        );
        expect(
            ledger.some((entry) => entry.endpoint === 'getQueryFiltersLegacy')
        ).toBe(true);
        expect(renderedItemHrefs()).toHaveLength(3);
    });

    it('keeps a filter applied while the drawer is closed', async () => {
        await renderRecipe(
            DRAWER,
            '/library/lib-movies?genre=Drama&favorite=1'
        );

        expect(
            container.querySelector('[data-rf-slot="filter-drawer"]')
        ).toBeNull();
        expect(
            ledger.find((entry) => entry.endpoint === 'getItems')?.params
        ).toMatchObject({ genres: ['Drama'], isFavorite: true });
    });

    it('opens on its trigger, moves focus in, and issues nothing new', async () => {
        await renderRecipe(DRAWER);
        const before = ledgerSnapshot();

        const trigger = container.querySelector<HTMLButtonElement>(
            '.rf-filter-drawer__trigger'
        );
        expect(trigger).not.toBeNull();
        expect(trigger?.getAttribute('aria-expanded')).toBe('false');

        await act(async () => {
            trigger?.click();
        });

        const panel = container.querySelector('[data-rf-slot="filter-drawer"]');
        expect(panel).not.toBeNull();
        expect(panel?.getAttribute('role')).toBe('dialog');
        expect(panel?.getAttribute('aria-modal')).toBe('true');
        expect(panel?.contains(document.activeElement)).toBe(true);
        expect(trigger?.getAttribute('aria-expanded')).toBe('true');

        // Opening a panel is not a data event.
        expect(ledgerSnapshot()).toEqual(before);
    });

    it('closes on Escape, returns focus to its trigger, and changes no query', async () => {
        await renderRecipe(
            DRAWER,
            '/library/lib-movies?genre=Drama&favorite=1'
        );

        const trigger = container.querySelector<HTMLButtonElement>(
            '.rf-filter-drawer__trigger'
        );
        await act(async () => {
            trigger?.click();
        });
        const before = ledgerSnapshot();

        const panel = container.querySelector('[data-rf-slot="filter-drawer"]');
        await act(async () => {
            panel?.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true
                })
            );
        });

        expect(
            container.querySelector('[data-rf-slot="filter-drawer"]')
        ).toBeNull();
        expect(document.activeElement).toBe(trigger);
        // The filter survives the close, and closing issued nothing.
        expect(ledgerSnapshot()).toEqual(before);
        expect(
            ledger.find((entry) => entry.endpoint === 'getItems')?.params
        ).toMatchObject({ genres: ['Drama'], isFavorite: true });
    });

    it('offers the same filter controls in the drawer as the inline bar has', async () => {
        await renderRecipe(RECIPES[3]); // inline
        const inlineLabels = [
            ...container.querySelectorAll('.rf-sort-select__label, label')
        ]
            .map((node) => (node.textContent ?? '').trim())
            .sort();

        act(() => root.unmount());
        container.remove();
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await renderRecipe(DRAWER);
        const trigger = container.querySelector<HTMLButtonElement>(
            '.rf-filter-drawer__trigger'
        );
        await act(async () => {
            trigger?.click();
        });

        const drawerLabels = [
            ...container.querySelectorAll('.rf-sort-select__label, label')
        ]
            .map((node) => (node.textContent ?? '').trim())
            .sort();

        // Not "a subset" and not "at least" — the same set. A drawer that dropped a control would
        // be a recipe deciding which filters a user may reach.
        expect(drawerLabels).toEqual(inlineLabels);
    });
});

describe('Library composition — layout never writes user state', () => {
    const VIEW_MODE_KEY = 'library-view-lib-movies';

    it('hides the list/grid toggle under a shelf without touching the stored preference', async () => {
        localStorage.setItem(VIEW_MODE_KEY, JSON.stringify('list'));

        await renderRecipe(RECIPES[4]); // shelf

        expect(containerText()).not.toContain('LabelViewMode');
        expect(localStorage.getItem(VIEW_MODE_KEY)).toBe(
            JSON.stringify('list')
        );
    });

    it('restores the reader’s list choice when the recipe returns to a grid', async () => {
        localStorage.setItem(VIEW_MODE_KEY, JSON.stringify('list'));

        await renderRecipe(RECIPES[3]); // grid

        expect(
            container.querySelector('.rf-library-view__grid--list')
        ).not.toBeNull();
        expect(localStorage.getItem(VIEW_MODE_KEY)).toBe(
            JSON.stringify('list')
        );
    });

    it('keeps the same page size under a shelf, which shows fewer items at once', async () => {
        await renderRecipe(RECIPES[4]);

        expect(
            ledger.find((entry) => entry.endpoint === 'getItems')?.params
        ).toMatchObject({ limit: 24, startIndex: 0 });
    });

    it('shows the same pagination state under a grid and under a shelf', async () => {
        // The visible half of the same claim: a shelf displays fewer items AT ONCE, and still holds
        // page 1 of 5. A recipe that changed `limit` would change this label too.
        await renderRecipe(RECIPES[3]); // grid
        const fromGrid = container.querySelector(
            '.rf-library-view__pagination'
        )?.textContent;
        expect(fromGrid).toBeTruthy();

        act(() => root.unmount());
        container.remove();
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await renderRecipe(RECIPES[4]); // shelf
        expect(
            container.querySelector('.rf-library-view__pagination')?.textContent
        ).toBe(fromGrid);
    });
});

describe('Library composition — apply, reload, reset', () => {
    const applied = {
        page: {
            library: {
                layout: 'shelf' as const,
                cardAspect: 'square' as const,
                filters: 'drawer' as const
            }
        }
    };

    it('changes the live composition as soon as a draft is applied', async () => {
        await render(
            <PresentationProvider themeId='official.classic'>
                <LibraryView />
            </PresentationProvider>
        );
        expect(composition()).toEqual(PRE_BINDING_COMPOSITION);

        // What `applyLocalThemeOverlay` does on Apply. No reload, no remount.
        await act(async () => {
            saveAppliedPresentation(applied);
        });

        expect(composition()).toEqual({
            layout: 'shelf',
            cardAspect: 'square',
            filters: 'drawer'
        });
    });

    it('survives a reload, because the record is read at mount too', async () => {
        saveAppliedPresentation(applied);
        await render(
            <PresentationProvider themeId='official.classic'>
                <LibraryView />
            </PresentationProvider>
        );

        expect(composition()).toEqual({
            layout: 'shelf',
            cardAspect: 'square',
            filters: 'drawer'
        });
    });

    it('restores the official composition on reset', async () => {
        saveAppliedPresentation(applied);
        await render(
            <PresentationProvider themeId='official.classic'>
                <LibraryView />
            </PresentationProvider>
        );
        expect(composition()).toEqual({
            layout: 'shelf',
            cardAspect: 'square',
            filters: 'drawer'
        });

        await act(async () => {
            clearAppliedPresentation();
        });

        expect(composition()).toEqual(PRE_BINDING_COMPOSITION);
    });
});

describe('Library composition — a corrupted record cannot stop the page', () => {
    const KEY = 'tesserafin.themeStudio.appliedPresentation';

    it.each([
        ['not JSON at all', '{{{'],
        ['a JSON array', '[]'],
        [
            'a layout no renderer defines',
            '{"page":{"library":{"layout":"enormous"}}}'
        ],
        ['a numeric card aspect', '{"page":{"library":{"cardAspect":42}}}'],
        ['a null filter placement', '{"page":{"library":{"filters":null}}}'],
        ['the library recipe as a string', '{"page":{"library":"shelf"}}'],
        ['every key wrong at once', MALFORMED_RECORD]
    ])('boots and falls back with %s', async (_name, raw) => {
        localStorage.setItem(KEY, raw);
        await render(
            <PresentationProvider themeId='official.classic'>
                <LibraryView />
            </PresentationProvider>
        );

        expect(composition()).toEqual(PRE_BINDING_COMPOSITION);
        expect(renderedItemHrefs()).toHaveLength(3);
    });

    it('keeps the good keys of a half-corrupt record', async () => {
        // Deliberate: one bad value must not cost the others.
        localStorage.setItem(
            KEY,
            '{"page":{"library":{"layout":"shelf","cardAspect":"nonsense","filters":"drawer"}}}'
        );
        await render(
            <PresentationProvider themeId='official.classic'>
                <LibraryView />
            </PresentationProvider>
        );

        expect(composition()).toEqual({
            layout: 'shelf',
            cardAspect: 'poster',
            filters: 'drawer'
        });
    });
});

describe('Library composition — a recipe cannot suppress a state', () => {
    it.each(RECIPES)(
        'still renders the empty state under "$name"',
        async (recipe) => {
            // Same route, no items. A recipe that hid an empty state would leave a reader looking at a
            // page that says nothing at all.
            ITEMS_RESULT.Items = [];
            ITEMS_RESULT.TotalRecordCount = 0;
            try {
                await renderRecipe(recipe);
                expect(containerText()).toContain('MessageNoItemsAvailable');
            } finally {
                ITEMS_RESULT.Items = ITEMS;
                ITEMS_RESULT.TotalRecordCount = 100;
            }
        }
    );
});

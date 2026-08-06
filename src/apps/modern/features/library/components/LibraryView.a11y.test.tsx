// @vitest-environment jsdom
/**
 * Automated accessibility scan of the Library route under every shipped composition (web#128).
 *
 * A visual recipe is exactly the kind of change that can quietly cost accessibility: a shelf is a
 * scroll region, a drawer is a dialog, and both are structures the grid did not have. So the scan
 * runs once per recipe rather than once for the route — including with the filter drawer OPEN,
 * which is the state a scan of the default composition can never reach.
 *
 * The same two rules are disabled as in `themeStudio/components/ThemeStudio.a11y.test.tsx`, for the
 * same stated reasons: jsdom computes no layout and no used colour values, so `color-contrast` and
 * `scrollable-region-focusable` structurally cannot run here. Contrast is covered on the tokens by
 * `tesserafin-design/__tests__/palette-contrast.test.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe, { type Result, type RunOptions } from 'axe-core';
import React, { type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal('__WEBPACK_SERVE__', false);

vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key },
    translate: (key: string) => key
}));

const LIBRARY = { Id: 'lib-movies', Name: 'Movies', CollectionType: 'movies' };

const ITEMS = [
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

vi.mock('lib/tesserafin-sdk', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const empty = { data: { Items: [], TotalRecordCount: 0 } };
    return {
        ...actual,
        getLibraryApi: () => ({
            getItems: () =>
                Promise.resolve({
                    data: { Items: ITEMS, TotalRecordCount: 100 }
                }),
            getLatestMedia: () => Promise.resolve({ data: [] }),
            getResumeItems: () => Promise.resolve(empty)
        }),
        getStudioApi: () => ({
            getStudios: () =>
                Promise.resolve({
                    data: {
                        Items: [{ Id: 'studio-1', Name: 'A24' }],
                        TotalRecordCount: 1
                    }
                })
        }),
        getGenreApi: () => ({ getGenres: () => Promise.resolve(empty) }),
        getShowApi: () => ({
            getNextUp: () => Promise.resolve(empty),
            getUpcomingEpisodes: () => Promise.resolve(empty)
        }),
        getMovieApi: () => ({
            getMovieRecommendations: () => Promise.resolve({ data: [] })
        })
    };
});

vi.mock('hooks/useFetchItems', () => ({
    useGetQueryFiltersLegacy: () => ({
        data: { Genres: ['Drama'], Years: [2024] },
        isPending: false
    })
}));

vi.mock('hooks/useApi', () => ({
    useApi: () => ({
        reefinApi: { axiosInstance: {} },
        user: { Id: 'user-1' },
        __legacyApiClient__: {
            getImageUrl: (itemId: string) => `/image/${itemId}`,
            serverId: () => 'server-1'
        }
    })
}));

vi.mock('hooks/useUserSettings', () => ({
    useUserSettings: () => ({ libraryPageSize: 24 })
}));

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
const { saveAppliedPresentation } = await import(
    'themes/platform/localPresentation'
);

let container: HTMLDivElement;
let root: Root;

/** Rules that structurally cannot run under jsdom. Each one names where it is covered instead. */
const RULES_JSDOM_CANNOT_RUN: RunOptions['rules'] = {
    // Covered by tesserafin-design/__tests__/palette-contrast.test.ts, on the tokens themselves.
    'color-contrast': { enabled: false },
    // Needs a real scroll box; jsdom reports every element as zero-sized.
    'scrollable-region-focusable': { enabled: false }
};

function describeViolations(violations: Result[]): string[] {
    return violations.map(
        (violation) =>
            `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes
                .map((node) => node.html)
                .slice(0, 3)
                .join(' | ')}`
    );
}

async function scan(): Promise<Result[]> {
    const results = await axe.run(container, {
        rules: RULES_JSDOM_CANNOT_RUN,
        runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
        }
    });
    return results.violations;
}

async function render(recipe?: {
    layout: 'grid' | 'shelf';
    cardAspect: 'poster' | 'backdrop' | 'square';
    filters: 'inline' | 'drawer';
}) {
    if (recipe) saveAppliedPresentation({ page: { library: recipe } });

    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } }
    });
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={['/library/lib-movies']}>
                    <Routes>
                        <Route
                            path='/library/:libraryId'
                            element={
                                <PresentationProvider themeId='official.classic'>
                                    <LibraryView />
                                </PresentationProvider>
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
    for (let pass = 0; pass < 8; pass++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
        root = createRoot(container);
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
});

const RECIPES = [
    {
        name: 'the platform default — grid, poster, inline',
        recipe: undefined
    },
    {
        name: 'grid, backdrop, drawer',
        recipe: {
            layout: 'grid' as const,
            cardAspect: 'backdrop' as const,
            filters: 'drawer' as const
        }
    },
    {
        name: 'shelf, backdrop, drawer',
        recipe: {
            layout: 'shelf' as const,
            cardAspect: 'backdrop' as const,
            filters: 'drawer' as const
        }
    },
    {
        name: 'shelf, square, inline',
        recipe: {
            layout: 'shelf' as const,
            cardAspect: 'square' as const,
            filters: 'inline' as const
        }
    }
];

describe('Library accessibility — every composition', () => {
    it.each(RECIPES)(
        'has no WCAG A/AA violation under %s',
        async ({ recipe }) => {
            await render(recipe);
            const violations = await scan();
            expect(describeViolations(violations)).toEqual([]);
        }
    );

    it('has no violation with the filter drawer open', async () => {
        await render(RECIPES[2].recipe);

        const trigger = container.querySelector<HTMLButtonElement>(
            '.rf-filter-drawer__trigger'
        );
        await act(async () => {
            trigger?.click();
        });
        expect(
            container.querySelector('[data-rf-slot="filter-drawer"]')
        ).not.toBeNull();

        expect(describeViolations(await scan())).toEqual([]);
    });

    it('labels every media card in both layouts', async () => {
        for (const recipe of [RECIPES[0].recipe, RECIPES[2].recipe]) {
            await render(recipe);
            const cards = [
                ...container.querySelectorAll('[data-rf-slot="media-card"]')
            ];
            expect(cards).toHaveLength(2);
            for (const card of cards) {
                // The accessible name comes from the card's own title text, in either container.
                expect((card.textContent ?? '').trim().length).toBeGreaterThan(
                    0
                );
            }
        }
    });
});

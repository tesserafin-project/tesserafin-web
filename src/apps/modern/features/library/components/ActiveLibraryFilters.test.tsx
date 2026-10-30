// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('__WEBPACK_SERVE__', false);
vi.mock('lib/globalize', () => ({
    default: {
        translate: (key: string, ...args: unknown[]) => [key, ...args].join(' ')
    }
}));
// The real hook reaches `playbackmanager`, whose module start-up throws under vitest.
vi.mock('hooks/useApi', () => ({
    useApi: () => ({ user: { Id: 'user', ServerId: 'server' } })
}));
vi.mock('hooks/useUserSettings', () => ({
    useUserSettings: () => ({ libraryPageSize: 100 })
}));
const fixture = vi.hoisted(() => ({
    mode: 'some',
    studios: [
        { Id: 's1', Name: 'A24' },
        { Id: 's2', Name: 'Studio Two' }
    ],
    facetsPending: false,
    requests: [] as Record<string, unknown>[]
}));
vi.mock('../api/useLibraryFilters', () => ({
    useLibraryFilters: () => ({
        data: { Genres: ['Drama'], Years: [2026] },
        isPending: fixture.facetsPending
    })
}));
vi.mock('../api/useLibraryDestinations', () => ({
    useLibraryStudios: () => ({
        data: { Items: fixture.studios },
        isPending: fixture.facetsPending
    })
}));
vi.mock('../api/useLibraryItems', () => ({
    useLibraryItems: (params: Record<string, unknown>) => {
        fixture.requests.push(params);
        return {
            data: {
                Items:
                    fixture.mode === 'some'
                        ? [{ Id: 'one', Name: 'One', ServerId: 'server' }]
                        : [],
                TotalRecordCount: fixture.mode === 'some' ? 400 : 0
            },
            isPending: fixture.mode === 'pending',
            isError: ['error', 'denied'].includes(fixture.mode),
            isSuccess: !['pending', 'error', 'denied'].includes(fixture.mode),
            isPlaceholderData: fixture.mode === 'placeholder',
            error: {
                response: { status: fixture.mode === 'denied' ? 401 : 500 }
            },
            refetch: vi.fn()
        };
    }
}));
const { default: Browse } = await import('./BrowseDestination');
const { PresentationProvider, usePresentation } = await import(
    'ui/presentation/PresentationContext'
);
const { BaseItemKind } = await import('lib/tesserafin-sdk');
function Harness() {
    const recipe = usePresentation().page.library;
    return (
        <Browse
            libraryId='lib'
            libraryName='Movies'
            collectionType='tvshows'
            primaryItemType={BaseItemKind.Series}
            density='compact'
            apiClient={undefined}
            recipe={recipe}
        />
    );
}
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let router: ReturnType<typeof createMemoryRouter>;
const query =
    'genre=Drama&year=2026&letter=%23&favorite=1&studio=s1,s2&page=3&sort=DateCreated&order=Descending&granularity=episodes&density=compact&view=list&other=keep';
const summary = () =>
    container.querySelector<HTMLElement>('.rf-active-library-filters')!;
const chips = () => [
    ...container.querySelectorAll<HTMLButtonElement>('button[data-filter-key]')
];
const button = (text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (el) => el.textContent === text
    )!;
async function render(theme = 'official.classic', params = query) {
    router = createMemoryRouter(
        [
            { path: '/outside', element: <div>Outside</div> },
            { path: '/library/lib', element: <Harness /> }
        ],
        { initialEntries: ['/outside', `/library/lib?${params}`] }
    );
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <PresentationProvider themeId={theme}>
                    <RouterProvider router={router} />
                </PresentationProvider>
            </QueryClientProvider>
        );
    });
}
async function click(el: HTMLElement) {
    await act(async () => {
        el.click();
    });
}
beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fixture.mode = 'some';
    fixture.studios = [
        { Id: 's1', Name: 'A24' },
        { Id: 's2', Name: 'Studio Two' }
    ];
    fixture.facetsPending = false;
    fixture.requests.length = 0;
    localStorage.clear();
});
afterEach(async () => {
    await act(async () => root.unmount());
    router?.dispose();
    client.clear();
    container.remove();
});

for (const theme of ['official.classic', 'official.glass']) {
    describe(`${theme}: visible, reversible library filters`, () => {
        it('shows every active predicate outside the closed drawer and removes only the chosen one', async () => {
            await render(theme);
            expect(chips()).toHaveLength(6);
            expect(summary().textContent).toContain('A24');
            expect(container.querySelector('[role="dialog"]')).toBeNull();
            const remove = chips().find(
                (el) => el.dataset.filterKey === 'studio:s1'
            )!;
            remove.focus();
            await click(remove);
            const params = new URLSearchParams(router.state.location.search);
            expect(params.get('studio')).toBe('s2');
            expect(params.get('genre')).toBe('Drama');
            expect(params.has('page')).toBe(false);
            expect(document.activeElement).toBe(chips()[4]);
            expect(chips()[4].textContent).toContain('Studio Two');
            expect(fixture.requests.at(-1)).toMatchObject({
                startIndex: 0,
                studioIds: ['s2'],
                sortBy: 'DateCreated',
                sortOrder: 'Descending',
                includeItemTypes: ['Episode'],
                isFavorite: true,
                letter: '#'
            });
        });
        it('reset keeps sort, display, depth and unrelated URL state; focus remains usable and Back is not polluted', async () => {
            await render(theme);
            await click(button('ResetFilters'));
            const params = new URLSearchParams(router.state.location.search);
            expect(Object.fromEntries(params)).toEqual({
                sort: 'DateCreated',
                order: 'Descending',
                granularity: 'episodes',
                density: 'compact',
                view: 'list',
                other: 'keep'
            });
            expect(chips()).toHaveLength(0);
            expect(document.activeElement).toBe(
                container.querySelector(
                    '.rf-library-view__controls select,.rf-filter-drawer__trigger'
                )
            );
            expect(fixture.requests.at(-1)).toMatchObject({
                startIndex: 0,
                sortBy: 'DateCreated',
                includeItemTypes: ['Episode'],
                genre: undefined,
                year: undefined,
                studioIds: undefined,
                isFavorite: undefined,
                letter: undefined
            });
            await act(async () => {
                await router.navigate(-1);
            });
            expect(router.state.location.pathname).toBe('/outside');
        });
        it('offers reset on a genuine filtered empty response, but not on an unfiltered empty response', async () => {
            fixture.mode = 'empty';
            await render(theme, 'genre=Drama');
            const empty = container.querySelector<HTMLElement>(
                '[data-rf-slot="state-empty"]'
            )!;
            expect(empty.textContent).toContain(
                'MessageNoMatchingLibraryItems'
            );
            await click(empty.querySelector('button')!);
            expect(
                container.querySelector('[data-rf-slot="state-empty"]')
                    ?.textContent
            ).toContain('MessageNoItemsAvailable');
            expect(
                container.querySelector('[data-rf-slot="state-empty"] button')
            ).toBeNull();
        });
        it('lets a selected unknown studio be removed when facets are unavailable without exposing its opaque id', async () => {
            fixture.studios = [];
            fixture.facetsPending = true;
            await render(theme, 'studio=opaque-identifier');
            expect(summary().textContent).toContain('SelectedLibraryStudio 1');
            expect(summary().textContent).not.toContain('opaque-identifier');
            await click(chips()[0]);
            expect(chips()).toHaveLength(0);
            expect(
                new URLSearchParams(router.state.location.search).has('studio')
            ).toBe(false);
        });
    });
}

it.each(['pending', 'placeholder', 'error', 'denied'])(
    'does not mislabel %s as filtered zero results',
    async (mode) => {
        fixture.mode = mode;
        await render('official.classic', 'genre=Drama');
        expect(container.textContent).not.toContain(
            'MessageNoMatchingLibraryItems'
        );
        expect(
            container.querySelector('[data-rf-slot="state-empty"] button')
        ).toBeNull();
    }
);

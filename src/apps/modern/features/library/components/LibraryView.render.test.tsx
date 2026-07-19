// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Render smoke tests for the components L15b mounts.
 *
 * ## What these are, and what they are explicitly not
 *
 * They are **not** the acceptance proof for the activation. That is
 * `npm run test:e2e` against a real Reefin server, which asserts the real router and real server
 * responses; these mock both, so by the lane's own rule they do not count as the final proof and
 * are not offered as one.
 *
 * What they do buy is narrow and real: before this file, none of the five new components had ever
 * *executed* — not under vitest (util tests only) and not under Playwright (no server available).
 * `tsc` cannot catch a render-time crash, a hook called down a branch that does not exist, or a
 * `.map` over something that is `undefined` at first paint. These run each component through its
 * mount, its pending state and its loaded state, so that class of failure surfaces here instead of
 * in front of a human doing a merge.
 *
 * The server is stubbed at the *hook* boundary rather than the network, deliberately: stubbing the
 * network would make these look like end-to-end tests, which is the confusion this comment exists
 * to prevent.
 */

// React 18's `act` needs this flag or every render logs "not configured to support act(...)".
// It is not part of `globalThis`'s type, hence the cast rather than a bare assignment.
(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Something in the import graph still reaches `ServerConnections` → `apphost` → `webSettings`,
// which reads webpack's build-time `__WEBPACK_SERVE__` define. Under vitest there is no webpack, so
// it is stubbed to its production value.
vi.stubGlobal('__WEBPACK_SERVE__', false);

// `lib/globalize` is the heavy root of this graph: it reaches `scripts/settings/userSettings` and
// from there the whole legacy shell (apphost, dialogHelper and its `.template.html` files, and
// `RootAppRouter`'s side-effecting `createHashRouter`). Translations are not what these tests
// assert, so it is replaced by an identity: every label becomes its own key, which also makes the
// assertions below independent of any locale.
vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key },
    translate: (key: string) => key
}));

const mockUseApi = vi.fn();
const mockUseItem = vi.fn();

vi.mock('hooks/useApi', () => ({ useApi: () => mockUseApi() }));
vi.mock('hooks/useItem', () => ({ useItem: (id?: string) => mockUseItem(id) }));
vi.mock('hooks/useUserSettings', () => ({
    useUserSettings: () => ({ libraryPageSize: 100 })
}));
// `components/Page` reaches into the legacy shell (`libraryMenu`, view manager); the route's own
// rendering is what is under test here, not the page chrome it is wrapped in.
vi.mock('components/Page', () => ({
    default: ({ children }: { children?: ReactNode }) => (
        <div data-testid='page'>{children}</div>
    )
}));

const emptyResult = { Items: [], TotalRecordCount: 0 };

vi.mock('../api/useLibraryItems', () => ({
    useLibraryItems: () => ({
        data: emptyResult,
        isPending: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
        error: null,
        refetch: vi.fn()
    })
}));
vi.mock('../api/useLibraryFilters', () => ({
    useLibraryFilters: () => ({
        data: { Genres: ['Drama'], Years: [2026] },
        isPending: false
    })
}));

const destinationQuery = (data: unknown) => ({
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    isPlaceholderData: false,
    fetchStatus: 'idle',
    error: null,
    refetch: vi.fn()
});

vi.mock('../api/useLibraryDestinations', () => ({
    useLibraryGenres: () =>
        destinationQuery({ Items: [{ Id: 'g1', Name: 'Drama' }] }),
    useLibraryCollections: () => destinationQuery(emptyResult),
    useLibraryStudios: () =>
        destinationQuery({ Items: [{ Id: 's1', Name: 'A24' }] }),
    useLibraryUpcoming: () => destinationQuery(emptyResult),
    useLibraryResumeItems: () => destinationQuery(emptyResult),
    useLibraryLatestItems: () =>
        destinationQuery({ Items: [{ Id: 'm1', Name: 'A Movie' }] }),
    useLibraryNextUp: () => destinationQuery(emptyResult),
    useLibraryMovieRecommendations: () => destinationQuery([])
}));

const LibraryView = (await import('./LibraryView')).default;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockUseApi.mockReturnValue({
        reefinApi: {},
        user: { Id: 'user-1' },
        __legacyApiClient__: {
            getImageUrl: () => 'https://example.com/image.jpg',
            serverId: () => 'server-1'
        }
    });
    mockUseItem.mockReturnValue({
        data: { Id: 'lib-1', Name: 'Movies', CollectionType: 'movies' },
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn()
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
});

const renderAt = (path: string) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

    act(() => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[path]}>
                    <Routes>
                        <Route
                            path='/library/:libraryId'
                            element={<LibraryView />}
                        />
                        <Route
                            path='/library/:libraryId/:destination'
                            element={<LibraryView />}
                        />
                        <Route path='*' element={<div>elsewhere</div>} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );
    });
};

describe('LibraryView renders each destination without throwing', () => {
    it('renders Browse with the full control bar at the short URL', () => {
        renderAt('/library/lib-1');

        expect(container.querySelector('[data-rf-slot="tabs"]')).not.toBeNull();
        expect(container.querySelectorAll('[data-rf-slot="tab"]')).toHaveLength(
            4
        );
        // The controls the arbitration turned from tabs into controls must actually be present —
        // this is the render-level counterpart of the design §3.2 table.
        expect(
            container.querySelector('[data-rf-slot="alpha-picker"]')
        ).not.toBeNull();
        expect(container.querySelectorAll('select').length).toBeGreaterThan(3);
    });

    it('renders Genres', () => {
        renderAt('/library/lib-1/genres');
        expect(container.textContent).toContain('Drama');
    });

    it('renders Collections', () => {
        renderAt('/library/lib-1/collections');
        expect(container.querySelector('[data-rf-slot="tabs"]')).not.toBeNull();
    });

    it('renders Suggestions with its shelves', () => {
        renderAt('/library/lib-1/suggestions');
        expect(
            container.querySelector('[data-rf-slot="media-shelf"]')
        ).not.toBeNull();
    });

    it('renders a tvshows library, which adds the granularity control', () => {
        mockUseItem.mockReturnValue({
            data: { Id: 'lib-tv', Name: 'Shows', CollectionType: 'tvshows' },
            isPending: false,
            isError: false,
            error: null,
            refetch: vi.fn()
        });

        renderAt('/library/lib-tv');
        expect(container.querySelector('[data-rf-slot="tabs"]')).not.toBeNull();
    });
});

describe('LibraryView failure states render', () => {
    it('renders the not-found state for a 404 without offering a retry', () => {
        mockUseItem.mockReturnValue({
            data: undefined,
            isPending: false,
            isError: true,
            error: { response: { status: 404 } },
            refetch: vi.fn()
        });

        renderAt('/library/missing');

        expect(
            container.querySelector('[data-rf-slot="state-empty"]')
        ).not.toBeNull();
        expect(
            container.querySelector('[data-rf-slot="state-error"]')
        ).toBeNull();
    });

    it('renders the retryable error state for a 500', () => {
        mockUseItem.mockReturnValue({
            data: undefined,
            isPending: false,
            isError: true,
            error: { response: { status: 500 } },
            refetch: vi.fn()
        });

        renderAt('/library/broken');

        expect(
            container.querySelector('[data-rf-slot="state-error"]')
        ).not.toBeNull();
    });

    it('renders the loading state while the library resolves', () => {
        mockUseItem.mockReturnValue({
            data: undefined,
            isPending: true,
            isError: false,
            error: null,
            refetch: vi.fn()
        });

        renderAt('/library/lib-1');

        expect(
            container.querySelector('[data-rf-slot="state-loading"]')
        ).not.toBeNull();
    });
});

describe('LibraryView canonicalizes non-canonical destination segments', () => {
    /**
     * `/browse` and unknown segments must not render a second copy of Browse at a second URL — they
     * redirect to the short canonical one. Rendered here (rather than only asserted as a string)
     * because a `<Navigate>` that loops would hang the render, which this would catch.
     */
    it.each(['browse', 'not-a-destination'])(
        'redirects /%s to the short URL rather than rendering it',
        (segment) => {
            renderAt(`/library/lib-1/${segment}`);

            // Landed on the short URL's render: the tab strip is present and Browse is selected.
            const tabs = container.querySelectorAll('[data-rf-slot="tab"]');
            expect(tabs).toHaveLength(4);
            expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
        }
    );
});

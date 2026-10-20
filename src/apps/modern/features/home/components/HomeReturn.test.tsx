// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
    QueryClient,
    QueryClientProvider,
    useQuery
} from '@tanstack/react-query';
import {
    createMemoryRouter,
    RouterProvider,
    useSearchParams
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('__WEBPACK_SERVE__', false);
const state = vi.hoisted(() => ({
    user: { Id: 'return-user', ServerId: 'return-server' },
    items: Array.from({ length: 14 }, (_, index) => ({
        Id: `item-${index}`,
        Name: `Movie ${index}`,
        Type: 'Movie',
        ServerId: 'return-server'
    })),
    wait: undefined as Promise<void> | undefined
}));
vi.mock('hooks/useApi', () => ({
    useApi: () => ({
        user: state.user,
        __legacyApiClient__: {
            serverId: () => state.user.ServerId,
            getImageUrl: () => ''
        }
    })
}));
vi.mock('lib/globalize', () => ({
    default: {
        translate: (key: string, ...args: string[]) => [key, ...args].join(' '),
        getCurrentDateTimeLocale: () => 'en-US'
    }
}));
vi.mock('components/playback/playbackmanager', () => ({
    playbackManager: { play: vi.fn() }
}));
vi.mock('../api/useUserViews', () => ({
    useUserViews: () => ({
        data: {
            Items: [{ Id: 'movies', Name: 'Movies', CollectionType: 'movies' }]
        },
        isPending: false,
        isError: false,
        refetch: vi.fn()
    })
}));
vi.mock('../api/useResumeItems', () => ({
    useResumeItems: () => ({
        data: { Items: state.items },
        isPending: false,
        isError: false,
        refetch: vi.fn()
    })
}));
vi.mock('../api/useNextUp', () => ({
    useNextUp: () => ({
        data: { Items: [] },
        isPending: false,
        isError: false,
        refetch: vi.fn()
    })
}));
vi.mock('../api/useLatestMedia', () => ({
    useLatestMedia: () =>
        useQuery({
            queryKey: ['Home', state.user.Id, 'ReturnFixture'],
            queryFn: async () => {
                await state.wait;
                return [...state.items];
            },
            retry: false
        })
}));

vi.mock('../api/useFavoriteItems', () => ({
    useFavoriteItems: (kinds: string[]) =>
        useQuery({
            queryKey: ['Home', state.user.Id, 'FavoriteReturnFixture', kinds],
            queryFn: async () => {
                await state.wait;
                return { Items: kinds[0] === 'Movie' ? [...state.items] : [] };
            },
            retry: false
        })
}));

const { default: HomeTab } = await import('./HomeTab');
const { default: FavoritesTab } = await import('./FavoritesTab');
const { useHomeReturnPosition } = await import(
    '../hooks/useHomeReturnPosition'
);
// Exercise the real shelves and recovery hook in a MemoryRouter; the browser suite covers
// the actual route shell. Reproduce that shell's mount-time vertical reset explicitly.
function Home() {
    const [params] = useSearchParams();
    const tab = params.get('tab') === '1' ? 1 : 0;
    const ref = useHomeReturnPosition(tab);
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);
    return (
        <div ref={ref}>
            <button role='tab' aria-selected={tab === 0}>
                Home
            </button>
            <button role='tab' aria-selected={tab === 1}>
                Favorites
            </button>
            {tab === 0 ? <HomeTab /> : <FavoritesTab />}
        </div>
    );
}
const { forgetHomePosition, homeReturnKey } = await import(
    '../utils/homeReturnPosition'
);
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let router: ReturnType<typeof createMemoryRouter>;
let y = 0;
const x = new WeakMap<Element, number>();
const allItems = [...state.items];
const shelf = () =>
    container.querySelector<HTMLElement>('#home-latest-movies')!;
const scroller = (id = 'home-latest-movies') =>
    container.querySelector<HTMLElement>(`#${id} .rf-media-shelf__scroller`)!;
const cards = () => [
    ...shelf().querySelectorAll<HTMLAnchorElement>(
        'a[data-rf-slot="media-card"]'
    )
];
async function flush() {
    // Query notifications, React commits and the recovery animation frame are separate turns.
    for (let turn = 0; turn < 3; turn += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    }
}
async function mount(initial = '/home') {
    client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } }
    });
    router = createMemoryRouter(
        [
            { path: '/home', element: <Home /> },
            { path: '/details', element: <button id='details'>Details</button> }
        ],
        { initialEntries: [initial] }
    );
    root = createRoot(container);
    await act(async () => {
        root.render(
            <React.StrictMode>
                <QueryClientProvider client={client}>
                    <RouterProvider router={router} />
                </QueryClientProvider>
            </React.StrictMode>
        );
    });
    await flush();
}
async function open() {
    const card = cards()[10];
    scroller().scrollLeft = 800;
    scroller('home-continueWatching').scrollLeft = 320;
    y = 500;
    const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0
    });
    await act(async () => {
        card.dispatchEvent(event);
    });
    // MemoryRouter cannot follow native hash links. Supply the destination in the no-fix
    // control too, so that control fails on lost scroll/focus rather than on test setup.
    if (!event.defaultPrevented)
        await act(async () => {
            await router.navigate('/details');
        });
    expect(router.state.location.pathname).toBe('/details');
}
async function back() {
    await act(async () => {
        await router.navigate(-1);
    });
    await flush();
}

beforeEach(() => {
    forgetHomePosition(
        homeReturnKey('return-server', 'return-user', 0, 'default')
    );
    container = document.createElement('div');
    document.body.append(container);
    state.user = { Id: 'return-user', ServerId: 'return-server' };
    state.items = [...allItems];
    state.wait = undefined;
    y = 0;
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) =>
        setTimeout(() => fn(0), 0)
    );
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
    vi.spyOn(window, 'scrollTo').mockImplementation(((
        arg: number | ScrollToOptions,
        top?: number
    ) => {
        y = typeof arg === 'number' ? top! : (arg.top ?? y);
    }) as typeof window.scrollTo);
    vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockImplementation(
        function (this: HTMLElement) {
            return x.get(this) ?? 0;
        }
    );
    vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'set').mockImplementation(
        function (this: HTMLElement, value: number) {
            x.set(this, value);
        }
    );
    HTMLElement.prototype.scrollTo = function (
        options?: ScrollToOptions | number
    ) {
        if (options && typeof options !== 'number')
            this.scrollLeft = options.left ?? this.scrollLeft;
    };
});
afterEach(async () => {
    if (root) await act(async () => root.unmount());
    router?.dispose();
    client?.clear();
    container.remove();
    vi.unstubAllGlobals();
});

describe('Home shelves and recovery hook in a memory router, with geometry mocked', () => {
    it('restores page, all rows and the exact card in its own shelf; refresh does not replay it', async () => {
        await mount();
        await open();
        await back();
        expect(y).toBe(500);
        expect(scroller().scrollLeft).toBe(800);
        expect(scroller('home-continueWatching').scrollLeft).toBe(320);
        expect(document.activeElement).toBe(cards()[10]);
        cards()[1].focus();
        y = 120;
        scroller().scrollLeft = 40;
        await act(async () => {
            await client.invalidateQueries({ queryKey: ['Home'] });
        });
        await flush();
        expect(document.activeElement).toBe(cards()[1]);
        expect(y).toBe(120);
        expect(scroller().scrollLeft).toBe(40);
    });
    it('waits for refreshed data and chooses the old index when the opened card disappeared', async () => {
        await mount();
        await open();
        state.items = state.items.filter((item) => item.Id !== 'item-10');
        let release!: () => void;
        state.wait = new Promise<void>((resolve) => {
            release = resolve;
        });
        await back();
        expect(y).toBe(0);
        await act(async () => {
            release();
        });
        await flush();
        expect(document.activeElement).toBe(cards()[10]);
        expect((document.activeElement as HTMLElement).textContent).toContain(
            'Movie 11'
        );
    });
    it('gives up pending restoration when the viewer starts navigating', async () => {
        await mount();
        await open();
        let release!: () => void;
        state.wait = new Promise<void>((resolve) => {
            release = resolve;
        });
        await back();
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
        );
        y = 75;
        await act(async () => {
            release();
        });
        await flush();
        expect(y).toBe(75);
        expect(document.activeElement).not.toBe(cards()[10]);
    });
    it('recovers when a persistent header Back button was focused before the return', async () => {
        await mount();
        await open();
        const header = document.createElement('button');
        document.body.append(header);
        header.focus();
        Object.defineProperty(header, 'getClientRects', {
            value: () => [new DOMRect(0, 0, 40, 40)]
        });
        await back();
        expect(document.activeElement).toBe(cards()[10]);
        expect(y).toBe(500);
        header.remove();
    });
    it('fresh Home navigation starts fresh rather than reusing an earlier entry', async () => {
        await mount();
        await open();
        await act(async () => {
            await router.navigate('/home');
        });
        await flush();
        expect(y).toBe(0);
        expect(scroller().scrollLeft).toBe(0);
        expect(document.activeElement).not.toBe(cards()[10]);
    });
    it.each(['user', 'server'])(
        'does not restore another %s’s state',
        async (kind) => {
            await mount();
            await open();
            state.user =
                kind === 'user'
                    ? { ...state.user, Id: 'other' }
                    : { ...state.user, ServerId: 'other' };
            await back();
            expect(y).toBe(0);
            expect(scroller().scrollLeft).toBe(0);
        }
    );
    it('restores Favorites independently of the Home tab', async () => {
        await mount('/home?tab=1');
        const row = container.querySelector<HTMLElement>(
            '#home-favorites-movies'
        )!;
        const card = row.querySelectorAll<HTMLAnchorElement>(
            'a[data-rf-slot="media-card"]'
        )[10];
        const strip = row.querySelector<HTMLElement>(
            '.rf-media-shelf__scroller'
        )!;
        strip.scrollLeft = 700;
        y = 400;
        await act(async () => {
            card.dispatchEvent(
                new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    button: 0
                })
            );
        });
        await back();
        const returned = container.querySelector<HTMLElement>(
            '#home-favorites-movies'
        )!;
        expect(document.activeElement).toBe(
            returned.querySelectorAll('a[data-rf-slot="media-card"]')[10]
        );
        expect(
            returned.querySelector<HTMLElement>('.rf-media-shelf__scroller')!
                .scrollLeft
        ).toBe(700);
        expect(y).toBe(400);
    });
    it('does not hijack modified or new-tab activation', async () => {
        await mount();
        const card = cards()[10];
        const event = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            button: 0
        });
        await act(async () => {
            card.dispatchEvent(event);
        });
        expect(event.defaultPrevented).toBe(false);
        expect(router.state.location.pathname).toBe('/home');
    });
});

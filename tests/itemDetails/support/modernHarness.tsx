/**
 * Mount the MIGRATED Item Details route and observe it the way the frozen P5 fixture speaks.
 *
 * The legacy harness mounted a view-manager controller against an HTML template and read the DOM
 * ids that template declared. There is no template and no controller any more, so this mounts the
 * real route component and reads the section/action/selector names the migrated slice publishes as
 * `data-detail-*` characterization hooks. The NAMES are unchanged, which is what lets
 * `tests/fixtures/item-details/legacy-contract.json` judge the new route without being rewritten.
 *
 * What is faked, and only this:
 *
 *  1. **The two API surfaces**, behind the same fail-closed proxies P5 used. An undeclared call is
 *     a failure, not a silent success.
 *  2. **Nothing else.** There are no customized built-in elements left to stub — that whole class of
 *     harness scaffolding retired with the `emby-*` selects and playstate buttons.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
/*
 * The `emby-*` elements are Custom Elements **v0** (`document.registerElement`), provided in the
 * browser by `webcomponents.js/webcomponents-lite`. That polyfill cannot run under jsdom, and the
 * migrated route reaches one of those modules transitively through `utils/dashboard`. Accepting
 * registration is test infrastructure standing in for a browser capability jsdom lacks — the same
 * shim the P5 harness carried, and no production file is changed to make the route testable.
 */
/*
 * React's own flag for "this is a test environment that drives `act`". Without it React logs an
 * act(...) warning on every update, which a suite that asserts an empty console would report as a
 * route failure rather than as harness configuration.
 */
(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof document !== 'undefined' && !('registerElement' in document)) {
    (
        document as Document & { registerElement?: (name: string) => unknown }
    ).registerElement = () => function RegisteredElement() {};
}
import { MemoryRouter } from 'react-router-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * A query client with no persister and no retry.
 *
 * The application's client persists to IndexedDB (`utils/query/queryClient.ts`). A suite that
 * shared it could pass from a previous test's cached data rather than from a request the route
 * actually issued — Phase 3 requirement 11. One client per mount, never restored from anywhere.
 */
export function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0, staleTime: 0 },
            mutations: { retry: false }
        }
    });
}

/**
 * Every root this module mounted and has not torn down.
 *
 * A route left mounted at the end of a test keeps its effects alive, and a dynamic import it
 * started can resolve inside the NEXT test — against that test's fail-closed API, which declares a
 * different read set. {@link unmountAll} is meant for an `afterEach`.
 */
const liveRoutes = new Set<() => void>();

/** Tear down every route still mounted. Call from `afterEach`. */
export function unmountAll(): void {
    for (const unmount of [...liveRoutes]) unmount();
    liveRoutes.clear();
}

export interface MountedRoute {
    container: HTMLElement;
    queryClient: QueryClient;
    unmount: () => void;
}

/**
 * Render a component into a detached container and drain until it stops changing.
 *
 * MACROTASK turns, not microtask flushes: React Query resolves through timers, and a microtask
 * flush leaves every query pending. Recorded in the same terms the reader suites use.
 */
export async function renderRoute(
    element: React.ReactElement,
    queryClient: QueryClient
): Promise<MountedRoute> {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let root: Root | undefined;
    await act(async () => {
        root = createRoot(container);
        root.render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>{element}</MemoryRouter>
            </QueryClientProvider>
        );
    });

    await settle();

    const unmount = () => {
        if (!liveRoutes.has(unmount)) return;
        liveRoutes.delete(unmount);
        act(() => {
            root?.unmount();
        });
        container.remove();
    };
    liveRoutes.add(unmount);

    return { container, queryClient, unmount };
}

/** Drain macrotasks until the tree stops changing. */
export async function settle(turns = 12): Promise<void> {
    for (let i = 0; i < turns; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

const attribute = (root: HTMLElement, name: string): string[] =>
    [...root.querySelectorAll(`[${name}]`)].map(
        (element) => element.getAttribute(name) ?? ''
    );

/**
 * The rendered semantic sections, in DOCUMENT order.
 *
 * Stronger than the legacy helper, which walked the template's declared order and filtered: this
 * reads the order the viewer actually gets, so a reordered section is a failure rather than an
 * invisible change.
 */
export const renderedSections = (root: HTMLElement): string[] =>
    attribute(root, 'data-detail-section');

/** The rendered principal actions, in document order. */
export const renderedActions = (root: HTMLElement): string[] =>
    attribute(root, 'data-detail-action');

/** The offered track/version selectors. */
export const renderedSelectors = (root: HTMLElement): string[] =>
    attribute(root, 'data-detail-select');

/** Every section heading, in document order, as rendered text. */
export const renderedHeadings = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('[data-detail-heading]')]
        .map((element) => (element.textContent ?? '').trim())
        .filter(Boolean);

/** Distinct API members touched on one surface, sorted. */
export function touched(
    calls: { surface: string; method: string }[],
    surface: 'legacy' | 'sdk'
): string[] {
    return [
        ...new Set(
            calls
                .filter((call) => call.surface === surface)
                .map((c) => c.method)
        )
    ].sort();
}

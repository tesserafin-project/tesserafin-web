/**
 * The mount harness the content-pack suites share.
 *
 * Not a test file (no `.test.` in the name, so vitest's default `include` never collects it) and
 * not reachable from production: nothing under `src/apps/modern/routes/` imports it, so it stays
 * out of every chunk the router's lazy context builds.
 *
 * It exists because every content-pack suite needs the same four things — a jsdom root, a query
 * client that does not retry and does not persist, a router with the real `contentpacks` paths,
 * and a way to let React Query actually settle.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// React 18's `act` needs this flag or every render logs "not configured to support act(...)".
(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A query client with no persister and no retry.
 *
 * The application's client persists to IndexedDB (`utils/query/queryClient.ts`). A suite that
 * shared it could pass from a previous test's cached data rather than from a request the code
 * under test actually issued.
 */
export const createTestQueryClient = (
    options: { gcTime?: number } = {}
): QueryClient =>
    new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                /*
                 * `0` by default, so nothing survives between mounts. A suite that seeds a cache
                 * entry with `setQueryData` and then asserts on it must pass `Infinity`: an entry
                 * with no observer is collected the moment it is written when `gcTime` is `0`, and
                 * the assertion would read `undefined` whatever the code under test did.
                 */
                gcTime: options.gcTime ?? 0,
                staleTime: 0
            },
            mutations: { retry: false }
        }
    });

/**
 * Let React Query settle.
 *
 * A microtask flush is not enough: the query core schedules its state transitions on the macrotask
 * queue, so `await Promise.resolve()` returns with every query still `pending`. Each turn here is
 * one real `setTimeout(0)` inside `act`, which is what actually advances a fetch from `pending` to
 * `success`.
 */
export const settle = async (turns = 4): Promise<void> => {
    for (let turn = 0; turn < turns; turn++) {
        await act(
            async () =>
                await new Promise<void>((resolve) => setTimeout(resolve, 0))
        );
    }
};

export interface MountedTree {
    container: HTMLElement;
    queryClient: QueryClient;
    unmount: () => void;
    /**
     * Re-render the SAME root, keeping React's tree and therefore React Query's observers alive.
     *
     * Unmount-and-mount-again is not equivalent: a new observer has no previous query, so every
     * `placeholderData` decision degrades to "no placeholder". Anything asserting what survives a
     * prop change has to go through here.
     */
    rerender: (next?: ReactElement) => void;
}

const live = new Set<() => void>();

/** Tear down every tree still mounted. Call from `afterEach`. */
export const unmountAll = (): void => {
    for (const unmount of [...live]) unmount();
    live.clear();
};

export interface MountOptions {
    /** Initial `MemoryRouter` entry. Defaults to `/contentpacks`. */
    path?: string;
    queryClient?: QueryClient;
    /** Mounted at `contentpacks/:packId` instead of at `contentpacks`. */
    detailElement?: ReactElement;
}

/**
 * Mount `element` under the REAL content-pack route paths.
 *
 * The paths are spelled the way `apps/modern/routes/asyncRoutes/user.ts` spells them, so a suite
 * that navigates from the list to a pack exercises the same parameter extraction the application
 * does — including the fact that `packId` arrives from the URL as an opaque string.
 */
export const mountRoute = (
    element: ReactElement,
    options: MountOptions = {}
): MountedTree => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const queryClient = options.queryClient ?? createTestQueryClient();

    const paint = (next: ReactElement) => {
        act(() => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter
                        initialEntries={[options.path ?? '/contentpacks']}
                    >
                        <Routes>
                            <Route path='/contentpacks' element={next} />
                            <Route
                                path='/contentpacks/:packId'
                                element={options.detailElement ?? next}
                            />
                            <Route path='*' element={<div>elsewhere</div>} />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            );
        });
    };

    paint(element);

    const unmount = () => {
        act(() => root.unmount());
        container.remove();
        live.delete(unmount);
    };
    live.add(unmount);

    return {
        container,
        queryClient,
        unmount,
        rerender: (next?: ReactElement) => paint(next ?? element)
    };
};

/** Mount a bare hook consumer with no router — for the query/mutation suites. */
export const mountHook = (
    element: ReactElement,
    queryClient: QueryClient = createTestQueryClient()
): MountedTree => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const paint = (next: ReactElement) => {
        act(() => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter>{next}</MemoryRouter>
                </QueryClientProvider>
            );
        });
    };

    paint(element);

    const unmount = () => {
        act(() => root.unmount());
        container.remove();
        live.delete(unmount);
    };
    live.add(unmount);

    return {
        container,
        queryClient,
        unmount,
        rerender: (next?: ReactElement) => paint(next ?? element)
    };
};

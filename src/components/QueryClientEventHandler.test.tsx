// @vitest-environment jsdom
import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import QueryClientEventHandler from './QueryClientEventHandler';

/**
 * POLISH-1 — the server's own "this changed" messages reach the query cache.
 *
 * The defect this pins: a new user finishes the first-run wizard, lands on a home page fetched
 * while the first scan had only just begun, and keeps looking at that snapshot — the cache is
 * fresh for a minute and persisted, so even a reload does not ask again.
 */

let subscribedTypes: string[] = [];
let serverSays: () => void = () => undefined;
const unsubscribe = vi.fn();
const api = {
    subscribe: vi.fn((types: string[], handler: () => void) => {
        subscribedTypes = types;
        serverSays = handler;
        return unsubscribe;
    })
};

vi.mock('hooks/useApi', () => ({
    useApi: () => ({ api, user: { Id: 'u1' } })
}));

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const isInvalidated = (queryKey: unknown[]) =>
    queryClient.getQueryState(queryKey)?.isInvalidated;

beforeEach(() => {
    unsubscribe.mockClear();
    queryClient = new QueryClient();
    for (const key of [
        ['Home', 'u1', 'LatestMedia', 'lib'],
        ['Home', 'u1', 'ResumeItems'],
        ['User', 'u1', 'Items', 'lib'],
        ['User', 'u1', 'Views'],
        ['Items', {}],
        ['Home', 'someone-else', 'ResumeItems'],
        ['Configuration']
    ]) {
        queryClient.setQueryData(key, []);
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
        root = createRoot(container);
        root.render(
            <QueryClientProvider client={queryClient}>
                <QueryClientEventHandler />
            </QueryClientProvider>
        );
    });
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

describe('QueryClientEventHandler', () => {
    it('listens for library and play-state changes', () => {
        expect(subscribedTypes).toEqual([
            OutboundWebSocketMessageType.LibraryChanged,
            OutboundWebSocketMessageType.UserDataChanged
        ]);
    });

    it('refreshes the home page and every item list when the server reports a change', () => {
        serverSays();

        expect(isInvalidated(['Home', 'u1', 'LatestMedia', 'lib'])).toBe(true);
        expect(isInvalidated(['Home', 'u1', 'ResumeItems'])).toBe(true);
        expect(isInvalidated(['User', 'u1', 'Items', 'lib'])).toBe(true);
        expect(isInvalidated(['User', 'u1', 'Views'])).toBe(true);
        expect(isInvalidated(['Items', {}])).toBe(true);
    });

    it('leaves other users and unrelated queries alone', () => {
        serverSays();

        expect(isInvalidated(['Home', 'someone-else', 'ResumeItems'])).toBe(
            false
        );
        expect(isInvalidated(['Configuration'])).toBe(false);
    });

    it('releases the subscription on unmount', () => {
        act(() => {
            root.render(<QueryClientProvider client={queryClient} />);
        });

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});

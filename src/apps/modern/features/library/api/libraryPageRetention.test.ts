import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
    markLibraryPageIdle,
    markLibraryPageObserved,
    MAX_IDLE_LIBRARY_PAGES
} from './libraryPageRetention';

const keyOf = (start: number) => ['pages', start];

const seeded = (count: number) => {
    const client = new QueryClient();
    for (let start = 0; start < count; start++) {
        client.setQueryData(keyOf(start), { start });
    }
    return client;
};

const cached = (client: QueryClient) =>
    client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey[1] as number)
        .sort((a, b) => a - b);

describe('libraryPageRetention', () => {
    it('keeps only the most recently left pages, however many were read', () => {
        const count = MAX_IDLE_LIBRARY_PAGES + 30;
        const client = seeded(count);
        for (let start = 0; start < count; start++) {
            markLibraryPageIdle(client, keyOf(start));
        }
        expect(cached(client)).toEqual(
            Array.from(
                { length: MAX_IDLE_LIBRARY_PAGES },
                (_, index) => count - MAX_IDLE_LIBRARY_PAGES + index
            )
        );
    });

    it('does not evict a page the viewer came back to', () => {
        const client = seeded(MAX_IDLE_LIBRARY_PAGES + 1);
        markLibraryPageIdle(client, keyOf(0));
        markLibraryPageObserved(keyOf(0));
        for (let start = 1; start <= MAX_IDLE_LIBRARY_PAGES; start++) {
            markLibraryPageIdle(client, keyOf(start));
        }
        expect(cached(client)).toContain(0);
    });

    it('leaves a page that is still observed in the cache', () => {
        const client = seeded(1);
        const stop = new QueryObserver(client, {
            queryKey: keyOf(0),
            staleTime: Infinity,
            queryFn: () => ({})
        }).subscribe(() => undefined);
        markLibraryPageIdle(client, keyOf(0));
        for (let start = 1; start <= MAX_IDLE_LIBRARY_PAGES; start++) {
            client.setQueryData(keyOf(start), {});
            markLibraryPageIdle(client, keyOf(start));
        }
        expect(cached(client)).toContain(0);
        stop();
    });
});

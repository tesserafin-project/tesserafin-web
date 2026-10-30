import {
    hashKey,
    type QueryClient,
    type QueryKey
} from '@tanstack/react-query';

/**
 * Pages no grid observes any more, across every result set. A garbage collection time alone bounds
 * how long a page lasts, not how many there are: a fast scroll through a large library would hold
 * them all for that long, in memory and in the persisted cache. Beyond this count the oldest goes.
 */
export const MAX_IDLE_LIBRARY_PAGES = 12;

const idle = new Map<string, QueryKey>();

export const markLibraryPageObserved = (queryKey: QueryKey) => {
    idle.delete(hashKey(queryKey));
};

export const markLibraryPageIdle = (
    client: QueryClient,
    queryKey: QueryKey
) => {
    const hash = hashKey(queryKey);
    idle.delete(hash);
    idle.set(hash, queryKey);
    while (idle.size > MAX_IDLE_LIBRARY_PAGES) {
        const [oldestHash, oldestKey] = idle.entries().next().value!;
        idle.delete(oldestHash);
        // Another grid may have picked it up since: `inactive` leaves a page in use alone.
        client.removeQueries({
            queryKey: oldestKey,
            exact: true,
            type: 'inactive'
        });
    }
};

// @vitest-environment jsdom
/**
 * The four reads: when they fire, when they do not, and what they are allowed to show while a
 * different pack is loading (#138 §9.4–§9.7).
 *
 * The adapter is mocked, so nothing here re-proves a request shape — `contentPacksApi.test.ts`
 * owns that. What is proved here is the behaviour a request shape cannot express: the guards, the
 * ordering pass-through, and the fact that a route transition cannot paint the previous pack.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContentPackDto } from '../adapters/contentPacksApi';
import { isNotFoundError, retryUnlessNotFound } from './contentPackErrors';
import {
    createTestQueryClient,
    mountHook,
    settle,
    unmountAll
} from '../testing/harness';

vi.stubGlobal('__WEBPACK_SERVE__', false);

const apiState: { reefinApi?: unknown; user?: { Id?: string } } = {};
vi.mock('hooks/useApi', () => ({ useApi: () => apiState }));

const adapter = {
    fetchContentPacks: vi.fn(),
    fetchContentPack: vi.fn(),
    fetchContentPackItems: vi.fn(),
    fetchContentPacksForItem: vi.fn()
};

vi.mock('../adapters/contentPacksApi', () => ({
    fetchContentPacks: (...args: unknown[]) =>
        adapter.fetchContentPacks(...args),
    fetchContentPack: (...args: unknown[]) => adapter.fetchContentPack(...args),
    fetchContentPackItems: (...args: unknown[]) =>
        adapter.fetchContentPackItems(...args),
    fetchContentPacksForItem: (...args: unknown[]) =>
        adapter.fetchContentPacksForItem(...args)
}));

const queries = await import('./useContentPackQueries');

const PACK_A = 'pack-a';
const PACK_B = 'pack-b';
const PAGE = { startIndex: 0, limit: 50 };

const SERVER_ORDER: ContentPackDto[] = [
    { Id: 'z', Name: 'Zulu', SortOrder: 0, VisibleItemCount: 4 },
    { Id: 'a', Name: 'Alpha', SortOrder: 1, VisibleItemCount: 11 },
    { Id: 'm', Name: 'Mike', SortOrder: 2, VisibleItemCount: 0 }
];

beforeEach(() => {
    apiState.reefinApi = {};
    apiState.user = { Id: 'user-1' };
    adapter.fetchContentPacks.mockResolvedValue(SERVER_ORDER);
    adapter.fetchContentPack.mockResolvedValue({
        Id: PACK_A,
        Name: 'Pack A',
        VisibleItemCount: 4
    });
    adapter.fetchContentPackItems.mockResolvedValue({
        items: [],
        totalRecordCount: 0,
        startIndex: 0
    });
    adapter.fetchContentPacksForItem.mockResolvedValue([]);
});

afterEach(() => {
    unmountAll();
    vi.clearAllMocks();
});

/** Mount one hook and hand back its latest result object. */
const observe = async <T,>(useHook: () => T): Promise<{ latest: () => T }> => {
    let latest: T;
    const Consumer = () => {
        latest = useHook();
        return null;
    };
    mountHook(<Consumer />);
    await settle(4);
    return { latest: () => latest };
};

describe('nothing is requested before the state it needs exists', () => {
    it('holds the pack list until there is an api client and a user', async () => {
        apiState.reefinApi = undefined;
        await observe(() => queries.useContentPacks());
        expect(adapter.fetchContentPacks).not.toHaveBeenCalled();

        apiState.reefinApi = {};
        apiState.user = {};
        await observe(() => queries.useContentPacks());
        expect(adapter.fetchContentPacks).not.toHaveBeenCalled();

        apiState.user = { Id: 'user-1' };
        await observe(() => queries.useContentPacks());
        expect(adapter.fetchContentPacks).toHaveBeenCalledTimes(1);
    });

    it('holds the pack detail until a pack id exists', async () => {
        await observe(() => queries.useContentPack(undefined));
        expect(adapter.fetchContentPack).not.toHaveBeenCalled();

        await observe(() => queries.useContentPack(PACK_A));
        expect(adapter.fetchContentPack).toHaveBeenCalledTimes(1);
    });

    it('holds the item pages until a pack id exists', async () => {
        await observe(() => queries.useContentPackItems(undefined, PAGE));
        expect(adapter.fetchContentPackItems).not.toHaveBeenCalled();
    });

    it('lets a hidden surface switch its own query off entirely', async () => {
        await observe(() =>
            queries.useContentPackItems(PACK_A, PAGE, { enabled: false })
        );
        expect(adapter.fetchContentPackItems).not.toHaveBeenCalled();

        await observe(() =>
            queries.useContentPacksForItem('item-1', { enabled: false })
        );
        expect(adapter.fetchContentPacksForItem).not.toHaveBeenCalled();

        await observe(() => queries.useContentPacksForItem('item-1'));
        expect(adapter.fetchContentPacksForItem).toHaveBeenCalledTimes(1);
    });
});

describe('the server owns the answer', () => {
    it('returns the pack list in the exact order the server sent, unsorted and unfiltered', async () => {
        const { latest } = await observe(() => queries.useContentPacks());

        expect(latest().data).toEqual(SERVER_ORDER);
        expect(latest().data?.map((pack) => pack.Id)).toEqual(['z', 'a', 'm']);
    });

    it('passes VisibleItemCount through untouched, including a zero', async () => {
        const { latest } = await observe(() => queries.useContentPacks());

        expect(latest().data?.map((pack) => pack.VisibleItemCount)).toEqual([
            4, 11, 0
        ]);
    });

    it('distinguishes an empty list from a pending one', async () => {
        adapter.fetchContentPacks.mockResolvedValue([]);
        const { latest } = await observe(() => queries.useContentPacks());

        expect(latest().isPending).toBe(false);
        expect(latest().isSuccess).toBe(true);
        expect(latest().data).toEqual([]);
    });
});

describe('a stale pack cannot paint over the active route', () => {
    it('shows no items at all while a DIFFERENT pack loads', async () => {
        const pages: Record<string, { items: { Id: string }[] }> = {
            [PACK_A]: { items: [{ Id: 'a1' }] },
            [PACK_B]: { items: [{ Id: 'b1' }] }
        };
        adapter.fetchContentPackItems.mockImplementation(
            (_api: unknown, query: { packId: string }) =>
                Promise.resolve({
                    ...pages[query.packId],
                    totalRecordCount: 1,
                    startIndex: 0
                })
        );

        const client = createTestQueryClient({ gcTime: Infinity });
        let packId = PACK_A;
        let latest: ReturnType<typeof queries.useContentPackItems>;
        const Consumer = () => {
            latest = queries.useContentPackItems(packId, PAGE);
            return null;
        };

        const tree = mountHook(<Consumer />, client);
        await settle(4);
        expect(latest!.data?.items).toEqual([{ Id: 'a1' }]);

        // Re-render the SAME observer at pack B, with B's response still in flight — the exact
        // shape of a route transition, and the only shape in which a placeholder could leak.
        let resolveB: (value: unknown) => void = () => undefined;
        adapter.fetchContentPackItems.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveB = resolve;
                })
        );
        packId = PACK_B;
        // A FRESH element: re-rendering the identical element reference makes React bail out of the
        // update entirely, and the observer would never see the new argument.
        tree.rerender(<Consumer />);
        await settle(2);

        // The placeholder refuses to carry pack A's page across a change of pack.
        expect(latest!.data).toBeUndefined();
        expect(latest!.isPending).toBe(true);

        resolveB({ items: [{ Id: 'b1' }], totalRecordCount: 1, startIndex: 0 });
        await settle(4);
        expect(latest!.data?.items).toEqual([{ Id: 'b1' }]);
        tree.unmount();
    });

    it('DOES keep the current page while the next page of the SAME pack loads', async () => {
        adapter.fetchContentPackItems.mockResolvedValue({
            items: [{ Id: 'p1' }],
            totalRecordCount: 100,
            startIndex: 0
        });

        const client = createTestQueryClient({ gcTime: Infinity });
        let page = PAGE;
        let latest: ReturnType<typeof queries.useContentPackItems>;
        const Consumer = () => {
            latest = queries.useContentPackItems(PACK_A, page);
            return null;
        };

        const tree = mountHook(<Consumer />, client);
        await settle(4);
        expect(latest!.data?.items).toEqual([{ Id: 'p1' }]);

        let resolveNext: (value: unknown) => void = () => undefined;
        adapter.fetchContentPackItems.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveNext = resolve;
                })
        );
        page = { startIndex: 50, limit: 50 };
        // A FRESH element: re-rendering the identical element reference makes React bail out of the
        // update entirely, and the observer would never see the new argument.
        tree.rerender(<Consumer />);
        await settle(2);

        expect(latest!.data?.items).toEqual([{ Id: 'p1' }]);
        expect(latest!.isPlaceholderData).toBe(true);

        resolveNext({
            items: [{ Id: 'p2' }],
            totalRecordCount: 100,
            startIndex: 50
        });
        await settle(4);
        expect(latest!.data?.items).toEqual([{ Id: 'p2' }]);
        tree.unmount();
    });

    it('never shows the previous pack under a new pack heading', async () => {
        adapter.fetchContentPack.mockImplementation(
            (_api: unknown, requestedPackId: string) =>
                requestedPackId === PACK_A
                    ? Promise.resolve({ Id: PACK_A, Name: 'Pack A' })
                    : new Promise(() => undefined)
        );

        const client = createTestQueryClient({ gcTime: Infinity });
        let packId = PACK_A;
        let latest: ReturnType<typeof queries.useContentPack>;
        const Consumer = () => {
            latest = queries.useContentPack(packId);
            return null;
        };

        const tree = mountHook(<Consumer />, client);
        await settle(4);
        expect(latest!.data?.Name).toBe('Pack A');

        packId = PACK_B;
        // A FRESH element: re-rendering the identical element reference makes React bail out of the
        // update entirely, and the observer would never see the new argument.
        tree.rerender(<Consumer />);
        await settle(3);

        expect(latest!.data).toBeUndefined();
        tree.unmount();
    });
});

describe('a 404 is a final answer, not a transport failure', () => {
    const notFound = { response: { status: 404 } };

    it('is recognised wherever the status is carried', () => {
        expect(isNotFoundError(notFound)).toBe(true);
        expect(isNotFoundError({ status: 404 })).toBe(true);
        expect(isNotFoundError({ response: { status: 500 } })).toBe(false);
        expect(isNotFoundError(new Error('offline'))).toBe(false);
        expect(isNotFoundError(undefined)).toBe(false);
    });

    it('is never retried, while a transport failure is retried twice', () => {
        expect(retryUnlessNotFound(0, notFound)).toBe(false);
        expect(retryUnlessNotFound(0, { response: { status: 401 } })).toBe(
            false
        );
        expect(retryUnlessNotFound(0, new Error('offline'))).toBe(true);
        expect(retryUnlessNotFound(1, new Error('offline'))).toBe(true);
        expect(retryUnlessNotFound(2, new Error('offline'))).toBe(false);
    });

    it('fails the pack query at once, with the 404 available to the surface', async () => {
        adapter.fetchContentPack.mockRejectedValue(notFound);
        const { latest } = await observe(() => queries.useContentPack(PACK_A));

        expect(latest().isError).toBe(true);
        expect(isNotFoundError(latest().error)).toBe(true);
        // One attempt. A not-found pack is not asked for again.
        expect(adapter.fetchContentPack).toHaveBeenCalledTimes(1);
    });

    it('does NOT fail a transport error at once — it is still retrying, and it is not a 404', async () => {
        adapter.fetchContentPack.mockRejectedValue(new Error('offline'));
        const { latest } = await observe(() => queries.useContentPack(PACK_A));

        expect(latest().isError).toBe(false);
        expect(latest().failureCount).toBeGreaterThan(0);
        expect(isNotFoundError(latest().failureReason)).toBe(false);
    });
});

describe('two users, two authorized projections', () => {
    /*
     * The server answers each user with what THEY may see; the Web displays each answer exactly and
     * never reconciles the two. This fixture proves the CLIENT behaviour — that the two answers do
     * not share a cache entry and that neither is adjusted towards the other. It deliberately does
     * not reproduce the server's permission logic in TypeScript.
     */
    const PROJECTIONS: Record<string, ContentPackDto[]> = {
        'user-a': [
            {
                Id: 'shared',
                Name: 'Shared pack',
                VisibleItemCount: 7,
                RepresentativeItemId: 'item-visible-to-a'
            }
        ],
        'user-b': [
            {
                Id: 'shared',
                Name: 'Shared pack',
                VisibleItemCount: 1,
                RepresentativeItemId: null
            }
        ],
        'user-c': []
    };

    it('shows each user exactly the projection they were sent', async () => {
        adapter.fetchContentPacks.mockImplementation(() =>
            Promise.resolve(PROJECTIONS[apiState.user!.Id!])
        );
        const client = createTestQueryClient({ gcTime: Infinity });

        const seen: Record<string, ContentPackDto[] | undefined> = {};
        for (const userId of ['user-a', 'user-b', 'user-c']) {
            apiState.user = { Id: userId };
            let latest: ReturnType<typeof queries.useContentPacks>;
            const Consumer = () => {
                latest = queries.useContentPacks();
                return null;
            };
            const tree = mountHook(<Consumer />, client);
            await settle(4);
            seen[userId] = latest!.data;
            tree.unmount();
        }

        expect(seen['user-a']?.[0].VisibleItemCount).toBe(7);
        expect(seen['user-a']?.[0].RepresentativeItemId).toBe(
            'item-visible-to-a'
        );
        // User B's smaller count and absent artwork are displayed as sent — not raised towards A's,
        // not annotated, not explained.
        expect(seen['user-b']?.[0].VisibleItemCount).toBe(1);
        expect(seen['user-b']?.[0].RepresentativeItemId).toBeNull();
        // And a user the pack is invisible to simply has no pack.
        expect(seen['user-c']).toEqual([]);
    });

    it('keeps the two answers in separate cache entries', async () => {
        adapter.fetchContentPacks.mockImplementation(() =>
            Promise.resolve(PROJECTIONS[apiState.user!.Id!])
        );
        const client = createTestQueryClient({ gcTime: Infinity });

        apiState.user = { Id: 'user-a' };
        let latest: ReturnType<typeof queries.useContentPacks>;
        const Consumer = () => {
            latest = queries.useContentPacks();
            return null;
        };
        const a = mountHook(<Consumer />, client);
        await settle(4);
        a.unmount();

        apiState.user = { Id: 'user-b' };
        const b = mountHook(<Consumer />, client);
        await settle(4);

        // B's first paint is B's own request, never A's cached answer.
        expect(latest!.data?.[0].VisibleItemCount).toBe(1);
        expect(adapter.fetchContentPacks).toHaveBeenCalledTimes(2);
        b.unmount();
    });
});

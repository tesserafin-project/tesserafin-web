// @vitest-environment jsdom
/**
 * The exact invalidation/update frontier of the six writes (#138 §9.3, §9.18).
 *
 * Every assertion here is about the CACHE, not about the request: the request shapes are proved in
 * `adapters/contentPacksApi.test.ts`. What this suite protects is the property that is invisible in
 * a single file — that a successful write leaves no surface reading a value the write invalidated,
 * and that a FAILED write leaves the cache untouched rather than showing a name, an order, a
 * deletion or a membership the server never accepted.
 */
import { QueryClient } from '@tanstack/react-query';
import React, { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contentPackKeys } from './contentPackKeys';
import {
    createTestQueryClient,
    mountHook,
    settle,
    unmountAll
} from '../testing/harness';

vi.stubGlobal('__WEBPACK_SERVE__', false);

const USER = 'user-1';
const PACK = 'pack-1';
const OTHER_PACK = 'pack-2';
const ITEM = 'item-1';
const OTHER_ITEM = 'item-2';

vi.mock('hooks/useApi', () => ({
    useApi: () => ({ reefinApi: {}, user: { Id: USER } })
}));

const adapter = {
    createContentPack: vi.fn(),
    updateContentPack: vi.fn(),
    reorderContentPacks: vi.fn(),
    deleteContentPack: vi.fn(),
    addContentPackItem: vi.fn(),
    removeContentPackItem: vi.fn()
};

vi.mock('../adapters/contentPacksApi', () => ({
    createContentPack: (...args: unknown[]) =>
        adapter.createContentPack(...args),
    updateContentPack: (...args: unknown[]) =>
        adapter.updateContentPack(...args),
    reorderContentPacks: (...args: unknown[]) =>
        adapter.reorderContentPacks(...args),
    deleteContentPack: (...args: unknown[]) =>
        adapter.deleteContentPack(...args),
    addContentPackItem: (...args: unknown[]) =>
        adapter.addContentPackItem(...args),
    removeContentPackItem: (...args: unknown[]) =>
        adapter.removeContentPackItem(...args)
}));

const mutations = await import('./useContentPackMutations');

interface Spies {
    invalidated: unknown[][];
    removed: unknown[][];
    seeded: { key: unknown[]; value: unknown }[];
}

/** Record the three cache operations the frontier is made of, without stopping them happening. */
const instrument = (client: QueryClient): Spies => {
    const spies: Spies = { invalidated: [], removed: [], seeded: [] };

    /** The only part of a filter object this suite reads. */
    type RecordedFilters = { queryKey?: unknown[] } | undefined;

    const realInvalidate = client.invalidateQueries.bind(client);
    vi.spyOn(client, 'invalidateQueries').mockImplementation(((
        filters: RecordedFilters
    ) => {
        if (filters?.queryKey) spies.invalidated.push(filters.queryKey);
        return realInvalidate(filters as never);
    }) as typeof client.invalidateQueries);

    const realRemove = client.removeQueries.bind(client);
    vi.spyOn(client, 'removeQueries').mockImplementation(((
        filters: RecordedFilters
    ) => {
        if (filters?.queryKey) spies.removed.push(filters.queryKey);
        return realRemove(filters as never);
    }) as typeof client.removeQueries);

    const realSet = client.setQueryData.bind(client);
    vi.spyOn(client, 'setQueryData').mockImplementation(((
        key: unknown[],
        value: unknown
    ) => {
        spies.seeded.push({ key, value });
        return realSet(key as never, value as never);
    }) as typeof client.setQueryData);

    return spies;
};

const hasKey = (recorded: unknown[][], key: readonly unknown[]) =>
    recorded.some(
        (entry) =>
            entry.length === key.length &&
            entry.every((part, index) => Object.is(part, key[index]))
    );

/** Run one mutation to completion and hand back what it did to the cache. */
const runMutation = async <TArgs,>(
    useMutationHook: () => { mutate: (args: TArgs) => void },
    args: TArgs
): Promise<Spies> => {
    const client = createTestQueryClient();
    const spies = instrument(client);

    const Consumer = () => {
        const mutation = useMutationHook();
        /*
         * Fire exactly once. The mutation object has a new identity on every render, so an effect
         * that honestly depends on it would issue the write again on each one — and every
         * call-count assertion in this suite would stop meaning anything.
         */
        const fired = useRef(false);
        useEffect(() => {
            if (fired.current) return;
            fired.current = true;
            mutation.mutate(args);
        }, [mutation]);
        return null;
    };

    mountHook(<Consumer />, client);
    await settle(6);
    return spies;
};

beforeEach(() => {
    adapter.createContentPack.mockResolvedValue({
        Id: PACK,
        Name: 'Road trip'
    });
    adapter.updateContentPack.mockResolvedValue({
        Id: PACK,
        Name: 'Road trip 2'
    });
    adapter.reorderContentPacks.mockResolvedValue(undefined);
    adapter.deleteContentPack.mockResolvedValue(undefined);
    adapter.addContentPackItem.mockResolvedValue(undefined);
    adapter.removeContentPackItem.mockResolvedValue(undefined);
});

afterEach(() => {
    unmountAll();
    vi.clearAllMocks();
});

describe('create', () => {
    it('invalidates the pack list and seeds the created detail from the response', async () => {
        const spies = await runMutation(mutations.useCreateContentPack, {
            Name: 'Road trip'
        });

        expect(hasKey(spies.invalidated, contentPackKeys.list(USER))).toBe(
            true
        );
        expect(spies.seeded).toEqual([
            {
                key: contentPackKeys.detail(USER, PACK),
                value: { Id: PACK, Name: 'Road trip' }
            }
        ]);
    });

    it('seeds nothing when the server returned no identifier', async () => {
        adapter.createContentPack.mockResolvedValue({ Name: 'Road trip' });

        const spies = await runMutation(mutations.useCreateContentPack, {
            Name: 'Road trip'
        });

        expect(spies.seeded).toHaveLength(0);
        expect(hasKey(spies.invalidated, contentPackKeys.list(USER))).toBe(
            true
        );
    });
});

describe('update / rename', () => {
    it('touches the list and the SAME pack detail, and nothing else', async () => {
        const spies = await runMutation(mutations.useUpdateContentPack, {
            packId: PACK,
            body: { Name: 'Road trip 2' }
        });

        expect(hasKey(spies.invalidated, contentPackKeys.list(USER))).toBe(
            true
        );
        expect(
            hasKey(spies.invalidated, contentPackKeys.detail(USER, PACK))
        ).toBe(true);
        expect(
            hasKey(spies.invalidated, contentPackKeys.detail(USER, OTHER_PACK))
        ).toBe(false);
        expect(spies.removed).toHaveLength(0);
    });

    it('keys the seeded detail by the REQUESTED id, so a rename cannot re-key the cache', async () => {
        adapter.updateContentPack.mockResolvedValue({
            // A server that answered with a different identifier must not silently move the entry.
            Id: 'a-different-id',
            Name: 'Road trip 2'
        });

        const spies = await runMutation(mutations.useUpdateContentPack, {
            packId: PACK,
            body: { Name: 'Road trip 2' }
        });

        expect(spies.seeded).toHaveLength(1);
        expect(spies.seeded[0].key).toEqual(contentPackKeys.detail(USER, PACK));
    });
});

describe('reorder', () => {
    it('sends the whole ordering and then re-reads the list rather than assuming it', async () => {
        const spies = await runMutation(mutations.useReorderContentPacks, [
            OTHER_PACK,
            PACK
        ]);

        expect(adapter.reorderContentPacks).toHaveBeenCalledWith({}, [
            OTHER_PACK,
            PACK
        ]);
        expect(hasKey(spies.invalidated, contentPackKeys.list(USER))).toBe(
            true
        );
        // No local ordering is written: the order shown is the order the server reports.
        expect(spies.seeded).toHaveLength(0);
    });
});

describe('delete', () => {
    it('removes the deleted pack rather than refetching it, and invalidates every membership answer', async () => {
        const spies = await runMutation(mutations.useDeleteContentPack, PACK);

        expect(hasKey(spies.removed, contentPackKeys.detail(USER, PACK))).toBe(
            true
        );
        expect(
            hasKey(spies.removed, contentPackKeys.itemsForPack(USER, PACK))
        ).toBe(true);
        expect(hasKey(spies.invalidated, contentPackKeys.list(USER))).toBe(
            true
        );
        expect(
            hasKey(spies.invalidated, contentPackKeys.forItemAll(USER))
        ).toBe(true);
        // An invalidation of the deleted pack would refetch a 404 and paint a not-found surface.
        expect(
            hasKey(spies.invalidated, contentPackKeys.detail(USER, PACK))
        ).toBe(false);
    });

    it('drops the deleted pack out of the cache for real', async () => {
        const client = createTestQueryClient({ gcTime: Infinity });
        client.setQueryData(contentPackKeys.detail(USER, PACK), {
            Id: PACK,
            Name: 'Road trip'
        });
        client.setQueryData(contentPackKeys.detail(USER, OTHER_PACK), {
            Id: OTHER_PACK,
            Name: 'Keep me'
        });

        const Consumer = () => {
            const mutation = mutations.useDeleteContentPack();
            const fired = useRef(false);
            useEffect(() => {
                if (fired.current) return;
                fired.current = true;
                mutation.mutate(PACK);
            }, [mutation]);
            return null;
        };
        mountHook(<Consumer />, client);
        await settle(6);

        expect(
            client.getQueryData(contentPackKeys.detail(USER, PACK))
        ).toBeUndefined();
        expect(
            client.getQueryData(contentPackKeys.detail(USER, OTHER_PACK))
        ).toEqual({ Id: OTHER_PACK, Name: 'Keep me' });
    });
});

describe('membership', () => {
    const frontier = (spies: Spies) => ({
        detail: hasKey(spies.invalidated, contentPackKeys.detail(USER, PACK)),
        items: hasKey(
            spies.invalidated,
            contentPackKeys.itemsForPack(USER, PACK)
        ),
        forItem: hasKey(spies.invalidated, contentPackKeys.forItem(USER, ITEM)),
        list: hasKey(spies.invalidated, contentPackKeys.list(USER)),
        otherPackDetail: hasKey(
            spies.invalidated,
            contentPackKeys.detail(USER, OTHER_PACK)
        ),
        otherPackItems: hasKey(
            spies.invalidated,
            contentPackKeys.itemsForPack(USER, OTHER_PACK)
        ),
        otherItem: hasKey(
            spies.invalidated,
            contentPackKeys.forItem(USER, OTHER_ITEM)
        )
    });

    it('add touches the pack, its pages, the item and the list projection', async () => {
        const spies = await runMutation(mutations.useAddContentPackItem, {
            packId: PACK,
            itemId: ITEM
        });

        expect(frontier(spies)).toEqual({
            detail: true,
            items: true,
            forItem: true,
            list: true,
            otherPackDetail: false,
            otherPackItems: false,
            otherItem: false
        });
    });

    it('remove has the SAME frontier as add, and still touches no other pack', async () => {
        const spies = await runMutation(mutations.useRemoveContentPackItem, {
            packId: PACK,
            itemId: ITEM
        });

        expect(frontier(spies)).toEqual({
            detail: true,
            items: true,
            forItem: true,
            list: true,
            otherPackDetail: false,
            otherPackItems: false,
            otherItem: false
        });
    });

    it('never recomputes a visible count locally — nothing is written, only invalidated', async () => {
        const spies = await runMutation(mutations.useAddContentPackItem, {
            packId: PACK,
            itemId: ITEM
        });

        expect(spies.seeded).toHaveLength(0);
    });

    it('a repeated add is a plain success with the same frontier, not a pre-checked no-op', async () => {
        const first = await runMutation(mutations.useAddContentPackItem, {
            packId: PACK,
            itemId: ITEM
        });
        const second = await runMutation(mutations.useAddContentPackItem, {
            packId: PACK,
            itemId: ITEM
        });

        expect(adapter.addContentPackItem).toHaveBeenCalledTimes(2);
        expect(frontier(second)).toEqual(frontier(first));
    });
});

describe('a failed mutation changes nothing', () => {
    const failing = { response: { status: 500 } };

    it.each([
        [
            'update',
            () => mutations.useUpdateContentPack(),
            { packId: PACK, body: { Name: 'Road trip 2' } },
            adapter.updateContentPack
        ],
        [
            'reorder',
            () => mutations.useReorderContentPacks(),
            [OTHER_PACK, PACK],
            adapter.reorderContentPacks
        ],
        [
            'delete',
            () => mutations.useDeleteContentPack(),
            PACK,
            adapter.deleteContentPack
        ],
        [
            'add membership',
            () => mutations.useAddContentPackItem(),
            { packId: PACK, itemId: ITEM },
            adapter.addContentPackItem
        ],
        [
            'remove membership',
            () => mutations.useRemoveContentPackItem(),
            { packId: PACK, itemId: ITEM },
            adapter.removeContentPackItem
        ]
    ])(
        'leaves the cache untouched when %s fails',
        async (_name, hook, args, fn) => {
            (fn as ReturnType<typeof vi.fn>).mockRejectedValue(failing);

            const spies = await runMutation(hook as never, args as never);

            expect(spies.invalidated).toHaveLength(0);
            expect(spies.removed).toHaveLength(0);
            expect(spies.seeded).toHaveLength(0);
        }
    );

    it('keeps the pack in the cache when the delete fails', async () => {
        adapter.deleteContentPack.mockRejectedValue(failing);
        const client = createTestQueryClient({ gcTime: Infinity });
        client.setQueryData(contentPackKeys.detail(USER, PACK), {
            Id: PACK,
            Name: 'Road trip'
        });

        const Consumer = () => {
            const mutation = mutations.useDeleteContentPack();
            const fired = useRef(false);
            useEffect(() => {
                if (fired.current) return;
                fired.current = true;
                mutation.mutate(PACK);
            }, [mutation]);
            return null;
        };
        mountHook(<Consumer />, client);
        await settle(6);

        expect(client.getQueryData(contentPackKeys.detail(USER, PACK))).toEqual(
            {
                Id: PACK,
                Name: 'Road trip'
            }
        );
    });
});

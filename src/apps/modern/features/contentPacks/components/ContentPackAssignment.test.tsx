// @vitest-environment jsdom
/**
 * The Item Details assignment affordance (#138 §9.16, §9.17).
 *
 * The two properties that matter here cannot be read off the component: that adding an item to
 * several packs leaves the others alone, and that removing it from one does the same. Both are
 * asserted by watching the exact `(pack, item)` pairs the surface sends.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContentPackDto } from '../adapters/contentPacksApi';
import { mountRoute, settle, unmountAll } from '../testing/harness';

vi.stubGlobal('__WEBPACK_SERVE__', false);

vi.mock('lib/globalize', () => ({
    default: {
        translate: (key: string, ...args: unknown[]) =>
            args.length ? `${key}:${args.join(',')}` : key
    },
    translate: (key: string) => key
}));

vi.mock('hooks/useApi', () => ({
    useApi: () => ({ reefinApi: {}, user: { Id: 'user-1' } })
}));

const packsQuery = {
    data: undefined as ContentPackDto[] | undefined,
    isPending: false,
    isError: false
};
const membershipQuery = {
    data: undefined as ContentPackDto[] | undefined,
    isPending: false,
    isError: false
};
const forItemEnabled = vi.fn();

vi.mock('../api/useContentPackQueries', () => ({
    useContentPacks: () => packsQuery,
    useContentPacksForItem: (
        itemId: string | undefined,
        options?: { enabled?: boolean }
    ) => {
        forItemEnabled(itemId, options);
        return membershipQuery;
    }
}));

const addMutation = { mutate: vi.fn(), isPending: false, isError: false };
const removeMutation = { mutate: vi.fn(), isPending: false, isError: false };

vi.mock('../api/useContentPackMutations', () => ({
    useAddContentPackItem: () => addMutation,
    useRemoveContentPackItem: () => removeMutation
}));

const ContentPackAssignment = (await import('./ContentPackAssignment')).default;

const ITEM = 'item-1';
const ALL_PACKS: ContentPackDto[] = [
    { Id: 'pack-1', Name: 'First' },
    { Id: 'pack-2', Name: 'Second' },
    { Id: 'pack-3', Name: 'Third' }
];

beforeEach(() => {
    packsQuery.data = ALL_PACKS;
    packsQuery.isPending = false;
    packsQuery.isError = false;
    membershipQuery.data = [ALL_PACKS[1]];
    membershipQuery.isPending = false;
    membershipQuery.isError = false;
    addMutation.mutate = vi.fn();
    addMutation.isPending = false;
    addMutation.isError = false;
    removeMutation.mutate = vi.fn();
    removeMutation.isPending = false;
    removeMutation.isError = false;
    forItemEnabled.mockClear();
});

afterEach(() => {
    unmountAll();
    vi.clearAllMocks();
});

const render = async (open = true) => {
    const tree = mountRoute(
        <ContentPackAssignment
            open={open}
            itemId={ITEM}
            onClose={() => undefined}
        />
    );
    await settle(2);
    return tree;
};

const toggles = () => [
    ...document.querySelectorAll<HTMLInputElement>(
        '[data-content-packs="assign-toggle"]'
    )
];

describe('what the dialog shows', () => {
    it('lists every accessible pack, marking the ones the item is already in', async () => {
        await render();

        expect(
            toggles().map((input) => [
                input.getAttribute('data-pack-id'),
                input.checked
            ])
        ).toEqual([
            ['pack-1', false],
            ['pack-2', true],
            ['pack-3', false]
        ]);
    });

    it('names each toggle by what activating it will do', async () => {
        await render();
        const labels = toggles().map((input) =>
            input.getAttribute('aria-label')
        );

        expect(labels[0]).toBe('ContentPackAssignAdd: First');
        expect(labels[1]).toBe('ContentPackAssignRemove: Second');
    });

    it('issues no membership request while it is closed', async () => {
        await render(false);

        expect(forItemEnabled).toHaveBeenCalledWith(ITEM, { enabled: false });
    });

    it('shows a loading region rather than an empty list while the reads are pending', async () => {
        membershipQuery.isPending = true;
        membershipQuery.data = undefined;
        await render();

        expect(
            document.querySelector('[data-rf-slot="state-loading"]')
        ).not.toBeNull();
        expect(toggles()).toHaveLength(0);
    });

    it('shows an error region when either read fails', async () => {
        membershipQuery.isError = true;
        await render();

        expect(
            document.querySelector('[data-rf-slot="state-error"]')
        ).not.toBeNull();
    });

    it('says so when the user has no packs at all', async () => {
        packsQuery.data = [];
        membershipQuery.data = [];
        await render();

        expect(document.body.textContent).toContain('MessageNoContentPacks');
    });
});

describe('multi-pack add and remove', () => {
    it('adds to several packs, one exact (pack, item) pair at a time', async () => {
        await render();
        toggles()[0].click();
        toggles()[2].click();

        expect(addMutation.mutate.mock.calls).toEqual([
            [{ packId: 'pack-1', itemId: ITEM }],
            [{ packId: 'pack-3', itemId: ITEM }]
        ]);
        // Nothing was removed on the way.
        expect(removeMutation.mutate).not.toHaveBeenCalled();
    });

    it('removes from one pack without naming any other', async () => {
        membershipQuery.data = [ALL_PACKS[0], ALL_PACKS[1], ALL_PACKS[2]];
        await render();
        toggles()[1].click();

        expect(removeMutation.mutate.mock.calls).toEqual([
            [{ packId: 'pack-2', itemId: ITEM }]
        ]);
        expect(addMutation.mutate).not.toHaveBeenCalled();
    });

    it('sends a plain add for a pack it is already in, with no pre-check', async () => {
        // A repeated add is a successful no-op at the server (composite uniqueness on the pair), so
        // the surface neither guards it nor asks first.
        membershipQuery.data = [];
        await render();
        toggles()[1].click();
        toggles()[1].click();

        expect(addMutation.mutate.mock.calls).toEqual([
            [{ packId: 'pack-2', itemId: ITEM }],
            [{ packId: 'pack-2', itemId: ITEM }]
        ]);
    });
});

describe('pending and failure state', () => {
    it('disables the toggles and announces the write while one is in flight', async () => {
        addMutation.isPending = true;
        await render();

        expect(toggles().every((input) => input.disabled)).toBe(true);
        expect(
            document
                .querySelector('[data-content-packs="assign-pending"]')
                ?.getAttribute('role')
        ).toBe('status');
    });

    it('surfaces a failed write as an alert instead of a silent no-op', async () => {
        removeMutation.isError = true;
        await render();

        const alert = document.querySelector(
            '[data-content-packs="assign-error"]'
        );
        expect(alert?.getAttribute('role')).toBe('alert');
    });

    it('never writes a membership locally — the checked state is the server answer', async () => {
        await render();
        const [first] = toggles();
        first.click();
        await settle(2);

        // The mutation was sent; the checkbox still reflects `getContentPacksForItem`, which has
        // not answered again yet. Nothing optimistic was painted.
        expect(addMutation.mutate).toHaveBeenCalledTimes(1);
        expect(toggles()[0].checked).toBe(false);
    });
});

// @vitest-environment jsdom
/**
 * The manager surface: the capability gate, the exact reorder behaviour, the delete confirmation's
 * full scope, and what a failed write is allowed to leave on screen (#138 §9.11–§9.14, §9.18).
 *
 * The mutations are mocked at the hook boundary — their cache frontier is proved in
 * `api/useContentPackMutations.test.tsx`, and re-proving it here would only couple this suite to
 * that one. What is proved here is the payload each control sends and the state the UI is left in.
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

const apiState: {
    reefinApi?: unknown;
    user?: { Id?: string; Policy?: Record<string, unknown> };
} = {};
vi.mock('hooks/useApi', () => ({ useApi: () => apiState }));

const makeMutation = () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null as unknown
});

const createMutation = makeMutation();
const updateMutation = makeMutation();
const reorderMutation = makeMutation();
const deleteMutation = makeMutation();

vi.mock('../api/useContentPackMutations', () => ({
    useCreateContentPack: () => createMutation,
    useUpdateContentPack: () => updateMutation,
    useReorderContentPacks: () => reorderMutation,
    useDeleteContentPack: () => deleteMutation
}));

const ContentPackManagerBar = (await import('./ContentPackManagerBar')).default;

const PACKS: ContentPackDto[] = [
    { Id: 'pack-1', Name: 'First', VisibleItemCount: 1 },
    { Id: 'pack-2', Name: 'Second', VisibleItemCount: 2 },
    { Id: 'pack-3', Name: 'Third', VisibleItemCount: 3 }
];

const resetMutation = (mutation: ReturnType<typeof makeMutation>) => {
    mutation.mutate = vi.fn();
    mutation.reset = vi.fn();
    mutation.isPending = false;
    mutation.isError = false;
    mutation.error = null;
};

beforeEach(() => {
    apiState.reefinApi = {};
    apiState.user = {
        Id: 'user-1',
        Policy: { EnableContentPackManagement: true }
    };
    for (const mutation of [
        createMutation,
        updateMutation,
        reorderMutation,
        deleteMutation
    ]) {
        resetMutation(mutation);
    }
});

afterEach(() => {
    unmountAll();
    vi.clearAllMocks();
});

const render = async (packs = PACKS) => {
    const tree = mountRoute(<ContentPackManagerBar packs={packs} />);
    await settle(2);
    return tree;
};

const q = <T extends Element>(root: ParentNode, selector: string) =>
    root.querySelector<T>(selector);

/**
 * Type into a controlled input the way a user does.
 *
 * Assigning `.value` and dispatching `input` is not enough: React installs its own value tracker on
 * the element, sees the assigned value as already-current, and skips `onChange` entirely. Going
 * through the prototype's native setter is what makes the tracker notice.
 */
const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

/** A button inside the open MUI dialog, by its (identity-translated) label. */
const dialogButton = (label: string) => {
    const dialog = document.querySelector('[role="dialog"]');
    return [
        ...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    ].find((button) => button.textContent === label);
};
const qa = <T extends Element>(root: ParentNode, selector: string) => [
    ...root.querySelectorAll<T>(selector)
];

describe('the capability gate', () => {
    it('is exactly EnableContentPackManagement', async () => {
        for (const policy of [
            {},
            { EnableContentPackManagement: false },
            { IsAdministrator: true },
            { IsAdministrator: true, EnableContentPackManagement: false }
        ]) {
            apiState.user = { Id: 'user-1', Policy: policy };
            const { container, unmount } = await render();
            expect(
                q(container, '[data-content-packs="manager"]'),
                JSON.stringify(policy)
            ).toBeNull();
            unmount();
        }

        apiState.user = {
            Id: 'user-1',
            Policy: { EnableContentPackManagement: true }
        };
        const { container } = await render();
        expect(q(container, '[data-content-packs="manager"]')).not.toBeNull();
    });

    it('renders no affordance at all, rather than a disabled one', async () => {
        apiState.user = { Id: 'user-1', Policy: {} };
        const { container } = await render();

        expect(qa(container, 'button')).toHaveLength(0);
        expect(container.innerHTML).toBe('');
    });
});

describe('reorder', () => {
    it('disables the first pack’s move-up and the last pack’s move-down', async () => {
        const { container } = await render();
        const up = qa<HTMLButtonElement>(
            container,
            '[data-content-packs="move-up"]'
        );
        const down = qa<HTMLButtonElement>(
            container,
            '[data-content-packs="move-down"]'
        );

        expect(up.map((button) => button.disabled)).toEqual([
            true,
            false,
            false
        ]);
        expect(down.map((button) => button.disabled)).toEqual([
            false,
            false,
            true
        ]);
    });

    it('sends the WHOLE ordering, every id exactly once, for a move up', async () => {
        const { container } = await render();
        qa<HTMLButtonElement>(
            container,
            '[data-content-packs="move-up"]'
        )[2].click();

        expect(reorderMutation.mutate).toHaveBeenCalledWith([
            'pack-1',
            'pack-3',
            'pack-2'
        ]);
    });

    it('sends the WHOLE ordering for a move down', async () => {
        const { container } = await render();
        qa<HTMLButtonElement>(
            container,
            '[data-content-packs="move-down"]'
        )[0].click();

        expect(reorderMutation.mutate).toHaveBeenCalledWith([
            'pack-2',
            'pack-1',
            'pack-3'
        ]);
    });

    it('is reachable from the keyboard: the controls are real buttons in an ordered list', async () => {
        const { container } = await render();
        const list = q(container, '[data-content-packs="manage-list"]');

        expect(list?.tagName).toBe('OL');
        for (const button of qa(container, '[data-content-packs="move-up"]')) {
            expect(button.tagName).toBe('BUTTON');
            expect(button.getAttribute('type')).toBe('button');
            // Named per pack, so a screen reader says WHICH pack is being moved.
            expect(button.getAttribute('aria-label')).toContain(
                'ContentPackMoveUp'
            );
        }
    });

    it('keeps focus on the pack that moved, not on the position it moved into', async () => {
        const { container, rerender } = await render();
        qa<HTMLButtonElement>(
            container,
            '[data-content-packs="move-up"]'
        )[2].click();

        // The server answers, the list arrives reordered, and the component re-renders.
        const reordered = [PACKS[0], PACKS[2], PACKS[1]];
        rerender(<ContentPackManagerBar packs={reordered} />);
        await settle(2);

        const focused = document.activeElement;
        expect(focused?.getAttribute('aria-label')).toBe(
            'ContentPackMoveUp: Third'
        );
    });

    it('falls back to the sibling control when the moved pack lands at an end', async () => {
        const { container, rerender } = await render();
        qa<HTMLButtonElement>(
            container,
            '[data-content-packs="move-up"]'
        )[1].click();

        // `Second` is now first, so its move-up is disabled and cannot hold focus.
        const reordered = [PACKS[1], PACKS[0], PACKS[2]];
        rerender(<ContentPackManagerBar packs={reordered} />);
        await settle(2);

        expect(document.activeElement?.getAttribute('aria-label')).toBe(
            'ContentPackMoveDown: Second'
        );
    });

    it('surfaces a failed reorder instead of leaving a false order on screen', async () => {
        reorderMutation.isError = true;
        const { container } = await render();

        const alert = q(container, '[data-content-packs="reorder-error"]');
        expect(alert?.getAttribute('role')).toBe('alert');
        // The list still shows the SERVER order — nothing was reordered locally.
        expect(
            qa(container, '[data-content-packs="manage-name"]').map(
                (node) => node.textContent
            )
        ).toEqual(['First', 'Second', 'Third']);
    });
});

describe('create and rename', () => {
    const openDialog = async (selector: string) => {
        const tree = await render();
        q<HTMLButtonElement>(tree.container, selector)?.click();
        await settle(2);
        return tree;
    };

    const dialogForm = () =>
        document.querySelector<HTMLFormElement>('[data-content-packs="form"]');

    it('refuses a whitespace-only name without spending a request', async () => {
        await openDialog('[data-content-packs="create"]');
        const form = dialogForm()!;
        const name = form.querySelector<HTMLInputElement>('input')!;

        type(name, '   ');
        await settle(1);
        form.requestSubmit();
        await settle(1);

        expect(createMutation.mutate).not.toHaveBeenCalled();
        expect(
            form.querySelector('[data-content-packs="form-error"]')?.textContent
        ).toBe('MessageContentPackNameRequired');
    });

    it('trims the submitted name and sends an absent description as null', async () => {
        await openDialog('[data-content-packs="create"]');
        const form = dialogForm()!;
        const name = form.querySelector<HTMLInputElement>('input')!;

        type(name, '  Road trip  ');
        await settle(1);
        form.requestSubmit();
        await settle(1);

        expect(createMutation.mutate).toHaveBeenCalledWith(
            { Name: 'Road trip', Description: null },
            expect.anything()
        );
    });

    it('shows the duplicate-name message for a 409 and the generic one otherwise', async () => {
        createMutation.error = { response: { status: 409 } };
        const first = await openDialog('[data-content-packs="create"]');
        expect(
            dialogForm()?.querySelector('[data-content-packs="form-error"]')
                ?.textContent
        ).toBe('MessageContentPackNameConflict');
        first.unmount();

        createMutation.error = { response: { status: 400 } };
        await openDialog('[data-content-packs="create"]');
        expect(
            dialogForm()?.querySelector('[data-content-packs="form-error"]')
                ?.textContent
        ).toBe('ErrorDefault');
    });

    it('seeds the rename form with THAT pack’s current name', async () => {
        const tree = await render();
        qa<HTMLButtonElement>(
            tree.container,
            '[data-content-packs="rename"]'
        )[1].click();
        await settle(2);

        expect(dialogForm()?.querySelector('input')?.value).toBe('Second');
    });

    it('renames by pack id, so the identity and therefore the route are unchanged', async () => {
        const tree = await render();
        qa<HTMLButtonElement>(
            tree.container,
            '[data-content-packs="rename"]'
        )[1].click();
        await settle(2);

        const form = dialogForm()!;
        const name = form.querySelector<HTMLInputElement>('input')!;
        type(name, 'Renamed');
        await settle(1);
        form.requestSubmit();
        await settle(1);

        expect(updateMutation.mutate).toHaveBeenCalledWith(
            { packId: 'pack-2', body: { Name: 'Renamed', Description: null } },
            expect.anything()
        );
    });

    it('disables submit while the write is in flight', async () => {
        createMutation.isPending = true;
        await openDialog('[data-content-packs="create"]');

        const submit = dialogForm()?.querySelector<HTMLButtonElement>(
            'button[type="submit"]'
        );
        expect(submit?.disabled).toBe(true);
    });

    it('restores focus to the control that opened the dialog when it closes', async () => {
        const tree = await render();
        const renameButton = qa<HTMLButtonElement>(
            tree.container,
            '[data-content-packs="rename"]'
        )[0];
        renameButton.click();
        await settle(2);

        dialogButton('ButtonCancel')?.click();
        await settle(2);

        expect(document.activeElement).toBe(renameButton);
    });
});

describe('delete', () => {
    const openDelete = async (index = 0) => {
        const tree = await render();
        qa<HTMLButtonElement>(tree.container, '[data-content-packs="delete"]')[
            index
        ].click();
        await settle(2);
        return tree;
    };

    it('names the pack it is about to delete', async () => {
        await openDelete(1);

        expect(
            document.querySelector('[data-content-packs="delete-target"]')
                ?.textContent
        ).toBe('Second');
    });

    it('states every fact the scope requires, in the confirmation itself', async () => {
        await openDelete();
        const scope = document.querySelector(
            '[data-content-packs="delete-scope"]'
        )?.textContent;

        expect(scope).toBe('ContentPackDeleteScope');
    });

    it('confirms with the pack id', async () => {
        await openDelete(2);
        dialogButton('Delete')?.click();

        expect(deleteMutation.mutate).toHaveBeenCalledWith(
            'pack-3',
            expect.anything()
        );
    });

    it('stays open and truthful when the delete fails', async () => {
        deleteMutation.isError = true;
        const { container } = await openDelete();

        expect(
            document.querySelector('[data-content-packs="delete-error"]')
        ).not.toBeNull();
        // The pack is still there, in the list, unchanged.
        expect(
            qa(container, '[data-content-packs="manage-name"]').map(
                (node) => node.textContent
            )
        ).toEqual(['First', 'Second', 'Third']);
    });
});

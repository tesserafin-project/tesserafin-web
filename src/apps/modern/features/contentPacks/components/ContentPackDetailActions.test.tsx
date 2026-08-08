// @vitest-environment jsdom
/**
 * Management FROM the detail route (#138 §7): rename the pack being viewed, delete the pack being
 * viewed, and the exact things each is required to leave alone.
 *
 * The mutations are mocked at the hook boundary, as in `ContentPackManagerBar.test.tsx` — their
 * cache frontier is proved in `api/useContentPackMutations.test.tsx`. What is proved here is that
 * this surface sends the same payloads through the same mutations, and what happens to the ROUTE:
 * a rename must not touch it, a successful delete must leave it, and a failed delete must not.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';

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

interface MutateOptions {
    onSuccess?: (result: unknown, variables: unknown) => void;
}

const makeMutation = () => ({
    mutate: vi.fn() as unknown as (
        variables: unknown,
        options?: MutateOptions
    ) => void,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null as unknown
});

const updateMutation = makeMutation();
const deleteMutation = makeMutation();

vi.mock('../api/useContentPackMutations', () => ({
    useUpdateContentPack: () => updateMutation,
    useDeleteContentPack: () => deleteMutation
}));

const ContentPackDetailActions = (await import('./ContentPackDetailActions'))
    .default;

const PACK: ContentPackDto = {
    Id: 'pack:opaque/id',
    Name: 'Sunday films',
    Description: 'Rainy afternoons',
    VisibleItemCount: 7,
    RepresentativeItemId: 'item-1'
};

/** The pathname and state the router is actually on, published for assertions. */
const observed: { pathname: string; state: unknown } = {
    pathname: '',
    state: null
};

const RouteProbe: React.FC<{ label: string }> = ({ label }) => {
    const location = useLocation();
    observed.pathname = location.pathname;
    observed.state = location.state;
    return <div data-probe={label}>{label}</div>;
};

const DetailRoute: React.FC<{ pack?: ContentPackDto }> = ({ pack = PACK }) => (
    <>
        <RouteProbe label='detail' />
        <ContentPackDetailActions pack={pack} />
    </>
);

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
    resetMutation(updateMutation);
    resetMutation(deleteMutation);
    observed.pathname = '';
    observed.state = null;
});

afterEach(() => {
    unmountAll();
    vi.clearAllMocks();
});

const DETAIL_PATH = `/contentpacks/${encodeURIComponent(PACK.Id ?? '')}`;

const render = async (pack: ContentPackDto = PACK) => {
    const tree = mountRoute(<RouteProbe label='list' />, {
        path: DETAIL_PATH,
        detailElement: <DetailRoute pack={pack} />
    });
    await settle(2);
    return tree;
};

const q = <T extends Element>(root: ParentNode, selector: string) =>
    root.querySelector<T>(selector);

const click = (node: Element | null | undefined) => {
    (node as HTMLElement | null)?.click();
};

const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const dialogButton = (label: string) => {
    const dialog = document.querySelector('[role="dialog"]');
    return [
        ...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    ].find((button) => button.textContent === label);
};

describe('the capability gate', () => {
    it('renders neither control without EnableContentPackManagement', async () => {
        apiState.user = { Id: 'user-1', Policy: {} };
        const { container } = await render();

        expect(
            q(container, '[data-content-packs="detail-manager"]')
        ).toBeNull();
        expect(q(container, '[data-content-packs="detail-rename"]')).toBeNull();
        expect(q(container, '[data-content-packs="detail-delete"]')).toBeNull();
        // The pack itself is still browsable — only the management surface is absent.
        expect(q(container, '[data-probe="detail"]')).not.toBeNull();
    });

    it('is not satisfied by IsAdministrator', async () => {
        apiState.user = {
            Id: 'user-1',
            Policy: {
                IsAdministrator: true,
                EnableContentPackManagement: false
            }
        };
        const { container } = await render();

        expect(
            q(container, '[data-content-packs="detail-manager"]')
        ).toBeNull();
    });

    it('draws both controls for a manager', async () => {
        const { container } = await render();

        expect(
            q(container, '[data-content-packs="detail-rename"]')
        ).not.toBeNull();
        expect(
            q(container, '[data-content-packs="detail-delete"]')
        ).not.toBeNull();
    });
});

describe('rename from the detail route', () => {
    it('sends the route parameter as the pack id, and the trimmed name', async () => {
        const { container } = await render();

        click(q(container, '[data-content-packs="detail-rename"]'));
        await settle(2);

        const input = document.querySelector<HTMLInputElement>(
            '[role="dialog"] input[name="contentPackName"]'
        );
        expect(input?.value).toBe('Sunday films');
        type(input!, '  Sunday classics  ');
        click(dialogButton('Save'));
        await settle(2);

        expect(updateMutation.mutate).toHaveBeenCalledTimes(1);
        const [variables] = (
            updateMutation.mutate as unknown as {
                mock: { calls: [{ packId: string; body: unknown }][] };
            }
        ).mock.calls[0];
        expect(variables).toEqual({
            packId: 'pack:opaque/id',
            body: { Name: 'Sunday classics', Description: 'Rainy afternoons' }
        });
    });

    it('leaves the URL and the opaque id untouched', async () => {
        const { container } = await render();
        const before = observed.pathname;

        click(q(container, '[data-content-packs="detail-rename"]'));
        await settle(2);
        const input = document.querySelector<HTMLInputElement>(
            '[role="dialog"] input[name="contentPackName"]'
        );
        type(input!, 'Another name');
        click(dialogButton('Save'));
        await settle(2);

        expect(observed.pathname).toBe(before);
        expect(observed.pathname).toBe(DETAIL_PATH);
        // The route parameter still decodes to the server's identifier, verbatim.
        expect(decodeURIComponent(observed.pathname.split('/')[2])).toBe(
            'pack:opaque/id'
        );
    });

    it('does not touch the delete mutation', async () => {
        const { container } = await render();

        click(q(container, '[data-content-packs="detail-rename"]'));
        await settle(2);
        click(dialogButton('Save'));
        await settle(2);

        expect(deleteMutation.mutate).not.toHaveBeenCalled();
    });

    it('shows the name-conflict message in the dialog and stays on the route', async () => {
        updateMutation.error = { status: 409 };
        const { container } = await render();

        click(q(container, '[data-content-packs="detail-rename"]'));
        await settle(2);

        expect(
            document.querySelector('[data-content-packs="form-error"]')
                ?.textContent
        ).toBe('MessageContentPackNameConflict');
        expect(observed.pathname).toBe(DETAIL_PATH);
    });

    it('returns focus to the rename control when the dialog is dismissed', async () => {
        const { container } = await render();
        const rename = q<HTMLButtonElement>(
            container,
            '[data-content-packs="detail-rename"]'
        );

        click(rename);
        await settle(2);
        click(dialogButton('ButtonCancel'));
        await settle(2);

        expect(document.activeElement).toBe(rename);
    });
});

describe('delete from the detail route', () => {
    it('shows the whole scope sentence, naming the pack', async () => {
        const { container } = await render();

        click(q(container, '[data-content-packs="detail-delete"]'));
        await settle(2);

        expect(
            document.querySelector('[data-content-packs="delete-target"]')
                ?.textContent
        ).toBe('Sunday films');
        expect(
            document.querySelector('[data-content-packs="delete-scope"]')
                ?.textContent
        ).toBe('ContentPackDeleteScope');
    });

    it('deletes the pack whose route this is', async () => {
        const { container } = await render();

        click(q(container, '[data-content-packs="detail-delete"]'));
        await settle(2);
        click(dialogButton('Delete'));
        await settle(2);

        expect(deleteMutation.mutate).toHaveBeenCalledTimes(1);
        const [packId] = (
            deleteMutation.mutate as unknown as {
                mock: { calls: [string][] };
            }
        ).mock.calls[0];
        expect(packId).toBe('pack:opaque/id');
    });

    it('returns to the list, replacing the deleted URL, and says which pack went', async () => {
        deleteMutation.mutate = vi.fn(
            (_variables: unknown, options?: MutateOptions) =>
                options?.onSuccess?.(undefined, _variables)
        ) as unknown as typeof deleteMutation.mutate;

        const { container } = await render();
        click(q(container, '[data-content-packs="detail-delete"]'));
        await settle(2);
        click(dialogButton('Delete'));
        await settle(4);

        expect(observed.pathname).toBe('/contentpacks');
        expect(observed.state).toEqual({ contentPackDeleted: 'Sunday films' });
        expect(container.querySelector('[data-probe="list"]')).not.toBeNull();
    });

    it('stays on the detail route when the delete fails', async () => {
        deleteMutation.mutate =
            vi.fn() as unknown as typeof deleteMutation.mutate;
        deleteMutation.isError = true;
        const { container } = await render();

        click(q(container, '[data-content-packs="detail-delete"]'));
        await settle(2);
        click(dialogButton('Delete'));
        await settle(2);

        expect(observed.pathname).toBe(DETAIL_PATH);
        // Truthful state: the dialog is still open, still naming the pack that still exists.
        expect(
            document.querySelector('[data-content-packs="delete-error"]')
                ?.textContent
        ).toBe('ErrorDefault');
        expect(
            document.querySelector('[data-content-packs="delete-target"]')
                ?.textContent
        ).toBe('Sunday films');
    });

    it('returns focus to the delete control when the confirmation is dismissed', async () => {
        const { container } = await render();
        const remove = q<HTMLButtonElement>(
            container,
            '[data-content-packs="detail-delete"]'
        );

        click(remove);
        await settle(2);
        click(dialogButton('ButtonCancel'));
        await settle(2);

        expect(document.activeElement).toBe(remove);
    });
});

describe('the exported navigation state', () => {
    it('recognises only its own shape', async () => {
        const { isContentPackDeletedState, CONTENT_PACKS_LIST_PATH } =
            await import('./ContentPackDetailActions');

        expect(CONTENT_PACKS_LIST_PATH).toBe('/contentpacks');
        expect(isContentPackDeletedState({ contentPackDeleted: 'x' })).toBe(
            true
        );
        expect(isContentPackDeletedState({ contentPackDeleted: 1 })).toBe(
            false
        );
        expect(isContentPackDeletedState(null)).toBe(false);
        expect(isContentPackDeletedState(undefined)).toBe(false);
        expect(isContentPackDeletedState({})).toBe(false);
    });
});

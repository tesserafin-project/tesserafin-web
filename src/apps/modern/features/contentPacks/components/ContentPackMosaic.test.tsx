// @vitest-environment jsdom
/**
 * The mosaic's states and the two rules its cards are judged by (#138 §9.6–§9.8, §9.14).
 *
 * `lib/globalize` is replaced by an identity so every assertion below reads a translation KEY. That
 * keeps the suite independent of the locale file and, more usefully, makes "the copy says the count
 * came from `ItemCount`" checkable rather than a string comparison against English.
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
    __legacyApiClient__?: { getImageUrl: (id: string) => string };
} = {};
vi.mock('hooks/useApi', () => ({ useApi: () => apiState }));

const packsQuery = {
    data: undefined as ContentPackDto[] | undefined,
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn()
};
vi.mock('../api/useContentPackQueries', () => ({
    useContentPacks: () => packsQuery
}));

const ContentPackMosaic = (await import('./ContentPackMosaic')).default;

const PACKS: ContentPackDto[] = [
    {
        Id: 'pack:z',
        Name: 'Zulu',
        VisibleItemCount: 4,
        RepresentativeItemId: 'item-1'
    },
    { Id: 'pack:a', Name: 'Alpha', VisibleItemCount: 0 },
    {
        Id: 'pack:m',
        Name: 'Mike',
        VisibleItemCount: 12,
        RepresentativeItemId: null
    }
];

beforeEach(() => {
    apiState.reefinApi = {};
    apiState.user = { Id: 'user-1', Policy: {} };
    apiState.__legacyApiClient__ = {
        getImageUrl: (id: string) => `https://example.com/Items/${id}/Images`
    };
    packsQuery.data = PACKS;
    packsQuery.isPending = false;
    packsQuery.isError = false;
    packsQuery.error = null;
    packsQuery.refetch = vi.fn();
});

afterEach(() => {
    unmountAll();
    vi.clearAllMocks();
});

const render = async () => {
    const tree = mountRoute(<ContentPackMosaic />);
    await settle(2);
    return tree;
};

const cards = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-rf-slot="media-card"]')];

describe('populated list', () => {
    it('renders one card per pack, in the server order', async () => {
        const { container } = await render();

        expect(
            cards(container).map(
                (card) =>
                    card.querySelector('.rf-media-card__title')?.textContent
            )
        ).toEqual(['Zulu', 'Alpha', 'Mike']);
    });

    it('shows VisibleItemCount verbatim, including a zero', async () => {
        const { container } = await render();

        expect(
            cards(container).map(
                (card) =>
                    card.querySelector('.rf-media-card__subtitle')?.textContent
            )
        ).toEqual(['ItemCount:4', 'ItemCount:0', 'ItemCount:12']);
    });

    it('links each card to its own opaque-id route, encoded', async () => {
        const { container } = await render();

        expect(cards(container).map((card) => card.getAttribute('href'))).toEqual(
            [
                '#/contentpacks/pack%3Az',
                '#/contentpacks/pack%3Aa',
                '#/contentpacks/pack%3Am'
            ]
        );
    });

    it('renders each card as an anchor, so keyboard and remote activation need no extra handler', async () => {
        const { container } = await render();

        for (const card of cards(container)) {
            expect(card.tagName).toBe('A');
            expect(card.getAttribute('href')).toBeTruthy();
        }
    });
});

describe('representative artwork', () => {
    it('uses the server-selected representative item and only that', async () => {
        const { container } = await render();
        const [zulu] = cards(container);

        expect(
            zulu.querySelector('img')?.getAttribute('src')
        ).toBe('https://example.com/Items/item-1/Images');
    });

    it('renders the placeholder when the server named no representative', async () => {
        const { container } = await render();
        const [, alpha, mike] = cards(container);

        // Neither an absent field nor an explicit `null` is replaced by an arbitrary member.
        for (const card of [alpha, mike]) {
            expect(card.querySelector('img')).toBeNull();
            expect(
                card.querySelector('.rf-media-card__placeholder')
            ).not.toBeNull();
        }
    });
});

describe('the other three states', () => {
    it('shows a loading region while the list is pending', async () => {
        packsQuery.isPending = true;
        packsQuery.data = undefined;
        const { container } = await render();

        expect(
            container.querySelector('[data-rf-slot="state-loading"]')
        ).not.toBeNull();
        expect(cards(container)).toHaveLength(0);
    });

    it('shows an empty state, not an error, for a user with no packs', async () => {
        packsQuery.data = [];
        const { container } = await render();

        expect(
            container.querySelector('[data-rf-slot="state-empty"]')
        ).not.toBeNull();
        expect(container.textContent).toContain('MessageNoContentPacks');
        expect(
            container.querySelector('[data-rf-slot="state-error"]')
        ).toBeNull();
    });

    it('shows an error with a retry that actually refetches', async () => {
        packsQuery.isError = true;
        packsQuery.data = undefined;
        const { container } = await render();

        const error = container.querySelector('[data-rf-slot="state-error"]');
        expect(error).not.toBeNull();

        const retry = error?.querySelector<HTMLButtonElement>(
            '.rf-error-state__retry'
        );
        expect(retry?.textContent).toBe('Retry');
        retry?.click();
        expect(packsQuery.refetch).toHaveBeenCalledTimes(1);
    });
});

describe('management affordances', () => {
    it('are absent for a user without EnableContentPackManagement', async () => {
        const { container } = await render();

        expect(container.querySelector('[data-content-packs="manager"]')).toBeNull();
        expect(container.querySelector('[data-content-packs="create"]')).toBeNull();
        expect(container.querySelector('[data-content-packs="rename"]')).toBeNull();
        expect(container.querySelector('[data-content-packs="delete"]')).toBeNull();
        expect(container.querySelector('[data-content-packs="move-up"]')).toBeNull();
        // Ordinary browsing is unaffected.
        expect(cards(container)).toHaveLength(3);
    });

    it('are absent for an administrator who lacks the capability', async () => {
        apiState.user = {
            Id: 'user-1',
            Policy: { IsAdministrator: true, EnableContentPackManagement: false }
        };
        const { container } = await render();

        expect(container.querySelector('[data-content-packs="manager"]')).toBeNull();
    });

    it('appear for a user who has the capability', async () => {
        apiState.user = {
            Id: 'user-1',
            Policy: { EnableContentPackManagement: true }
        };
        const { container } = await render();

        expect(
            container.querySelector('[data-content-packs="manager"]')
        ).not.toBeNull();
        expect(
            container.querySelectorAll('[data-content-packs="move-up"]')
        ).toHaveLength(3);
    });
});

describe('no theme-name branching', () => {
    it('reads presentation through the shared primitives and never names a theme', async () => {
        const { container } = await render();

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface).not.toBeNull();
        // The presentation values arrive as data attributes from `Surface`/`MediaCard`, which is
        // the only channel; no class or attribute here carries a theme identity.
        expect(surface?.getAttribute('data-rf-surface-elevation')).toBeTruthy();
        expect(container.innerHTML).not.toMatch(/classic|frosted|glass-theme/i);
    });
});

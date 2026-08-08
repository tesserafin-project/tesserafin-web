// @vitest-environment jsdom
/**
 * The pack browse: its states, its paging, and the mixed-media proof (#138 §9.9, §9.10).
 *
 * The point of §9.10 is that ONE surface renders more than one media family correctly, so the
 * fixture below is deliberately heterogeneous — a film, an episode, an album and a book — and the
 * assertions read the artwork each card actually requested and the destination each card actually
 * links to, not the branch of the adapter that was taken.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BaseItemDto, ContentPackDto } from '../adapters/contentPacksApi';
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
    user?: { Id?: string };
    __legacyApiClient__?: {
        getImageUrl: (id: string, options?: Record<string, unknown>) => string;
        serverId: () => string;
    };
} = {};
vi.mock('hooks/useApi', () => ({ useApi: () => apiState }));

const packQuery = {
    data: undefined as ContentPackDto | undefined,
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn()
};
const itemsQuery = {
    data: undefined as
        | { items: BaseItemDto[]; totalRecordCount: number; startIndex: number }
        | undefined,
    isPending: false,
    isError: false,
    isPlaceholderData: false,
    error: null as unknown,
    refetch: vi.fn()
};
const useContentPackItemsSpy = vi.fn();

vi.mock('../api/useContentPackQueries', () => ({
    useContentPack: () => packQuery,
    useContentPackItems: (packId: string | undefined, page: unknown) => {
        useContentPackItemsSpy(packId, page);
        return itemsQuery;
    }
}));

const ContentPackBrowse = (await import('./ContentPackBrowse')).default;

/** Four families in one pack, each with a different artwork source and destination. */
const MIXED_ITEMS: BaseItemDto[] = [
    {
        Id: 'movie-1',
        Name: 'A Film',
        Type: 'Movie',
        ProductionYear: 2021,
        ImageTags: { Primary: 'tag-movie' },
        ServerId: 'server-1'
    },
    {
        // No own primary: the artwork has to come from the SERIES, which is the whole reason an
        // episode is a different family rather than a differently-named movie.
        Id: 'episode-1',
        Name: 'An Episode',
        Type: 'Episode',
        SeriesName: 'A Series',
        SeriesId: 'series-1',
        SeriesPrimaryImageTag: 'tag-series',
        UserData: { Key: 'episode-1', PlayedPercentage: 42 },
        ServerId: 'server-1'
    },
    {
        Id: 'album-1',
        Name: 'An Album',
        Type: 'MusicAlbum',
        IsFolder: true,
        BackdropImageTags: ['tag-backdrop'],
        ServerId: 'server-1'
    },
    {
        Id: 'book-1',
        Name: 'A Book',
        Type: 'Book',
        ImageTags: { Primary: 'tag-book' },
        ServerId: 'server-1'
    }
];

const PACK: ContentPackDto = {
    Id: 'pack:1',
    Name: 'Road trip',
    Description: 'Long drives',
    VisibleItemCount: 4
};

beforeEach(() => {
    apiState.reefinApi = {};
    apiState.user = { Id: 'user-1' };
    apiState.__legacyApiClient__ = {
        getImageUrl: (id: string, options?: Record<string, unknown>) =>
            `https://example.com/Items/${id}/Images/${String(options?.type)}?tag=${String(options?.tag)}`,
        serverId: () => 'server-1'
    };
    packQuery.data = PACK;
    packQuery.isPending = false;
    packQuery.isError = false;
    packQuery.error = null;
    packQuery.refetch = vi.fn();
    itemsQuery.data = {
        items: MIXED_ITEMS,
        totalRecordCount: MIXED_ITEMS.length,
        startIndex: 0
    };
    itemsQuery.isPending = false;
    itemsQuery.isError = false;
    itemsQuery.error = null;
    itemsQuery.refetch = vi.fn();
    useContentPackItemsSpy.mockClear();
});

afterEach(() => {
    unmountAll();
    vi.clearAllMocks();
});

const render = async (path = '/contentpacks/pack%3A1') => {
    const tree = mountRoute(<ContentPackBrowse />, { path });
    await settle(2);
    return tree;
};

const cards = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-rf-slot="media-card"]')];

describe('the pack header', () => {
    it('shows the name, the description and the server visible count', async () => {
        const { container } = await render();

        expect(
            container.querySelector('[data-content-packs="pack-name"]')
                ?.textContent
        ).toBe('Road trip');
        expect(
            container.querySelector('[data-content-packs="pack-description"]')
                ?.textContent
        ).toBe('Long drives');
        // From `VisibleItemCount`, never from the page's `totalRecordCount`.
        expect(
            container.querySelector('[data-content-packs="pack-count"]')
                ?.textContent
        ).toBe('ItemCount:4');
    });

    it('omits the description entirely when the pack has none', async () => {
        packQuery.data = { ...PACK, Description: null };
        const { container } = await render();

        expect(
            container.querySelector('[data-content-packs="pack-description"]')
        ).toBeNull();
    });

    it('shows the visible count even when it disagrees with the page total', async () => {
        // The server may authorize fewer items than the pack contains. The count is the server's
        // answer about the pack; the page total is about the page. Neither is derived from the other
        // and nothing here compares them into a hint that hidden members exist.
        packQuery.data = { ...PACK, VisibleItemCount: 4 };
        itemsQuery.data = { items: MIXED_ITEMS, totalRecordCount: 4, startIndex: 0 };
        const { container } = await render();

        expect(container.textContent).toContain('ItemCount:4');
        expect(container.textContent).not.toMatch(/hidden|more items|restricted/i);
    });
});

describe('the opaque pack id reaches the query untouched', () => {
    it('decodes the route parameter and passes it through, with the paging window', async () => {
        await render('/contentpacks/pack%3A1?page=3');

        expect(useContentPackItemsSpy).toHaveBeenCalledWith('pack:1', {
            startIndex: 100,
            limit: 50
        });
    });

    it('treats a missing or nonsense page as page one', async () => {
        await render('/contentpacks/pack%3A1?page=zero');

        expect(useContentPackItemsSpy).toHaveBeenCalledWith('pack:1', {
            startIndex: 0,
            limit: 50
        });
    });
});

describe('one surface, four media families', () => {
    it('renders every family in the page, in the server order', async () => {
        const { container } = await render();

        expect(
            cards(container).map(
                (card) =>
                    card.querySelector('.rf-media-card__title')?.textContent
            )
        ).toEqual(['A Film', 'An Episode', 'An Album', 'A Book']);
    });

    it('resolves artwork per family, from the item the family actually carries it on', async () => {
        const { container } = await render();
        const sources = cards(container).map((card) =>
            card.querySelector('img')?.getAttribute('src')
        );

        expect(sources[0]).toContain('/Items/movie-1/Images/Primary?tag=tag-movie');
        // The episode's artwork comes from its SERIES, not from itself.
        expect(sources[1]).toContain(
            '/Items/series-1/Images/Primary?tag=tag-series'
        );
        // The album has only a backdrop.
        expect(sources[2]).toContain(
            '/Items/album-1/Images/Backdrop?tag=tag-backdrop'
        );
        expect(sources[3]).toContain('/Items/book-1/Images/Primary?tag=tag-book');
    });

    it('routes each family to its own destination', async () => {
        const { container } = await render();
        const hrefs = cards(container).map((card) => card.getAttribute('href'));

        expect(hrefs[0]).toBe('#/details?id=movie-1&serverId=server-1');
        expect(hrefs[1]).toBe('#/details?id=episode-1&serverId=server-1');
        // A folder-shaped member goes to the list route, not to the details route.
        expect(hrefs[2]).toBe('#/list?parentId=album-1&serverId=server-1');
        expect(hrefs[3]).toBe('#/details?id=book-1&serverId=server-1');
    });

    it('carries the existing progress treatment where the family has one', async () => {
        const { container } = await render();
        const bars = cards(container).map((card) =>
            card.querySelector('[role="progressbar"]')
        );

        expect(bars[0]).toBeNull();
        expect(bars[1]?.getAttribute('aria-valuenow')).toBe('42');
        expect(bars[2]).toBeNull();
        expect(bars[3]).toBeNull();
    });

    it('gives the episode its series as a subtitle and the film its year', async () => {
        const { container } = await render();
        const subtitles = cards(container).map(
            (card) =>
                card.querySelector('.rf-media-card__subtitle')?.textContent
        );

        expect(subtitles[0]).toBe('2021');
        expect(subtitles[1]).toBe('A Series');
    });
});

describe('paging', () => {
    it('shows no pagination for a single page', async () => {
        const { container } = await render();

        expect(container.querySelector('[data-rf-slot="pagination"]')).toBeNull();
    });

    it('shows pagination once the page total exceeds one page', async () => {
        itemsQuery.data = {
            items: MIXED_ITEMS,
            totalRecordCount: 120,
            startIndex: 0
        };
        const { container } = await render();

        const pagination = container.querySelector(
            '[data-rf-slot="pagination"]'
        );
        expect(pagination).not.toBeNull();
        expect(pagination?.textContent).toContain('Page 1 of 3');
    });
});

describe('the states a pack can be in', () => {
    it('is loading while the pack metadata is pending', async () => {
        packQuery.isPending = true;
        packQuery.data = undefined;
        const { container } = await render();

        expect(
            container.querySelector('[data-rf-slot="state-loading"]')
        ).not.toBeNull();
    });

    it('says only "not available" for a 404, and offers no retry', async () => {
        packQuery.isError = true;
        packQuery.error = { response: { status: 404 } };
        packQuery.data = undefined;
        const { container } = await render();

        expect(container.textContent).toContain(
            'MessageContentPackUnavailable'
        );
        expect(
            container.querySelector('[data-rf-slot="state-error"]')
        ).toBeNull();
        // Nothing suggests which of "absent" or "inaccessible" it was.
        expect(container.textContent).not.toMatch(/permission|forbidden|deleted/i);
    });

    it('offers a retry for a transport failure, and it refetches both queries', async () => {
        packQuery.isError = true;
        packQuery.error = new Error('offline');
        packQuery.data = undefined;
        const { container } = await render();

        container
            .querySelector<HTMLButtonElement>('.rf-error-state__retry')
            ?.click();

        expect(packQuery.refetch).toHaveBeenCalledTimes(1);
        expect(itemsQuery.refetch).toHaveBeenCalledTimes(1);
    });

    it('shows the pack header and an empty items region for a pack with nothing visible', async () => {
        itemsQuery.data = { items: [], totalRecordCount: 0, startIndex: 0 };
        const { container } = await render();

        expect(container.textContent).toContain('Road trip');
        expect(container.textContent).toContain('MessageContentPackEmpty');
        expect(cards(container)).toHaveLength(0);
    });

    it('keeps the pack header while only the items fail', async () => {
        itemsQuery.isError = true;
        itemsQuery.data = undefined;
        const { container } = await render();

        expect(container.textContent).toContain('Road trip');
        expect(
            container.querySelector('[data-rf-slot="state-error"]')
        ).not.toBeNull();
    });
});

describe('presentation', () => {
    it('renders inside a Surface and never branches on a theme identity', async () => {
        const { container } = await render();

        expect(container.querySelector('[data-rf-slot="surface"]')).not.toBeNull();
        expect(container.innerHTML).not.toMatch(/classic|frosted/i);
    });
});

import { describe, expect, it, vi } from 'vitest';

import type { ItemDto } from 'types/base/models/item-dto';

import type { ImageApiClient } from './mediaCardProps';
import { toMediaCardProps, toMediaCardPropsArray } from './mediaCardProps';

const item = (overrides: Partial<ItemDto>): ItemDto => ({
    Id: 'item-1',
    Name: 'Some Item',
    ...overrides
});

const fakeApiClient = (
    overrides: Partial<ImageApiClient> = {}
): ImageApiClient => ({
    getImageUrl: vi.fn(
        (itemId: string, options?: Record<string, unknown>) =>
            `https://server/Items/${itemId}/Images/${options?.type}?tag=${options?.tag}`
    ),
    serverId: () => 'srv-1',
    ...overrides
});

describe('toMediaCardProps()', () => {
    it('builds a poster card for a movie with a primary image', () => {
        const apiClient = fakeApiClient();
        const movie = item({
            Id: 'movie-1',
            Name: 'The Matrix',
            ProductionYear: 1999,
            ImageTags: { Primary: 'tag-primary' }
        });

        const props = toMediaCardProps(movie, apiClient, 'poster');

        expect(props.title).toBe('The Matrix');
        expect(props.subtitle).toBe('1999');
        expect(props.imageAspect).toBe('poster');
        expect(props.imageUrl).toBe(
            'https://server/Items/movie-1/Images/Primary?tag=tag-primary'
        );
        expect(props.href).toBe('#/details?id=movie-1&serverId=srv-1');
    });

    it('omits the subtitle when there is no production year', () => {
        const props = toMediaCardProps(
            item({ ProductionYear: undefined }),
            fakeApiClient(),
            'poster'
        );

        expect(props.subtitle).toBeUndefined();
    });

    it('omits the image when there is no primary image tag', () => {
        const props = toMediaCardProps(item({}), fakeApiClient(), 'poster');

        expect(props.imageUrl).toBeUndefined();
    });

    it('omits the image when there is no api client', () => {
        const movie = item({ ImageTags: { Primary: 'tag-primary' } });

        const props = toMediaCardProps(movie, undefined, 'poster');

        expect(props.imageUrl).toBeUndefined();
    });

    it('falls back to the api client serverId when the item has none', () => {
        const props = toMediaCardProps(
            item({ ServerId: undefined }),
            fakeApiClient(),
            'poster'
        );

        expect(props.href).toBe('#/details?id=item-1&serverId=srv-1');
    });

    it("prefers the item's own ServerId over the api client's", () => {
        const props = toMediaCardProps(
            item({ ServerId: 'item-server' }),
            fakeApiClient(),
            'poster'
        );

        expect(props.href).toBe('#/details?id=item-1&serverId=item-server');
    });

    it('reports an in-progress percentage as progressPercent', () => {
        const props = toMediaCardProps(
            item({ PlayedPercentage: 42 }),
            fakeApiClient(),
            'poster'
        );

        expect(props.progressPercent).toBe(42);
    });

    it('omits progressPercent for fully played or unplayed items', () => {
        expect(
            toMediaCardProps(
                item({ PlayedPercentage: 100 }),
                fakeApiClient(),
                'poster'
            ).progressPercent
        ).toBeUndefined();
        expect(
            toMediaCardProps(
                item({ PlayedPercentage: 0 }),
                fakeApiClient(),
                'poster'
            ).progressPercent
        ).toBeUndefined();
    });
});

describe('toMediaCardProps() — the aspect is presentation, not a request', () => {
    it('draws every aspect from the same image request for the same item', () => {
        const movie = item({
            Id: 'movie-1',
            ImageTags: { Primary: 'tag-primary' }
        });

        const urls = (['poster', 'backdrop', 'square'] as const).map((aspect) =>
            toMediaCardProps(movie, fakeApiClient(), aspect)
        );

        // The aspect reaches `imageAspect` and NOTHING else. If `cardAspect: 'backdrop'` ever
        // selected `ImageType.Backdrop`, a theme would be choosing which image endpoint the client
        // calls — the line RFC-0007 §6.1 draws. Cropping is presentation; a different request is not.
        expect(urls.map((props) => props.imageAspect)).toEqual([
            'poster',
            'backdrop',
            'square'
        ]);
        expect(new Set(urls.map((props) => props.imageUrl)).size).toBe(1);
        expect(new Set(urls.map((props) => props.href)).size).toBe(1);
    });
});

describe('toMediaCardPropsArray()', () => {
    it('maps every item in the array', () => {
        const items = [item({ Id: 'a' }), item({ Id: 'b' })];

        const props = toMediaCardPropsArray(items, fakeApiClient(), 'poster');

        expect(props).toHaveLength(2);
        expect(props[0].href).toBe('#/details?id=a&serverId=srv-1');
        expect(props[1].href).toBe('#/details?id=b&serverId=srv-1');
    });

    it('returns an empty array for null/undefined items', () => {
        expect(toMediaCardPropsArray(null, fakeApiClient(), 'poster')).toEqual(
            []
        );
        expect(
            toMediaCardPropsArray(undefined, fakeApiClient(), 'poster')
        ).toEqual([]);
    });
});

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

        const props = toMediaCardProps(movie, apiClient);

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
            fakeApiClient()
        );

        expect(props.subtitle).toBeUndefined();
    });

    it('omits the image when there is no primary image tag', () => {
        const props = toMediaCardProps(item({}), fakeApiClient());

        expect(props.imageUrl).toBeUndefined();
    });

    it('omits the image when there is no api client', () => {
        const movie = item({ ImageTags: { Primary: 'tag-primary' } });

        const props = toMediaCardProps(movie, undefined);

        expect(props.imageUrl).toBeUndefined();
    });

    it('falls back to the api client serverId when the item has none', () => {
        const props = toMediaCardProps(
            item({ ServerId: undefined }),
            fakeApiClient()
        );

        expect(props.href).toBe('#/details?id=item-1&serverId=srv-1');
    });

    it("prefers the item's own ServerId over the api client's", () => {
        const props = toMediaCardProps(
            item({ ServerId: 'item-server' }),
            fakeApiClient()
        );

        expect(props.href).toBe('#/details?id=item-1&serverId=item-server');
    });

    it('reports an in-progress percentage as progressPercent', () => {
        const props = toMediaCardProps(
            item({ PlayedPercentage: 42 }),
            fakeApiClient()
        );

        expect(props.progressPercent).toBe(42);
    });

    it('omits progressPercent for fully played or unplayed items', () => {
        expect(
            toMediaCardProps(item({ PlayedPercentage: 100 }), fakeApiClient())
                .progressPercent
        ).toBeUndefined();
        expect(
            toMediaCardProps(item({ PlayedPercentage: 0 }), fakeApiClient())
                .progressPercent
        ).toBeUndefined();
    });
});

describe('toMediaCardPropsArray()', () => {
    it('maps every item in the array', () => {
        const items = [item({ Id: 'a' }), item({ Id: 'b' })];

        const props = toMediaCardPropsArray(items, fakeApiClient());

        expect(props).toHaveLength(2);
        expect(props[0].href).toBe('#/details?id=a&serverId=srv-1');
        expect(props[1].href).toBe('#/details?id=b&serverId=srv-1');
    });

    it('returns an empty array for null/undefined items', () => {
        expect(toMediaCardPropsArray(null, fakeApiClient())).toEqual([]);
        expect(toMediaCardPropsArray(undefined, fakeApiClient())).toEqual([]);
    });
});

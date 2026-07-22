import { describe, expect, it, vi } from 'vitest';

import type { BaseItemDto } from 'lib/tesserafin-sdk';
import { CollectionType } from 'lib/tesserafin-sdk';

import {
    type ImageApiClient,
    getLatestMediaCardOptions,
    toMediaCardProps,
    toMediaCardPropsArray
} from './mediaCardProps';

const item = (overrides: Partial<BaseItemDto>): BaseItemDto => ({
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

        const props = toMediaCardProps(movie, apiClient, {
            imageAspect: 'poster'
        });

        expect(props.title).toBe('The Matrix');
        expect(props.subtitle).toBe('1999');
        expect(props.imageAspect).toBe('poster');
        expect(props.imageUrl).toBe(
            'https://server/Items/movie-1/Images/Primary?tag=tag-primary'
        );
        expect(props.href).toBe('#/details?id=movie-1&serverId=srv-1');
    });

    it('prefers the series name over the year for an episode subtitle', () => {
        const apiClient = fakeApiClient();
        const episode = item({
            Id: 'ep-1',
            Name: 'Pilot',
            SeriesName: 'Breaking Bad',
            ProductionYear: 2008
        });

        const props = toMediaCardProps(episode, apiClient, {
            imageAspect: 'backdrop'
        });

        expect(props.subtitle).toBe('Breaking Bad');
    });

    it('prefers a thumb image over the primary image when preferThumb is set', () => {
        const apiClient = fakeApiClient();
        const episode = item({
            Id: 'ep-1',
            ImageTags: { Primary: 'primary-tag', Thumb: 'thumb-tag' }
        });

        const props = toMediaCardProps(episode, apiClient, {
            imageAspect: 'backdrop',
            preferThumb: true
        });

        expect(props.imageUrl).toBe(
            'https://server/Items/ep-1/Images/Thumb?tag=thumb-tag'
        );
    });

    it('falls back to a series-inherited thumb image when the episode has none of its own', () => {
        const apiClient = fakeApiClient();
        const episode = item({
            Id: 'ep-1',
            SeriesId: 'series-1',
            SeriesThumbImageTag: 'series-thumb-tag'
        });

        const props = toMediaCardProps(episode, apiClient, {
            imageAspect: 'backdrop',
            preferThumb: true
        });

        expect(props.imageUrl).toBe(
            'https://server/Items/series-1/Images/Thumb?tag=series-thumb-tag'
        );
    });

    it('falls back to an item backdrop image when there is no primary/thumb tag', () => {
        const apiClient = fakeApiClient();
        const noPrimary = item({
            Id: 'item-1',
            BackdropImageTags: ['backdrop-tag']
        });

        const props = toMediaCardProps(noPrimary, apiClient, {
            imageAspect: 'backdrop'
        });

        expect(props.imageUrl).toBe(
            'https://server/Items/item-1/Images/Backdrop?tag=backdrop-tag'
        );
    });

    it('leaves imageUrl undefined when the item has no usable image tag', () => {
        const apiClient = fakeApiClient();
        const bare = item({ Id: 'item-1' });

        const props = toMediaCardProps(bare, apiClient, {
            imageAspect: 'poster'
        });

        expect(props.imageUrl).toBeUndefined();
    });

    it('leaves imageUrl undefined when there is no api client', () => {
        const withImage = item({
            Id: 'item-1',
            ImageTags: { Primary: 'tag' }
        });

        const props = toMediaCardProps(withImage, undefined, {
            imageAspect: 'poster'
        });

        expect(props.imageUrl).toBeUndefined();
    });

    it.each([
        [42, 42],
        [0, undefined],
        [100, undefined],
        [undefined, undefined]
    ])(
        'maps UserData.PlayedPercentage %s to progressPercent %s',
        (played, expected) => {
            const apiClient = fakeApiClient();
            const withProgress = item({
                Id: 'item-1',
                UserData:
                    played === undefined
                        ? undefined
                        : { Key: 'item-1', PlayedPercentage: played }
            });

            const props = toMediaCardProps(withProgress, apiClient, {
                imageAspect: 'backdrop'
            });

            expect(props.progressPercent).toBe(expected);
        }
    );

    /**
     * The activation, seen from `/home` (issue #15, L15b). A movies or tvshows tile now opens the
     * canonical four-destination route instead of the legacy per-type page. This assertion is the
     * guard on the one duplication this module knowingly carries: it re-implements
     * `appRouter.getRouteUrl()`'s library subset rather than importing the singleton, so if
     * `getRouteUrl` moves and this does not, `/home`'s cards would quietly point somewhere else
     * than every other entry point in the app.
     */
    it('routes a movies library tile to the canonical /library route', () => {
        const apiClient = fakeApiClient();
        const library = item({
            Id: 'lib-1',
            Name: 'Movies',
            CollectionType: CollectionType.Movies
        });

        const props = toMediaCardProps(library, apiClient, {
            imageAspect: 'backdrop'
        });

        expect(props.href).toBe('#/library/lib-1');
    });

    it('routes a tvshows library tile to the canonical /library route', () => {
        const apiClient = fakeApiClient();
        const library = item({
            Id: 'lib-tv',
            Name: 'Shows',
            CollectionType: CollectionType.Tvshows
        });

        const props = toMediaCardProps(library, apiClient, {
            imageAspect: 'backdrop'
        });

        expect(props.href).toBe('#/library/lib-tv');
    });

    it('leaves an unmigrated collection type on its dedicated page', () => {
        const apiClient = fakeApiClient();
        const library = item({
            Id: 'lib-music',
            Name: 'Music',
            CollectionType: CollectionType.Music
        });

        const props = toMediaCardProps(library, apiClient, {
            imageAspect: 'backdrop'
        });

        expect(props.href).toBe(
            '#/music?topParentId=lib-music&collectionType=music'
        );
    });

    it('routes a Live TV library tile to #/livetv', () => {
        const apiClient = fakeApiClient();
        const liveTv = item({
            Id: 'lib-2',
            CollectionType: CollectionType.Livetv
        });

        const props = toMediaCardProps(liveTv, apiClient, {
            imageAspect: 'backdrop'
        });

        expect(props.href).toBe('#/livetv?collectionType=livetv');
    });

    it('routes a home videos library tile without a collectionType query param', () => {
        const apiClient = fakeApiClient();
        const homevideos = item({
            Id: 'lib-3',
            CollectionType: CollectionType.Homevideos
        });

        const props = toMediaCardProps(homevideos, apiClient, {
            imageAspect: 'square'
        });

        expect(props.href).toBe('#/homevideos?topParentId=lib-3');
    });

    it('routes a mixed-content library folder to #/mixed', () => {
        const apiClient = fakeApiClient();
        const mixed = item({
            Id: 'lib-4',
            Type: 'CollectionFolder',
            IsFolder: true,
            CollectionType: undefined
        });

        const props = toMediaCardProps(mixed, apiClient, {
            imageAspect: 'backdrop'
        });

        expect(props.href).toBe(
            '#/mixed?topParentId=lib-4&collectionType=mixed'
        );
    });

    it('routes a generic folder without a dedicated page to #/list', () => {
        const apiClient = fakeApiClient();
        const folder = item({
            Id: 'folder-1',
            Type: 'Folder',
            IsFolder: true
        });

        const props = toMediaCardProps(folder, apiClient, {
            imageAspect: 'backdrop'
        });

        expect(props.href).toBe('#/list?parentId=folder-1&serverId=srv-1');
    });

    it('prefers the item ServerId over the api client fallback', () => {
        const apiClient = fakeApiClient();
        const withServerId = item({ Id: 'item-1', ServerId: 'own-server' });

        const props = toMediaCardProps(withServerId, apiClient, {
            imageAspect: 'poster'
        });

        expect(props.href).toBe('#/details?id=item-1&serverId=own-server');
    });
});

describe('toMediaCardPropsArray()', () => {
    it('returns an empty array for null/undefined input', () => {
        const apiClient = fakeApiClient();

        expect(
            toMediaCardPropsArray(undefined, apiClient, {
                imageAspect: 'poster'
            })
        ).toEqual([]);
        expect(
            toMediaCardPropsArray(null, apiClient, { imageAspect: 'poster' })
        ).toEqual([]);
    });

    it('maps every item to MediaCard props', () => {
        const apiClient = fakeApiClient();
        const items = [
            item({ Id: '1', Name: 'A' }),
            item({ Id: '2', Name: 'B' })
        ];

        const props = toMediaCardPropsArray(items, apiClient, {
            imageAspect: 'poster'
        });

        expect(props.map((p) => p.title)).toEqual(['A', 'B']);
    });
});

describe('getLatestMediaCardOptions()', () => {
    it('uses a poster aspect with no thumb preference for movies', () => {
        const options = getLatestMediaCardOptions(CollectionType.Movies);

        expect(options.imageAspect).toBe('poster');
        expect(options.preferThumb).toBe(false);
    });

    it('uses a poster aspect but keeps thumb preference for books', () => {
        const options = getLatestMediaCardOptions(CollectionType.Books);

        expect(options.imageAspect).toBe('poster');
        expect(options.preferThumb).toBe(true);
    });

    it('uses a square aspect for music and home videos', () => {
        expect(
            getLatestMediaCardOptions(CollectionType.Music).imageAspect
        ).toBe('square');
        expect(
            getLatestMediaCardOptions(CollectionType.Homevideos).imageAspect
        ).toBe('square');
    });

    it('falls back to a backdrop aspect with thumb preference when there is no collection type', () => {
        const options = getLatestMediaCardOptions(undefined);

        expect(options.imageAspect).toBe('backdrop');
        expect(options.preferThumb).toBe(true);
    });
});

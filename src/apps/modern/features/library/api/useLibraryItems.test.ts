import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { BaseItemKind, ItemSortBy, ReefinApi, SortOrder } from 'lib/reefin-sdk';

import {
    fetchLibraryItems,
    getLibraryItemsQueryKey,
    type LibraryItemsParams
} from './useLibraryItems';

// `useLibraryItems.ts` also exports the `useLibraryItems` hook, which imports `hooks/useApi` ->
// `lib/jellyfin-apiclient` -> `apphost.js` -> `scripts/settings/webSettings.js`, which reads
// `__WEBPACK_SERVE__` at module load time - a webpack `DefinePlugin` global that doesn't exist
// under vitest (same constraint `apps/modern/features/home/api/useUserViews.test.ts` works around).
// `fetchLibraryItems` itself never touches `useApi`, so stubbing it out here is enough to let the
// module load without pulling in that chain.
vi.mock('hooks/useApi', () => ({ useApi: () => ({}) }));

/**
 * Tests `fetchLibraryItems` in isolation against a `ReefinApi` built with a mocked axios instance -
 * same pattern as `apps/modern/features/home/api/useLatestMedia.test.ts`.
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): ReefinApi =>
    new ReefinApi(
        'https://example.com',
        { name: 'Reefin Web', version: '1.0.0' },
        { name: 'Test Device', id: 'device-1' },
        'test-token',
        { request, defaults: {} } as unknown as AxiosInstance
    );

const baseParams: LibraryItemsParams = {
    parentId: 'library-1',
    includeItemTypes: [BaseItemKind.Movie],
    sortBy: ItemSortBy.SortName,
    sortOrder: SortOrder.Ascending,
    startIndex: 0,
    limit: 50
};

describe('fetchLibraryItems()', () => {
    it('requests the library items route with the base movie params, auth header attached', async () => {
        const items = [{ Name: 'The Matrix' }];
        const request = vi.fn().mockResolvedValue({
            data: { Items: items, TotalRecordCount: 1, StartIndex: 0 }
        });
        const api = createMockApi(request);

        const result = await fetchLibraryItems(api, 'user-1', baseParams);

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                url: expect.stringContaining('/Items?'),
                method: 'GET',
                headers: expect.objectContaining({
                    Authorization: api.authorizationHeader
                })
            })
        );

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).toContain('parentId=library-1');
        expect(requestedUrl).toContain('includeItemTypes=Movie');
        expect(requestedUrl).toContain('recursive=true');
        expect(requestedUrl).toContain('sortBy=SortName');
        expect(requestedUrl).toContain('sortOrder=Ascending');
        expect(requestedUrl).toContain('startIndex=0');
        expect(requestedUrl).toContain('limit=50');
        expect(requestedUrl).not.toContain('genres=');
        expect(requestedUrl).not.toContain('years=');

        expect(result).toEqual({
            Items: items,
            TotalRecordCount: 1,
            StartIndex: 0
        });
    });

    it('includes tvshows params when requesting Series items', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', {
            ...baseParams,
            includeItemTypes: [BaseItemKind.Series],
            sortBy: ItemSortBy.CommunityRating,
            sortOrder: SortOrder.Descending
        });

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).toContain('includeItemTypes=Series');
        expect(requestedUrl).toContain('sortBy=CommunityRating');
        expect(requestedUrl).toContain('sortOrder=Descending');
    });

    it('includes a single genre filter when provided', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', {
            ...baseParams,
            genre: 'Action'
        });

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).toContain('genres=Action');
    });

    it('includes a single year filter when provided', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', { ...baseParams, year: 1999 });

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).toContain('years=1999');
    });

    it('requests the primary-image field/type with a 1-image limit', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', baseParams);

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).toContain('fields=PrimaryImageAspectRatio');
        expect(requestedUrl).toContain('enableImageTypes=Primary');
        expect(requestedUrl).toContain('imageTypeLimit=1');
    });

    // Each filter below is a *parameter of this one query* — which is the whole reason design §3.2
    // demotes Studios/Favorites from tabs to controls, and Episodes to a granularity. Asserting on
    // the emitted URL is what makes that claim checkable rather than merely stated.

    it('sends studioIds for the Studios filter (a predicate, not a destination)', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', {
            ...baseParams,
            studioIds: ['studio-a', 'studio-b']
        });

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).toContain('studioIds=studio-a');
        expect(requestedUrl).toContain('studio-b');
    });

    it('omits studioIds entirely when the filter is empty', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', {
            ...baseParams,
            studioIds: []
        });

        expect(request.mock.calls[0][0].url as string).not.toContain(
            'studioIds='
        );
    });

    it('sends isFavorite=true for the Favorites filter', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', {
            ...baseParams,
            isFavorite: true
        });

        expect(request.mock.calls[0][0].url as string).toContain(
            'isFavorite=true'
        );
    });

    it('omits isFavorite when off, rather than asking for non-favorites', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', {
            ...baseParams,
            isFavorite: false
        });

        expect(request.mock.calls[0][0].url as string).not.toContain(
            'isFavorite'
        );
    });

    it('requests Episode items at episodes granularity (same query, deeper)', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', {
            ...baseParams,
            includeItemTypes: [BaseItemKind.Episode]
        });

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).toContain('includeItemTypes=Episode');
        expect(requestedUrl).toContain('parentId=library-1');
    });

    it('sends nameStartsWith for an alphabetic AlphaPicker letter', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', { ...baseParams, letter: 'Q' });

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).toContain('nameStartsWith=Q');
        expect(requestedUrl).not.toContain('nameLessThan');
    });

    it('translates `#` to nameLessThan=A, matching utils/items.ts', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', { ...baseParams, letter: '#' });

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).toContain('nameLessThan=A');
        // `#` is not a prefix — sending it as one would return nothing.
        expect(requestedUrl).not.toContain('nameStartsWith');
    });

    it('sends no letter params when no letter is selected', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);

        await fetchLibraryItems(api, 'user-1', baseParams);

        const requestedUrl = request.mock.calls[0][0].url as string;
        expect(requestedUrl).not.toContain('nameStartsWith');
        expect(requestedUrl).not.toContain('nameLessThan');
    });

    it('forwards an abort signal when provided', async () => {
        const request = vi.fn().mockResolvedValue({ data: {} });
        const api = createMockApi(request);
        const signal = {} as AbortSignal;

        await fetchLibraryItems(api, 'user-1', baseParams, { signal });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ signal })
        );
    });
});

describe('getLibraryItemsQueryKey()', () => {
    it('accepts undefined params without throwing (initial renders, CollectionType still loading)', () => {
        expect(() =>
            getLibraryItemsQueryKey('user-1', undefined)
        ).not.toThrow();
        expect(getLibraryItemsQueryKey('user-1', undefined)).not.toEqual(
            getLibraryItemsQueryKey('user-1', baseParams)
        );
    });

    it('produces different keys for different parentIds', () => {
        const keyA = getLibraryItemsQueryKey('user-1', baseParams);
        const keyB = getLibraryItemsQueryKey('user-1', {
            ...baseParams,
            parentId: 'library-2'
        });

        expect(keyA).not.toEqual(keyB);
    });

    it('produces different keys for different sort/filter params', () => {
        const keyA = getLibraryItemsQueryKey('user-1', baseParams);
        const keyB = getLibraryItemsQueryKey('user-1', {
            ...baseParams,
            genre: 'Comedy'
        });

        expect(keyA).not.toEqual(keyB);
    });

    it('produces the same key for identical params', () => {
        const keyA = getLibraryItemsQueryKey('user-1', { ...baseParams });
        const keyB = getLibraryItemsQueryKey('user-1', { ...baseParams });

        expect(keyA).toEqual(keyB);
    });

    it('includes the userId so different users never share a cache entry', () => {
        const keyA = getLibraryItemsQueryKey('user-1', baseParams);
        const keyB = getLibraryItemsQueryKey('user-2', baseParams);

        expect(keyA).not.toEqual(keyB);
    });
});

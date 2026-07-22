import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { TesserafinApi } from 'lib/tesserafin-sdk';

import { fetchFavoriteItems } from './useFavoriteItems';

// See `useUserViews.test.ts` for why `hooks/useApi` has to be stubbed: `useFavoriteItems.ts` also
// exports the `useFavoriteItems` hook, which transitively pulls in a webpack-only global that
// doesn't exist under vitest. `fetchFavoriteItems` itself never touches `useApi`.
vi.mock('hooks/useApi', () => ({ useApi: () => ({}) }));

/**
 * Tests `fetchFavoriteItems` in isolation against a `TesserafinApi` built with a mocked axios instance
 * - per `playbackDiagnosticsApi.test.ts`'s pattern. See `useUserViews.test.ts` for why `defaults`
 * has to be present on the mock.
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): TesserafinApi =>
    new TesserafinApi(
        'https://example.com',
        { name: 'Reefin Web', version: '1.0.0' },
        { name: 'Test Device', id: 'device-1' },
        'test-token',
        { request, defaults: {} } as unknown as AxiosInstance
    );

describe('fetchFavoriteItems()', () => {
    it('requests the items route filtered to favorites, with the auth header attached', async () => {
        const items = [{ Name: 'Some Favorite' }];
        const request = vi.fn().mockResolvedValue({ data: { Items: items } });
        const api = createMockApi(request);

        const result = await fetchFavoriteItems(api, {
            userId: 'user-1',
            filters: ['IsFavorite'],
            recursive: true,
            includeItemTypes: ['Movie', 'Series'],
            limit: 20,
            sortBy: ['SortName']
        });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://example.com/Items?userId=user-1&limit=20&recursive=true&includeItemTypes=Movie&includeItemTypes=Series&filters=IsFavorite&sortBy=SortName',
                method: 'GET',
                headers: expect.objectContaining({
                    Authorization: api.authorizationHeader
                })
            })
        );
        expect(result).toEqual({ Items: items });
    });

    it('forwards an abort signal when provided', async () => {
        const request = vi.fn().mockResolvedValue({ data: { Items: [] } });
        const api = createMockApi(request);
        const signal = {} as AbortSignal;

        await fetchFavoriteItems(api, { userId: 'user-1' }, { signal });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ signal })
        );
    });
});

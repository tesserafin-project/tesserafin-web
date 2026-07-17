import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { ReefinApi } from 'lib/reefin-sdk';

import { fetchLatestMedia } from './useLatestMedia';

// See `useUserViews.test.ts` for why `hooks/useApi` has to be stubbed: `useLatestMedia.ts` also
// exports the `useLatestMedia` hook, which transitively pulls in a webpack-only global that
// doesn't exist under vitest. `fetchLatestMedia` itself never touches `useApi`.
vi.mock('hooks/useApi', () => ({ useApi: () => ({}) }));

/**
 * Tests `fetchLatestMedia` in isolation against a `ReefinApi` built with a mocked axios instance -
 * per `playbackDiagnosticsApi.test.ts`'s pattern. See `useUserViews.test.ts` for why `defaults`
 * has to be present on the mock.
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): ReefinApi =>
    new ReefinApi(
        'https://example.com',
        { name: 'Reefin Web', version: '1.0.0' },
        { name: 'Test Device', id: 'device-1' },
        'test-token',
        { request, defaults: {} } as unknown as AxiosInstance
    );

describe('fetchLatestMedia()', () => {
    it('requests the latest media route for the given library, with the auth header attached', async () => {
        const items = [{ Name: 'Some Movie' }];
        const request = vi.fn().mockResolvedValue({ data: items });
        const api = createMockApi(request);

        const result = await fetchLatestMedia(api, {
            userId: 'user-1',
            parentId: 'library-1',
            limit: 16
        });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://example.com/Items/Latest?userId=user-1&parentId=library-1&limit=16',
                method: 'GET',
                headers: expect.objectContaining({
                    Authorization: api.authorizationHeader
                })
            })
        );
        expect(result).toBe(items);
    });

    it('forwards an abort signal when provided', async () => {
        const request = vi.fn().mockResolvedValue({ data: [] });
        const api = createMockApi(request);
        const signal = {} as AbortSignal;

        await fetchLatestMedia(
            api,
            { userId: 'user-1', parentId: 'library-1' },
            { signal }
        );

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ signal })
        );
    });
});

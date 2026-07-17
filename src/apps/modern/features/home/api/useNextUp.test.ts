import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { ReefinApi } from 'lib/reefin-sdk';

import { fetchNextUp } from './useNextUp';

// See `useUserViews.test.ts` for why `hooks/useApi` has to be stubbed: `useNextUp.ts` also exports
// the `useNextUp` hook, which transitively pulls in a webpack-only global that doesn't exist under
// vitest. `fetchNextUp` itself never touches `useApi`.
vi.mock('hooks/useApi', () => ({ useApi: () => ({}) }));

/**
 * Tests `fetchNextUp` in isolation against a `ReefinApi` built with a mocked axios instance - per
 * `playbackDiagnosticsApi.test.ts`'s pattern. See `useUserViews.test.ts` for why `defaults` has to
 * be present on the mock.
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): ReefinApi =>
    new ReefinApi(
        'https://example.com',
        { name: 'Reefin Web', version: '1.0.0' },
        { name: 'Test Device', id: 'device-1' },
        'test-token',
        { request, defaults: {} } as unknown as AxiosInstance
    );

describe('fetchNextUp()', () => {
    it('requests the next up route with the given params, with the auth header attached', async () => {
        const items = [{ Name: 'Some Episode' }];
        const request = vi.fn().mockResolvedValue({ data: { Items: items } });
        const api = createMockApi(request);

        const result = await fetchNextUp(api, {
            userId: 'user-1',
            limit: 12
        });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://example.com/Shows/NextUp?userId=user-1&limit=12',
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

        await fetchNextUp(api, { userId: 'user-1' }, { signal });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ signal })
        );
    });
});

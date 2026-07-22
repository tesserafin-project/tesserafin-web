import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { TesserafinApi } from 'lib/tesserafin-sdk';

import { fetchResumeItems } from './useResumeItems';

// See `useUserViews.test.ts` for why `hooks/useApi` has to be stubbed: `useResumeItems.ts` also
// exports the `useResumeItems` hook, which transitively pulls in a webpack-only global that
// doesn't exist under vitest. `fetchResumeItems` itself never touches `useApi`.
vi.mock('hooks/useApi', () => ({ useApi: () => ({}) }));

/**
 * Tests `fetchResumeItems` in isolation against a `TesserafinApi` built with a mocked axios instance -
 * per `playbackDiagnosticsApi.test.ts`'s pattern. See `useUserViews.test.ts` for why `defaults` has
 * to be present on the mock.
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): TesserafinApi =>
    new TesserafinApi(
        'https://example.com',
        { name: 'Reefin Web', version: '1.0.0' },
        { name: 'Test Device', id: 'device-1' },
        'test-token',
        { request, defaults: {} } as unknown as AxiosInstance
    );

describe('fetchResumeItems()', () => {
    it('requests the resume items route with the given params, with the auth header attached', async () => {
        const items = [{ Name: 'Some Movie' }];
        const request = vi.fn().mockResolvedValue({ data: { Items: items } });
        const api = createMockApi(request);

        const result = await fetchResumeItems(api, {
            userId: 'user-1',
            mediaTypes: ['Video'],
            limit: 12,
            fields: ['PrimaryImageAspectRatio']
        });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://example.com/UserItems/Resume?userId=user-1&limit=12&fields=PrimaryImageAspectRatio&mediaTypes=Video',
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

        await fetchResumeItems(api, { userId: 'user-1' }, { signal });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ signal })
        );
    });
});

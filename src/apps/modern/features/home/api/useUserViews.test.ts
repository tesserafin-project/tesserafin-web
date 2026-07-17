import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { ReefinApi } from 'lib/reefin-sdk';

import { fetchUserViews } from './useUserViews';

// `useUserViews.ts` also exports the `useUserViews` hook, which imports `hooks/useApi` -> `lib/
// jellyfin-apiclient`'s `ServerConnections` -> `apphost.js` -> `scripts/settings/webSettings.js`,
// which reads `__WEBPACK_SERVE__` at module load time - a webpack `DefinePlugin` global that
// doesn't exist under vitest (same constraint `playbackDiagnosticDetail.contract.test.ts` works
// around for `lib/globalize`). `fetchUserViews` itself never touches `useApi`, so stubbing it out
// here is enough to let the module load without pulling in that chain.
vi.mock('hooks/useApi', () => ({ useApi: () => ({}) }));

/**
 * Tests `fetchUserViews` in isolation against a `ReefinApi` built with a mocked axios instance -
 * per `playbackDiagnosticsApi.test.ts`'s pattern. The generated `UserViewApi` class always
 * dispatches through `axiosInstance.request(...)` (`lib/reefin-sdk/generated/common.ts`'s
 * `createRequestFunction`), and reads `axios.defaults.baseURL` before doing so, so `defaults` has
 * to exist on the mock even though its value doesn't matter here.
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): ReefinApi =>
    new ReefinApi(
        'https://example.com',
        { name: 'Reefin Web', version: '1.0.0' },
        { name: 'Test Device', id: 'device-1' },
        'test-token',
        { request, defaults: {} } as unknown as AxiosInstance
    );

describe('fetchUserViews()', () => {
    it('requests the user views route for the given user, with the auth header attached', async () => {
        const items = [{ Name: 'Movies' }];
        const request = vi.fn().mockResolvedValue({ data: { Items: items } });
        const api = createMockApi(request);

        const result = await fetchUserViews(api, { userId: 'user-1' });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://example.com/UserViews?userId=user-1',
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

        await fetchUserViews(api, { userId: 'user-1' }, { signal });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ signal })
        );
    });
});

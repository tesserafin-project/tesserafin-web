import type { Api } from '@jellyfin/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
    fetchPlaybackSessionFixture,
    fetchPlaybackSessions
} from './playbackDiagnosticsApi';
import type { PlaybackSessionListItem } from './types';

/**
 * Tests the fetch functions in isolation against a minimal mocked `Api`, per design doc §7.3 —
 * avoids introducing `@testing-library/react-hooks` for a need that doesn't justify it yet.
 *
 * Since PR2 (docs/reefin/design-reefin-api-layer.md), these functions call through the generated
 * `SystemApi` class rather than `axiosInstance.get()` directly. The generated client always
 * dispatches through `axiosInstance.request(...)` (see `src/lib/reefin-sdk/generated/common.ts`'s
 * `createRequestFunction`), so the mock shape changed from `{ get }` to `{ request, defaults }` —
 * `defaults` is read (`axios.defaults.baseURL`) by that same helper before `request` is ever
 * called, so it has to exist on the mock even though its value doesn't matter here.
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): Api =>
    ({
        axiosInstance: { request, defaults: {} },
        basePath: 'https://example.com',
        authorizationHeader: 'MediaBrowser Token="test-token"'
    }) as unknown as Api;

describe('fetchPlaybackSessions()', () => {
    it('requests the diagnostics sessions route with the auth header attached', async () => {
        const items: PlaybackSessionListItem[] = [];
        const request = vi.fn().mockResolvedValue({ data: items });
        const api = createMockApi(request);

        const result = await fetchPlaybackSessions(api);

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://example.com/System/PlaybackDiagnostics/Sessions',
                method: 'GET',
                headers: expect.objectContaining({
                    Authorization: 'MediaBrowser Token="test-token"'
                })
            })
        );
        expect(result).toBe(items);
    });

    it('forwards an abort signal when provided', async () => {
        const request = vi.fn().mockResolvedValue({ data: [] });
        const api = createMockApi(request);
        // A signal-shaped stub is enough to assert pass-through - no need to construct a real
        // AbortController here.
        const signal = {} as AbortSignal;

        await fetchPlaybackSessions(api, signal);

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ signal })
        );
    });
});

describe('fetchPlaybackSessionFixture()', () => {
    it('requests the Fixture sub-route as a blob, with the auth header attached', async () => {
        const blob = new Blob(['{}'], { type: 'application/json' });
        const request = vi.fn().mockResolvedValue({ data: blob });
        const api = createMockApi(request);

        const result = await fetchPlaybackSessionFixture(api, 'session-1');

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://example.com/System/PlaybackDiagnostics/Sessions/session-1/Fixture',
                method: 'GET',
                headers: expect.objectContaining({
                    Authorization: 'MediaBrowser Token="test-token"'
                }),
                responseType: 'blob'
            })
        );
        expect(result).toBe(blob);
    });

    it('propagates the request rejection (e.g. a 422 for a session with no retained diagnostic)', async () => {
        const notRetainedError = Object.assign(
            new Error('Request failed with status code 422'),
            {
                isAxiosError: true,
                response: { status: 422 }
            }
        );
        const request = vi.fn().mockRejectedValue(notRetainedError);
        const api = createMockApi(request);

        await expect(
            fetchPlaybackSessionFixture(api, 'session-1')
        ).rejects.toBe(notRetainedError);
    });
});

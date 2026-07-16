import type { Api } from '@jellyfin/sdk';
import { describe, expect, it, vi } from 'vitest';

import { fetchPlaybackSessionFixture, fetchPlaybackSessions } from './playbackDiagnosticsApi';
import type { PlaybackSessionListItem } from './types';

/**
 * Tests the fetch function in isolation against a minimal mocked `Api`, per design doc §7.3 —
 * avoids introducing `@testing-library/react-hooks` for a need that doesn't justify it yet.
 */
const createMockApi = (get: ReturnType<typeof vi.fn>): Api => ({
    axiosInstance: { get },
    basePath: 'https://example.com',
    authorizationHeader: 'MediaBrowser Token="test-token"'
} as unknown as Api);

describe('fetchPlaybackSessions()', () => {
    it('requests the diagnostics sessions route with the auth header attached', async () => {
        const items: PlaybackSessionListItem[] = [];
        const get = vi.fn().mockResolvedValue({ data: items });
        const api = createMockApi(get);

        const result = await fetchPlaybackSessions(api);

        expect(get).toHaveBeenCalledWith(
            'https://example.com/System/PlaybackDiagnostics/Sessions',
            expect.objectContaining({
                headers: { Authorization: 'MediaBrowser Token="test-token"' }
            })
        );
        expect(result).toBe(items);
    });

    it('forwards an abort signal when provided', async () => {
        const get = vi.fn().mockResolvedValue({ data: [] });
        const api = createMockApi(get);
        // Avoid constructing a real AbortController here (flagged by eslint-plugin-compat for
        // older browser targets) — a signal-shaped stub is enough to assert pass-through.
        const signal = {} as AbortSignal;

        await fetchPlaybackSessions(api, signal);

        expect(get).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ signal })
        );
    });
});

describe('fetchPlaybackSessionFixture()', () => {
    it('requests the Fixture sub-route as a blob, with the auth header attached', async () => {
        const blob = new Blob([ '{}' ], { type: 'application/json' });
        const get = vi.fn().mockResolvedValue({ data: blob });
        const api = createMockApi(get);

        const result = await fetchPlaybackSessionFixture(api, 'session-1');

        expect(get).toHaveBeenCalledWith(
            'https://example.com/System/PlaybackDiagnostics/Sessions/session-1/Fixture',
            expect.objectContaining({
                headers: { Authorization: 'MediaBrowser Token="test-token"' },
                responseType: 'blob'
            })
        );
        expect(result).toBe(blob);
    });

    it('propagates the request rejection (e.g. a 422 for a session with no retained diagnostic)', async () => {
        const notRetainedError = Object.assign(new Error('Request failed with status code 422'), {
            isAxiosError: true,
            response: { status: 422 }
        });
        const get = vi.fn().mockRejectedValue(notRetainedError);
        const api = createMockApi(get);

        await expect(fetchPlaybackSessionFixture(api, 'session-1')).rejects.toBe(notRetainedError);
    });
});

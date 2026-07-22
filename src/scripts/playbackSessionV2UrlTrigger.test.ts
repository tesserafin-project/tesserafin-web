import type { Api } from '@jellyfin/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    ResolveV2PlaybackUrlParams,
    V2PatchableStreamInfo
} from './playbackSessionV2Url';
import { applyV2PlaybackUrlIfEnabled } from './playbackSessionV2UrlTrigger';

/**
 * Tests the lazy-load gate in isolation, mirroring `playbackSessionShadowTrigger.test.ts`:
 * `loadV2UrlModule` stands in for the real `import('./playbackSessionV2Url')` (PR116f) so these
 * tests exercise the gate/wiring without depending on webpack's own code-splitting behavior. The
 * wrapped module's own fallback matrix is covered by `playbackSessionV2Url.test.ts`.
 *
 * The property under test (PR116f's whole point): with the flag off, `loadV2UrlModule` must never be
 * called at all - that is what keeps `playback-v2-url.chunk.js`, the `tesserafinPlaybackCapabilities`
 * builder and the v2 network calls off the wire, not just out of the main bundle.
 */
const baseParams: ResolveV2PlaybackUrlParams = {
    api: {} as Api,
    itemId: 'item-1',
    mediaType: 'Video',
    userId: 'user-1',
    mediaSourceId: 'media-source-1',
    startTimeTicks: 0
};

const apiClient = { getUrl: (url: string) => `https://server${url}` };

/** A legacy `streamInfo` as `createStreamInfo()` would have produced it - the fallback that must
 * survive every v2 failure untouched. */
const legacyStreamInfo = (): V2PatchableStreamInfo => ({
    url: 'https://server/legacy/stream.m3u8',
    mimeType: 'video/mp4',
    playMethod: 'Transcode',
    playSessionId: 'legacy-session'
});

describe('applyV2PlaybackUrlIfEnabled()', () => {
    let logger: { debug: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        logger = { debug: vi.fn() };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('flag OFF', () => {
        it('never loads the v2 module and leaves the legacy streamInfo untouched', async () => {
            const loadV2UrlModule = vi.fn();
            const streamInfo = legacyStreamInfo();

            const applied = await applyV2PlaybackUrlIfEnabled(
                streamInfo,
                baseParams,
                apiClient,
                {},
                { isEnabled: () => false, loadV2UrlModule, logger }
            );

            expect(applied).toBe(false);
            expect(loadV2UrlModule).not.toHaveBeenCalled();
            expect(logger.debug).not.toHaveBeenCalled();
            expect(streamInfo).toEqual(legacyStreamInfo());
        });

        it('defaults isEnabled to appSettings.enableV2PlaybackPath() (off by default)', async () => {
            const loadV2UrlModule = vi.fn();

            // No `isEnabled` override: exercises the real default, which reads the real (unmocked)
            // appSettings flag - default off, per `settings/appSettings.js`.
            const applied = await applyV2PlaybackUrlIfEnabled(
                legacyStreamInfo(),
                baseParams,
                apiClient,
                {},
                { loadV2UrlModule, logger }
            );

            expect(applied).toBe(false);
            expect(loadV2UrlModule).not.toHaveBeenCalled();
        });
    });

    describe('flag ON', () => {
        it('loads the v2 module on demand and delegates to applyV2PlaybackUrlToStreamInfo()', async () => {
            const applyV2PlaybackUrlToStreamInfo = vi
                .fn()
                .mockResolvedValue(true);
            const loadV2UrlModule = vi
                .fn()
                .mockResolvedValue({ applyV2PlaybackUrlToStreamInfo });
            const streamInfo = legacyStreamInfo();

            const applied = await applyV2PlaybackUrlIfEnabled(
                streamInfo,
                baseParams,
                apiClient,
                {},
                { isEnabled: () => true, loadV2UrlModule, logger }
            );

            expect(applied).toBe(true);
            expect(loadV2UrlModule).toHaveBeenCalledOnce();
            expect(applyV2PlaybackUrlToStreamInfo).toHaveBeenCalledWith(
                streamInfo,
                baseParams,
                apiClient,
                {},
                expect.objectContaining({ isEnabled: expect.any(Function) })
            );
        });

        it('forwards v2Deps to the wrapped module', async () => {
            const applyV2PlaybackUrlToStreamInfo = vi
                .fn()
                .mockResolvedValue(true);
            const generatePlaySessionId = () => 'play-session-1';

            await applyV2PlaybackUrlIfEnabled(
                legacyStreamInfo(),
                baseParams,
                apiClient,
                {},
                {
                    isEnabled: () => true,
                    loadV2UrlModule: vi
                        .fn()
                        .mockResolvedValue({ applyV2PlaybackUrlToStreamInfo }),
                    v2Deps: { generatePlaySessionId },
                    logger
                }
            );

            expect(applyV2PlaybackUrlToStreamInfo).toHaveBeenCalledWith(
                legacyStreamInfo(),
                baseParams,
                apiClient,
                {},
                expect.objectContaining({ generatePlaySessionId })
            );
        });

        it('applies the execution context through to the wrapped module', async () => {
            // Regression guard for an arity mismatch that no other test in either suite can see.
            // `applyV2PlaybackUrlToStreamInfo` takes `(streamInfo, params, apiClient, context,
            // deps)`. If this trigger forwards its resolve deps as arg 4 - the pre-#24 shape - they
            // land in `context` and the caller's real context is dropped on the floor, silently:
            // `directPlayMimeType` and `requestOptions` arrive `undefined`, which reads as "v2
            // cannot supply a complete execution state" and collapses the v2 path to HLS-only,
            // with the stream-copy retry flags stuck at false. Every test that calls the wrapped
            // module directly still passes, because they build `context` themselves. Only a test
            // driving the trigger can catch it.
            const applyV2PlaybackUrlToStreamInfo = vi
                .fn()
                .mockResolvedValue(true);
            const context = {
                directPlayMimeType: 'video/mp4',
                requestOptions: { allowVideoStreamCopy: false }
            };

            await applyV2PlaybackUrlIfEnabled(
                legacyStreamInfo(),
                baseParams,
                apiClient,
                context,
                {
                    isEnabled: () => true,
                    loadV2UrlModule: vi
                        .fn()
                        .mockResolvedValue({ applyV2PlaybackUrlToStreamInfo }),
                    logger
                }
            );

            const args = applyV2PlaybackUrlToStreamInfo.mock.calls[0];
            expect(args[3]).toEqual(context);
            // ...and the deps must NOT have been merged into the context slot.
            expect(args[3]).not.toHaveProperty('isEnabled');
            expect(args[4]).toEqual(
                expect.objectContaining({ isEnabled: expect.any(Function) })
            );
        });

        it('awaits the patch so the mutated streamInfo is visible to the caller before it resolves', async () => {
            // The caller hands this exact object to `player.play()` on the next line - a
            // fire-and-forget wrapper would let it play the legacy URL. This is the regression
            // guard for that.
            const loadV2UrlModule = vi.fn().mockResolvedValue({
                applyV2PlaybackUrlToStreamInfo: async (
                    info: V2PatchableStreamInfo
                ) => {
                    await Promise.resolve();
                    info.url = 'https://server/v2/stream.m3u8';
                    info.playMethod = 'DirectPlay';
                    return true;
                }
            });
            const streamInfo = legacyStreamInfo();

            await applyV2PlaybackUrlIfEnabled(
                streamInfo,
                baseParams,
                apiClient,
                {},
                { isEnabled: () => true, loadV2UrlModule, logger }
            );

            expect(streamInfo.url).toBe('https://server/v2/stream.m3u8');
            expect(streamInfo.playMethod).toBe('DirectPlay');
        });

        it('keeps the legacy streamInfo when the wrapped module declines (v2 failure/fallback)', async () => {
            const streamInfo = legacyStreamInfo();

            const applied = await applyV2PlaybackUrlIfEnabled(
                streamInfo,
                baseParams,
                apiClient,
                {},
                {
                    isEnabled: () => true,
                    loadV2UrlModule: vi.fn().mockResolvedValue({
                        applyV2PlaybackUrlToStreamInfo: vi
                            .fn()
                            .mockResolvedValue(false)
                    }),
                    logger
                }
            );

            expect(applied).toBe(false);
            expect(streamInfo).toEqual(legacyStreamInfo());
        });

        it('does not reject and keeps the legacy streamInfo when the dynamic import() itself fails', async () => {
            const streamInfo = legacyStreamInfo();

            const applied = await applyV2PlaybackUrlIfEnabled(
                streamInfo,
                baseParams,
                apiClient,
                {},
                {
                    isEnabled: () => true,
                    loadV2UrlModule: vi
                        .fn()
                        .mockRejectedValue(new Error('ChunkLoadError')),
                    logger
                }
            );

            expect(applied).toBe(false);
            expect(streamInfo).toEqual(legacyStreamInfo());
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining(
                    'failed to load the v2 playback URL module'
                ),
                expect.any(Error)
            );
        });

        it('does not reject and keeps the legacy streamInfo when the wrapped module throws', async () => {
            const streamInfo = legacyStreamInfo();

            const applied = await applyV2PlaybackUrlIfEnabled(
                streamInfo,
                baseParams,
                apiClient,
                {},
                {
                    isEnabled: () => true,
                    loadV2UrlModule: vi.fn().mockResolvedValue({
                        applyV2PlaybackUrlToStreamInfo: vi
                            .fn()
                            .mockRejectedValue(new Error('boom'))
                    }),
                    logger
                }
            );

            expect(applied).toBe(false);
            expect(streamInfo).toEqual(legacyStreamInfo());
        });
    });
});

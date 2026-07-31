import type { Api } from '@jellyfin/sdk';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type Mock
} from 'vitest';

import type { V2PatchableStreamInfo } from './playbackSessionV2Url';
import {
    applyV2PlaybackReplanIfEnabled,
    type V2PlaybackReplanTriggerParams
} from './playbackSessionV2ReplanTrigger';

/**
 * Tests the retry re-plan FORK in isolation, mirroring `playbackSessionV2UrlTrigger.test.ts`:
 * `loadV2UrlModule` stands in for the real `import('./playbackSessionV2Url')` so these tests
 * exercise the gate/wiring without depending on webpack's code-splitting. The wrapped module's own
 * PUT/GET/fallback matrix is covered by `playbackSessionV2Url.test.ts`.
 *
 * The two properties under test:
 *   - "has adopted v2 session -> PUT, else legacy": the chunk is loaded ONLY when the flag is on
 *     AND a session id + play session id were recovered - a legacy retry must not even request
 *     `playback-v2-url.chunk.js`;
 *   - the explicit fallback: once the fork chose v2, a failure to load/apply must log a WARNING
 *     (never throw) and leave the legacy `streamInfo` untouched.
 */
const baseParams = (
    overrides: Partial<V2PlaybackReplanTriggerParams> = {}
): V2PlaybackReplanTriggerParams => ({
    api: {} as Api,
    itemId: 'item-1',
    mediaType: 'Video',
    userId: 'user-1',
    mediaSourceId: 'media-source-1',
    startTimeTicks: 0,
    playbackAttemptId: 'attempt-1',
    sessionId: 'server-session-1',
    playSessionId: 'play-session-1',
    ...overrides
});

const apiClient = { getUrl: (url: string) => `https://server${url}` };

/** A legacy `streamInfo` as the retry's `createStreamInfo()` would have produced it - the fallback
 * that must survive every declined/failed re-plan untouched. */
const legacyStreamInfo = (): V2PatchableStreamInfo => ({
    url: 'https://server/legacy/stream.m3u8',
    mimeType: 'video/mp4',
    playMethod: 'Transcode',
    playSessionId: 'legacy-session'
});

describe('applyV2PlaybackReplanIfEnabled()', () => {
    let logger: {
        debug: Mock<(...args: unknown[]) => void>;
        warn: Mock<(...args: unknown[]) => void>;
    };

    beforeEach(() => {
        logger = {
            debug: vi.fn<(...args: unknown[]) => void>(),
            warn: vi.fn<(...args: unknown[]) => void>()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('flag OFF', () => {
        it('never loads the v2 module and leaves the legacy streamInfo untouched', async () => {
            const loadV2UrlModule = vi.fn();
            const streamInfo = legacyStreamInfo();

            const applied = await applyV2PlaybackReplanIfEnabled(
                streamInfo,
                baseParams(),
                apiClient,
                {},
                { isEnabled: () => false, loadV2UrlModule, logger }
            );

            expect(applied).toBe(false);
            expect(loadV2UrlModule).not.toHaveBeenCalled();
            expect(logger.debug).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
            expect(streamInfo).toEqual(legacyStreamInfo());
        });

        it('defaults isEnabled to appSettings.enableV2PlaybackPath() (off by default)', async () => {
            const loadV2UrlModule = vi.fn();

            // No `isEnabled` override: exercises the real default, which reads the real
            // (unmocked) appSettings flag - default off, per `settings/appSettings.js`.
            const applied = await applyV2PlaybackReplanIfEnabled(
                legacyStreamInfo(),
                baseParams(),
                apiClient,
                {},
                { loadV2UrlModule, logger }
            );

            expect(applied).toBe(false);
            expect(loadV2UrlModule).not.toHaveBeenCalled();
        });
    });

    describe('the fork: no adopted v2 session -> legacy', () => {
        it.each([
            ['absent', undefined],
            ['null', null],
            ['blank', '   ']
        ])(
            'declines without loading the module when sessionId is %s',
            async (_label, sessionId) => {
                const loadV2UrlModule = vi.fn();
                const streamInfo = legacyStreamInfo();

                const applied = await applyV2PlaybackReplanIfEnabled(
                    streamInfo,
                    baseParams({ sessionId }),
                    apiClient,
                    {},
                    { isEnabled: () => true, loadV2UrlModule, logger }
                );

                expect(applied).toBe(false);
                expect(loadV2UrlModule).not.toHaveBeenCalled();
                expect(streamInfo).toEqual(legacyStreamInfo());
                // A routine fork, not a failure: debug, never warn.
                expect(logger.debug).toHaveBeenCalledWith(
                    expect.stringContaining('no adopted v2 session')
                );
                expect(logger.warn).not.toHaveBeenCalled();
            }
        );

        it('declines when a session id exists but its PlaySessionId was lost', async () => {
            const loadV2UrlModule = vi.fn();

            const applied = await applyV2PlaybackReplanIfEnabled(
                legacyStreamInfo(),
                baseParams({ playSessionId: undefined }),
                apiClient,
                {},
                { isEnabled: () => true, loadV2UrlModule, logger }
            );

            expect(applied).toBe(false);
            expect(loadV2UrlModule).not.toHaveBeenCalled();
        });
    });

    describe('the fork: adopted v2 session -> PUT re-plan', () => {
        it('loads the v2 module on demand and delegates with the narrowed params', async () => {
            const applyV2PlaybackReplanToStreamInfo = vi
                .fn()
                .mockResolvedValue(true);
            const loadV2UrlModule = vi
                .fn()
                .mockResolvedValue({ applyV2PlaybackReplanToStreamInfo });
            const streamInfo = legacyStreamInfo();

            // Whitespace-padded ids prove the narrowing really trims rather than merely
            // truthiness-checking - the wrapped module must receive wire-safe values.
            const applied = await applyV2PlaybackReplanIfEnabled(
                streamInfo,
                baseParams({
                    sessionId: ' server-session-1 ',
                    playSessionId: ' play-session-1 '
                }),
                apiClient,
                {},
                { isEnabled: () => true, loadV2UrlModule, logger }
            );

            expect(applied).toBe(true);
            expect(loadV2UrlModule).toHaveBeenCalledOnce();
            expect(applyV2PlaybackReplanToStreamInfo).toHaveBeenCalledWith(
                streamInfo,
                expect.objectContaining({
                    sessionId: 'server-session-1',
                    playSessionId: 'play-session-1',
                    playbackAttemptId: 'attempt-1'
                }),
                apiClient,
                {},
                {}
            );
        });

        it('forwards v2Deps to the wrapped module', async () => {
            const applyV2PlaybackReplanToStreamInfo = vi
                .fn()
                .mockResolvedValue(true);
            const fetchStream = vi.fn();

            await applyV2PlaybackReplanIfEnabled(
                legacyStreamInfo(),
                baseParams(),
                apiClient,
                {},
                {
                    isEnabled: () => true,
                    loadV2UrlModule: vi.fn().mockResolvedValue({
                        applyV2PlaybackReplanToStreamInfo
                    }),
                    v2Deps: { fetchStream },
                    logger
                }
            );

            expect(applyV2PlaybackReplanToStreamInfo).toHaveBeenCalledWith(
                legacyStreamInfo(),
                expect.anything(),
                apiClient,
                {},
                { fetchStream }
            );
        });

        it('applies the execution context through to the wrapped module', async () => {
            // Same regression guard as the POST trigger's: `context` MUST land on arg 4 and the
            // deps on arg 5. Swapping them silently drops `directPlayMimeType`/`requestOptions`,
            // which reads as "cannot supply a complete execution state" and collapses every
            // re-plan to a warned legacy fallback - a defect only a trigger-level test can see.
            const applyV2PlaybackReplanToStreamInfo = vi
                .fn()
                .mockResolvedValue(true);
            const context = {
                directPlayMimeType: 'video/mp4',
                requestOptions: { allowVideoStreamCopy: false }
            };

            await applyV2PlaybackReplanIfEnabled(
                legacyStreamInfo(),
                baseParams(),
                apiClient,
                context,
                {
                    isEnabled: () => true,
                    loadV2UrlModule: vi.fn().mockResolvedValue({
                        applyV2PlaybackReplanToStreamInfo
                    }),
                    logger
                }
            );

            const args = applyV2PlaybackReplanToStreamInfo.mock.calls[0];
            expect(args[3]).toEqual(context);
            expect(args[3]).not.toHaveProperty('fetchStream');
        });

        it('awaits the patch so the mutated streamInfo is visible to the caller before it resolves', async () => {
            // The caller hands this exact object to changeStreamToUrl() -> player.play() on the
            // next line - a fire-and-forget wrapper would let it play the legacy URL.
            const loadV2UrlModule = vi.fn().mockResolvedValue({
                applyV2PlaybackReplanToStreamInfo: async (
                    info: V2PatchableStreamInfo
                ) => {
                    await Promise.resolve();
                    info.url = 'https://server/v2/replanned.m3u8';
                    info.playMethod = 'Transcode';
                    return true;
                }
            });
            const streamInfo = legacyStreamInfo();

            await applyV2PlaybackReplanIfEnabled(
                streamInfo,
                baseParams(),
                apiClient,
                {},
                { isEnabled: () => true, loadV2UrlModule, logger }
            );

            expect(streamInfo.url).toBe('https://server/v2/replanned.m3u8');
        });

        it('keeps the legacy streamInfo when the wrapped module declines (PUT failure fallback)', async () => {
            const streamInfo = legacyStreamInfo();

            const applied = await applyV2PlaybackReplanIfEnabled(
                streamInfo,
                baseParams(),
                apiClient,
                {},
                {
                    isEnabled: () => true,
                    loadV2UrlModule: vi.fn().mockResolvedValue({
                        applyV2PlaybackReplanToStreamInfo: vi
                            .fn()
                            .mockResolvedValue(false)
                    }),
                    logger
                }
            );

            expect(applied).toBe(false);
            expect(streamInfo).toEqual(legacyStreamInfo());
        });

        it('warns and keeps the legacy streamInfo when the dynamic import() itself fails', async () => {
            const streamInfo = legacyStreamInfo();

            const applied = await applyV2PlaybackReplanIfEnabled(
                streamInfo,
                baseParams(),
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
            // Past the fork, a fallback is a real event: WARN, not debug - the explicit-fallback
            // contract of the re-plan path.
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    'failed to load the v2 playback URL module'
                ),
                expect.any(Error)
            );
        });

        it('does not reject and keeps the legacy streamInfo when the wrapped module throws', async () => {
            const streamInfo = legacyStreamInfo();

            const applied = await applyV2PlaybackReplanIfEnabled(
                streamInfo,
                baseParams(),
                apiClient,
                {},
                {
                    isEnabled: () => true,
                    loadV2UrlModule: vi.fn().mockResolvedValue({
                        applyV2PlaybackReplanToStreamInfo: vi
                            .fn()
                            .mockRejectedValue(new Error('boom'))
                    }),
                    logger
                }
            );

            expect(applied).toBe(false);
            expect(streamInfo).toEqual(legacyStreamInfo());
            expect(logger.warn).toHaveBeenCalled();
        });
    });
});

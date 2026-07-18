import type { Api } from '@jellyfin/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PlaybackUrlResolvingApiClient,
    ResolveV2PlaybackUrlDeps,
    ResolveV2PlaybackUrlParams,
    V2PatchableStreamInfo
} from './playbackSessionV2Url';
import {
    applyV2PlaybackUrlToStreamInfo,
    resolveV2PlaybackUrl
} from './playbackSessionV2Url';

/**
 * Mirrors `playbackSessionShadow.test.ts`'s mock shape: both the generated `PlaybackApi.
 * createPlaybackSession()` call and this module's own hand-written `GET .../Stream` wrapper
 * dispatch through the single `axiosInstance.request(...)` seam, so one `request` mock covers both
 * legs of the flow - responses are told apart by `method`/`url` on each captured call.
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): Api =>
    ({
        axiosInstance: { request, defaults: {} },
        basePath: 'https://example.com',
        authorizationHeader: 'MediaBrowser Token="test-token"'
    }) as unknown as Api;

const baseParams = (api: Api): ResolveV2PlaybackUrlParams => ({
    api,
    itemId: 'item-1',
    mediaType: 'Video',
    userId: 'user-1',
    mediaSourceId: 'media-source-1',
    startTimeTicks: 30000000
});

const NATIVE_CAPABILITIES = {
    Decode: { DirectPlayProfiles: [], VideoCodecs: [], AudioCodecs: [] },
    OutputProfiles: []
} as unknown as ReturnType<
    NonNullable<ResolveV2PlaybackUrlDeps['buildCapabilities']>
>;

const NATIVE_CONSTRAINTS = {
    AllowDirectPlay: true
} as unknown as ReturnType<
    NonNullable<ResolveV2PlaybackUrlDeps['buildConstraints']>
>;

/** Queues one POST response then one GET response on the same mock `request` fn, mirroring the two
 * sequential calls `resolveV2PlaybackUrl` makes. */
function mockPostThenGet(
    postResponse: unknown,
    getResponse: unknown
): ReturnType<typeof vi.fn> {
    const request = vi.fn();
    request.mockImplementationOnce(() => Promise.resolve(postResponse));
    request.mockImplementationOnce(() => Promise.resolve(getResponse));
    return request;
}

const baseDeps = (
    overrides: ResolveV2PlaybackUrlDeps = {}
): ResolveV2PlaybackUrlDeps => ({
    isEnabled: () => true,
    generatePlaySessionId: () => 'v2-session-id',
    buildCapabilities: () => NATIVE_CAPABILITIES,
    buildConstraints: () => NATIVE_CONSTRAINTS,
    ...overrides
});

describe('resolveV2PlaybackUrl()', () => {
    let logger: { debug: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        logger = { debug: vi.fn() };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not call the API at all when the flag is off', async () => {
        const request = vi.fn();
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(baseParams(api), {
            ...baseDeps(),
            isEnabled: () => false,
            logger
        });

        expect(result).toBeNull();
        expect(request).not.toHaveBeenCalled();
        expect(logger.debug).not.toHaveBeenCalled();
    });

    it('does not call the API for a mediaType other than Video/Audio', async () => {
        const request = vi.fn();
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(
            { ...baseParams(api), mediaType: 'Book' },
            { ...baseDeps(), logger }
        );

        expect(result).toBeNull();
        expect(request).not.toHaveBeenCalled();
    });

    it('happy path: POSTs Playback/Sessions then GETs .../Stream and returns the descriptor URL', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            {
                data: {
                    Url: '/Videos/item-1/stream.mp4?PlaySessionId=v2-session-id',
                    Protocol: 'Http',
                    ServedBy: 2,
                    FallbackReason: null,
                    SubtitleUrl: null
                }
            }
        );
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(baseParams(api), {
            ...baseDeps(),
            logger
        });

        expect(result).toEqual({
            url: '/Videos/item-1/stream.mp4?PlaySessionId=v2-session-id',
            protocol: 'Http',
            playMethod: 'DirectPlay',
            playSessionId: 'v2-session-id',
            // Server-assigned, distinct from the client-generated playSessionId above.
            playbackSessionId: 'server-session-1',
            subtitleUrl: undefined,
            servedBy: 2,
            fallbackReason: null
        });

        expect(request).toHaveBeenCalledTimes(2);
        const [[postArgs], [getArgs]] = request.mock.calls;
        expect(postArgs).toEqual(
            expect.objectContaining({
                url: 'https://example.com/Playback/Sessions',
                method: 'POST'
            })
        );
        expect(JSON.parse(postArgs.data)).toEqual({
            ItemId: 'item-1',
            UserId: 'user-1',
            MediaSourceId: 'media-source-1',
            PlaySessionId: 'v2-session-id',
            Capabilities: NATIVE_CAPABILITIES,
            Constraints: NATIVE_CONSTRAINTS
        });
        expect(getArgs).toEqual(
            expect.objectContaining({
                url: 'https://example.com/Playback/Sessions/server-session-1/Stream',
                method: 'GET',
                params: { startTimeTicks: 30000000 },
                headers: expect.objectContaining({
                    Authorization: 'MediaBrowser Token="test-token"'
                })
            })
        );

        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining(
                'GET Playback/Sessions/{id}/Stream resolved'
            ),
            expect.objectContaining({
                ServedBy: 2,
                FallbackReason: null,
                Protocol: 'Http'
            })
        );
    });

    it('maps the Remux playback method to the legacy DirectStream name', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Remux' } },
            { data: { Url: '/stream', Protocol: 'Http' } }
        );
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(baseParams(api), baseDeps());

        expect(result?.playMethod).toBe('DirectStream');
    });

    it('falls back to legacy when the POST response has no session Id', async () => {
        const request = mockPostThenGet(
            { data: { Method: 'DirectPlay' } },
            { data: { Url: '/should-not-be-reached' } }
        );
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(baseParams(api), {
            ...baseDeps(),
            logger
        });

        expect(result).toBeNull();
        // Only the POST fires - a missing Id means the GET is never attempted.
        expect(request).toHaveBeenCalledTimes(1);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('returned no session id'),
            expect.anything()
        );
    });

    it('falls back to legacy when the POST call fails (network/4xx/5xx)', async () => {
        const request = vi.fn().mockRejectedValue(
            Object.assign(new Error('Request failed with status code 409'), {
                isAxiosError: true,
                response: { status: 409 }
            })
        );
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(baseParams(api), {
            ...baseDeps(),
            logger
        });

        expect(result).toBeNull();
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('falling back to legacy playback URL'),
            expect.anything()
        );
    });

    it('falls back to legacy when the GET call fails (network/4xx/5xx, e.g. 403 not-owner)', async () => {
        const request = vi.fn();
        request.mockImplementationOnce(() =>
            Promise.resolve({
                data: { Id: 'server-session-1', Method: 'Transcode' }
            })
        );
        request.mockImplementationOnce(() =>
            Promise.reject(
                Object.assign(
                    new Error('Request failed with status code 403'),
                    {
                        isAxiosError: true,
                        response: { status: 403 }
                    }
                )
            )
        );
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(baseParams(api), {
            ...baseDeps(),
            logger
        });

        expect(result).toBeNull();
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('falling back to legacy playback URL'),
            expect.anything()
        );
    });

    it('falls back to legacy when the descriptor has no Url', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            {
                data: {
                    Protocol: 'Http',
                    ServedBy: 0,
                    FallbackReason: 'KillSwitch'
                }
            }
        );
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(baseParams(api), {
            ...baseDeps(),
            logger
        });

        expect(result).toBeNull();
        // Still logged - a legacy fallback signaled server-side is not a client error.
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining(
                'GET Playback/Sessions/{id}/Stream resolved'
            ),
            expect.objectContaining({ FallbackReason: 'KillSwitch' })
        );
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('descriptor has no Url')
        );
    });

    it('swallows a missing/misconfigured api the same way', async () => {
        const brokenApi = {
            get axiosInstance(): never {
                throw new Error('no axios instance configured');
            },
            basePath: 'https://example.com',
            authorizationHeader: 'MediaBrowser Token="test-token"'
        } as unknown as Api;

        const result = await resolveV2PlaybackUrl(baseParams(brokenApi), {
            ...baseDeps(),
            logger
        });

        expect(result).toBeNull();
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('falling back to legacy playback URL'),
            expect.anything()
        );
    });

    it('generates a PlaySessionId via crypto.randomUUID() by default', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            { data: { Url: '/stream' } }
        );
        const api = createMockApi(request);
        const randomUUID = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValue('11111111-1111-1111-1111-111111111111');

        const result = await resolveV2PlaybackUrl(baseParams(api), {
            isEnabled: () => true,
            buildCapabilities: () => NATIVE_CAPABILITIES,
            buildConstraints: () => NATIVE_CONSTRAINTS
        });

        expect(randomUUID).toHaveBeenCalledOnce();
        expect(result?.playSessionId).toBe(
            '11111111-1111-1111-1111-111111111111'
        );
    });
});

describe('applyV2PlaybackUrlToStreamInfo()', () => {
    let logger: { debug: ReturnType<typeof vi.fn> };
    let apiClient: PlaybackUrlResolvingApiClient;

    beforeEach(() => {
        logger = { debug: vi.fn() };
        apiClient = {
            getUrl: vi.fn((url: string) => `https://example.com${url}`)
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('leaves streamInfo completely untouched when the flag is off', async () => {
        const request = vi.fn();
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            mimeType: 'video/mp4',
            playMethod: 'Transcode',
            playSessionId: 'legacy-id'
        };
        const snapshot = { ...streamInfo };

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            {},
            { ...baseDeps(), isEnabled: () => false, logger }
        );

        expect(applied).toBe(false);
        expect(streamInfo).toEqual(snapshot);
        expect(apiClient.getUrl).not.toHaveBeenCalled();
    });

    it('leaves streamInfo completely untouched when getUrl throws (all-or-nothing)', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            {
                data: {
                    Url: '/v2/stream',
                    Protocol: 'Hls',
                    ServedBy: 2,
                    SubtitleUrl: '/v2/subs'
                }
            }
        );
        const api = createMockApi(request);
        apiClient = {
            getUrl: vi.fn(() => {
                throw new Error('getUrl exploded');
            })
        };
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            mimeType: 'video/mp4',
            playMethod: 'Transcode',
            playSessionId: 'legacy-id'
        };
        const snapshot = { ...streamInfo };

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(false);
        expect(streamInfo).toEqual(snapshot);
    });

    it('replaces every execution-derived field on the v2 happy path', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            { data: { Url: '/v2/stream', Protocol: 'Http', ServedBy: 2 } }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            mimeType: 'video/x-matroska',
            playMethod: 'Transcode',
            playSessionId: 'legacy-id',
            // The legacy transcode plan had a non-zero offset. Issue #41: it used to survive onto a
            // v2 direct-play URL and shift every reported position.
            transcodingOffsetTicks: 30000000
        };

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            { directPlayMimeType: 'video/mp4' },
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(true);
        expect(streamInfo.url).toBe('https://example.com/v2/stream');
        expect(streamInfo.playMethod).toBe('DirectPlay');
        expect(streamInfo.playSessionId).toBe('v2-session-id');
        // Direct play over a non-HLS protocol serves the source file, so the mime type comes from
        // the source container - it is NOT left at its legacy value.
        expect(streamInfo.mimeType).toBe('video/mp4');
        // The legacy offset is gone, not carried over.
        expect(streamInfo.transcodingOffsetTicks).toBe(0);
    });

    it('carries the full typed decision, including the server session id', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            { data: { Url: '/v2/master.m3u8', Protocol: 'Hls', ServedBy: 2 } }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            playMethod: 'DirectPlay'
        };

        await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            { requestOptions: { allowVideoStreamCopy: false } },
            baseDeps()
        );

        expect(streamInfo.executionDecision).toEqual({
            source: 'v2',
            url: 'https://example.com/v2/master.m3u8',
            playMethod: 'Transcode',
            mimeType: 'application/x-mpegURL',
            transcodingOffsetTicks: 0,
            playSessionId: 'v2-session-id',
            // Distinct from playSessionId: the server-created Playback/Sessions resource id.
            playbackSessionId: 'server-session-1',
            protocol: 'Hls',
            retry: {
                // Derived from the v2 play method, not the legacy DirectPlay one.
                isAlreadyFallbacking: true,
                preventsVideoStreamCopy: true,
                preventsAudioStreamCopy: false
            }
        });
    });

    it('keeps the legacy decision whole when v2 cannot supply a mime type', async () => {
        // Remux over a non-HLS protocol: the server picks the output container and reports it
        // nowhere, so there is no correct mime type to write. Rather than mixing a v2 URL with a
        // legacy mime type, the whole decision falls back.
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Remux' } },
            { data: { Url: '/v2/stream', Protocol: 'Http' } }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            mimeType: 'video/x-matroska',
            playMethod: 'Transcode',
            playSessionId: 'legacy-id',
            transcodingOffsetTicks: 30000000
        };
        const snapshot = { ...streamInfo };

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            // No directPlayMimeType, and Remux/Http cannot derive one.
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(false);
        // Not one field moved - in particular the URL did not.
        expect(streamInfo).toEqual(snapshot);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('cannot supply a complete execution state')
        );
    });

    it('keeps the legacy decision whole when a direct-play mime type is unavailable', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            { data: { Url: '/v2/stream', Protocol: 'Http' } }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            mimeType: 'video/mp4',
            playMethod: 'DirectPlay',
            transcodingOffsetTicks: 0
        };
        const snapshot = { ...streamInfo };

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            // Caller could not determine the source container's mime type.
            { directPlayMimeType: undefined },
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(false);
        expect(streamInfo).toEqual(snapshot);
    });

    it('sets the HLS mimeType when the descriptor protocol is Hls', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            { data: { Url: '/v2/master.m3u8', Protocol: 'Hls' } }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = { mimeType: 'video/mp4' };

        await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            {},
            baseDeps()
        );

        expect(streamInfo.mimeType).toBe('application/x-mpegURL');
    });

    it('overrides the default subtitle track url when the descriptor carries a SubtitleUrl', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            {
                data: {
                    Url: '/v2/stream',
                    Protocol: 'Http',
                    SubtitleUrl: '/v2/subtitles/2/stream.vtt'
                }
            }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            textTracks: [
                { url: 'https://example.com/legacy-sub-1', isDefault: false },
                { url: 'https://example.com/legacy-sub-2', isDefault: true }
            ]
        };

        await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            { directPlayMimeType: 'video/mp4' },
            baseDeps()
        );

        expect(streamInfo.textTracks?.[0].url).toBe(
            'https://example.com/legacy-sub-1'
        );
        expect(streamInfo.textTracks?.[1].url).toBe(
            'https://example.com/v2/subtitles/2/stream.vtt'
        );
    });

    it('leaves streamInfo untouched when v2 resolution fails', async () => {
        const request = vi.fn().mockRejectedValue(new Error('network down'));
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            playMethod: 'DirectPlay',
            playSessionId: 'legacy-id'
        };
        const snapshot = { ...streamInfo };

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            { directPlayMimeType: 'video/mp4' },
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(false);
        expect(streamInfo).toEqual(snapshot);
    });
});

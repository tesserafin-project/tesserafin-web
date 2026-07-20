import type { Api } from '@jellyfin/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PlaybackUrlResolvingApiClient,
    ResolveV2PlaybackUrlDeps,
    ResolveV2PlaybackUrlParams,
    V2PatchableStreamInfo
} from './playbackSessionV2Url';
import type { ReplanV2PlaybackUrlParams } from './playbackSessionV2Url';
import {
    applyV2PlaybackReplanToStreamInfo,
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
        // Remux over a non-HLS protocol against a PRE-#46 server: the descriptor carries neither
        // `Container` nor `MimeType`, so the server picked the output container and reported it
        // nowhere. There is no correct mime type to write. Rather than mixing a v2 URL with a
        // legacy mime type, the whole decision falls back. Against a #46 server this same case is
        // applied rather than declined - see the 'reefin #46 descriptor' suite below.
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

/**
 * `reefin` #43: the v2 `POST Playback/Sessions` must carry the SAME `PlaybackAttemptId` the
 * attempt's `PlaybackInfo` call already sent, and must omit the field rather than send a blank one
 * (the server accepts absent, rejects empty/whitespace with a 400). The id arrives as a REQUEST
 * parameter (`params.playbackAttemptId`) minted by `playbackmanager.js#playInternal()` - this module
 * never mints one and never reads ambient state, which is what keeps both requests of one attempt on
 * the same value even when a second attempt overlaps this one.
 */
describe('resolveV2PlaybackUrl() PlaybackAttemptId (reefin #43)', () => {
    const logger = { debug: vi.fn() };

    const succeedingRequest = () =>
        mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            { data: { Url: '/Videos/item-1/stream.mp4' } }
        );

    it('sends the attempt id it was passed on the POST body', async () => {
        const request = succeedingRequest();
        const api = createMockApi(request);

        await resolveV2PlaybackUrl(
            { ...baseParams(api), playbackAttemptId: 'attempt-1' },
            { ...baseDeps(), logger }
        );

        const [[postArgs]] = request.mock.calls;
        expect(JSON.parse(postArgs.data).PlaybackAttemptId).toBe('attempt-1');
    });

    it('sends the same id on a second call of the same attempt - the retry case', async () => {
        const first = succeedingRequest();
        await resolveV2PlaybackUrl(
            {
                ...baseParams(createMockApi(first)),
                playbackAttemptId: 'attempt-1'
            },
            { ...baseDeps(), logger }
        );

        const second = succeedingRequest();
        await resolveV2PlaybackUrl(
            {
                ...baseParams(createMockApi(second)),
                playbackAttemptId: 'attempt-1'
            },
            { ...baseDeps(), logger }
        );

        expect(JSON.parse(first.mock.calls[0][0].data).PlaybackAttemptId).toBe(
            JSON.parse(second.mock.calls[0][0].data).PlaybackAttemptId
        );
    });

    it("keeps two overlapping calls on their own ids - never the other call's", async () => {
        // Companion to the concurrency test in `playbackAttemptId.test.ts`: because the id is a
        // parameter of THIS call rather than a module-level read, two resolutions in flight at once
        // cannot substitute each other's value.
        const first = succeedingRequest();
        const second = succeedingRequest();

        await Promise.all([
            resolveV2PlaybackUrl(
                {
                    ...baseParams(createMockApi(first)),
                    playbackAttemptId: 'attempt-a'
                },
                { ...baseDeps(), logger }
            ),
            resolveV2PlaybackUrl(
                {
                    ...baseParams(createMockApi(second)),
                    playbackAttemptId: 'attempt-b'
                },
                { ...baseDeps(), logger }
            )
        ]);

        expect(JSON.parse(first.mock.calls[0][0].data).PlaybackAttemptId).toBe(
            'attempt-a'
        );
        expect(JSON.parse(second.mock.calls[0][0].data).PlaybackAttemptId).toBe(
            'attempt-b'
        );
    });

    it('omits the field entirely when no attempt id is supplied', async () => {
        const request = succeedingRequest();
        const api = createMockApi(request);

        // No `playbackAttemptId` on the params at all - the optional field is simply absent.
        await resolveV2PlaybackUrl(baseParams(api), {
            ...baseDeps(),
            logger
        });

        const body = JSON.parse(request.mock.calls[0][0].data);
        // ABSENT, not `''` - the server 400s on a blank value and accepts a missing one.
        expect('PlaybackAttemptId' in body).toBe(false);
    });

    it('omits the field rather than sending a blank attempt id', async () => {
        const request = succeedingRequest();
        const api = createMockApi(request);

        await resolveV2PlaybackUrl(
            { ...baseParams(api), playbackAttemptId: '   ' },
            { ...baseDeps(), logger }
        );

        const body = JSON.parse(request.mock.calls[0][0].data);
        expect('PlaybackAttemptId' in body).toBe(false);
    });

    it('still succeeds without an attempt id - absent must never break playback', async () => {
        const request = succeedingRequest();
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(baseParams(api), {
            ...baseDeps(),
            logger
        });

        expect(result?.url).toBe('/Videos/item-1/stream.mp4');
    });
});

/**
 * `reefin` PR #46 adds `Container` and `MimeType` to `PlaybackSessionStreamDescriptor`. These cover
 * the perimeter that restores: #24 had to fold remux and transcode over non-HLS onto legacy because
 * the effective output container was reported nowhere, cutting the v2 path down to DirectPlay + HLS
 * and biasing the canary's play-method metrics by construction (issue #44 §8-A).
 *
 * The invariant under all of them: the decision is read off the descriptor's reported fields, never
 * off the URL. Each descriptor URL below is deliberately opaque about its own format, so a test can
 * only pass by consuming `MimeType`.
 */
describe('applyV2PlaybackUrlToStreamInfo() - reefin #46 descriptor', () => {
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

    it('applies a Remux over http using the reported MimeType', async () => {
        // The case #24 had to decline outright. `/v2/opaque` names no container, so the reported
        // MimeType is the only possible source for `video/x-matroska`.
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Remux' } },
            {
                data: {
                    Url: '/v2/opaque',
                    Protocol: 'Http',
                    Container: 'mkv',
                    MimeType: 'video/x-matroska'
                }
            }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            mimeType: 'video/mp4',
            playMethod: 'Transcode',
            playSessionId: 'legacy-id',
            transcodingOffsetTicks: 30000000
        };

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            // No directPlayMimeType: the server's report is what carries this case, not the caller.
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(true);
        expect(streamInfo.url).toBe('https://example.com/v2/opaque');
        expect(streamInfo.playMethod).toBe('DirectStream');
        expect(streamInfo.mimeType).toBe('video/x-matroska');
        // The legacy transcode offset does not survive onto the v2 URL.
        expect(streamInfo.transcodingOffsetTicks).toBe(0);
        expect(streamInfo.executionDecision?.container).toBe('mkv');
        expect(streamInfo.executionDecision?.source).toBe('v2');
    });

    it('applies a Transcode over http using the reported MimeType', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            {
                data: {
                    Url: '/v2/opaque',
                    Protocol: 'Http',
                    Container: 'mp4',
                    MimeType: 'video/mp4'
                }
            }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            mimeType: 'video/x-matroska',
            playMethod: 'DirectPlay',
            transcodingOffsetTicks: 0
        };

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            { requestOptions: { allowAudioStreamCopy: false } },
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(true);
        expect(streamInfo.playMethod).toBe('Transcode');
        expect(streamInfo.mimeType).toBe('video/mp4');
        expect(streamInfo.executionDecision).toEqual({
            source: 'v2',
            url: 'https://example.com/v2/opaque',
            playMethod: 'Transcode',
            mimeType: 'video/mp4',
            transcodingOffsetTicks: 0,
            playSessionId: 'v2-session-id',
            playbackSessionId: 'server-session-1',
            protocol: 'Http',
            container: 'mp4',
            retry: {
                isAlreadyFallbacking: true,
                preventsVideoStreamCopy: false,
                preventsAudioStreamCopy: true
            }
        });
    });

    it('prefers the reported MimeType over the caller directPlayMimeType on DirectPlay', async () => {
        // The server is the authority on what the delivery endpoint will send. The caller's value,
        // derived from the *source* container, must not win over it.
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            {
                data: {
                    Url: '/v2/opaque',
                    Protocol: 'Http',
                    Container: 'webm',
                    MimeType: 'video/webm'
                }
            }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {};

        await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            { directPlayMimeType: 'video/x-matroska' },
            { ...baseDeps(), logger }
        );

        expect(streamInfo.mimeType).toBe('video/webm');
        expect(streamInfo.executionDecision?.container).toBe('webm');
    });

    it('uses the reported playlist MimeType on HLS and never depends on Container', async () => {
        // PR #46 notes a v2 HLS response may carry `Container: null` with a correct `MimeType`. The
        // HLS path must key off `Protocol` alone; a decision that consulted `Container` here would
        // decline this response.
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            {
                data: {
                    Url: '/v2/opaque',
                    Protocol: 'Hls',
                    Container: null,
                    MimeType: 'application/vnd.apple.mpegurl'
                }
            }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = { mimeType: 'video/mp4' };

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(true);
        expect(streamInfo.mimeType).toBe('application/vnd.apple.mpegurl');
        // Reported as absent rather than coerced to a placeholder.
        expect(streamInfo.executionDecision?.container).toBeUndefined();
        expect(streamInfo.executionDecision?.protocol).toBe('Hls');
    });

    it('reports the HLS segment container without letting it reach mimeType', async () => {
        // On HLS the container describes the *segments*; `url` addresses the playlist. Both are
        // carried, and they must not be conflated.
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            {
                data: {
                    Url: '/v2/opaque',
                    Protocol: 'Hls',
                    Container: 'ts',
                    MimeType: 'application/vnd.apple.mpegurl'
                }
            }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {};

        await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            {},
            { ...baseDeps(), logger }
        );

        expect(streamInfo.executionDecision?.container).toBe('ts');
        expect(streamInfo.mimeType).toBe('application/vnd.apple.mpegurl');
    });

    it('treats a null MimeType as absence, not as a value (transcode over http declines)', async () => {
        // The server sends `null` rather than `application/octet-stream` when it has no mapping for
        // the container, precisely so a client can tell "unknown" from "opaque bytes". Writing the
        // null through - or substituting a placeholder - would be the failure this asserts against.
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            {
                data: {
                    Url: '/v2/opaque',
                    Protocol: 'Http',
                    Container: 'weird',
                    MimeType: null
                }
            }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {
            url: 'https://example.com/legacy',
            mimeType: 'video/mp4',
            playMethod: 'Transcode',
            transcodingOffsetTicks: 30000000
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
        // Not one field moved - the URL included. A reported Container is NOT a licence to derive
        // a mime type client-side and overrule the server's own "I don't know".
        expect(streamInfo).toEqual(snapshot);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('cannot supply a complete execution state')
        );
    });

    it('falls back to the caller directPlayMimeType when a null MimeType lands on DirectPlay', async () => {
        // DirectPlay serves the source file itself, so the caller's value describes the *source*
        // and is not a guess at a server-side choice. This keeps a pre-#46 server on exactly the
        // #24 behavior instead of regressing it.
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'DirectPlay' } },
            { data: { Url: '/v2/opaque', Protocol: 'Http', MimeType: null } }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {};

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            { directPlayMimeType: 'video/mp4' },
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(true);
        expect(streamInfo.mimeType).toBe('video/mp4');
    });

    it('falls back to the HLS playlist type when a pre-#46 server reports no MimeType', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            { data: { Url: '/v2/opaque', Protocol: 'Hls' } }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {};

        const applied = await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(true);
        expect(streamInfo.mimeType).toBe('application/x-mpegURL');
        expect(streamInfo.executionDecision?.container).toBeUndefined();
    });

    it('carries retry metadata with no URL heuristic left to find, on a v2 retry', async () => {
        // Issue #44 requirement 4. `onPlaybackError`'s ladder used to recover its inputs with
        // `url.includes('transcodereasons')` and `url.indexOf('allowvideostreamcopy=false')`. A v2
        // URL carries neither, so under the old heuristics every flag read false and the ladder
        // degraded silently. Here the client has already retried with stream copy disabled: the
        // metadata must reflect that from the request options, while the URL stays free of both
        // substrings.
        const request = mockPostThenGet(
            { data: { Id: 'server-session-2', Method: 'Transcode' } },
            {
                data: {
                    Url: '/v2/opaque',
                    Protocol: 'Http',
                    Container: 'mp4',
                    MimeType: 'video/mp4'
                }
            }
        );
        const api = createMockApi(request);
        const streamInfo: V2PatchableStreamInfo = {};

        await applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            baseParams(api),
            apiClient,
            {
                requestOptions: {
                    allowVideoStreamCopy: false,
                    allowAudioStreamCopy: false
                }
            },
            { ...baseDeps(), logger }
        );

        const url = streamInfo.url?.toLowerCase() ?? '';
        expect(url).not.toContain('transcodereasons');
        expect(url).not.toContain('allowvideostreamcopy');
        expect(url).not.toContain('allowaudiostreamcopy');

        // The state the URL cannot carry is carried explicitly instead.
        expect(streamInfo.executionDecision?.retry).toEqual({
            isAlreadyFallbacking: true,
            preventsVideoStreamCopy: true,
            preventsAudioStreamCopy: true
        });
    });

    it('exposes Container and MimeType on the resolved result verbatim', async () => {
        const request = mockPostThenGet(
            { data: { Id: 'server-session-1', Method: 'Remux' } },
            {
                data: {
                    Url: '/v2/opaque',
                    Protocol: 'Http',
                    Container: 'mkv',
                    MimeType: 'video/x-matroska'
                }
            }
        );
        const api = createMockApi(request);

        const result = await resolveV2PlaybackUrl(baseParams(api), {
            ...baseDeps(),
            logger
        });

        // PascalCase on the wire, camelCase on the result - asserted so a rename on either side
        // cannot pass silently.
        expect(result?.container).toBe('mkv');
        expect(result?.mimeType).toBe('video/x-matroska');
    });
});

describe('applyV2PlaybackReplanToStreamInfo()', () => {
    let logger: {
        debug: ReturnType<typeof vi.fn>;
        warn: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        logger = { debug: vi.fn(), warn: vi.fn() };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const replanApiClient = { getUrl: (url: string) => `https://server${url}` };

    const replanParams = (
        api: Api,
        overrides: Partial<ReplanV2PlaybackUrlParams> = {}
    ): ReplanV2PlaybackUrlParams => ({
        ...baseParams(api),
        playbackAttemptId: 'attempt-1',
        sessionId: 'server-session-1',
        playSessionId: 'play-session-1',
        ...overrides
    });

    /** A legacy `streamInfo` as the retry's `createStreamInfo()` would have produced it. */
    const legacyRetryStreamInfo = (): V2PatchableStreamInfo => ({
        url: 'https://server/legacy/retry.m3u8',
        mimeType: 'video/mp4',
        playMethod: 'Transcode',
        playSessionId: 'legacy-session'
    });

    /** Queues the PUT response then the GET .../Stream response on the same seam, mirroring
     * `mockPostThenGet` for the two sequential calls the re-plan makes. */
    function mockPutThenGet(
        putResponse: unknown,
        getResponse: unknown
    ): ReturnType<typeof vi.fn> {
        const request = vi.fn();
        request.mockImplementationOnce(() => Promise.resolve(putResponse));
        request.mockImplementationOnce(() => Promise.resolve(getResponse));
        return request;
    }

    it('happy path: PUTs Playback/Sessions/{id} then GETs .../Stream and patches streamInfo whole', async () => {
        const request = mockPutThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            {
                data: {
                    Url: '/videos/item-1/master.m3u8?PlaySessionId=play-session-1',
                    Protocol: 'Hls',
                    ServedBy: 2,
                    FallbackReason: null,
                    MimeType: 'application/x-mpegURL',
                    Container: 'ts'
                }
            }
        );
        const api = createMockApi(request);
        const streamInfo = legacyRetryStreamInfo();

        const applied = await applyV2PlaybackReplanToStreamInfo(
            streamInfo,
            replanParams(api),
            replanApiClient,
            { requestOptions: { allowVideoStreamCopy: false } },
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(true);

        expect(request).toHaveBeenCalledTimes(2);
        const [[putArgs], [getArgs]] = request.mock.calls;
        expect(putArgs).toEqual(
            expect.objectContaining({
                url: 'https://example.com/Playback/Sessions/server-session-1',
                method: 'PUT'
            })
        );
        const putBody = JSON.parse(putArgs.data);
        expect(putBody).toEqual({
            ItemId: 'item-1',
            UserId: 'user-1',
            MediaSourceId: 'media-source-1',
            Capabilities: NATIVE_CAPABILITIES,
            Constraints: NATIVE_CONSTRAINTS,
            // The SAME attempt id the retry's PlaybackInfo POST carried - never re-minted.
            PlaybackAttemptId: 'attempt-1'
        });
        // Route-addressed: `ReplacePlaybackSessionRequest` has no PlaySessionId field, and one
        // sneaking into the body would be the server contract's misuse case.
        expect(putBody).not.toHaveProperty('PlaySessionId');
        expect(getArgs).toEqual(
            expect.objectContaining({
                url: 'https://example.com/Playback/Sessions/server-session-1/Stream',
                method: 'GET'
            })
        );

        // The whole execution state moved together (issue #41's all-or-nothing contract).
        expect(streamInfo.url).toBe(
            'https://server/videos/item-1/master.m3u8?PlaySessionId=play-session-1'
        );
        expect(streamInfo.playMethod).toBe('Transcode');
        // A re-plan keeps the session's ORIGINAL PlaySessionId - never a fresh one.
        expect(streamInfo.playSessionId).toBe('play-session-1');
        expect(streamInfo.mimeType).toBe('application/x-mpegURL');
        expect(streamInfo.transcodingOffsetTicks).toBe(0);
        expect(streamInfo.executionDecision).toEqual(
            expect.objectContaining({
                source: 'v2',
                playbackSessionId: 'server-session-1',
                playSessionId: 'play-session-1',
                retry: expect.objectContaining({
                    isAlreadyFallbacking: true,
                    preventsVideoStreamCopy: true
                })
            })
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('threads the retry constraint overrides into buildConstraints alongside startTimeTicks', async () => {
        const buildConstraints = vi.fn(() => NATIVE_CONSTRAINTS);
        const request = mockPutThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            {
                data: {
                    Url: '/videos/item-1/master.m3u8',
                    Protocol: 'Hls',
                    MimeType: 'application/x-mpegURL'
                }
            }
        );
        const api = createMockApi(request);

        await applyV2PlaybackReplanToStreamInfo(
            legacyRetryStreamInfo(),
            replanParams(api, {
                constraintOverrides: {
                    allowDirectPlay: false,
                    allowDirectStream: true,
                    allowVideoStreamCopy: true,
                    allowAudioStreamCopy: false
                }
            }),
            replanApiClient,
            {},
            { ...baseDeps(), buildConstraints, logger }
        );

        // The ladder's prohibitions must reach the wire, or the server would re-plan the exact
        // decision that just failed.
        expect(buildConstraints).toHaveBeenCalledWith({
            startTimeTicks: 30000000,
            allowDirectPlay: false,
            allowDirectStream: true,
            allowVideoStreamCopy: true,
            allowAudioStreamCopy: false
        });
    });

    it('does not call the API and warns for a mediaType other than Video/Audio', async () => {
        const request = vi.fn();
        const api = createMockApi(request);
        const streamInfo = legacyRetryStreamInfo();

        const applied = await applyV2PlaybackReplanToStreamInfo(
            streamInfo,
            replanParams(api, { mediaType: 'Book' }),
            replanApiClient,
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(false);
        expect(request).not.toHaveBeenCalled();
        expect(streamInfo).toEqual(legacyRetryStreamInfo());
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('unsupported mediaType')
        );
    });

    it('falls back EXPLICITLY on a PUT 4xx/5xx: warns with the status, streamInfo untouched', async () => {
        // The server contract's 422 "nothing plannable" case - the session keeps serving its old
        // plan, and this client keeps its legacy retry URL.
        const request = vi.fn(() =>
            Promise.reject(
                Object.assign(new Error('Unprocessable Entity'), {
                    response: { status: 422 }
                })
            )
        );
        const api = createMockApi(request);
        const streamInfo = legacyRetryStreamInfo();

        const applied = await applyV2PlaybackReplanToStreamInfo(
            streamInfo,
            replanParams(api),
            replanApiClient,
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(false);
        expect(streamInfo).toEqual(legacyRetryStreamInfo());
        // Exactly one PUT was attempted - no GET follows a failed re-plan.
        expect(request).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('HTTP 422'),
            expect.any(Error)
        );
    });

    it('falls back EXPLICITLY on a network failure: warns naming it, streamInfo untouched', async () => {
        const request = vi.fn(() => Promise.reject(new Error('Network Error')));
        const api = createMockApi(request);
        const streamInfo = legacyRetryStreamInfo();

        const applied = await applyV2PlaybackReplanToStreamInfo(
            streamInfo,
            replanParams(api),
            replanApiClient,
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(false);
        expect(streamInfo).toEqual(legacyRetryStreamInfo());
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('network or client error'),
            expect.any(Error)
        );
    });

    it('falls back EXPLICITLY when the re-planned GET .../Stream supplies no Url', async () => {
        const request = mockPutThenGet(
            { data: { Id: 'server-session-1', Method: 'Transcode' } },
            { data: { Url: null, Protocol: 'Hls' } }
        );
        const api = createMockApi(request);
        const streamInfo = legacyRetryStreamInfo();

        const applied = await applyV2PlaybackReplanToStreamInfo(
            streamInfo,
            replanParams(api),
            replanApiClient,
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(false);
        expect(streamInfo).toEqual(legacyRetryStreamInfo());
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('supplied no Url')
        );
    });

    it('falls back EXPLICITLY when the responses cannot supply a complete execution state', async () => {
        // Remux over plain HTTP against a pre-#46 server (no MimeType reported) and no caller
        // fallback: nothing can name the output type, so the legacy decision stays whole - and
        // on the re-plan path that decline must be WARNED, not silent.
        const request = mockPutThenGet(
            { data: { Id: 'server-session-1', Method: 'Remux' } },
            { data: { Url: '/videos/item-1/stream.mkv', Protocol: 'Http' } }
        );
        const api = createMockApi(request);
        const streamInfo = legacyRetryStreamInfo();

        const applied = await applyV2PlaybackReplanToStreamInfo(
            streamInfo,
            replanParams(api),
            replanApiClient,
            {},
            { ...baseDeps(), logger }
        );

        expect(applied).toBe(false);
        expect(streamInfo).toEqual(legacyRetryStreamInfo());
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('complete execution state')
        );
    });
});

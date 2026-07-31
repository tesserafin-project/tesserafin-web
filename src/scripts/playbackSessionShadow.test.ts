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

import type {
    ShadowPlaybackSessionDeps,
    ShadowPlaybackSessionParams
} from './playbackSessionShadow';
import { sendShadowPlaybackSession } from './playbackSessionShadow';

/**
 * Tests the shadow-call orchestration in isolation against a minimal mocked `Api`, mirroring
 * `playbackDiagnosticsApi.test.ts`'s pattern: the generated client always dispatches through
 * `axiosInstance.request(...)`, so the mock shape is `{ request, defaults }` (`defaults` is read by
 * the generated `createRequestFunction` helper before `request` is ever called).
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): Api =>
    ({
        axiosInstance: { request, defaults: {} },
        basePath: 'https://example.com',
        authorizationHeader: 'MediaBrowser Token="test-token"'
    }) as unknown as Api;

const baseParams = (api: Api): ShadowPlaybackSessionParams => ({
    api,
    itemId: 'item-1',
    userId: 'user-1',
    mediaSourceId: 'media-source-1'
});

const NATIVE_CAPABILITIES = {
    Decode: { DirectPlayProfiles: [], VideoCodecs: [], AudioCodecs: [] },
    OutputProfiles: []
} as unknown as ReturnType<
    NonNullable<ShadowPlaybackSessionDeps['buildCapabilities']>
>;

const NATIVE_CONSTRAINTS = {
    AllowDirectPlay: true
} as unknown as ReturnType<
    NonNullable<ShadowPlaybackSessionDeps['buildConstraints']>
>;

describe('sendShadowPlaybackSession()', () => {
    let logger: { debug: Mock<(...args: unknown[]) => void> };

    beforeEach(() => {
        logger = { debug: vi.fn<(...args: unknown[]) => void>() };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not call the API at all when the flag is off', async () => {
        const request = vi.fn();
        const api = createMockApi(request);

        await sendShadowPlaybackSession(baseParams(api), {
            isEnabled: () => false,
            logger
        });

        expect(request).not.toHaveBeenCalled();
        expect(logger.debug).not.toHaveBeenCalled();
    });

    it('POSTs Playback/Sessions with a distinct PlaySessionId and the native builder payload when the flag is on', async () => {
        const request = vi.fn().mockResolvedValue({
            data: { DecisionVersion: 2, Method: 'DirectPlay' }
        });
        const api = createMockApi(request);
        const generatePlaySessionId = vi.fn(() => 'shadow-session-id');
        const buildCapabilities = vi.fn(() => NATIVE_CAPABILITIES);
        const buildConstraints = vi.fn(() => NATIVE_CONSTRAINTS);

        await sendShadowPlaybackSession(baseParams(api), {
            isEnabled: () => true,
            generatePlaySessionId,
            buildCapabilities,
            buildConstraints,
            logger
        });

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                url: 'https://example.com/Playback/Sessions',
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'MediaBrowser Token="test-token"'
                })
            })
        );
        // The generated client JSON-serializes the body itself (`serializeDataIfNeeded`,
        // `src/lib/tesserafin-sdk/generated/common.ts`) before handing it to axios - `data` on the
        // captured request args is therefore a JSON string, not the plain object.
        const [[sentArgs]] = request.mock.calls;
        expect(JSON.parse(sentArgs.data)).toEqual({
            ItemId: 'item-1',
            UserId: 'user-1',
            MediaSourceId: 'media-source-1',
            PlaySessionId: 'shadow-session-id',
            Capabilities: NATIVE_CAPABILITIES,
            Constraints: NATIVE_CONSTRAINTS
        });
        expect(buildCapabilities).toHaveBeenCalledOnce();
        expect(buildConstraints).toHaveBeenCalledOnce();
    });

    it('never reuses a caller-supplied PlaySessionId - ShadowPlaybackSessionParams has no such field to reuse', async () => {
        const request = vi.fn().mockResolvedValue({
            data: { DecisionVersion: 0, Method: 'Transcode' }
        });
        const api = createMockApi(request);

        await sendShadowPlaybackSession(baseParams(api), {
            isEnabled: () => true,
            generatePlaySessionId: () => 'freshly-generated-id',
            buildCapabilities: () => NATIVE_CAPABILITIES,
            buildConstraints: () => NATIVE_CONSTRAINTS,
            logger
        });

        const [[sentArgs]] = request.mock.calls;
        expect(JSON.parse(sentArgs.data).PlaySessionId).toBe(
            'freshly-generated-id'
        );
    });

    it('generates a PlaySessionId via crypto.randomUUID() by default', async () => {
        const request = vi.fn().mockResolvedValue({
            data: { DecisionVersion: 2, Method: 'DirectPlay' }
        });
        const api = createMockApi(request);
        const randomUUID = vi
            .spyOn(crypto, 'randomUUID')
            // Real return type is a template-literal UUID string; the exact value doesn't matter
            // here, only that this spy is what produced it.
            .mockReturnValue('11111111-1111-1111-1111-111111111111');

        await sendShadowPlaybackSession(baseParams(api), {
            isEnabled: () => true,
            buildCapabilities: () => NATIVE_CAPABILITIES,
            buildConstraints: () => NATIVE_CONSTRAINTS,
            logger
        });

        expect(randomUUID).toHaveBeenCalledOnce();
        const [[sentArgs]] = request.mock.calls;
        expect(JSON.parse(sentArgs.data).PlaySessionId).toBe(
            '11111111-1111-1111-1111-111111111111'
        );
    });

    it('logs DecisionVersion and Method from the response on success', async () => {
        const request = vi.fn().mockResolvedValue({
            data: { DecisionVersion: 2, Method: 'Transcode' }
        });
        const api = createMockApi(request);

        await sendShadowPlaybackSession(baseParams(api), {
            isEnabled: () => true,
            generatePlaySessionId: () => 'shadow-session-id',
            buildCapabilities: () => NATIVE_CAPABILITIES,
            buildConstraints: () => NATIVE_CONSTRAINTS,
            logger
        });

        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('shadow Playback/Sessions decision'),
            expect.objectContaining({ DecisionVersion: 2, Method: 'Transcode' })
        );
    });

    it('swallows a network/API failure into a single debug log - never rejects, never throws', async () => {
        const request = vi.fn().mockRejectedValue(
            Object.assign(new Error('Request failed with status code 422'), {
                isAxiosError: true,
                response: { status: 422 }
            })
        );
        const api = createMockApi(request);

        await expect(
            sendShadowPlaybackSession(baseParams(api), {
                isEnabled: () => true,
                generatePlaySessionId: () => 'shadow-session-id',
                buildCapabilities: () => NATIVE_CAPABILITIES,
                buildConstraints: () => NATIVE_CONSTRAINTS,
                logger
            })
        ).resolves.toBeUndefined();

        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('shadow Playback/Sessions call failed'),
            expect.anything()
        );
    });

    it('swallows a missing/misconfigured api (throws while building the request) the same way', async () => {
        const brokenApi = {
            get axiosInstance(): never {
                throw new Error('no axios instance configured');
            },
            basePath: 'https://example.com',
            authorizationHeader: 'MediaBrowser Token="test-token"'
        } as unknown as Api;

        await expect(
            sendShadowPlaybackSession(baseParams(brokenApi), {
                isEnabled: () => true,
                generatePlaySessionId: () => 'shadow-session-id',
                buildCapabilities: () => NATIVE_CAPABILITIES,
                buildConstraints: () => NATIVE_CONSTRAINTS,
                logger
            })
        ).resolves.toBeUndefined();

        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('shadow Playback/Sessions call failed'),
            expect.anything()
        );
    });
});

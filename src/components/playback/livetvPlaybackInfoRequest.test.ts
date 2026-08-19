/**
 * #153-LTV-P0 - Live TV `PlaybackInfo` source-selection contract.
 *
 * Every assertion inspects the `playbackInfoDto` actually handed to
 * `getMediaInfoApi(api).getPostedPlaybackInfo(...)` by the real `PlaybackManager`, driven through
 * its public entry points (`play()`, `nextTrack()`, `getPlaybackInfo()`). Nothing here rebuilds
 * the request from a helper, and no test calls the selection predicate directly.
 *
 * See docs/tesserafin/live-tv-playbackinfo-source-selection.md for the frozen contract and for the
 * software-tuner run these ids come from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `playbackmanager` pulls in `webSettings` -> `apphost` -> the route tree, which read webpack
// build-time globals. Without these three the module graph throws at import time.
vi.stubGlobal('__WEBPACK_SERVE__', false);
vi.stubGlobal('__USE_SYSTEM_FONTS__', false);
vi.stubGlobal('__JF_BUILD_VERSION__', 'test');

import {
    CHANNEL_ITEM_ID,
    SERVER_ID,
    TUNER_SOURCE_ID,
    USER_ID,
    VIDEO_ITEM_ID,
    audioItem,
    audioSource,
    channelItem,
    createFakePlayer,
    createPlaybackInfoResponder,
    recordingItem,
    recordingSource,
    tunerSource,
    videoItem,
    videoSource
} from './__testSupport/livetvHarness';

const postedPlaybackInfo = vi.fn();
const alerts: unknown[] = [];

vi.mock('@jellyfin/sdk/lib/utils/api/media-info-api', () => ({
    getMediaInfoApi: () => ({ getPostedPlaybackInfo: postedPlaybackInfo })
}));

vi.mock('components/alert', () => ({
    default: (opts: unknown) => {
        alerts.push(opts);
        return Promise.resolve();
    }
}));

const apiClient = {
    serverId: () => SERVER_ID,
    serverAddress: () => 'http://127.0.0.1:8096',
    accessToken: () => 'test-token',
    deviceId: () => 'ltvp0-device',
    deviceName: () => 'ltvp0-device-name',
    appName: () => 'ltvp0',
    appVersion: () => '1.0.0',
    getCurrentUserId: () => USER_ID,
    getCurrentUser: () =>
        Promise.resolve({
            Id: USER_ID,
            Configuration: {
                RememberAudioSelections: true,
                RememberSubtitleSelections: true
            },
            Policy: {}
        }),
    getEndpointInfo: () => Promise.resolve({ IsInNetwork: true }),
    getSavedEndpointInfo: () => ({ IsInNetwork: true }),
    getItem: (_userId: string, id: string) =>
        Promise.resolve(id === VIDEO_ITEM_ID ? videoItem() : channelItem()),
    getItems: () => Promise.resolve({ Items: [] }),
    getIntros: () => Promise.resolve({ Items: [] }),
    getUser: () => Promise.resolve({ Id: USER_ID, Configuration: {} }),
    getUrl: (path: string) => 'http://127.0.0.1:8096/' + path,
    isMinServerVersion: () => true,
    reportPlaybackStart: () => Promise.resolve(),
    reportPlaybackProgress: () => Promise.resolve(),
    reportPlaybackStopped: () => Promise.resolve(),
    getLiveStreamFile: () => '',
    sendMessage: () => undefined,
    ajax: () => Promise.resolve({})
};

const serverConnectionsMock = {
    ServerConnections: {
        getApiClient: () => apiClient,
        getApi: () => ({ axiosInstance: {}, basePath: '', accessToken: '' }),
        currentApiClient: () => apiClient
    }
};

// Partial: `ConnectionState` is consumed by the route tree that `apphost` drags in.
vi.mock('lib/jellyfin-apiclient', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('lib/jellyfin-apiclient')>();
    return { ...actual, ...serverConnectionsMock };
});
vi.mock('lib/jellyfin-apiclient/ServerConnections', () => ({
    default: serverConnectionsMock.ServerConnections
}));

/**
 * The exact `playbackInfoDto` key set unmodified `main` sends for the queue-advance channel
 * request, captured from this same harness before the repair. `MediaSourceId` is the only key the
 * repair is allowed to remove; every other key must survive with its value.
 */
const CLEAN_MAIN_CHANNEL_REQUEST_KEYS = [
    'AlwaysBurnInSubtitleWhenTranscoding',
    'AutoOpenLiveStream',
    'DeviceProfile',
    'DirectPlayProtocols',
    'IsPlayback',
    'MediaSourceId',
    'PlaybackAttemptId',
    'StartTimeTicks',
    'SubtitleStreamIndex',
    'UserId'
].sort();

const CLEAN_MAIN_CHANNEL_REQUEST_VALUES: Record<string, unknown> = {
    AlwaysBurnInSubtitleWhenTranscoding: false,
    AutoOpenLiveStream: true,
    DirectPlayProtocols: ['File'],
    IsPlayback: true,
    StartTimeTicks: 0,
    SubtitleStreamIndex: -1,
    UserId: USER_ID
};

async function mountManager() {
    const { PlaybackManager } = await import(
        'components/playback/playbackmanager'
    );
    const { pluginManager } = await import('components/pluginManager');
    const Events = (await import('utils/events')).default;

    const manager = new PlaybackManager();
    const player = createFakePlayer();
    Events.trigger(pluginManager, 'registered', [player]);
    return { manager, player };
}

/**
 * Wait for the manager's un-awaited promise chains to have produced `count` requests. A fixed
 * number of macrotask turns would turn a starved machine into a bogus "MediaSourceId" failure;
 * this fails with its own named message instead, so every assertion below stays about source
 * selection.
 */
async function waitForRequests(count: number) {
    await vi.waitFor(
        () => expect(postedPlaybackInfo).toHaveBeenCalledTimes(count),
        { timeout: 20000, interval: 10 }
    );
}

function requests() {
    return postedPlaybackInfo.mock.calls.map((call) => call[0]);
}

describe('Live TV PlaybackInfo source selection', () => {
    beforeEach(() => {
        postedPlaybackInfo.mockReset();
        alerts.length = 0;
        postedPlaybackInfo.mockImplementation(
            createPlaybackInfoResponder({
                [VIDEO_ITEM_ID]: [videoSource()],
                [CHANNEL_ITEM_ID]: [tunerSource()]
            })
        );
    });

    /**
     * The original defect fixture. An ordinary video with its subtitle selection remembered as
     * "off" (-1) is playing; a Live TV channel has been added to the play queue
     * (`itemContextMenu` offers this because `canQueue(channel)` is true while a video player is
     * active); the queue then advances onto the channel.
     *
     * On unmodified `main` this sends `MediaSourceId = <channel item id>`, the server narrows the
     * source list to nothing, and playback dies with `NoCompatibleStream`.
     */
    it('omits the placeholder id when a queue advance lands on a Live TV channel', async () => {
        const { manager, player } = await mountManager();

        await manager.play({ items: [videoItem(), channelItem()] });
        await waitForRequests(1);

        manager.nextTrack(player);
        await waitForRequests(2);

        const captured = requests();
        expect(captured).toHaveLength(2);

        const channelRequest = captured[1];
        expect(channelRequest.itemId).toBe(CHANNEL_ITEM_ID);
        expect(channelRequest.playbackInfoDto).not.toHaveProperty(
            'MediaSourceId'
        );
    });

    it('returns a real tuner source, not NoCompatibleStream, for that same fixture', async () => {
        const { manager, player } = await mountManager();

        await manager.play({ items: [videoItem(), channelItem()] });
        await waitForRequests(1);

        manager.nextTrack(player);
        await waitForRequests(2);

        const channelRequest = requests()[1];
        const response = await postedPlaybackInfo.mock.results[1].value;

        expect(channelRequest.itemId).toBe(CHANNEL_ITEM_ID);
        expect(response.data.ErrorCode).toBeUndefined();
        expect(response.data.MediaSources).toHaveLength(1);
        expect(response.data.MediaSources[0].Id).toBe(TUNER_SOURCE_ID);
        expect(alerts).toEqual([]);
    });

    it('changes no other field of the channel request', async () => {
        const { manager, player } = await mountManager();

        await manager.play({ items: [videoItem(), channelItem()] });
        await waitForRequests(1);

        manager.nextTrack(player);
        await waitForRequests(2);

        const body = requests()[1].playbackInfoDto as Record<string, unknown>;

        expect(Object.keys(body).sort()).toEqual(
            CLEAN_MAIN_CHANNEL_REQUEST_KEYS.filter(
                (key) => key !== 'MediaSourceId'
            )
        );
        for (const [key, value] of Object.entries(
            CLEAN_MAIN_CHANNEL_REQUEST_VALUES
        )) {
            expect(body[key]).toEqual(value);
        }
        expect(body.DeviceProfile).toBeTruthy();
        expect(typeof body.PlaybackAttemptId).toBe('string');
    });

    it.each([
        ['TvChannel', 'TvChannel'],
        ['LiveTvChannel', 'LiveTvChannel']
    ])(
        'omits a placeholder id supplied directly for a %s item',
        async (_label, type) => {
            const { manager } = await mountManager();

            // The assertion is about the request that went out. Whether the *response* can be
            // turned into a stream is a different property, covered by its own test.
            await manager
                .getPlaybackInfo(channelItem({ Type: type }), {
                    mediaSourceId: CHANNEL_ITEM_ID
                })
                .catch(() => undefined);
            await waitForRequests(1);

            const body = requests()[0].playbackInfoDto as Record<
                string,
                unknown
            >;
            expect(body).not.toHaveProperty('MediaSourceId');
        }
    );

    it('preserves a resolved tuner source id for a Live TV channel', async () => {
        const { manager } = await mountManager();

        await manager.getPlaybackInfo(channelItem(), {
            mediaSourceId: TUNER_SOURCE_ID
        }).catch(() => undefined);
        await waitForRequests(1);

        const body = requests()[0].playbackInfoDto as Record<string, unknown>;
        expect(body.MediaSourceId).toBe(TUNER_SOURCE_ID);
    });

    it('omits MediaSourceId for a Live TV channel when no source id is supplied', async () => {
        const { manager } = await mountManager();

        await manager.getPlaybackInfo(channelItem(), {}).catch(() => undefined);
        await waitForRequests(1);

        const body = requests()[0].playbackInfoDto as Record<string, unknown>;
        expect(body).not.toHaveProperty('MediaSourceId');
    });

    it('preserves a non-live video source id even when it equals the item id', async () => {
        postedPlaybackInfo.mockImplementation(
            createPlaybackInfoResponder({
                [VIDEO_ITEM_ID]: [videoSource({ Id: VIDEO_ITEM_ID })]
            })
        );
        const { manager } = await mountManager();

        await manager.getPlaybackInfo(
            videoItem({ MediaSources: [videoSource({ Id: VIDEO_ITEM_ID })] }),
            { mediaSourceId: VIDEO_ITEM_ID }
        ).catch(() => undefined);
        await waitForRequests(1);

        const body = requests()[0].playbackInfoDto as Record<string, unknown>;
        expect(body.MediaSourceId).toBe(VIDEO_ITEM_ID);
    });

    it('leaves audio source selection unchanged', async () => {
        const audio = audioItem();
        postedPlaybackInfo.mockImplementation(
            createPlaybackInfoResponder({
                [audio.Id as string]: [audioSource({ Id: audio.Id as string })]
            })
        );
        const { manager, player } = await mountManager();
        // Without this the manager builds an audio stream url instead of asking the server.
        (player as Record<string, unknown>).useServerPlaybackInfoForAudio = true;

        await manager.getPlaybackInfo(audio, {
            mediaSourceId: audio.Id as string,
            mediaType: 'Audio'
        }).catch(() => undefined);
        await waitForRequests(1);

        const body = requests()[0].playbackInfoDto as Record<string, unknown>;
        expect(body.MediaSourceId).toBe(audio.Id);
    });

    it('leaves recordings unchanged', async () => {
        const recording = recordingItem();
        postedPlaybackInfo.mockImplementation(
            createPlaybackInfoResponder({
                [recording.Id as string]: [
                    recordingSource({ Id: recording.Id as string })
                ]
            })
        );
        const { manager } = await mountManager();

        await manager.getPlaybackInfo(recording, {
            mediaSourceId: recording.Id as string
        }).catch(() => undefined);
        await waitForRequests(1);

        const body = requests()[0].playbackInfoDto as Record<string, unknown>;
        expect(body.MediaSourceId).toBe(recording.Id);
    });
});

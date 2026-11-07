import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    SERVER_ID,
    USER_ID,
    createFakePlayer,
    videoItem,
    videoSource
} from './__testSupport/livetvHarness';

vi.stubGlobal('__WEBPACK_SERVE__', false);
vi.stubGlobal('__USE_SYSTEM_FONTS__', false);
vi.stubGlobal('__JF_BUILD_VERSION__', 'test');

const seriesId = 'series';
function episode(number: number) {
    return {
        ...videoItem(),
        Id: `episode-${number}`,
        SeriesId: seriesId,
        SeasonId: number <= 100 ? 'season-one' : 'season-two',
        Type: 'Episode',
        UserData: {
            Played: false,
            PlaybackPositionTicks: number === 1 ? 30000000 : 0
        }
    };
}
const catalogue = Array.from({ length: 130 }, (_, i) => episode(i + 1));
type EpisodeQuery = { startItemId?: string; SeasonId?: string; limit?: number };

async function page(_seriesId: string, query: EpisodeQuery) {
    const visible = catalogue.filter(
        (item) => !query.SeasonId || item.SeasonId === query.SeasonId
    );
    const index = query.startItemId
        ? visible.findIndex((item) => item.Id === query.startItemId)
        : 0;
    const remaining = index < 0 ? [] : visible.slice(index);
    return {
        Items: remaining
            .slice(0, query.limit)
            .map((item) => structuredClone(item)),
        TotalRecordCount: remaining.length,
        StartIndex: 0
    };
}

const getEpisodes = vi.fn(page);
const reportPlaybackStopped = vi.fn(async () => undefined);
const alerts = vi.fn(async () => undefined);
let activeUserId = USER_ID;

const apiClient = {
    getEpisodes,
    getNextUpEpisodes: async () => ({ Items: [episode(1)] }),
    serverId: () => SERVER_ID,
    serverAddress: () => 'http://127.0.0.1:8096',
    accessToken: () => 'fixture',
    deviceId: () => 'fixture',
    deviceName: () => 'fixture',
    appName: () => 'fixture',
    appVersion: () => '1.0.0',
    getCurrentUserId: () => activeUserId,
    getCurrentUser: async () => ({
        Id: activeUserId,
        Configuration: { EnableNextEpisodeAutoPlay: true },
        Policy: {}
    }),
    getEndpointInfo: async () => ({ IsInNetwork: true }),
    getSavedEndpointInfo: () => ({ IsInNetwork: true }),
    getItem: async (_userId: string, id: string) => videoItem({ Id: id }),
    getIntros: async () => ({ Items: [] }),
    getUrl: (path: string, options?: Record<string, string>) =>
        `http://127.0.0.1:8096/${path}?${new URLSearchParams(options)}`,
    isMinServerVersion: () => true,
    reportPlaybackStart: async () => undefined,
    reportPlaybackProgress: async () => undefined,
    reportPlaybackStopped,
    sendMessage: () => undefined,
    ajax: async () => ({})
};
const connections = {
    getApiClient: () => apiClient,
    getApi: () => ({ axiosInstance: {}, basePath: '', accessToken: '' }),
    currentApiClient: () => apiClient
};
vi.mock('lib/jellyfin-apiclient', async (importOriginal) => ({
    ...(await importOriginal<typeof import('lib/jellyfin-apiclient')>()),
    ServerConnections: connections
}));
vi.mock('lib/jellyfin-apiclient/ServerConnections', () => ({
    default: connections
}));
vi.mock('components/alert', () => ({ default: alerts }));
vi.mock('lib/playbackCredentials/broker', () => ({
    brokerFor: async () => ({
        mediaValue: async () => 'fixture-capability',
        releasePlaySession: () => undefined
    })
}));

const postedPlaybackInfo = vi.fn(async ({ itemId }: { itemId: string }) => ({
    data: {
        MediaSources: [videoSource({ Id: itemId })],
        PlaySessionId: 'session-' + itemId
    }
}));
vi.mock('@jellyfin/sdk/lib/utils/api/media-info-api', () => ({
    getMediaInfoApi: () => ({ getPostedPlaybackInfo: postedPlaybackInfo })
}));

const { playbackManager: manager } = await import('./playbackmanager');
const { pluginManager } = await import('../pluginManager');
const Events = (await import('../../utils/events')).default;

const player = createFakePlayer();
player.stop = async (_destroy: boolean, notify: boolean) => {
    if (notify) Events.trigger(player, 'stopped');
};
Events.trigger(pluginManager, 'registered', [player]);

async function selectLastBufferedEpisode() {
    const last = (await manager.getPlaylist(player)).at(-1);
    manager.setCurrentPlaylistItem(last.PlaylistItemId, player);
    await vi.waitFor(() =>
        expect(manager.currentItem(player)?.Id).toBe(last.Id)
    );
}

const series = { Id: seriesId, Type: 'Series', ServerId: SERVER_ID };
const season = {
    Id: 'season-one',
    Type: 'Season',
    SeriesId: seriesId,
    ServerId: SERVER_ID
};

describe('ordered series playback', { timeout: 30000 }, () => {
    beforeEach(() => {
        getEpisodes.mockReset();
        getEpisodes.mockImplementation(page);
        reportPlaybackStopped.mockClear();
        postedPlaybackInfo.mockClear();
        alerts.mockClear();
        activeUserId = USER_ID;
    });

    it('resumes and autoplays all 130 episodes in order, with bounded requests and history', async () => {
        await manager.play({ items: [series] });
        expect(manager.currentItem(player).Id).toBe('episode-1');
        expect(postedPlaybackInfo.mock.calls[0][0]).toMatchObject({
            playbackInfoDto: { StartTimeTicks: 30000000 }
        });

        let maxHistory = 0;
        let maxQueueSize = 0;
        for (let number = 2; number <= 130; number++) {
            Events.trigger(player, 'stopped');
            await vi.waitFor(
                () =>
                    expect(manager.currentItem(player)?.Id).toBe(
                        `episode-${number}`
                    ),
                { interval: 5 }
            );
            maxHistory = Math.max(
                maxHistory,
                manager.getCurrentPlaylistIndex(player)
            );
            maxQueueSize = Math.max(
                maxQueueSize,
                (await manager.getPlaylist(player)).length
            );
        }
        Events.trigger(player, 'stopped');
        await vi.waitFor(() => expect(manager.getCurrentPlayer()).toBeNull());
        expect(postedPlaybackInfo.mock.calls.map(([r]) => r.itemId)).toEqual(
            catalogue.map((item) => item.Id)
        );
        expect(
            getEpisodes.mock.calls.map(([, query]) => [
                query.startItemId,
                query.limit
            ])
        ).toEqual([
            ['episode-1', 100],
            ['episode-100', 26],
            ['episode-125', 26]
        ]);
        expect(maxHistory).toBe(3);
        expect(maxQueueSize).toBeLessThanOrEqual(100);
        expect(reportPlaybackStopped).toHaveBeenCalledTimes(130);
        expect(alerts).not.toHaveBeenCalled();
    });

    it('keeps explicit single-season playback within its season', async () => {
        await manager.play({ items: [season] });
        await selectLastBufferedEpisode();
        Events.trigger(player, 'stopped');
        await vi.waitFor(() => expect(manager.getCurrentPlayer()).toBeNull());
        expect(getEpisodes).toHaveBeenCalledTimes(1);
        expect(getEpisodes.mock.calls[0][1].SeasonId).toBe('season-one');
        expect(postedPlaybackInfo.mock.calls.map(([r]) => r.itemId)).toEqual([
            'episode-1',
            'episode-100'
        ]);
    });

    it('retries a failed prefetch at the boundary, from the same anchor', async () => {
        getEpisodes
            .mockImplementationOnce(page)
            .mockRejectedValueOnce(new Error('offline'));
        await manager.play({ items: [episode(1)] });
        await selectLastBufferedEpisode();
        await vi.waitFor(() => expect(getEpisodes).toHaveBeenCalledTimes(2));
        Events.trigger(player, 'stopped');
        await vi.waitFor(() =>
            expect(manager.currentItem(player)?.Id).toBe('episode-101')
        );
        expect(getEpisodes.mock.calls[2][1].startItemId).toBe('episode-100');
        expect(alerts).not.toHaveBeenCalled();
        await manager.stop(player);
    });

    it.each(['stop', 'account change', 'another title'] as const)(
        'discards an in-flight refill after %s',
        async (action) => {
            let completePage!: (
                result: Awaited<ReturnType<typeof page>>
            ) => void;
            const pendingPage = new Promise<Awaited<ReturnType<typeof page>>>(
                (resolve) => {
                    completePage = resolve;
                }
            );
            getEpisodes
                .mockImplementationOnce(page)
                .mockReturnValueOnce(pendingPage);
            await manager.play({ items: [episode(1)] });
            await selectLastBufferedEpisode();
            await vi.waitFor(() =>
                expect(getEpisodes).toHaveBeenCalledTimes(2)
            );
            Events.trigger(player, 'stopped');
            if (action === 'stop') {
                await manager.stop(player);
                await vi.waitFor(() =>
                    expect(manager.getCurrentPlayer()).toBeNull()
                );
            } else if (action === 'account change') {
                activeUserId = 'another-account';
            } else {
                await manager.play({ items: [videoItem()] });
            }
            completePage(
                await page(seriesId, { startItemId: 'episode-100', limit: 26 })
            );
            if (action === 'another title') {
                expect(await manager.getPlaylist(player)).toMatchObject([
                    { Id: videoItem().Id }
                ]);
                expect(manager.currentItem(player)?.Id).toBe(videoItem().Id);
            } else {
                await vi.waitFor(() =>
                    expect(manager.getCurrentPlayer()).toBeNull()
                );
            }
            const expected = ['episode-1', 'episode-100'];
            if (action === 'another title') expected.push(videoItem().Id);
            expect(
                postedPlaybackInfo.mock.calls.map(([r]) => r.itemId)
            ).toEqual(expected);
            expect(reportPlaybackStopped).toHaveBeenCalledTimes(2);
            expect(alerts).not.toHaveBeenCalled();
            if (action === 'another title') await manager.stop(player);
        }
    );

    it('reports an unavailable anchor without restarting from episode one', async () => {
        getEpisodes.mockImplementationOnce(page).mockResolvedValue({
            Items: [],
            TotalRecordCount: 0,
            StartIndex: 0
        });
        await manager.play({ items: [episode(1)] });
        await selectLastBufferedEpisode();
        await vi.waitFor(() => expect(getEpisodes).toHaveBeenCalledTimes(2));
        Events.trigger(player, 'stopped');
        await vi.waitFor(() => expect(alerts).toHaveBeenCalledTimes(1));
        expect(postedPlaybackInfo.mock.calls.map(([r]) => r.itemId)).toEqual([
            'episode-1',
            'episode-100'
        ]);
    });
});

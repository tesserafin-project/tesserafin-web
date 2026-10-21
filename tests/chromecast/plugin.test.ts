import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Events from '../../src/utils/events';

const fixture = vi.hoisted(() => ({
    api: {
        userId: 'user-a',
        getCurrentUserId() {
            return this.userId;
        },
        serverAddress: () => 'http://fixture.local',
        deviceId: () => 'fixture-device',
        accessToken: () => 'fixture-token',
        serverId: () => 'fixture-server',
        serverVersion: () => '1.0.0',
        getUser: vi.fn()
    },
    connections: {
        currentApiClient: vi.fn(),
        _callbacks: {}
    },
    manager: { setActivePlayer: vi.fn(), removeActivePlayer: vi.fn() }
}));
vi.mock('../../src/scripts/settings/appSettings', () => ({
    default: { maxChromecastBitrate: () => undefined }
}));
vi.mock('../../src/scripts/settings/userSettings', () => ({}));
vi.mock('../../src/components/playback/playbackmanager', () => ({
    playbackManager: fixture.manager
}));
vi.mock('../../src/lib/globalize', () => ({ default: {} }));
vi.mock('../../src/components/alert', () => ({ default: vi.fn() }));
vi.mock('../../src/lib/jellyfin-apiclient', () => ({
    ServerConnections: fixture.connections
}));
vi.mock('../../src/utils/jellyfin-apiclient/getItems.ts', () => ({
    getItems: vi.fn()
}));
import ChromecastPlayer from '../../src/plugins/chromecastPlayer/plugin';

const castWindow = window as Window & { chrome?: any };
let apiConfig: any;
let init: ReturnType<typeof vi.fn>;
let requestSession: ReturnType<typeof vi.fn>;
function sdk({ receivers = true, success = true } = {}) {
    init = vi.fn((config, onSuccess, onError) => {
        apiConfig = config;
        if (!success) {
            onError();
            return;
        }
        config.receiver(receivers ? 'available' : 'unavailable');
        onSuccess();
    });
    requestSession = vi.fn();
    castWindow.chrome = {
        cast: {
            isAvailable: true,
            SessionRequest: class {
                constructor(public id: string) {}
            },
            ApiConfig: class {
                constructor(
                    public request: unknown,
                    public session: unknown,
                    public receiver: (e: string) => void
                ) {}
            },
            initialize: init,
            requestSession
        }
    };
}
async function discover(player: ChromecastPlayer) {
    const pending = player.getTargets({ enableDiscovery: true });
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(50);
    return pending;
}
beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fixture.connections._callbacks = {};
    fixture.api.userId = 'user-a';
    fixture.connections.currentApiClient.mockReturnValue(fixture.api);
    fixture.api.getUser.mockResolvedValue({
        Configuration: { CastReceiverId: 'fixture-receiver' }
    });
    sdk();
});
afterEach(() => {
    vi.useRealTimers();
    delete castWindow.chrome;
});

describe('Cast discovery intent and lifecycle', () => {
    it('does not initialize at construction, sign-in or passive enumeration', async () => {
        const player = new ChromecastPlayer();
        Events.trigger(fixture.connections, 'localusersignedin');
        expect(await player.getTargets()).toEqual([]);
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(50);
        expect(init).not.toHaveBeenCalled();
        expect(fixture.api.getUser).not.toHaveBeenCalled();
    });
    it('discovers on intent, reuses initialization and pairs through the existing SDK picker', async () => {
        const player = new ChromecastPlayer();
        const first = await discover(player);
        expect(first).toEqual([
            expect.objectContaining({ id: 'Google Cast', deviceType: 'cast' })
        ]);
        expect(await player.getTargets()).toHaveLength(1);
        expect(await discover(player)).toHaveLength(1);
        expect(init).toHaveBeenCalledTimes(1);
        const pairing = player.tryPair();
        expect(requestSession).toHaveBeenCalledTimes(1);
        const session = {
            media: [],
            addMessageListener: vi.fn(),
            addMediaListener: vi.fn(),
            addUpdateListener: vi.fn(),
            sendMessage: vi.fn()
        };
        requestSession.mock.calls[0][0](session);
        await expect(pairing).resolves.toBeUndefined();
    });
    it('shares initialization between overlapping menu requests', async () => {
        const player = new ChromecastPlayer();
        const first = discover(player);
        const second = discover(player);
        await expect(first).resolves.toHaveLength(1);
        await expect(second).resolves.toHaveLength(1);
        expect(init).toHaveBeenCalledTimes(1);
    });
    it('does not expose a target when no receiver is available', async () => {
        sdk({ receivers: false });
        expect(await discover(new ChromecastPlayer())).toEqual([]);
    });
    it('contains SDK initialization errors and retries only on intent', async () => {
        sdk({ success: false });
        const player = new ChromecastPlayer();
        expect(await discover(player)).toEqual([]);
        expect(await player.getTargets()).toEqual([]);
        expect(init).toHaveBeenCalledTimes(1);
        sdk();
        expect(await discover(player)).toHaveLength(1);
    });
    it('contains failed user lookup and absent receiver configuration', async () => {
        for (const result of [
            () => Promise.reject(new Error('network')),
            () => Promise.resolve({ Configuration: {} })
        ]) {
            fixture.api.getUser.mockImplementationOnce(result);
            expect(await discover(new ChromecastPlayer())).toEqual([]);
        }
        expect(init).not.toHaveBeenCalled();
    });
    it('does not lose a saved autocast intent when the sign-in listener runs afterwards', async () => {
        const player = new ChromecastPlayer();
        const pending = discover(player);
        Events.trigger(fixture.connections, 'localusersignedin');
        await expect(pending).resolves.toHaveLength(1);
        expect(init).toHaveBeenCalledTimes(1);
    });
    it('invalidates an in-flight user lookup on logout, ignores late callbacks and starts clean for another user', async () => {
        let resolveUser!: (value: unknown) => void;
        fixture.api.getUser.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveUser = resolve;
            })
        );
        const player = new ChromecastPlayer();
        const pending = discover(player);
        await vi.dynamicImportSettled();
        fixture.api.userId = '';
        Events.trigger(fixture.connections, 'localusersignedout');
        resolveUser({ Configuration: { CastReceiverId: 'old-user' } });
        await vi.advanceTimersByTimeAsync(50);
        await expect(pending).resolves.toEqual([]);
        expect(init).not.toHaveBeenCalled();
        fixture.api.userId = 'user-b';
        expect(await discover(player)).toHaveLength(1);
        Events.trigger(fixture.connections, 'localusersignedout');
        apiConfig.session({ media: [] });
        expect(fixture.manager.setActivePlayer).not.toHaveBeenCalled();
        await expect(player.tryPair()).rejects.toThrow('tryPair failed');
    });
});

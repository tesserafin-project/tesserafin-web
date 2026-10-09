/**
 * POLISH-2-R1 - a software recovery belongs to ONE playback attempt.
 *
 * Every test drives the real `PlaybackManager` through its public entry points (`play()`,
 * `stop()`) and through the two events a player raises (`error`, `stopped`). The server's answer
 * to the recovery's `PlaybackInfo` request is a promise the test settles when it chooses, and the
 * recovery timeout runs on a controlled clock, so each ordering below is forced rather than hoped
 * for. Assertions are on what a viewer or the server would observe: which streams the player was
 * given, what was reported, which dialogs were raised, which transcodes were released.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('__WEBPACK_SERVE__', false);
vi.stubGlobal('__USE_SYSTEM_FONTS__', false);
vi.stubGlobal('__JF_BUILD_VERSION__', 'test');

import {
    SERVER_ID,
    USER_ID,
    VIDEO_ITEM_ID,
    createFakePlayer,
    videoItem,
    videoSource
} from './__testSupport/livetvHarness';

const SECOND_ITEM_ID = '55555555555555555555555555555555';
const SECOND_SOURCE_ID = '66666666666666666666666666666666';
const FAILED_AT_MS = 42000;
const FAILED_AT_TICKS = FAILED_AT_MS * 10000;
const RECOVERY_TIMEOUT_MS = 30000;

const postedPlaybackInfo = vi.fn();
const alerts: unknown[] = [];
const toasts: unknown[] = [];

vi.mock('@jellyfin/sdk/lib/utils/api/media-info-api', () => ({
    getMediaInfoApi: () => ({ getPostedPlaybackInfo: postedPlaybackInfo })
}));

// The credential runtime, stubbed at its one transport seam (see livetvPlaybackInfoRequest.test.ts).
let mintedCapabilities = 0;
vi.mock('lib/tesserafin-sdk/generated/api/playback-credentials-api', () => ({
    PlaybackCredentialsApi: class {
        mintPlaybackCapability({
            playbackCapabilityRequestDto
        }: {
            playbackCapabilityRequestDto: { PlaySessionId?: string };
        }) {
            mintedCapabilities += 1;
            return Promise.resolve({
                data: {
                    CapabilityId: `p2r1-cap-${mintedCapabilities}`,
                    Value: `p2r1-value-${mintedCapabilities}`,
                    IssuedAt: new Date(Date.now()).toISOString(),
                    ExpiresAt: new Date(Date.now() + 900_000).toISOString(),
                    Scopes: [],
                    PlaySessionId: playbackCapabilityRequestDto?.PlaySessionId
                }
            });
        }

        renewPlaybackCapability({ capabilityId }: { capabilityId: string }) {
            return Promise.resolve({
                data: {
                    CapabilityId: capabilityId,
                    IssuedAt: new Date(Date.now()).toISOString(),
                    ExpiresAt: new Date(Date.now() + 900_000).toISOString()
                }
            });
        }
    }
}));

vi.mock('components/alert', () => ({
    default: (opts: unknown) => {
        alerts.push(opts);
        return Promise.resolve();
    }
}));
vi.mock('components/toast/toast', () => ({
    default: (opts: unknown) => {
        toasts.push(opts);
    }
}));

const stopActiveEncodings = vi.fn((_playSessionId?: string) =>
    Promise.resolve()
);
const reportPlaybackStart = vi.fn((_info: unknown) => Promise.resolve());
const reportPlaybackStopped = vi.fn((_info: unknown) => Promise.resolve());

const apiClient = {
    _tesserafinSdk: { basePath: 'http://127.0.0.1:8096', configuration: {} },
    serverId: () => SERVER_ID,
    serverAddress: () => 'http://127.0.0.1:8096',
    accessToken: () => 'test-token',
    deviceId: () => 'p2r1-device',
    deviceName: () => 'p2r1-device-name',
    appName: () => 'p2r1',
    appVersion: () => '1.0.0',
    getCurrentUserId: () => USER_ID,
    getCurrentUser: () =>
        Promise.resolve({ Id: USER_ID, Configuration: {}, Policy: {} }),
    getEndpointInfo: () => Promise.resolve({ IsInNetwork: true }),
    getSavedEndpointInfo: () => ({ IsInNetwork: true }),
    getItem: (_userId: string, id: string) =>
        Promise.resolve(id === SECOND_ITEM_ID ? secondItem() : videoItem()),
    getItems: () => Promise.resolve({ Items: [] }),
    getIntros: () => Promise.resolve({ Items: [] }),
    getUser: () => Promise.resolve({ Id: USER_ID, Configuration: {} }),
    getUrl: (path: string) => 'http://127.0.0.1:8096/' + path,
    isMinServerVersion: () => true,
    reportPlaybackStart,
    reportPlaybackProgress: () => Promise.resolve(),
    reportPlaybackStopped,
    stopActiveEncodings,
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

vi.mock('lib/jellyfin-apiclient', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('lib/jellyfin-apiclient')>();
    return { ...actual, ...serverConnectionsMock };
});
vi.mock('lib/jellyfin-apiclient/ServerConnections', () => ({
    default: serverConnectionsMock.ServerConnections
}));

// Module scope on purpose: see livetvPlaybackInfoRequest.test.ts.
const { playbackManager: manager } = await import(
    'components/playback/playbackmanager'
);
const { pluginManager } = await import('components/pluginManager');
const Events = (await import('utils/events')).default;
const { MediaError } = await import('types/mediaError');

/** A source the server will only ever transcode, as HLS: the only kind a recovery applies to. */
function transcodedSource(id: string, sessionId: string) {
    return {
        ...videoSource({ Id: id }),
        SupportsDirectPlay: false,
        SupportsDirectStream: false,
        SupportsTranscoding: true,
        TranscodingUrl: `/videos/${id}/master.m3u8?PlaySessionId=${sessionId}`,
        TranscodingSubProtocol: 'hls',
        TranscodingContainer: 'ts'
    };
}

function secondItem() {
    return videoItem({
        Id: SECOND_ITEM_ID,
        Name: 'Second Video',
        MediaSources: [videoSource({ Id: SECOND_SOURCE_ID })]
    });
}

function answer(sourceId: string, sessionId: string) {
    return {
        data: {
            MediaSources: [transcodedSource(sourceId, sessionId)],
            PlaySessionId: sessionId
        }
    };
}

interface Deferred {
    request: { itemId: string; playbackInfoDto: Record<string, unknown> };
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
}

/** Requests whose answer the test has not given yet, in the order they were made. */
let held: Deferred[] = [];
let playbackErrors: unknown[] = [];

interface Rig {
    manager: typeof manager;
    player: ReturnType<typeof createFakePlayer>;
}

// The module's own manager, and no other. Every manager ever constructed binds to every player
// registered after it, so a second one would answer the same `error` event a second time.
Events.on(manager, 'playbackerror', (_e: unknown, type: unknown) => {
    playbackErrors.push(type);
});
let mounted = 0;
let current: Rig | null = null;

function mount(): Rig {
    const player = createFakePlayer();
    mounted += 1;
    player.name = 'P2R1TestPlayer' + mounted;
    player.id = 'p2r1testplayer' + mounted;
    // A real player announces its own stop, and reads a position only while it has a stream:
    // the element is torn down with a failed one and reads zero until the next has started.
    let positionMs = 0;
    const play = player.play as (streamInfo: unknown) => Promise<void>;
    player.play = (streamInfo: unknown) =>
        play(streamInfo).then(() => {
            positionMs = FAILED_AT_MS;
        });
    player.tearDown = () => {
        positionMs = 0;
    };
    player.stop = () => {
        Events.trigger(player, 'stopped');
        return Promise.resolve();
    };
    player.currentTime = () => positionMs;
    Events.trigger(pluginManager, 'registered', [player]);
    current = { manager, player };
    return current;
}

/** What the HLS layer does when a segment request fails: note the failure, then raise `error`. */
function failTranscode(
    player: Rig['player'],
    transcodeRecovery: 'software' | 'none' | null
) {
    player.lastPlaybackFailure = {
        positionMs: FAILED_AT_MS,
        transcodeRecovery
    };
    (player.tearDown as () => void)();
    Events.trigger(player, 'error', [{ type: MediaError.SERVER_ERROR }]);
}

async function until(assertion: () => void) {
    await vi.waitFor(assertion, { timeout: 20000, interval: 1 });
}

/** Lets every already-settled promise chain run to its end. */
async function settle() {
    for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

async function startPlayback(rig: Rig, item = videoItem()) {
    const startsBefore = reportPlaybackStart.mock.calls.length;
    const playsBefore = rig.player.played.length;
    const playing = rig.manager.play({ items: [item] });
    await until(() => expect(held.length).toBeGreaterThan(0));
    const source = (item.MediaSources as { Id: string }[])[0].Id;
    held.shift()?.resolve(answer(source, 'session-' + item.Id));
    await playing;
    await until(() => {
        expect(rig.player.played).toHaveLength(playsBefore + 1);
        expect(reportPlaybackStart).toHaveBeenCalledTimes(startsBefore + 1);
    });
}

/** Starts A, fails its transcode with a software offer, and returns the held recovery request. */
async function startRecovery(rig: Rig) {
    await startPlayback(rig);
    failTranscode(rig.player, 'software');
    await until(() => expect(held).toHaveLength(1));
    return held.shift() as Deferred;
}

/**
 * Waits until the late answer has been fully dealt with - either the manager released the
 * transcode it was for, or (the defect) it handed the stream to the player.
 */
async function lateAnswerHandled(rig: Rig, sessionId: string, plays: number) {
    await until(() =>
        expect(
            stopActiveEncodings.mock.calls.some(([id]) => id === sessionId) ||
                rig.player.played.length > plays
        ).toBe(true)
    );
    await settle();
}

/** The ordinary retry ladder's own bound for a transcoded stream: what unmodified `main` does. */
const LADDER_RELOADS = 2;

/**
 * Answers each request the retry ladder makes and fails the stream it then plays, until the
 * ladder asks for nothing more. Returns how many streams it tried.
 */
async function exhaustLadder(
    rig: Rig,
    transcodeRecovery: 'software' | 'none' | null
) {
    let reloads = 0;
    while (held.length > 0 && reloads < 10) {
        reloads += 1;
        const plays = rig.player.played.length;
        held.shift()?.resolve(
            answer(VIDEO_ITEM_ID, 'session-A-ladder-' + reloads)
        );
        await until(() => expect(rig.player.played).toHaveLength(plays + 1));
        await settle();
        failTranscode(rig.player, transcodeRecovery);
        await settle();
    }
    return reloads;
}

function stoppedPositions() {
    return reportPlaybackStopped.mock.calls.map(
        ([info]) => (info as { PositionTicks: number }).PositionTicks
    );
}

function playedSessions(rig: Rig) {
    return rig.player.played.map(
        (streamInfo) => (streamInfo as { playSessionId: string }).playSessionId
    );
}

describe('software recovery attempt isolation', { timeout: 60000 }, () => {
    beforeEach(() => {
        held = [];
        playbackErrors = [];
        alerts.length = 0;
        toasts.length = 0;
        stopActiveEncodings.mockClear();
        reportPlaybackStart.mockClear();
        reportPlaybackStopped.mockClear();
        postedPlaybackInfo.mockReset();
        postedPlaybackInfo.mockImplementation(
            (request: Deferred['request']) =>
                new Promise((resolve, reject) => {
                    held.push({ request, resolve, reject });
                })
        );
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(async () => {
        // Leave nothing playing, and take this test's player out of the next one's selection.
        if (current) {
            await manager.stop(current.player);
            await settle();
            current.player.canPlayMediaType = () => false;
            current = null;
        }
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('reloads once, from the failed position, when the server offers software', async () => {
        const rig = mount();
        const recovery = await startRecovery(rig);

        expect(recovery.request.playbackInfoDto.StartTimeTicks).toBe(
            FAILED_AT_TICKS
        );
        recovery.resolve(answer(VIDEO_ITEM_ID, 'session-A-recovered'));
        await until(() => expect(rig.player.played).toHaveLength(2));
        await settle();

        // The timer of a recovery that succeeded must not report a failure later.
        await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS * 2);
        await settle();

        expect(playedSessions(rig)).toEqual([
            'session-' + VIDEO_ITEM_ID,
            'session-A-recovered'
        ]);
        expect(playbackErrors).toEqual([]);
        expect(reportPlaybackStopped).not.toHaveBeenCalled();
        expect(postedPlaybackInfo).toHaveBeenCalledTimes(2);
    });

    it('does not start the stream when its answer arrives after the recovery timed out', async () => {
        const rig = mount();
        const recovery = await startRecovery(rig);

        await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS);
        await settle();
        expect(playbackErrors).toEqual([MediaError.TRANSCODE_FAILED]);
        expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);

        recovery.resolve(answer(VIDEO_ITEM_ID, 'session-A-late'));
        await lateAnswerHandled(rig, 'session-A-late', 1);

        expect(playedSessions(rig)).toEqual(['session-' + VIDEO_ITEM_ID]);
        expect(reportPlaybackStart).toHaveBeenCalledTimes(1);
        expect(playbackErrors).toEqual([MediaError.TRANSCODE_FAILED]);
        expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);
        expect(stopActiveEncodings).toHaveBeenCalledWith('session-A-late');
    });

    it('does not start the stream when its answer arrives after the viewer stopped', async () => {
        const rig = mount();
        const recovery = await startRecovery(rig);

        await rig.manager.stop(rig.player);
        await settle();
        expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);

        recovery.resolve(answer(VIDEO_ITEM_ID, 'session-A-late'));
        await lateAnswerHandled(rig, 'session-A-late', 1);
        await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS * 2);
        await settle();

        expect(playedSessions(rig)).toEqual(['session-' + VIDEO_ITEM_ID]);
        expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);
        expect(playbackErrors).toEqual([]);
        expect(alerts).toEqual([]);
        expect(stopActiveEncodings).toHaveBeenCalledWith('session-A-late');
    });

    it('leaves playback B alone when A`s recovery answers after B has started', async () => {
        const rig = mount();
        const recovery = await startRecovery(rig);

        await rig.manager.stop(rig.player);
        await settle();
        await startPlayback(rig, secondItem());
        const stopsBeforeLateAnswer = reportPlaybackStopped.mock.calls.length;
        const releasedBeforeLateAnswer = stopActiveEncodings.mock.calls.length;

        recovery.resolve(answer(VIDEO_ITEM_ID, 'session-A-late'));
        await lateAnswerHandled(rig, 'session-A-late', 2);

        // B is still the stream the player has, and nothing was said about it.
        expect(playedSessions(rig)).toEqual([
            'session-' + VIDEO_ITEM_ID,
            'session-' + SECOND_ITEM_ID
        ]);
        expect(rig.manager.currentItem(rig.player).Id).toBe(SECOND_ITEM_ID);
        expect(rig.manager.playSessionId(rig.player)).toBe(
            'session-' + SECOND_ITEM_ID
        );
        expect(reportPlaybackStopped).toHaveBeenCalledTimes(
            stopsBeforeLateAnswer
        );
        expect(reportPlaybackStart).toHaveBeenCalledTimes(2);
        expect(playbackErrors).toEqual([]);
        expect(alerts).toEqual([]);
        // Only A's abandoned transcode is released: never B's.
        expect(
            stopActiveEncodings.mock.calls
                .slice(releasedBeforeLateAnswer)
                .map(([id]) => id)
        ).toEqual(['session-A-late']);

        // And B can still be stopped normally: A's answer did not leave it "changing stream".
        await rig.manager.stop(rig.player);
        await settle();
        expect(reportPlaybackStopped).toHaveBeenCalledTimes(
            stopsBeforeLateAnswer + 1
        );
    });

    it('ignores A`s timer when it fires while B is playing', async () => {
        const rig = mount();
        await startRecovery(rig);

        await rig.manager.stop(rig.player);
        await settle();
        await startPlayback(rig, secondItem());
        const stopsBeforeTimer = reportPlaybackStopped.mock.calls.length;

        await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS * 2);
        await settle();

        expect(playbackErrors).toEqual([]);
        expect(alerts).toEqual([]);
        expect(reportPlaybackStopped).toHaveBeenCalledTimes(stopsBeforeTimer);
        expect(rig.manager.currentItem(rig.player).Id).toBe(SECOND_ITEM_ID);
        expect(playedSessions(rig)).toEqual([
            'session-' + VIDEO_ITEM_ID,
            'session-' + SECOND_ITEM_ID
        ]);
    });

    it('ignores A`s timer when B is itself recovering', async () => {
        const rig = mount();
        await startRecovery(rig);
        await rig.manager.stop(rig.player);
        await settle();
        await startPlayback(rig, secondItem());

        // B fails 20 s after A did: A's timer is due in 10 s, B's own in 30 s.
        await vi.advanceTimersByTimeAsync(20000);
        failTranscode(rig.player, 'software');
        await until(() => expect(held).toHaveLength(1));
        const recoveryOfB = held.shift() as Deferred;

        await vi.advanceTimersByTimeAsync(15000);
        await settle();
        expect(playbackErrors).toEqual([]);

        recoveryOfB.resolve(answer(SECOND_SOURCE_ID, 'session-B-recovered'));
        await until(() => expect(rig.player.played).toHaveLength(3));
        expect(playedSessions(rig)[2]).toBe('session-B-recovered');
    });

    it('starts one recovery when the same failure is notified several times', async () => {
        const rig = mount();
        await startPlayback(rig);

        failTranscode(rig.player, 'software');
        failTranscode(rig.player, 'software');
        // The element raises its own error for the stream that was just torn down.
        Events.trigger(rig.player, 'error', [
            { type: MediaError.MEDIA_DECODE_ERROR }
        ]);
        await until(() => expect(held.length).toBeGreaterThan(0));
        await settle();

        expect(held).toHaveLength(1);
        expect(held[0].request.playbackInfoDto.StartTimeTicks).toBe(
            FAILED_AT_TICKS
        );
        expect(postedPlaybackInfo).toHaveBeenCalledTimes(2);
        expect(playbackErrors).toEqual([]);
        expect(reportPlaybackStopped).not.toHaveBeenCalled();
        expect(toasts).toHaveLength(1);

        held.shift()?.resolve(answer(VIDEO_ITEM_ID, 'session-A-recovered'));
        await until(() => expect(rig.player.played).toHaveLength(2));
        expect(playedSessions(rig)[1]).toBe('session-A-recovered');
    });

    it('allows one recovery only: a second software offer ends playback', async () => {
        const rig = mount();
        const recovery = await startRecovery(rig);
        recovery.resolve(answer(VIDEO_ITEM_ID, 'session-A-recovered'));
        await until(() => expect(rig.player.played).toHaveLength(2));
        await settle();

        failTranscode(rig.player, 'software');
        await settle();

        expect(postedPlaybackInfo).toHaveBeenCalledTimes(2);
        expect(held).toEqual([]);
        expect(rig.player.played).toHaveLength(2);
        expect(playbackErrors).toEqual([MediaError.TRANSCODE_FAILED]);
        expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);
    });

    it('does not start a software recovery when the server offers none', async () => {
        const rig = mount();
        await startPlayback(rig);

        failTranscode(rig.player, 'none');
        await until(() => expect(held).toHaveLength(1));

        // What follows is the ordinary retry ladder (direct play refused), which is bounded by
        // its own rules - not the recovery: no "recovering" notice, no recovery in flight.
        expect(toasts).toEqual([]);
        expect(rig.player.softwareRecovery).toBeFalsy();
        expect(held[0].request.playbackInfoDto.EnableDirectPlay).toBe(false);
        expect(held[0].request.playbackInfoDto.StartTimeTicks).toBe(
            FAILED_AT_TICKS
        );

        // Every stream the ladder tries fails the same way. It ends by its own rules, the end is
        // named as a transcode failure, and the position is the one the viewer was at.
        const reloads = await exhaustLadder(rig, 'none');

        expect(reloads).toBe(LADDER_RELOADS);
        expect(toasts).toEqual([]);
        expect(playbackErrors).toEqual([MediaError.TRANSCODE_FAILED]);
        expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);
    });

    it('treats a failure without a recovery instruction as an ordinary error', async () => {
        const rig = mount();
        await startPlayback(rig);

        failTranscode(rig.player, null);
        await until(() => expect(held).toHaveLength(1));

        // The ordinary retry ladder: no "recovering" notice, no recovery in flight, and the
        // request is the ladder's (direct play refused).
        expect(toasts).toEqual([]);
        expect(rig.player.softwareRecovery).toBeFalsy();
        expect(held[0].request.playbackInfoDto.EnableDirectPlay).toBe(false);

        const reloads = await exhaustLadder(rig, null);

        // Nothing claims the server diagnosed a transcode failure.
        expect(reloads).toBe(LADDER_RELOADS);
        expect(toasts).toEqual([]);
        expect(playbackErrors).toEqual([MediaError.SERVER_ERROR]);
    });

    it('ends A`s recovery when B is started without stopping A first', async () => {
        const rig = mount();
        const recovery = await startRecovery(rig);

        await startPlayback(rig, secondItem());
        // A's stop is reported where it failed, not at the torn-down element's zero.
        expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);

        recovery.resolve(answer(VIDEO_ITEM_ID, 'session-A-late'));
        await lateAnswerHandled(rig, 'session-A-late', 2);
        await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS * 2);
        await settle();

        expect(playedSessions(rig)).toEqual([
            'session-' + VIDEO_ITEM_ID,
            'session-' + SECOND_ITEM_ID
        ]);
        expect(rig.manager.currentItem(rig.player).Id).toBe(SECOND_ITEM_ID);
        expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);
        expect(playbackErrors).toEqual([]);
        expect(alerts).toEqual([]);
    });

    it('ends in a transcode failure when the recovered stream cannot start either', async () => {
        const rig = mount();
        const recovery = await startRecovery(rig);
        rig.player.play = (streamInfo: unknown) => {
            rig.player.played.push(streamInfo);
            rig.player.lastPlaybackFailure = {
                positionMs: 0,
                transcodeRecovery: 'none'
            };
            return Promise.reject(MediaError.SERVER_ERROR);
        };

        recovery.resolve(answer(VIDEO_ITEM_ID, 'session-A-recovered'));
        await until(() => expect(playbackErrors).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS * 2);
        await settle();

        expect(playbackErrors).toEqual([MediaError.TRANSCODE_FAILED]);
        expect(postedPlaybackInfo).toHaveBeenCalledTimes(2);
        expect(rig.player.played).toHaveLength(2);
        // The viewer's position is the one the first failure happened at, not zero.
        expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);
    });

    // The same isolation for a stream change that is NOT a recovery. The ordinary retry ladder
    // reloads the stream too, and its answer is just as able to arrive late.
    describe('any stream change', () => {
        async function startLadderReload(rig: Rig) {
            await startPlayback(rig);
            failTranscode(rig.player, null);
            await until(() => expect(held).toHaveLength(1));
            return held.shift() as Deferred;
        }

        it('does not start the stream when its answer arrives after the viewer stopped', async () => {
            const rig = mount();
            const reload = await startLadderReload(rig);

            await rig.manager.stop(rig.player);
            await settle();
            // Where the viewer was, not the zero of an element that has no stream.
            expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);

            reload.resolve(answer(VIDEO_ITEM_ID, 'session-A-late'));
            await lateAnswerHandled(rig, 'session-A-late', 1);

            expect(playedSessions(rig)).toEqual(['session-' + VIDEO_ITEM_ID]);
            expect(reportPlaybackStart).toHaveBeenCalledTimes(1);
            expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);
            expect(playbackErrors).toEqual([]);
            expect(stopActiveEncodings).toHaveBeenCalledWith('session-A-late');
        });

        it('leaves playback B alone when A`s answer arrives after B has started', async () => {
            const rig = mount();
            const reload = await startLadderReload(rig);

            await rig.manager.stop(rig.player);
            await settle();
            await startPlayback(rig, secondItem());
            const stopsBeforeLateAnswer =
                reportPlaybackStopped.mock.calls.length;

            reload.resolve(answer(VIDEO_ITEM_ID, 'session-A-late'));
            await lateAnswerHandled(rig, 'session-A-late', 2);

            expect(playedSessions(rig)).toEqual([
                'session-' + VIDEO_ITEM_ID,
                'session-' + SECOND_ITEM_ID
            ]);
            expect(rig.manager.currentItem(rig.player).Id).toBe(SECOND_ITEM_ID);
            expect(rig.manager.playSessionId(rig.player)).toBe(
                'session-' + SECOND_ITEM_ID
            );
            expect(reportPlaybackStopped).toHaveBeenCalledTimes(
                stopsBeforeLateAnswer
            );
            expect(playbackErrors).toEqual([]);
            expect(alerts).toEqual([]);
        });

        it.each([
            ['the ordinary reload', null],
            ['the software recovery', 'software']
        ] as const)(
            'honours a stop that arrives while the stream of %s is loading',
            async (_label, offer) => {
                const rig = mount();
                await startPlayback(rig);

                // The new stream is handed to the player, which has not started it yet.
                let started: (() => void) | undefined;
                rig.player.play = (streamInfo: unknown) => {
                    rig.player.played.push(streamInfo);
                    return new Promise<void>((resolve) => {
                        started = resolve;
                    });
                };
                let stops = 0;
                rig.player.stop = () => {
                    stops += 1;
                    Events.trigger(rig.player, 'stopped');
                    return Promise.resolve();
                };

                failTranscode(rig.player, offer);
                await until(() => expect(held).toHaveLength(1));
                held.shift()?.resolve(answer(VIDEO_ITEM_ID, 'session-A-new'));
                await until(() => expect(rig.player.played).toHaveLength(2));

                await rig.manager.stop(rig.player);
                await settle();
                expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);

                // The player finishes loading after all: the stream is stopped, not played.
                started?.();
                await settle();
                await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS * 2);
                await settle();

                // One stop: the reported one already took the player down.
                expect(stops).toBe(1);
                expect(reportPlaybackStart).toHaveBeenCalledTimes(1);
                expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);
                expect(playbackErrors).toEqual([]);
                expect(alerts).toEqual([]);
                expect(stopActiveEncodings).toHaveBeenCalledWith(
                    'session-A-new'
                );
            }
        );

        it('does not stop B when A`s stream finishes loading after B replaced it', async () => {
            const rig = mount();
            await startPlayback(rig);

            // A's new stream is handed to the player, which has not started it yet.
            const normalPlay = rig.player.play;
            let started: (() => void) | undefined;
            rig.player.play = (streamInfo: unknown) => {
                rig.player.played.push(streamInfo);
                rig.player.play = normalPlay;
                return new Promise<void>((resolve) => {
                    started = resolve;
                });
            };
            let stops = 0;
            rig.player.stop = () => {
                stops += 1;
                Events.trigger(rig.player, 'stopped');
                return Promise.resolve();
            };

            failTranscode(rig.player, 'software');
            await until(() => expect(held).toHaveLength(1));
            held.shift()?.resolve(answer(VIDEO_ITEM_ID, 'session-A-new'));
            await until(() => expect(rig.player.played).toHaveLength(2));

            // B replaces A without a stop. Tearing A's element down settles A's play() while
            // B is still asking the server what to play - the player has no stream just then.
            const item = secondItem();
            const playing = rig.manager.play({ items: [item] });
            await until(() => expect(held).toHaveLength(1));
            const stopsWhenBStarted = stops;
            const reportsWhenBStarted = reportPlaybackStopped.mock.calls.length;
            started?.();
            await settle();
            const stopsAfterAsPlaySettled = stops;

            held.shift()?.resolve(
                answer(SECOND_SOURCE_ID, 'session-' + SECOND_ITEM_ID)
            );
            await playing;
            await until(() => expect(rig.player.played).toHaveLength(3));
            await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS * 2);
            await settle();

            expect(stopsAfterAsPlaySettled).toBe(stopsWhenBStarted);
            expect(stops).toBe(stopsWhenBStarted);
            expect(reportPlaybackStopped).toHaveBeenCalledTimes(
                reportsWhenBStarted
            );
            expect(rig.manager.currentItem(rig.player).Id).toBe(SECOND_ITEM_ID);
            expect(playbackErrors).toEqual([]);
            expect(stopActiveEncodings).toHaveBeenCalledWith('session-A-new');
        });

        it('ends a recovery once when its answer cannot be played', async () => {
            const rig = mount();
            const recovery = await startRecovery(rig);

            recovery.resolve({
                data: { MediaSources: [], ErrorCode: 'NoCompatibleStream' }
            });
            await until(() => expect(alerts).toHaveLength(1));
            await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS * 2);
            await settle();

            // One message, one stop where the viewer was, and nothing from the timer after.
            expect(alerts).toHaveLength(1);
            expect(playbackErrors).toEqual([]);
            expect(stoppedPositions()).toEqual([FAILED_AT_TICKS]);
            expect(rig.player.played).toHaveLength(1);
        });

        it('forgets the position of a change that never happened', async () => {
            const rig = mount();
            await startPlayback(rig);

            // An ordinary reload that the server refuses: the stream in place keeps playing.
            Events.trigger(rig.player, 'error', [
                { type: MediaError.MEDIA_DECODE_ERROR }
            ]);
            await until(() => expect(held).toHaveLength(1));
            held.shift()?.resolve({
                data: { MediaSources: [], ErrorCode: 'NoCompatibleStream' }
            });
            await until(() => expect(alerts).toHaveLength(1));
            await settle();

            // Later the viewer stops with the element reading zero for its own reasons.
            (rig.player.tearDown as () => void)();
            await rig.manager.stop(rig.player);
            await settle();

            expect(stoppedPositions()).toEqual([0]);
        });
    });
});

// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Events from 'utils/events';

/*
 * A fake engine with the surface the two adapters read. Player objects are plain objects, like
 * the real ones, so `utils/events` (real) carries their events. The player's `getStats()` and the
 * server's sessions answer when the test says so.
 */
const engine = vi.hoisted(() => {
    type Pending = { resolve: (v: unknown) => void };
    const state = {
        player: null as Record<string, unknown> | null,
        item: null as { Id: string; ServerId: string } | null,
        offsetSupported: true,
        external: true,
        /** What the player reports: it applies a new offset 100 ms late, so it lags. */
        playerOffset: 0,
        calls: [] as string[],
        statsAnswers: [] as Pending[],
        sessionAnswers: [] as Pending[],
        holdStats: false,
        holdSessions: false,
        syncPlay: false,
        session: {
            NowPlayingItem: {},
            PlayState: { PlayMethod: 'Transcode' },
            TranscodingInfo: {
                VideoCodec: 'h264',
                AudioCodec: 'aac',
                Bitrate: 4200000,
                AudioChannels: 2,
                IsVideoDirect: false,
                IsAudioDirect: false,
                CompletionPercentage: 12.34,
                Framerate: 48,
                TranscodeReasons: [
                    'ContainerNotSupported',
                    'AudioCodecNotSupported'
                ]
            }
        }
    };
    const name = () => String(state.player?.name);
    const answer = <T,>(hold: boolean, queue: Pending[], value: T) =>
        hold
            ? new Promise<T>((resolve) =>
                  queue.push({ resolve: resolve as (v: unknown) => void })
              )
            : Promise.resolve(value);
    const pm = {
        getCurrentPlayer: () => state.player,
        currentItem: () => state.item,
        supportSubtitleOffset: () => state.offsetSupported,
        canHandleOffsetOnCurrentSubtitle: () => state.external,
        getPlayerSubtitleOffset: () => state.playerOffset,
        setSubtitleOffset: (v: number, p: { name: string }) => {
            state.calls.push(`offset ${v} on ${p.name}`);
        },
        enableShowingSubtitleOffset: (p: { name: string }) => {
            state.calls.push(`show offset on ${p.name}`);
        },
        disableShowingSubtitleOffset: (p: { name: string }) => {
            state.calls.push(`hide offset on ${p.name}`);
        },
        currentMediaSource: () => ({
            Container: state.item?.Id === 'film-b' ? 'mp4' : 'mkv',
            Size: 35_000_000,
            Bitrate: 1_900_000,
            MediaStreams: [
                {
                    Type: 'Video',
                    Codec: 'h264',
                    Profile: 'High',
                    Level: 40,
                    BitRate: 1_500_000,
                    AverageFrameRate: 24,
                    ReferenceFrameRate: 24,
                    BitDepth: 8,
                    PixelFormat: 'yuv420p',
                    VideoRangeType: 'SDR'
                }
            ]
        }),
        getAudioStreamIndex: () => 1,
        audioTracks: () => [
            {
                Type: 'Audio',
                Index: 1,
                Codec: 'aac',
                Profile: 'LC',
                Channels: 2,
                BitRate: 192000,
                SampleRate: 44100
            }
        ]
    };
    const statsFor = () => ({
        categories: [
            { stats: [{ label: 'Dropped frames', value: `${name()} 0` }] }
        ]
    });
    const player = (playerName: string) => ({
        name: playerName,
        playback: { stopped: false },
        getStats: () => {
            state.calls.push(`getStats on ${playerName}`);
            return answer(state.holdStats, state.statsAnswers, statsFor());
        }
    });
    const apiClient = {
        deviceId: () => 'device',
        getSessions: () => {
            state.calls.push('getSessions');
            return answer(state.holdSessions, state.sessionAnswers, [
                state.session
            ]);
        }
    };
    return { state, pm, player, apiClient, statsFor };
});

vi.mock('components/playback/playbackmanager', () => ({
    playbackManager: engine.pm
}));
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: { getApiClient: () => engine.apiClient }
}));
vi.mock('components/pluginManager', () => ({
    pluginManager: {
        firstOfType: () =>
            engine.state.syncPlay
                ? {
                      instance: {
                          Manager: {
                              isSyncPlayEnabled: () => true,
                              getStats: () => ({
                                  TimeSyncDevice: 'server',
                                  TimeSyncOffset: '1.50',
                                  PlaybackDiff: '12.00',
                                  SyncMethod: 'SpeedToSync'
                              })
                          }
                      }
                  }
                : null
    }
}));
vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key, getCurrentLocale: () => 'fr' }
}));
vi.mock('components/layoutManager', () => ({
    default: { tv: false, mobile: false }
}));
vi.mock('components/focusManager', () => ({
    default: { focus: (el?: HTMLElement) => el?.focus() }
}));
vi.mock('scripts/keyboardNavigation', () => ({
    getKeyName: (e: KeyboardEvent) => e.key
}));
vi.mock('utils/file', () => ({
    getReadableSize: (n: number) => `${(n / 1048576).toFixed(1)} MiB`
}));

const { setTrackMenuHost } = await import(
    'apps/modern/features/playerTracks/playerTracks'
);
const offset = await import('./subtitleOffset');
const stats = await import('./playerStats');
const { default: PlayerPanels } = await import('./PlayerPanels');

const { state } = engine;
let player: Record<string, unknown> & {
    name: string;
    playback: { stopped: boolean };
};

function startPlayback(name: string, itemId: string) {
    player = engine.player(name);
    state.player = player;
    state.item = { Id: itemId, ServerId: 'server' };
}

/** Another device's "play now": the same player object, a new playback, a new film. */
function replaceFilm() {
    player.playback = { stopped: false };
    state.item = { Id: 'film-b', ServerId: 'server' };
    act(() => Events.trigger(player, 'playbackstart'));
}

const ref = () => offset.getOffsetState()?.ref ?? null;
const current = async () => {
    const { currentRef } = await import(
        'apps/modern/features/playerTracks/playerTracks'
    );
    return currentRef()!;
};
const flush = () =>
    act(async () => {
        for (let i = 0; i < 6; i++) await Promise.resolve();
    });
const listeners = (o: unknown) =>
    Object.values(
        (o as { _callbacks?: Record<string, unknown[]> })._callbacks ?? {}
    ).flat().length;

let now = 1_000_000;
beforeEach(() => {
    now += 60_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    Object.assign(state, {
        offsetSupported: true,
        external: true,
        playerOffset: 0,
        calls: [],
        statsAnswers: [],
        sessionAnswers: [],
        holdStats: false,
        holdSessions: false,
        syncPlay: false
    });
    startPlayback('A', 'film-a');
    offset.resetSubtitleOffset();
    stats.closeStats();
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('the subtitle offset adapter', () => {
    it('reads a typed offset as the old field did, clamped to the slider', () => {
        expect(offset.parseOffset('2.5')).toBe(2.5);
        expect(offset.parseOffset('+3s')).toBe(3);
        expect(offset.parseOffset('2.5kf')).toBe(2.5);
        expect(offset.parseOffset('99')).toBe(30);
        expect(offset.parseOffset('-99')).toBe(-30);
        expect(offset.parseOffset('-1.234')).toBe(-1.2);
        expect(offset.parseOffset('abc')).toBeNull();
        expect(offset.formatOffset(0.5)).toBe('+0.5s');
        expect(offset.formatOffset(-1.2)).toBe('-1.2s');
    });

    it('opens only where the player can shift the subtitle on', async () => {
        state.external = false; // an embedded or SSA track
        expect(offset.showSubtitleOffset(await current())).toBe(false);
        state.external = true;
        state.offsetSupported = false;
        expect(offset.showSubtitleOffset(await current())).toBe(false);
        expect(state.calls).toEqual([]);
        state.offsetSupported = true;
        expect(offset.showSubtitleOffset(await current())).toBe(true);
        expect(state.calls).toEqual(['show offset on A']);
    });

    it('steps from the offset it set, not from what the lagging player reports', () => {
        offset.nudgeSubtitleOffset(1);
        offset.nudgeSubtitleOffset(1);
        offset.nudgeSubtitleOffset(1);
        offset.nudgeSubtitleOffset(-1);
        expect(state.calls).toEqual([
            'offset 0.1 on A',
            'offset 0.2 on A',
            'offset 0.3 on A',
            'offset 0.2 on A'
        ]);
        // G/H alone does not open the panel.
        expect(offset.getOffsetState()?.open).toBe(false);
    });

    it("drops a change for film A once B replaced it, and starts B from B's own offset", async () => {
        offset.showSubtitleOffset(await current());
        offset.setOffset(ref()!, 2.5);
        const forA = ref()!;
        player.playback = { stopped: false };
        state.item = { Id: 'film-b', ServerId: 'server' };
        state.calls = [];
        expect(offset.setOffset(forA, 4)).toBe(false);
        offset.nudgeSubtitleOffset(1);
        expect(state.calls).toEqual(['offset 0.1 on A']);
        // The panel opened for A is not reopened by a key pressed during B.
        expect(offset.getOffsetState()?.open).toBe(false);
    });

    it('follows a subtitle switch: stays at 0 on a track it can shift, closes on one it cannot', async () => {
        offset.showSubtitleOffset(await current());
        offset.setOffset(ref()!, 2);
        state.calls = [];
        offset.syncSubtitleOffset(true);
        expect(offset.getOffsetState()).toMatchObject({
            open: true,
            offset: 0
        });
        expect(state.calls).toEqual(['show offset on A']);
        state.external = false;
        offset.syncSubtitleOffset(true);
        expect(offset.getOffsetState()?.open).toBe(false);
    });

    it('forgets the playback once it is replaced or stopped', async () => {
        offset.showSubtitleOffset(await current());
        player.playback.stopped = true;
        offset.syncSubtitleOffset();
        expect(offset.getOffsetState()).toBeNull();
    });
});

describe('the stats reader', () => {
    it('answers null when its playback was replaced while the player and the server answered', async () => {
        state.holdStats = true;
        state.holdSessions = true;
        const reading = stats.createStatsReader(await current()).read();
        player.playback = { stopped: false };
        state.item = { Id: 'film-b', ServerId: 'server' };
        for (const a of state.statsAnswers.splice(0))
            a.resolve(engine.statsFor());
        for (const a of state.sessionAnswers.splice(0))
            a.resolve([state.session]);
        expect(await reading).toBeNull();
    });
});

describe('the panels', () => {
    let container: HTMLDivElement;
    let settingsSlot: HTMLDivElement;
    let settingsButton: HTMLButtonElement;
    let root: Root;
    const panel = (slot: string) =>
        document.querySelector<HTMLElement>(`[data-rf-slot="${slot}"]`);
    const field = () =>
        panel('subtitle-offset')!.querySelector<HTMLInputElement>(
            'input[type="text"]'
        )!;
    const slider = () =>
        panel('subtitle-offset')!.querySelector<HTMLInputElement>(
            'input[type="range"]'
        )!;
    const key = (k: string, target: Element = document.activeElement!) =>
        act(() => {
            target.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: k,
                    bubbles: true,
                    cancelable: true
                })
            );
        });
    const osd = (shown: boolean) =>
        act(() => Events.trigger(document, 'SHOW_VIDEO_OSD', [shown]));
    const rows = () =>
        [...(panel('player-stats')?.querySelectorAll('[data-stat]') ?? [])].map(
            (r) => r.textContent
        );

    beforeEach(() => {
        container = document.createElement('div');
        settingsSlot = document.createElement('div');
        settingsButton = document.createElement('button');
        settingsSlot.append(settingsButton);
        document.body.append(container, settingsSlot);
        act(() => {
            root = createRoot(container);
            root.render(<PlayerPanels />);
        });
        act(() =>
            setTrackMenuHost({
                slot: document.createElement('div'),
                settingsSlot,
                onMenuOpenChange: () => undefined
            })
        );
    });
    afterEach(() => {
        act(() => setTrackMenuHost(null));
        act(() => root.unmount());
        container.remove();
        settingsSlot.remove();
    });

    describe('subtitle offset', () => {
        const open = async () => {
            const r = await current();
            act(() => {
                offset.showSubtitleOffset(r);
            });
        };

        it('opens with the slider focused, at the range and step of the old one', async () => {
            await open();
            expect(document.activeElement).toBe(slider());
            expect([
                slider().min,
                slider().max,
                slider().step,
                slider().value
            ]).toEqual(['-30', '30', '0.1', '0']);
            expect(field().value).toBe('0s');
        });

        it('typing in the field reaches none of the player shortcuts, and Enter applies it clamped', async () => {
            await open();
            const playerKeys = vi.fn();
            document.addEventListener('keydown', playerKeys);
            act(() => field().focus());
            for (const k of ['k', 'f', ' ', 'ArrowLeft', 'm']) key(k, field());
            act(() => {
                const set = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    'value'
                )!.set!;
                set.call(field(), '45x');
                field().dispatchEvent(new Event('input', { bubbles: true }));
            });
            expect(field().value).toBe('45'); // only what an offset can contain
            key('Enter', field());
            document.removeEventListener('keydown', playerKeys);
            expect(playerKeys).not.toHaveBeenCalled();
            expect(state.calls.at(-1)).toBe('offset 30 on A');
            expect(field().value).toBe('30s');
        });

        it('something that is not a number leaves the offset as it was', async () => {
            await open();
            act(() => field().focus());
            act(() => {
                const set = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    'value'
                )!.set!;
                set.call(field(), 's');
                field().dispatchEvent(new Event('input', { bubbles: true }));
            });
            state.calls = [];
            key('Enter', field());
            expect(state.calls).toEqual([]);
            expect(field().value).toBe('0s');
        });

        it('Escape closes it onto the settings button, leaving the offset in effect', async () => {
            await open();
            act(() => {
                offset.setOffset(ref()!, 1.5);
            });
            state.calls = [];
            key('Escape', slider());
            expect(panel('subtitle-offset')).toBeNull();
            expect(document.activeElement).toBe(settingsButton);
            expect(state.calls).toEqual(['hide offset on A']);
            // Closed, it listens to neither the player nor the page.
            expect(listeners(player)).toBe(0);
            expect(listeners(document)).toBe(0);
        });

        it("a remote's back command closes it too", async () => {
            await open();
            const back = new CustomEvent('command', {
                detail: { command: 'back' },
                bubbles: true,
                cancelable: true
            });
            act(() => {
                slider().dispatchEvent(back);
            });
            expect(back.defaultPrevented).toBe(true);
            expect(panel('subtitle-offset')).toBeNull();
            expect(document.activeElement).toBe(settingsButton);
        });

        it('follows the controls: hidden with them unless focused, back with them or with G/H', async () => {
            await open();
            act(() => slider().blur());
            osd(false);
            expect(panel('subtitle-offset')).toBeNull();
            osd(true);
            expect(panel('subtitle-offset')).not.toBeNull();
            osd(false);
            act(() => offset.nudgeSubtitleOffset(1));
            expect(panel('subtitle-offset')).not.toBeNull();
            act(() => slider().focus());
            osd(false);
            expect(panel('subtitle-offset')).not.toBeNull();
        });

        it('closes when another device replaces the film, and its slider changes nothing on the new one', async () => {
            await open();
            const stale = slider();
            replaceFilm();
            expect(panel('subtitle-offset')).toBeNull();
            state.calls = [];
            act(() => {
                const set = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    'value'
                )!.set!;
                set.call(stale, '5');
                stale.dispatchEvent(new Event('input', { bubbles: true }));
            });
            expect(state.calls).toEqual([]);
        });
    });

    describe('playback data', () => {
        it('shows what the player, the session, the source and SyncPlay say', async () => {
            state.syncPlay = true;
            act(() => stats.toggleStats());
            await flush();
            expect(rows()).toEqual([
                'LabelPlaybackInfo',
                'LabelPlayerA  (Transcoding)',
                'Dropped framesA 0',
                'LabelTranscodingInfo',
                'LabelTargetCodecsH264,  AAC,  2 Ch,  4.2 Mbps',
                'LabelProgressAndSpeed12.3% / 48 fps (2.00x)',
                'LabelReasonsContainerNotSupportedAudioCodecNotSupported',
                'LabelOriginalMediaInfo',
                'LabelProfileContainermkv,  33.4 MiB,  1.9 Mbps',
                'LabelVideoCodecH264',
                'LabelVideoAttributesHigh,  Lv 40,  1.5 Mbps,  24.00 fps',
                'LabelVideoBitDepth8 Bit,  yuv420p,  SDR',
                'LabelAudioCodecAAC  LC',
                'LabelAudioAttributes2 Ch,  192 Kbps,  44100 Hz',
                'LabelSyncPlayInfo',
                'LabelSyncPlayTimeSyncDeviceserver',
                'LabelSyncPlayTimeSyncOffset1.50 MillisecondsUnit',
                'LabelSyncPlayPlaybackDiff12.00 MillisecondsUnit',
                'LabelSyncPlaySyncMethodSpeedToSync'
            ]);
            // Server text is text: the reasons are lines, not markup.
            expect(panel('player-stats')!.innerHTML).not.toContain('<br');
        });

        it('refreshes on time updates at most every 700 ms, asking the server at most every 10 s', async () => {
            act(() => stats.toggleStats());
            await flush();
            state.calls = [];
            act(() => Events.trigger(player, 'timeupdate'));
            await flush();
            expect(state.calls).toEqual([]); // inside 700 ms
            now += 800;
            act(() => Events.trigger(player, 'timeupdate'));
            await flush();
            expect(state.calls).toEqual(['getStats on A']); // the session is still fresh
            now += 10_000;
            act(() => Events.trigger(player, 'timeupdate'));
            await flush();
            expect(state.calls).toEqual([
                'getStats on A',
                'getStats on A',
                'getSessions'
            ]);
        });

        it('stops all work when closed: no listener left, and a late answer is not shown', async () => {
            act(() => stats.toggleStats());
            await flush();
            state.holdStats = true;
            now += 800;
            act(() => Events.trigger(player, 'timeupdate'));
            act(() => stats.toggleStats());
            expect(panel('player-stats')).toBeNull();
            expect(listeners(player)).toBe(0);

            state.calls = [];
            now += 800;
            act(() => Events.trigger(player, 'timeupdate'));
            for (const a of state.statsAnswers.splice(0))
                a.resolve(engine.statsFor());
            await flush();
            expect(state.calls).toEqual([]);
            expect(panel('player-stats')).toBeNull();
        });

        it("follows the new film, and drops film A's answer that arrives after B started", async () => {
            act(() => stats.toggleStats());
            await flush();
            state.holdStats = true;
            now += 800;
            act(() => Events.trigger(player, 'timeupdate')); // A's read, held
            const forA = state.statsAnswers.splice(0);
            state.holdStats = false;
            now += 20_000;
            replaceFilm();
            await flush();
            expect(rows()).toContain(
                'LabelProfileContainermp4,  33.4 MiB,  1.9 Mbps'
            );
            // A's player stats arrive late: they are not shown over B.
            for (const a of forA)
                a.resolve({
                    categories: [
                        {
                            stats: [
                                {
                                    label: 'Dropped frames',
                                    value: 'from film A'
                                }
                            ]
                        }
                    ]
                });
            await flush();
            expect(rows().join(' ')).not.toContain('from film A');
            expect(rows()).toContain(
                'LabelProfileContainermp4,  33.4 MiB,  1.9 Mbps'
            );
        });

        it('a slow server answer for A is dropped once B started', async () => {
            state.holdSessions = true;
            act(() => stats.toggleStats());
            const forA = state.sessionAnswers.splice(0);
            state.holdSessions = false;
            replaceFilm();
            await flush();
            for (const a of forA)
                a.resolve([
                    {
                        ...state.session,
                        PlayState: { PlayMethod: 'DirectPlay' },
                        TranscodingInfo: undefined
                    }
                ]);
            await flush();
            expect(rows()).toContain('LabelPlayerA  (Transcoding)');
        });

        it('closes on Escape from its close button, onto the settings button', async () => {
            act(() => stats.toggleStats());
            await flush();
            const close = panel('player-stats')!.querySelector('button')!;
            act(() => close.focus());
            key('Escape', close);
            expect(panel('player-stats')).toBeNull();
            expect(document.activeElement).toBe(settingsButton);
        });
    });

    it('when the player view hides, both panels close and forget their playback', async () => {
        const r = await current();
        act(() => {
            stats.toggleStats();
            offset.showSubtitleOffset(r);
        });
        await flush();
        act(() => setTrackMenuHost(null));
        expect(panel('player-stats')).toBeNull();
        expect(panel('subtitle-offset')).toBeNull();
        expect(stats.isStatsOpen()).toBe(false);
        expect(offset.getOffsetState()).toBeNull();
        expect(listeners(player)).toBe(0);
        expect(listeners(engine.pm)).toBe(0);
    });
});

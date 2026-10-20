// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    type Mock,
    vi
} from 'vitest';

import { RepeatMode } from '@jellyfin/sdk/lib/generated-client/models/repeat-mode';

import Events from 'utils/events';

/*
 * A fake engine with the surface the adapter reads. Its player objects are plain objects, like the
 * real ones, so `utils/events` (real) carries their events.
 */
const engine = vi.hoisted(() => {
    const ext = (Index: number, Language: string) => ({
        Index,
        Language,
        Codec: 'subrip',
        IsExternal: true
    });
    const state = {
        player: null as { name: string; playback?: object | null } | null,
        item: null as { Id: string; ServerId?: string } | null,
        audio: [
            { Index: 1, Language: 'fra', Codec: 'aac', Channels: 2 },
            { Index: 2, Language: 'eng', Codec: 'aac', Channels: 2 }
        ],
        subs: [
            ext(3, 'deu'),
            ext(4, 'eng'),
            { Index: 5, Language: 'fra', Codec: 'ass' }
        ],
        audioIndex: 1 as number | null,
        subIndex: -1 as number | null,
        secIndex: -1,
        commands: [
            'SetAspectRatio',
            'PlaybackRate',
            'SetMaxStreamingBitrate',
            'SetRepeatMode'
        ],
        aspect: 'auto',
        rate: 1,
        maxBitrate: 8000000,
        autoBitrate: false,
        repeat: 'RepeatNone',
        source: {
            SupportsTranscoding: true,
            RunTimeTicks: 60_000_000_000,
            MediaStreams: [{ Type: 'Video', Codec: 'h264', BitRate: 9000000 }]
        } as Record<string, unknown>,
        subOffset: false,
        calls: [] as string[]
    };
    const pm = {
        getCurrentPlayer: () => state.player,
        currentItem: () => state.item,
        audioTracks: () => state.audio.slice(),
        subtitleTracks: () => state.subs.slice(),
        secondarySubtitleTracks: () =>
            state.subs.filter((s) => 'IsExternal' in s),
        getAudioStreamIndex: () => state.audioIndex,
        getSubtitleStreamIndex: () => state.subIndex,
        getSecondarySubtitleStreamIndex: () => state.secIndex,
        playerHasSecondarySubtitleSupport: () => true,
        trackHasSecondarySubtitleSupport: (t?: { IsExternal?: boolean }) =>
            !!t?.IsExternal,
        getSubtitleStream: (_p: unknown, i: number) =>
            state.subs.find((s) => s.Index === i),
        setAudioStreamIndex: (i: number, p: { name: string }) => {
            state.calls.push(`audio ${i} on ${p.name}`);
        },
        setSubtitleStreamIndex: (i: number, p: { name: string }) => {
            state.calls.push(`subtitles ${i} on ${p.name}`);
        },
        setSecondarySubtitleStreamIndex: (i: number, p: { name: string }) => {
            state.calls.push(`secondary ${i} on ${p.name}`);
        },
        getSupportedCommands: () => state.commands.slice(),
        getSupportedAspectRatios: () => [
            { id: 'auto', name: 'Auto' },
            { id: 'cover', name: 'Cover' },
            { id: 'fill', name: 'Fill' }
        ],
        getAspectRatio: () => state.aspect,
        setAspectRatio: (id: string, p: { name: string }) => {
            state.calls.push(`aspect ${id} on ${p.name}`);
        },
        getSupportedPlaybackRates: () =>
            [0.5, 1, 1.5, 2].map((id) => ({ id, name: `${id}x` })),
        getPlaybackRate: () => state.rate,
        setPlaybackRate: (rate: number, p: { name: string }) => {
            state.calls.push(`rate ${rate} on ${p.name}`);
        },
        getMaxStreamingBitrate: () => state.maxBitrate,
        enableAutomaticBitrateDetection: () => state.autoBitrate,
        setMaxStreamingBitrate: (
            o: { enableAutomaticBitrateDetection: boolean; maxBitrate: number },
            p: { name: string }
        ) => {
            state.calls.push(
                `bitrate ${o.maxBitrate} auto=${o.enableAutomaticBitrateDetection} on ${p.name}`
            );
        },
        getRepeatMode: () => state.repeat,
        setRepeatMode: (mode: string, p: { name: string }) => {
            state.calls.push(`repeat ${mode} on ${p.name}`);
        },
        currentMediaSource: () => state.source,
        getPlayerState: () => ({
            MediaSource: state.source,
            PlayState: { PlayMethod: 'Transcode' }
        }),
        supportSubtitleOffset: () => state.subOffset,
        canHandleOffsetOnCurrentSubtitle: () => state.subOffset,
        enableShowingSubtitleOffset: (p: { name: string }) => {
            state.calls.push(`suboffset on ${p.name}`);
        }
    };
    return { state, pm };
});

/** The server's answer to "who is the user": the test settles it when it chooses. */
const server = vi.hoisted(() => {
    const s = {
        transcoding: true,
        pending: [] as (() => void)[],
        /** When false, getCurrentUser answers at once. */
        hold: false,
        getCurrentUser: () =>
            new Promise((resolve) => {
                const answer = () =>
                    resolve({
                        Policy: {
                            EnableVideoPlaybackTranscoding: s.transcoding
                        }
                    });
                if (s.hold) s.pending.push(answer);
                else answer();
            }),
        release() {
            for (const answer of s.pending.splice(0)) answer();
        }
    };
    return s;
});

const panels = vi.hoisted(() => ({
    toggleStats: vi.fn(),
    showSubtitleOffset: vi.fn((_ref: unknown) => true),
    syncSubtitleOffset: vi.fn((_switched?: boolean) => undefined)
}));
vi.mock('apps/modern/features/playerPanels/playerStats', () => ({
    toggleStats: panels.toggleStats
}));
vi.mock('apps/modern/features/playerPanels/subtitleOffset', () => ({
    showSubtitleOffset: panels.showSubtitleOffset,
    syncSubtitleOffset: panels.syncSubtitleOffset
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: () => ({ getCurrentUser: server.getCurrentUser })
    }
}));

vi.mock('components/playback/playbackmanager', () => ({
    playbackManager: engine.pm
}));
vi.mock('lib/globalize', () => ({
    default: {
        translate: (key: string) => key,
        getCurrentLocale: () => 'fr'
    }
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

const {
    readTracks,
    setAudio,
    setSubtitles,
    subscribeTracks,
    setTrackMenuHost
} = await import('./playerTracks');
const {
    readSettings,
    setAspectRatio,
    setMaxBitrate,
    setPlaybackRate,
    setRepeatMode
} = await import('./playerSettings');
const { default: TrackMenus } = await import('./TrackMenus');

const { state } = engine;
let player: { name: string; playback?: object | null };

function startPlayback(name: string, itemId: string) {
    player = { name, playback: { stopped: false } };
    state.player = player;
    state.item = { Id: itemId, ServerId: 'server' };
}

/** What another device's "play now" does: same player object, a new playback, a new film. */
function replaceFilm() {
    player.playback = { stopped: false };
    state.item = { Id: 'film-b', ServerId: 'server' };
    act(() => Events.trigger(player, 'playbackstart'));
}

/** Lets settled promises run, inside act so React applies what they set. */
const flush = () =>
    act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });

beforeEach(() => {
    vi.clearAllMocks();
    server.hold = false;
    server.pending = [];
    server.transcoding = true;
    state.subOffset = false;
    state.source.SupportsTranscoding = true;
    state.source.RunTimeTicks = 60_000_000_000;
    state.calls = [];
    state.audioIndex = 1;
    state.subIndex = -1;
    state.secIndex = -1;
    startPlayback('A', 'film-a');
});

describe('the track adapter', () => {
    it('reads nothing when nothing plays', () => {
        state.item = null;
        expect(readTracks()).toBeNull();
    });

    it('offers secondary subtitles only for an external primary that is on', () => {
        expect(readTracks()?.secondary).toBeNull();
        state.subIndex = 5; // SSA, cannot pair
        expect(readTracks()?.secondary).toBeNull();
        state.subIndex = 3;
        expect(readTracks()?.secondary).toEqual({
            tracks: [state.subs[0], state.subs[1]],
            index: -1
        });
    });

    it('sends a command to the playback it was chosen for', () => {
        const ref = readTracks()!.ref;
        expect(setAudio(ref, 2)).toBe(true);
        expect(state.calls).toEqual(['audio 2 on A']);
    });

    it('drops a command once its playback is replaced, stopped, or moved to another player', () => {
        let ref = readTracks()!.ref;
        // Same player object, a new play request: the engine replaces `player.playback`.
        player.playback = { stopped: false };
        state.item = { Id: 'film-b' };
        expect(setAudio(ref, 2)).toBe(false);

        ref = readTracks()!.ref;
        (player.playback as { stopped: boolean }).stopped = true;
        expect(setSubtitles(ref, 3)).toBe(false);

        startPlayback('A', 'film-b');
        ref = readTracks()!.ref;
        startPlayback('B', 'film-b');
        expect(setAudio(ref, 2)).toBe(false);
        expect(state.calls).toEqual([]);
    });

    it('drops a command when the same film is played again', () => {
        // Same player, same item, a new play request: only `player.playback` tells them apart.
        const ref = readTracks()!.ref;
        player.playback = { stopped: false };
        expect(setAudio(ref, 2)).toBe(false);
        expect(state.calls).toEqual([]);
    });

    it('keeps a command across a stream change of the same playback', () => {
        const ref = readTracks()!.ref;
        state.audioIndex = 2; // a transcode restart changes the stream, not `player.playback`
        expect(setAudio(ref, 1)).toBe(true);
    });

    it('follows the current player and leaves no listener behind', () => {
        const seen: string[] = [];
        const first = player as unknown as {
            _callbacks?: Record<string, unknown[]>;
        };
        const stop = subscribeTracks(() => seen.push(state.player!.name));
        Events.trigger(player, 'mediastreamschange');
        startPlayback('B', 'film-b');
        Events.trigger(engine.pm, 'playerchange');
        Events.trigger(first, 'playbackstart'); // the old player is no longer heard
        Events.trigger(player, 'playbackstop');
        expect(seen).toEqual(['A', 'B', 'B']);
        stop();
        Events.trigger(player, 'playbackstart');
        Events.trigger(engine.pm, 'playerchange');
        expect(seen).toHaveLength(3);
        const listeners = (o: unknown) =>
            Object.values(
                (o as { _callbacks?: Record<string, unknown[]> })._callbacks ??
                    {}
            ).flat().length;
        expect(listeners(first)).toBe(0);
        expect(listeners(player)).toBe(0);
        expect(listeners(engine.pm)).toBe(0);
    });
});

describe('the settings adapter', () => {
    it('offers each setting only where the player, the item and the user allow it', async () => {
        let s = await readSettings();
        expect(s?.aspectRatio?.find((c) => c.selected)?.id).toBe('auto');
        expect(s?.playbackRate?.find((c) => c.selected)?.id).toBe(1);
        expect(s?.quality?.summary).toBe('8 Mbps');
        expect(s?.repeatMode).toBe('RepeatNone');
        expect(s?.subtitleOffset).toBe(false);

        server.transcoding = false; // the user may not transcode
        expect((await readSettings())?.quality).toBeNull();
        server.transcoding = true;
        state.source.SupportsTranscoding = false; // the source cannot be transcoded
        expect((await readSettings())?.quality).toBeNull();
        state.source.SupportsTranscoding = true;
        state.source.RunTimeTicks = undefined; // a live stream has no end to repeat at
        expect((await readSettings())?.repeatMode).toBeNull();
        state.commands = ['PlaybackRate']; // a player that only changes speed
        state.subOffset = true;
        s = await readSettings();
        expect(s?.aspectRatio).toBeNull();
        expect(s?.quality).toBeNull();
        expect(s?.repeatMode).toBeNull();
        expect(s?.subtitleOffset).toBe(true);
        state.commands = [
            'SetAspectRatio',
            'PlaybackRate',
            'SetMaxStreamingBitrate',
            'SetRepeatMode'
        ];
    });

    it('says Auto and what Auto chose', async () => {
        state.autoBitrate = true;
        const s = await readSettings();
        expect(s?.quality?.choices.find((c) => c.selected)?.id).toBe(0);
        expect(s?.quality?.summary).toBe('Auto 8 Mbps');
        state.autoBitrate = false;
    });

    it('sends each command to the playback it was read for, and drops it once that is replaced', async () => {
        const { ref } = (await readSettings())!;
        expect(setAspectRatio(ref, 'fill')).toBe(true);
        expect(setPlaybackRate(ref, 2)).toBe(true);
        expect(setMaxBitrate(ref, 0)).toBe(true);
        expect(setRepeatMode(ref, RepeatMode.RepeatOne)).toBe(true);
        expect(state.calls).toEqual([
            'aspect fill on A',
            'rate 2 on A',
            'bitrate 0 auto=true on A',
            'repeat RepeatOne on A'
        ]);

        state.calls = [];
        player.playback = { stopped: false };
        expect(setAspectRatio(ref, 'fill')).toBe(false);
        expect(setPlaybackRate(ref, 2)).toBe(false);
        expect(setMaxBitrate(ref, 0)).toBe(false);
        expect(setRepeatMode(ref, RepeatMode.RepeatOne)).toBe(false);
        expect(state.calls).toEqual([]);
    });

    it('reads nothing when the playback is replaced while the server answers', async () => {
        server.hold = true;
        const reading = readSettings();
        player.playback = { stopped: false };
        state.item = { Id: 'film-b', ServerId: 'server' };
        server.release();
        expect(await reading).toBeNull();
    });
});

describe('the track menus', () => {
    let container: HTMLDivElement;
    let slot: HTMLDivElement;
    let settingsSlot: HTMLDivElement;
    let root: Root;
    let host: {
        slot: HTMLElement;
        settingsSlot: HTMLElement;
        onMenuOpenChange: Mock<(open: boolean) => void>;
    };
    const button = (kind: string) =>
        document.querySelector<HTMLButtonElement>(
            `[data-track-menu="${kind}"]`
        );
    const title = () =>
        document.querySelector('.rf-track-menu__title')?.textContent;
    const menu = () => document.querySelector('[data-rf-slot="track-menu"]');
    const rows = () => [
        ...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')
    ];
    const row = (text: string) =>
        rows().find((r) => r.textContent?.includes(text))!;
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

    beforeEach(() => {
        container = document.createElement('div');
        slot = document.createElement('div');
        settingsSlot = document.createElement('div');
        document.body.append(container, slot, settingsSlot);
        host = {
            slot,
            settingsSlot,
            onMenuOpenChange: vi.fn<(open: boolean) => void>()
        };
        act(() => {
            root = createRoot(container);
            root.render(<TrackMenus />);
        });
    });
    afterEach(() => {
        act(() => setTrackMenuHost(null));
        act(() => root.unmount());
        container.remove();
        slot.remove();
        settingsSlot.remove();
    });

    it('renders its triggers only once the player lends a slot', () => {
        expect(slot.children).toHaveLength(0);
        expect(settingsSlot.children).toHaveLength(0);
        act(() => setTrackMenuHost(host));
        expect(settingsSlot.contains(button('settings'))).toBe(true);
        expect(slot.contains(button('subtitles'))).toBe(true);
        expect(button('audio')).not.toBeNull();
        state.audio = state.audio.slice(0, 1);
        act(() => Events.trigger(player, 'mediastreamschange'));
        expect(button('audio')).toBeNull();
        state.audio = [
            { Index: 1, Language: 'fra', Codec: 'aac', Channels: 2 },
            { Index: 2, Language: 'eng', Codec: 'aac', Channels: 2 }
        ];
    });

    it.each([
        ['audio', 1],
        ['audio', 0],
        ['subtitles', 0]
    ] as const)(
        'Escape returns to settings if the %s trigger disappears (%i tracks remaining)',
        (kind, remaining) => {
            const audio = state.audio;
            const subs = state.subs;
            try {
                if (kind === 'subtitles') state.subIndex = 3;
                act(() => setTrackMenuHost(host));
                act(() => button(kind)!.click());
                if (kind === 'audio')
                    state.audio = state.audio.slice(0, remaining);
                else state.subs = [];
                act(() => Events.trigger(player, 'mediastreamschange'));
                expect(button(kind)).toBeNull();
                expect(menu()).not.toBeNull();
                expect(menu()!.contains(document.activeElement)).toBe(true);
                key('Escape');
                expect(menu()).toBeNull();
                expect(document.activeElement).toBe(button('settings'));
            } finally {
                state.audio = audio;
                state.subs = subs;
            }
        }
    );

    it('a stream update preserves a focused row that still exists', () => {
        act(() => setTrackMenuHost(host));
        act(() => button('audio')!.click());
        key('ArrowDown');
        const focused = document.activeElement;
        act(() => Events.trigger(player, 'mediastreamschange'));
        expect(document.activeElement).toBe(focused);
    });

    it('Escape closes the menu and gives the focus back to its button', () => {
        act(() => setTrackMenuHost(host));
        act(() => button('audio')!.click());
        expect(menu()).not.toBeNull();
        expect(host.onMenuOpenChange).toHaveBeenLastCalledWith(true);
        expect(document.activeElement).toBe(row('Français'));
        expect(row('Français').getAttribute('aria-checked')).toBe('true');

        const playerKeys = vi.fn();
        document.addEventListener('keydown', playerKeys);
        key('ArrowDown');
        expect(document.activeElement).toBe(row('Anglais'));
        key('Escape');
        document.removeEventListener('keydown', playerKeys);

        expect(playerKeys).not.toHaveBeenCalled();
        expect(menu()).toBeNull();
        expect(host.onMenuOpenChange).toHaveBeenLastCalledWith(false);
        expect(document.activeElement).toBe(button('audio'));
        expect(state.calls).toEqual([]);
    });

    it("a remote's back command closes the menu, not the player", () => {
        act(() => setTrackMenuHost(host));
        act(() => button('subtitles')!.click());
        const command = new CustomEvent('command', {
            detail: { command: 'back' },
            bubbles: true,
            cancelable: true
        });
        act(() => {
            document.activeElement!.dispatchEvent(command);
        });
        expect(command.defaultPrevented).toBe(true);
        expect(menu()).toBeNull();
        expect(document.activeElement).toBe(button('subtitles'));
    });

    it('switches audio and subtitles, and refreshes the subtitle sync', () => {
        act(() => setTrackMenuHost(host));
        act(() => button('audio')!.click());
        act(() => row('Anglais').click());
        expect(menu()).toBeNull();
        expect(document.activeElement).toBe(button('audio'));

        act(() => button('subtitles')!.click());
        expect(row('Off').getAttribute('aria-checked')).toBe('true');
        act(() => row('Allemand').click());
        expect(state.calls).toEqual(['audio 2 on A', 'subtitles 3 on A']);
        expect(panels.syncSubtitleOffset).toHaveBeenCalledWith(true);
        expect(panels.syncSubtitleOffset).toHaveBeenCalledTimes(1);
    });

    it('shows the track chosen since the last stream event', () => {
        act(() => setTrackMenuHost(host));
        // A switch the engine makes on the same stream fires no event.
        state.audioIndex = 2;
        act(() => button('audio')!.click());
        expect(row('Anglais').getAttribute('aria-checked')).toBe('true');
        expect(row('Français').getAttribute('aria-checked')).toBe('false');
    });

    it('offers secondary subtitles under an external primary', () => {
        state.subIndex = 3;
        act(() => setTrackMenuHost(host));
        act(() => button('subtitles')!.click());
        const entry = row('SecondarySubtitles');
        expect(entry.getAttribute('role')).toBe('menuitem');
        act(() => entry.click());
        expect(menu()?.getAttribute('aria-labelledby')).toBeTruthy();
        expect(rows().map((r) => r.textContent?.split(/[A-Z]{3}/)[0])).toEqual([
            'Off',
            'Allemand',
            'Anglais'
        ]);
        act(() => row('Anglais').click());
        expect(state.calls).toEqual(['secondary 4 on A']);
        expect(panels.syncSubtitleOffset).toHaveBeenCalledWith(true);
        expect(panels.syncSubtitleOffset).toHaveBeenCalledTimes(1);
    });

    it('Escape in the secondary subtitles goes back to the subtitles, on the row it came from', () => {
        state.subIndex = 3;
        act(() => setTrackMenuHost(host));
        act(() => button('subtitles')!.click());
        act(() => row('SecondarySubtitles').click());
        key('Escape');
        expect(title()).toBe('Subtitles');
        expect(document.activeElement).toBe(row('SecondarySubtitles'));
        key('Escape');
        expect(menu()).toBeNull();
        expect(document.activeElement).toBe(button('subtitles'));
    });

    it('closes when another device replaces the film, and changes nothing on the new one', () => {
        act(() => setTrackMenuHost(host));
        act(() => button('audio')!.click());
        const stale = row('Anglais');

        // Same player object, new playback: what the remote's "play now" does.
        player.playback = { stopped: false };
        state.item = { Id: 'film-b' };
        act(() => Events.trigger(player, 'playbackstart'));

        expect(menu()).toBeNull();
        expect(host.onMenuOpenChange).toHaveBeenLastCalledWith(false);
        act(() => stale.click());
        expect(state.calls).toEqual([]);
    });

    it('closes when the player view hides', () => {
        act(() => setTrackMenuHost(host));
        act(() => button('audio')!.click());
        act(() => setTrackMenuHost(null));
        expect(menu()).toBeNull();
        expect(host.onMenuOpenChange).toHaveBeenLastCalledWith(false);
    });

    describe('the settings menu', () => {
        async function openSettings() {
            act(() => button('settings')!.click());
            await flush();
            expect(title()).toBe('Settings');
        }

        it('lists what the snapshot offers, each submenu with what is in effect', async () => {
            state.subOffset = true;
            act(() => setTrackMenuHost(host));
            await openSettings();
            expect(
                rows().map((r) => [
                    r.dataset.track,
                    r.getAttribute('aria-haspopup')
                ])
            ).toEqual([
                ['aspectratio', 'menu'],
                ['playbackrate', 'menu'],
                ['quality', 'menu'],
                ['repeatmode', 'menu'],
                ['suboffset', null],
                ['stats', null]
            ]);
            expect(row('PlaybackRate').textContent).toContain('1x');
            expect(row('Quality').textContent).toContain('8 Mbps');
            expect(row('RepeatMode').textContent).toContain('None');
            expect(host.onMenuOpenChange).toHaveBeenLastCalledWith(true);
        });

        it('Escape closes the submenu, then the menu, each time focusing where it came from', async () => {
            act(() => setTrackMenuHost(host));
            await openSettings();
            act(() => row('PlaybackRate').click());
            expect(title()).toBe('PlaybackRate');
            expect(document.activeElement).toBe(row('1x'));

            const playerKeys = vi.fn();
            document.addEventListener('keydown', playerKeys);
            key('Escape');
            expect(title()).toBe('Settings');
            expect(document.activeElement?.getAttribute('data-track')).toBe(
                'playbackrate'
            );
            expect(host.onMenuOpenChange).toHaveBeenLastCalledWith(true);
            key('Escape');
            document.removeEventListener('keydown', playerKeys);

            expect(playerKeys).not.toHaveBeenCalled();
            expect(menu()).toBeNull();
            expect(document.activeElement).toBe(button('settings'));
            expect(host.onMenuOpenChange).toHaveBeenLastCalledWith(false);
            expect(state.calls).toEqual([]);
        });

        it("a remote's back command goes up one level too", async () => {
            act(() => setTrackMenuHost(host));
            await openSettings();
            act(() => row('RepeatMode').click());
            const back = () =>
                act(() => {
                    document.activeElement!.dispatchEvent(
                        new CustomEvent('command', {
                            detail: { command: 'back' },
                            bubbles: true,
                            cancelable: true
                        })
                    );
                });
            back();
            expect(title()).toBe('Settings');
            back();
            expect(menu()).toBeNull();
            expect(document.activeElement).toBe(button('settings'));
        });

        it('sends each choice to the playback it was made for, and nothing for the one in effect', async () => {
            act(() => setTrackMenuHost(host));
            const pick = async (submenu: string, choice: string) => {
                await openSettings();
                act(() => row(submenu).click());
                act(() => row(choice).click());
                expect(menu()).toBeNull();
                expect(document.activeElement).toBe(button('settings'));
            };
            await pick('AspectRatio', 'Cover');
            await pick('PlaybackRate', '1.5x');
            await pick('PlaybackRate', '1x'); // already in effect
            await pick('Quality', 'Auto');
            await pick('Quality', '4 Mbps');
            await pick('RepeatMode', 'RepeatAll');
            expect(state.calls).toEqual([
                'aspect cover on A',
                'rate 1.5 on A',
                'bitrate 0 auto=true on A',
                'bitrate 4000000 auto=false on A',
                'repeat RepeatAll on A'
            ]);
        });

        it('opens the subtitle offset and the stats panels for the playback it was opened for', async () => {
            state.subOffset = true;
            act(() => setTrackMenuHost(host));
            await openSettings();
            act(() => row('SubtitleOffset').click());
            expect(panels.showSubtitleOffset).toHaveBeenCalledTimes(1);
            expect(panels.showSubtitleOffset.mock.calls[0][0]).toMatchObject({
                player,
                itemId: 'film-a'
            });
            expect(menu()).toBeNull();

            await openSettings();
            act(() => row('PlaybackData').click());
            expect(panels.toggleStats).toHaveBeenCalledTimes(1);
            expect(menu()).toBeNull();
        });

        it('does not open for film A once film B replaced it while the server answered', async () => {
            server.hold = true;
            act(() => setTrackMenuHost(host));
            act(() => button('settings')!.click());
            replaceFilm();
            server.release();
            await flush();
            expect(menu()).toBeNull();
            expect(host.onMenuOpenChange).not.toHaveBeenCalledWith(true);
        });

        it('a late answer does not replace a menu opened since', async () => {
            server.hold = true;
            act(() => setTrackMenuHost(host));
            act(() => button('settings')!.click());
            act(() => button('audio')!.click());
            server.release();
            await flush();
            expect(title()).toBe('Audio');
        });

        it('does not open once the player view has hidden', async () => {
            server.hold = true;
            act(() => setTrackMenuHost(host));
            act(() => button('settings')!.click());
            act(() => setTrackMenuHost(null));
            server.release();
            await flush();
            expect(menu()).toBeNull();
        });

        it('a submenu open on film A closes when B replaces it, and its choices change nothing', async () => {
            act(() => setTrackMenuHost(host));
            await openSettings();
            act(() => row('Quality').click());
            const stale = row('4 Mbps');
            replaceFilm();
            expect(menu()).toBeNull();
            expect(host.onMenuOpenChange).toHaveBeenLastCalledWith(false);
            act(() => stale.click());
            expect(state.calls).toEqual([]);
        });

        it('closes when the playback stops', async () => {
            act(() => setTrackMenuHost(host));
            await openSettings();
            act(() => row('AspectRatio').click());
            (player.playback as { stopped: boolean }).stopped = true;
            act(() => Events.trigger(player, 'playbackstop'));
            expect(menu()).toBeNull();
        });
    });
});

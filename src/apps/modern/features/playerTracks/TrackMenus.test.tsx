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
        item: null as { Id: string } | null,
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
        }
    };
    return { state, pm };
});

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
const { default: TrackMenus } = await import('./TrackMenus');

const { state } = engine;
let player: { name: string; playback?: object | null };

function startPlayback(name: string, itemId: string) {
    player = { name, playback: { stopped: false } };
    state.player = player;
    state.item = { Id: itemId };
}

beforeEach(() => {
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

describe('the track menus', () => {
    let container: HTMLDivElement;
    let slot: HTMLDivElement;
    let root: Root;
    let host: {
        slot: HTMLElement;
        onSubtitlesChanged: Mock<() => void>;
        onMenuOpenChange: Mock<(open: boolean) => void>;
    };
    const button = (kind: string) =>
        slot.querySelector<HTMLButtonElement>(`[data-track-menu="${kind}"]`);
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
        document.body.append(container, slot);
        host = {
            slot,
            onSubtitlesChanged: vi.fn<() => void>(),
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
    });

    it('renders its triggers only once the player lends a slot', () => {
        expect(slot.children).toHaveLength(0);
        act(() => setTrackMenuHost(host));
        expect(button('subtitles')).not.toBeNull();
        expect(button('audio')).not.toBeNull();
        state.audio = state.audio.slice(0, 1);
        act(() => Events.trigger(player, 'mediastreamschange'));
        expect(button('audio')).toBeNull();
        state.audio = [
            { Index: 1, Language: 'fra', Codec: 'aac', Channels: 2 },
            { Index: 2, Language: 'eng', Codec: 'aac', Channels: 2 }
        ];
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
        expect(host.onSubtitlesChanged).toHaveBeenCalledTimes(1);
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
        expect(host.onSubtitlesChanged).toHaveBeenCalledTimes(1);
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
});

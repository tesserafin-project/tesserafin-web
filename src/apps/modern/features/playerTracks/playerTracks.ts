/**
 * The player's audio and subtitle tracks, as the track menus need them (DEBT-WEB-2).
 *
 * The menus never touch `playbackManager` themselves. They read a snapshot, listen for a change,
 * and send a command that names the playback it was chosen for. That last part is the point of
 * this module: the player object outlives the film, so a menu opened on film A and answered after
 * another device started film B used to switch film B's audio. A command here carries the engine's
 * own playback object (`player.playback`, replaced by every play request, kept across a stream
 * change) and is dropped when that is no longer the player's.
 */
import { PlaybackManagerEvent } from 'apps/legacy/features/playback/constants/playbackManagerEvent';
import { PlayerEvent } from 'apps/legacy/features/playback/constants/playerEvent';
import { playbackManager } from 'components/playback/playbackmanager';
import type { TrackStream } from 'components/playback/trackMenuItem';
import Events from 'utils/events';

/** The engine's player object, as far as this module reads it. */
interface Player {
    playback?: object | null;
}

/** What a command acts on: the playback that was current when the menu read its tracks. */
export interface PlaybackRef {
    readonly player: Player;
    readonly playback: object | null | undefined;
    readonly itemId: string | undefined;
}

export interface PlayerTracks {
    ref: PlaybackRef;
    audio: TrackStream[];
    audioIndex: number | null;
    subtitles: TrackStream[];
    /** -1 when subtitles are off. */
    subtitleIndex: number;
    /** The secondary subtitles the current primary track can pair with; null when not offered. */
    secondary: { tracks: TrackStream[]; index: number } | null;
}

function currentItemId(player: Player): string | undefined {
    return playbackManager.currentItem(player)?.Id;
}

/** What is playing now, as a command target, or null when nothing is. */
export function currentRef(): PlaybackRef | null {
    const player: Player | undefined = playbackManager.getCurrentPlayer();
    if (!player || !playbackManager.currentItem(player)) return null;
    return { player, playback: player.playback, itemId: currentItemId(player) };
}

/** The tracks of what is playing now, or null when nothing is. */
export function readTracks(): PlayerTracks | null {
    const ref = currentRef();
    if (!ref) return null;
    const { player } = ref;

    const subtitles: TrackStream[] = playbackManager.subtitleTracks(player);
    const subtitleIndex: number =
        playbackManager.getSubtitleStreamIndex(player) ?? -1;
    const secondaryTracks: TrackStream[] =
        playbackManager.secondarySubtitleTracks(player);

    // Offered only when the player can, there is a track to pair with, and the primary track is
    // on and is itself one that can be paired (an external, non-SSA one).
    const secondaryOffered =
        playbackManager.playerHasSecondarySubtitleSupport(player) &&
        secondaryTracks.length > 0 &&
        subtitleIndex !== -1 &&
        playbackManager.trackHasSecondarySubtitleSupport(
            playbackManager.getSubtitleStream(player, subtitleIndex),
            player
        );

    return {
        ref,
        audio: playbackManager.audioTracks(player),
        audioIndex: playbackManager.getAudioStreamIndex(player) ?? null,
        subtitles,
        subtitleIndex,
        secondary: secondaryOffered
            ? {
                  tracks: secondaryTracks,
                  index:
                      playbackManager.getSecondarySubtitleStreamIndex(player) ??
                      -1
              }
            : null
    };
}

/** True while `ref` still names what the current player is playing. */
export function isCurrent(ref: PlaybackRef): boolean {
    const player: Player | undefined = playbackManager.getCurrentPlayer();
    return (
        player === ref.player &&
        player.playback === ref.playback &&
        !(ref.playback as { stopped?: boolean } | null | undefined)?.stopped &&
        currentItemId(player) === ref.itemId
    );
}

/** Calls `onChange` whenever the tracks may have changed. Returns the unsubscribe. */
export function subscribeTracks(onChange: () => void): () => void {
    const PLAYER_EVENTS = [
        PlayerEvent.PlaybackStart,
        PlayerEvent.PlaybackStop,
        PlayerEvent.MediaStreamsChange
    ];
    let player: Player | undefined;
    const listen = (on: boolean) => {
        if (!player) return;
        for (const e of PLAYER_EVENTS) {
            if (on) Events.on(player, e, onChange);
            else Events.off(player, e, onChange);
        }
    };
    const bind = () => {
        const next = playbackManager.getCurrentPlayer();
        if (next === player) return;
        listen(false);
        player = next;
        listen(true);
    };
    const onPlayerChange = () => {
        bind();
        onChange();
    };

    bind();
    Events.on(
        playbackManager,
        PlaybackManagerEvent.PlayerChange,
        onPlayerChange
    );
    return () => {
        Events.off(
            playbackManager,
            PlaybackManagerEvent.PlayerChange,
            onPlayerChange
        );
        listen(false);
        player = undefined;
    };
}

/*
 * Commands. Each returns whether it was sent: false means the playback it was chosen for has
 * ended or been replaced, and nothing was changed.
 */

export function setAudio(ref: PlaybackRef, index: number): boolean {
    if (!isCurrent(ref)) return false;
    playbackManager.setAudioStreamIndex(index, ref.player);
    return true;
}

export function setSubtitles(ref: PlaybackRef, index: number): boolean {
    if (!isCurrent(ref)) return false;
    playbackManager.setSubtitleStreamIndex(index, ref.player);
    return true;
}

export function setSecondarySubtitles(
    ref: PlaybackRef,
    index: number
): boolean {
    if (!isCurrent(ref)) return false;
    playbackManager.setSecondarySubtitleStreamIndex(index, ref.player);
    return true;
}

/**
 * What the legacy controller lends the menus: where the triggers go in its button row, and a way
 * to hold its shortcuts and its auto-hide while a menu is open. The stats and subtitle-offset
 * panels the settings menu opens are React too (`features/playerPanels`, DEBT-WEB-4).
 */
export interface TrackMenuHost {
    slot: HTMLElement;
    settingsSlot: HTMLElement;
    onMenuOpenChange: (open: boolean) => void;
}

let host: TrackMenuHost | null = null;
const hostListeners = new Set<() => void>();

/** Called by the controller when its view shows (with a host) and before it hides (null). */
export function setTrackMenuHost(next: TrackMenuHost | null): void {
    host = next;
    for (const listener of hostListeners) listener();
}

export function getTrackMenuHost(): TrackMenuHost | null {
    return host;
}

export function subscribeTrackMenuHost(listener: () => void): () => void {
    hostListeners.add(listener);
    return () => {
        hostListeners.delete(listener);
    };
}

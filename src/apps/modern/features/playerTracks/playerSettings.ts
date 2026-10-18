/**
 * The player's settings menu, as the React menus need it (DEBT-WEB-3): aspect ratio, playback
 * speed, streaming quality, repeat mode, and the two overlays it opens.
 *
 * Same contract as the tracks in `playerTracks`: the menu reads a snapshot taken for one playback,
 * and every command names that playback and is dropped when it is no longer the player's. Reading
 * the snapshot waits on the server for the user's transcoding permission; the playback is checked
 * again once that answer is in, so a slow answer cannot open a menu for A over film B.
 */
import { RepeatMode } from '@jellyfin/sdk/lib/generated-client/models/repeat-mode';

import { playbackManager } from 'components/playback/playbackmanager';
import { getVideoQualityOptions } from 'components/qualityOptions';
import { ServerConnections } from 'lib/jellyfin-apiclient';

import { type PlaybackRef, currentRef, isCurrent } from './playerTracks';

export interface Choice<T> {
    id: T;
    name: string;
    selected: boolean;
}

export interface PlayerSettings {
    ref: PlaybackRef;
    /** Each setting is null when the player or the item does not offer it. */
    aspectRatio: Choice<string>[] | null;
    playbackRate: Choice<number>[] | null;
    /** Bitrates, 0 being Auto; `summary` is what the settings row says is in effect. */
    quality: { choices: Choice<number>[]; summary: string | null } | null;
    repeatMode: RepeatMode | null;
    /** Only when the player can shift subtitles and the track on is an external one. */
    subtitleOffset: boolean;
}

interface Named<T> {
    id: T;
    name: string;
}

function choices<T>(options: Named<T>[], current: T): Choice<T>[] {
    return options.map(({ id, name }) => ({
        id,
        name,
        selected: id === current
    }));
}

function readQuality(player: PlaybackRef['player']): PlayerSettings['quality'] {
    const source = playbackManager.currentMediaSource(player);
    const video = source?.MediaStreams?.find(
        (s: { Type?: string }) => s.Type === 'Video'
    );
    const options = getVideoQualityOptions({
        currentMaxBitrate: playbackManager.getMaxStreamingBitrate(player),
        isAutomaticBitrateEnabled:
            playbackManager.enableAutomaticBitrateDetection(player),
        videoCodec: video?.Codec ?? null,
        videoBitRate: video?.BitRate ?? null,
        enableAuto: true
    }) as {
        name: string;
        bitrate: number;
        selected?: boolean;
        autoText?: string;
    }[];

    const selected = options.find((o) => o.selected);
    let summary = selected?.name ?? null;
    if (selected?.autoText) {
        const playMethod =
            playbackManager.getPlayerState(player).PlayState?.PlayMethod;
        summary = `${selected.name}${
            playMethod && playMethod !== 'Transcode'
                ? ' - Direct'
                : ' ' + selected.autoText
        }`;
    }

    return {
        choices: options.map((o) => ({
            id: o.bitrate,
            name: o.name,
            selected: !!o.selected
        })),
        summary
    };
}

/** The settings of what is playing now, or null when nothing is or it changed while reading. */
export async function readSettings(): Promise<PlayerSettings | null> {
    const ref = currentRef();
    if (!ref) return null;

    const serverId: string | undefined = playbackManager.currentItem(
        ref.player
    )?.ServerId;
    const user = serverId
        ? await ServerConnections.getApiClient(serverId)
              ?.getCurrentUser()
              .catch(() => null)
        : null;
    if (!isCurrent(ref)) return null;

    const player = ref.player;
    const commands: string[] = playbackManager.getSupportedCommands(player);
    const state = playbackManager.getPlayerState(player);

    return {
        ref,
        aspectRatio: commands.includes('SetAspectRatio')
            ? choices<string>(
                  playbackManager.getSupportedAspectRatios(player),
                  playbackManager.getAspectRatio(player)
              )
            : null,
        playbackRate: commands.includes('PlaybackRate')
            ? choices<number>(
                  playbackManager.getSupportedPlaybackRates(player),
                  playbackManager.getPlaybackRate(player)
              )
            : null,
        quality:
            state.MediaSource?.SupportsTranscoding &&
            commands.includes('SetMaxStreamingBitrate') &&
            user?.Policy?.EnableVideoPlaybackTranscoding
                ? readQuality(player)
                : null,
        repeatMode:
            commands.includes('SetRepeatMode') &&
            playbackManager.currentMediaSource(player)?.RunTimeTicks
                ? playbackManager.getRepeatMode(player)
                : null,
        subtitleOffset:
            !!playbackManager.supportSubtitleOffset(player) &&
            playbackManager.canHandleOffsetOnCurrentSubtitle(player)
    };
}

export const REPEAT_MODES = [
    RepeatMode.RepeatAll,
    RepeatMode.RepeatOne,
    RepeatMode.RepeatNone
];

/*
 * Commands. Each returns whether it was sent: false means the playback it was chosen for has
 * ended or been replaced, and nothing was changed.
 */

export function setAspectRatio(ref: PlaybackRef, id: string): boolean {
    if (!isCurrent(ref)) return false;
    playbackManager.setAspectRatio(id, ref.player);
    return true;
}

export function setPlaybackRate(ref: PlaybackRef, rate: number): boolean {
    if (!isCurrent(ref)) return false;
    playbackManager.setPlaybackRate(rate, ref.player);
    return true;
}

/** 0 turns automatic bitrate detection on. */
export function setMaxBitrate(ref: PlaybackRef, bitrate: number): boolean {
    if (!isCurrent(ref)) return false;
    playbackManager.setMaxStreamingBitrate(
        { enableAutomaticBitrateDetection: !bitrate, maxBitrate: bitrate },
        ref.player
    );
    return true;
}

export function setRepeatMode(ref: PlaybackRef, mode: RepeatMode): boolean {
    if (!isCurrent(ref)) return false;
    playbackManager.setRepeatMode(mode, ref.player);
    return true;
}

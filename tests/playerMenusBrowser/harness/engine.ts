import Events from 'utils/events';

const player = { playback: { stopped: false } };
const audio = [
    { Index: 1, Language: 'eng', Codec: 'aac', Channels: 2 },
    { Index: 2, Language: 'fra', Codec: 'aac', Channels: 2 }
];
const subtitles = [
    { Index: 3, Language: 'eng', Codec: 'subrip', IsExternal: true }
];
const source = { SupportsTranscoding: false, RunTimeTicks: 60_000_000_000 };
let audioTracks = audio;
let subtitleTracks = subtitles;
let subIndex = 3;
export const commands: string[] = [];

export const playbackManager = {
    getCurrentPlayer: () => player,
    currentItem: () => ({ Id: 'fixture-film', ServerId: 'fixture-server' }),
    audioTracks: () => audioTracks,
    subtitleTracks: () => subtitleTracks,
    secondarySubtitleTracks: () => subtitleTracks,
    getAudioStreamIndex: () => 1,
    getSubtitleStreamIndex: () => subIndex,
    getSecondarySubtitleStreamIndex: () => -1,
    playerHasSecondarySubtitleSupport: () => true,
    trackHasSecondarySubtitleSupport: () => true,
    getSubtitleStream: () => subtitleTracks[0],
    setAudioStreamIndex: () => commands.push('audio'),
    setSubtitleStreamIndex: (index: number) => {
        subIndex = index;
        commands.push('subtitles');
    },
    setSecondarySubtitleStreamIndex: () => commands.push('secondary'),
    getSupportedCommands: () => [
        'SetAspectRatio',
        'PlaybackRate',
        'SetRepeatMode'
    ],
    getSupportedAspectRatios: () => [
        { id: 'auto', name: 'Auto' },
        { id: 'fill', name: 'Fill' }
    ],
    getAspectRatio: () => 'auto',
    getSupportedPlaybackRates: () => [
        { id: 1, name: '1x' },
        { id: 2, name: '2x' }
    ],
    getPlaybackRate: () => 1,
    getRepeatMode: () => 'RepeatNone',
    currentMediaSource: () => source,
    getPlayerState: () => ({ MediaSource: source, PlayState: {} }),
    supportSubtitleOffset: () => false,
    canHandleOffsetOnCurrentSubtitle: () => false,
    getPlayerSubtitleOffset: () => 0,
    enableShowingSubtitleOffset: () => undefined,
    disableShowingSubtitleOffset: () => undefined,
    setAspectRatio: () => commands.push('aspect'),
    setPlaybackRate: () => commands.push('rate'),
    setRepeatMode: () => commands.push('repeat')
};

export function removeTrigger(kind: 'audio' | 'subtitles', remaining = 1) {
    if (kind === 'audio') audioTracks = audio.slice(0, remaining);
    else subtitleTracks = [];
    Events.trigger(player, 'mediastreamschange');
}

export function stopPlayback() {
    player.playback.stopped = true;
    Events.trigger(player, 'playbackstop');
}

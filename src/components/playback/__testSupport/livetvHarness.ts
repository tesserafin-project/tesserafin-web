/**
 * #153-LTV-P0 harness: a minimal but *real* environment for `PlaybackManager`.
 *
 * The point of this file is that nothing here reimplements the request builder. It supplies a
 * server double whose `PlaybackInfo` endpoint applies exactly the filter the real server applies
 * (`Tesserafin.Api/Helpers/MediaInfoHelper.cs:169-176`: a non-empty `MediaSourceId` narrows the
 * source list by `Id`), so a request carrying a placeholder id produces the same
 * zero-sources / `NoCompatibleStream` answer observed against the live rig.
 */

/** Ids observed on the Phase 0 software-tuner rig (see docs/tesserafin/live-tv-playbackinfo-source-selection.md). */
export const CHANNEL_ITEM_ID = '036417f9ce07f6603a18aa4f86b8c1cb';
export const TUNER_SOURCE_ID = 'f00baff0a649bca042e0aca880a6eaad';
export const VIDEO_ITEM_ID = '11111111111111111111111111111111';
export const VIDEO_SOURCE_ID = '22222222222222222222222222222222';
export const SERVER_ID = 'ffffffffffffffffffffffffffffffff';
export const USER_ID = '99999999999999999999999999999999';

export interface MediaSourceLike {
    Id: string;
    Name?: string;
    Type?: string;
    Protocol?: string;
    RunTimeTicks?: number | null;
    MediaStreams?: unknown[];
    SupportsDirectPlay?: boolean;
    SupportsDirectStream?: boolean;
    SupportsTranscoding?: boolean;
    RequiresOpening?: boolean;
    RequiresClosing?: boolean;
    IsInfiniteStream?: boolean;
    DefaultAudioStreamIndex?: number | null;
    DefaultSubtitleStreamIndex?: number | null;
    DefaultSecondarySubtitleStreamIndex?: number | null;
    Path?: string;
    TranscodingUrl?: string;
    [key: string]: unknown;
}

/** The live-TV tuner source the rig returns once the placeholder is not sent. */
export function tunerSource(): MediaSourceLike {
    return {
        Id: TUNER_SOURCE_ID,
        Name: 'LTVP0 One',
        Type: 'Default',
        Protocol: 'Http',
        RunTimeTicks: null,
        MediaStreams: [],
        SupportsDirectPlay: false,
        SupportsDirectStream: true,
        SupportsTranscoding: true,
        RequiresOpening: false,
        RequiresClosing: false,
        IsInfiniteStream: true,
        DefaultAudioStreamIndex: -1,
        DefaultSubtitleStreamIndex: null,
        DefaultSecondarySubtitleStreamIndex: null,
        Path: 'http://127.0.0.1:18099/channel1.ts',
        TranscodingUrl: '/videos/' + CHANNEL_ITEM_ID + '/live.m3u8'
    };
}

/** An ordinary library video whose remembered subtitle selection is "off" (-1). */
export function videoSource(
    overrides: Partial<MediaSourceLike> = {}
): MediaSourceLike {
    return {
        Id: VIDEO_SOURCE_ID,
        Name: 'Ordinary Video',
        Type: 'Default',
        Protocol: 'File',
        RunTimeTicks: 6000000000,
        MediaStreams: [
            { Index: 0, Type: 'Video', Codec: 'h264' },
            { Index: 1, Type: 'Audio', Codec: 'aac', Language: 'eng' }
        ],
        SupportsDirectPlay: true,
        SupportsDirectStream: true,
        SupportsTranscoding: true,
        RequiresOpening: false,
        RequiresClosing: false,
        IsInfiniteStream: false,
        DefaultAudioStreamIndex: 1,
        DefaultSubtitleStreamIndex: -1,
        DefaultSecondarySubtitleStreamIndex: null,
        Path: '/media/video.mkv',
        ...overrides
    };
}

export function channelItem(overrides: Record<string, unknown> = {}) {
    return {
        Id: CHANNEL_ITEM_ID,
        ServerId: SERVER_ID,
        Name: 'LTVP0 One',
        Type: 'TvChannel',
        MediaType: 'Video',
        ChannelNumber: '1',
        IsFolder: false,
        RunTimeTicks: null,
        // The DTO the rig actually returns: a Placeholder source whose Id *is* the item id.
        MediaSources: [
            {
                Id: CHANNEL_ITEM_ID,
                Name: 'LTVP0 One',
                Type: 'Placeholder',
                Protocol: 'File'
            }
        ],
        ...overrides
    };
}

export const AUDIO_ITEM_ID = '33333333333333333333333333333333';
export const RECORDING_ITEM_ID = '44444444444444444444444444444444';

export function audioSource(
    overrides: Partial<MediaSourceLike> = {}
): MediaSourceLike {
    return {
        Id: AUDIO_ITEM_ID,
        Name: 'Ordinary Track',
        Type: 'Default',
        Protocol: 'File',
        RunTimeTicks: 2000000000,
        MediaStreams: [{ Index: 0, Type: 'Audio', Codec: 'flac' }],
        SupportsDirectPlay: true,
        SupportsDirectStream: true,
        SupportsTranscoding: true,
        RequiresOpening: false,
        RequiresClosing: false,
        IsInfiniteStream: false,
        DefaultAudioStreamIndex: 0,
        DefaultSubtitleStreamIndex: null,
        Path: '/media/track.flac',
        ...overrides
    };
}

export function recordingSource(
    overrides: Partial<MediaSourceLike> = {}
): MediaSourceLike {
    return videoSource({
        Id: RECORDING_ITEM_ID,
        Name: 'Recorded Programme',
        Path: '/media/recording.ts',
        ...overrides
    });
}

export function audioItem(overrides: Record<string, unknown> = {}) {
    return {
        Id: AUDIO_ITEM_ID,
        ServerId: SERVER_ID,
        Name: 'Ordinary Track',
        Type: 'Audio',
        MediaType: 'Audio',
        IsFolder: false,
        RunTimeTicks: 2000000000,
        MediaSources: [audioSource()],
        ...overrides
    };
}

export function recordingItem(overrides: Record<string, unknown> = {}) {
    return {
        Id: RECORDING_ITEM_ID,
        ServerId: SERVER_ID,
        Name: 'Recorded Programme',
        Type: 'Recording',
        MediaType: 'Video',
        SourceType: 'LiveTV',
        IsFolder: false,
        RunTimeTicks: 6000000000,
        MediaSources: [recordingSource()],
        ...overrides
    };
}

export function videoItem(overrides: Record<string, unknown> = {}) {
    return {
        Id: VIDEO_ITEM_ID,
        ServerId: SERVER_ID,
        Name: 'Ordinary Video',
        Type: 'Movie',
        MediaType: 'Video',
        IsFolder: false,
        RunTimeTicks: 6000000000,
        MediaStreams: videoSource().MediaStreams,
        MediaSources: [videoSource()],
        ...overrides
    };
}

/**
 * The `PlaybackInfo` server double. `sourcesByItemId` holds what the server would return for an
 * unfiltered request; the filter below is the server's, not the client's.
 */
export function createPlaybackInfoResponder(
    sourcesByItemId: Record<string, MediaSourceLike[]>
) {
    return ({
        itemId,
        playbackInfoDto
    }: {
        itemId: string;
        playbackInfoDto: Record<string, unknown>;
    }) => {
        const all = sourcesByItemId[itemId] ?? [];
        const requested = playbackInfoDto?.MediaSourceId as string | undefined;
        const sources =
            requested === undefined || requested === null || requested === ''
                ? all
                : all.filter(
                      (s) => s.Id.toLowerCase() === requested.toLowerCase()
                  );

        return Promise.resolve({
            data: {
                MediaSources: sources,
                PlaySessionId: 'session-' + itemId,
                ...(sources.length === 0
                    ? { ErrorCode: 'NoCompatibleStream' }
                    : {})
            }
        });
    };
}

export interface FakePlayer {
    name: string;
    id: string;
    type: string;
    isLocalPlayer: boolean;
    priority: number;
    played: unknown[];
    [key: string]: unknown;
}

export function createFakePlayer(): FakePlayer {
    const player: FakePlayer = {
        name: 'LtvP0TestPlayer',
        id: 'ltvp0testplayer',
        type: 'mediaplayer',
        isLocalPlayer: true,
        priority: -1,
        played: [],
        canPlayMediaType: (mediaType: string) =>
            mediaType === 'Video' || mediaType === 'Audio',
        canPlayItem: () => true,
        getDeviceProfile: () =>
            Promise.resolve({ Name: 'ltvp0', DirectPlayProfiles: [] }),
        supportsPlayMethod: () => true,
        getDirectPlayProtocols: () => ['File'],
        play(streamInfo: unknown) {
            (player.played as unknown[]).push(streamInfo);
            return Promise.resolve();
        },
        stop: () => Promise.resolve(),
        destroy: () => {
            /* no-op */
        },
        currentTime: () => 0,
        duration: () => 0,
        paused: () => false,
        volume: () => 100,
        isMuted: () => false,
        setSubtitleStreamIndex: () => {
            /* no-op */
        },
        setAudioStreamIndex: () => {
            /* no-op */
        },
        currentSrc: () => '',
        getStats: () => Promise.resolve({}),
        supports: () => false
    };

    return player;
}

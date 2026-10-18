/**
 * The playback data panel, as the React panel needs it (DEBT-WEB-4).
 *
 * Its rows come from four places: the player's own `getStats()` (stream type, sizes, dropped
 * frames), the server's session for this device (play method, transcoding: asked at most every
 * 10 s), the media source and audio track in use, and SyncPlay's time sync when a group is active.
 * A reader is bound to one playback: an answer that arrives after that playback was stopped or
 * replaced is dropped, so the panel never shows film A's figures over film B.
 */
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { getReadableSize } from 'utils/file';

import { PluginType } from 'constants/pluginType';
import { playbackManager } from 'components/playback/playbackmanager';
import playMethodHelper from 'components/playback/playmethodhelper';
import { pluginManager } from 'components/pluginManager';

import {
    type PlaybackRef,
    isCurrent
} from 'apps/modern/features/playerTracks/playerTracks';

export interface StatRow {
    label: string;
    /** Several values (the transcode reasons) are shown one per line. */
    value: string | string[];
}

export interface StatCategory {
    name?: string;
    subText?: string;
    rows: StatRow[];
}

/* The engine's objects, as far as these rows read them. */
interface Stream {
    Type?: string;
    Index?: number;
    Codec?: string;
    Profile?: string;
    Level?: number;
    BitRate?: number;
    AverageFrameRate?: number;
    RealFrameRate?: number;
    ReferenceFrameRate?: number;
    BitDepth?: number;
    PixelFormat?: string;
    VideoRangeType?: string;
    VideoDoViTitle?: string;
    ColorSpace?: string;
    ColorPrimaries?: string;
    ColorTransfer?: string;
    Channels?: number;
    SampleRate?: number;
}

interface Session {
    NowPlayingItem?: unknown;
    PlayState?: { PlayMethod?: string };
    TranscodingInfo?: {
        VideoCodec?: string;
        AudioCodec?: string;
        Bitrate?: number;
        AudioChannels?: number;
        IsVideoDirect?: boolean;
        IsAudioDirect?: boolean;
        CompletionPercentage?: number;
        Framerate?: number;
        TranscodeReasons?: string[];
    };
}

interface PlayerStatsResult {
    categories?: { name?: string; subText?: string; stats: StatRow[] }[];
}

interface PlayerWithStats {
    name?: string;
    getStats?: () => Promise<PlayerStatsResult>;
}

const t = (key: string) => globalize.translate(key);

function bitrate(value: number): string {
    return value > 1000000
        ? (value / 1000000).toFixed(1) + ' Mbps'
        : Math.floor(value / 1000) + ' Kbps';
}

/** Pushes `label: parts joined` when there is any part. */
function row(
    rows: StatRow[],
    label: string,
    parts: (string | false | null | undefined)[],
    separator = ',  '
): void {
    const present = parts.filter(Boolean) as string[];
    if (present.length)
        rows.push({ label: t(label), value: present.join(separator) });
}

function videoStream(player: PlaybackRef['player']): Stream {
    const source = playbackManager.currentMediaSource(player) || {};
    return (
        ((source.MediaStreams || []) as Stream[]).find(
            (s) => s.Type === 'Video'
        ) || {}
    );
}

function transcodingRows(
    session: Session,
    player: PlaybackRef['player'],
    method: string | null | undefined
): StatRow[] {
    const info = session.TranscodingInfo || {};
    const rows: StatRow[] = [];
    const transcoding = method === 'Transcode';
    const sourceFps = videoStream(player).ReferenceFrameRate;

    row(rows, 'LabelTargetCodecs', [
        info.VideoCodec &&
            info.VideoCodec.toUpperCase() +
                (info.IsVideoDirect ? ' (direct)' : ''),
        info.AudioCodec &&
            info.AudioCodec.toUpperCase() +
                (info.IsAudioDirect ? ' (direct)' : ''),
        transcoding && !!info.AudioChannels && `${info.AudioChannels} Ch`,
        transcoding && !!info.Bitrate && bitrate(info.Bitrate)
    ]);
    if (transcoding) {
        row(
            rows,
            'LabelProgressAndSpeed',
            [
                !!info.CompletionPercentage &&
                    `${info.CompletionPercentage.toFixed(1)}%`,
                !!info.Framerate &&
                    (sourceFps
                        ? `${info.Framerate} fps (${(info.Framerate / sourceFps).toFixed(2)}x)`
                        : `${info.Framerate} fps`)
            ],
            ' / '
        );
    }
    if (info.TranscodeReasons?.length) {
        rows.push({
            label: t('LabelReasons'),
            value: info.TranscodeReasons.map((reason) => t(String(reason)))
        });
    }
    return rows;
}

function mediaSourceRows(player: PlaybackRef['player']): StatRow[] {
    return [...videoRows(player), ...audioRows(player)];
}

function videoRows(player: PlaybackRef['player']): StatRow[] {
    const source = playbackManager.currentMediaSource(player) || {};
    const video = videoStream(player);
    const fps = video.AverageFrameRate || video.RealFrameRate;
    const rows: StatRow[] = [];

    row(rows, 'LabelProfileContainer', [
        source.Container,
        !!source.Size && getReadableSize(source.Size),
        !!source.Bitrate && bitrate(source.Bitrate)
    ]);
    row(
        rows,
        'LabelVideoCodec',
        [video.Codec?.toUpperCase(), video.VideoDoViTitle],
        '  '
    );
    row(rows, 'LabelVideoAttributes', [
        video.Profile,
        video.Level != null && video.Level >= 0 && `Lv ${video.Level}`,
        !!video.BitRate && bitrate(video.BitRate),
        !!fps && `${fps.toFixed(2)} fps`
    ]);
    row(rows, 'LabelVideoBitDepth', [
        !!video.BitDepth && `${video.BitDepth} Bit`,
        video.PixelFormat,
        video.VideoRangeType
    ]);
    row(rows, 'LabelVideoColors', [
        video.ColorSpace && `${video.ColorSpace}(m)`,
        video.ColorPrimaries && `${video.ColorPrimaries}(p)`,
        video.ColorTransfer && `${video.ColorTransfer}(t)`
    ]);
    return rows;
}

function audioRows(player: PlaybackRef['player']): StatRow[] {
    const audioIndex = playbackManager.getAudioStreamIndex(player);
    const audio: Stream =
        (playbackManager.audioTracks(player) as Stream[]).find(
            (s) => s.Type === 'Audio' && s.Index === audioIndex
        ) || {};
    const rows: StatRow[] = [];
    row(
        rows,
        'LabelAudioCodec',
        [audio.Codec?.toUpperCase(), audio.Profile],
        '  '
    );
    row(rows, 'LabelAudioAttributes', [
        !!audio.Channels && `${audio.Channels} Ch`,
        !!audio.BitRate && bitrate(audio.BitRate),
        !!audio.SampleRate && `${audio.SampleRate} Hz`,
        !!audio.BitDepth && `${audio.BitDepth} Bit`
    ]);
    return rows;
}

function syncPlayRows(): StatRow[] {
    const syncPlay = pluginManager.firstOfType(PluginType.SyncPlay)?.instance;
    if (!syncPlay?.Manager.isSyncPlayEnabled()) return [];
    const stats = syncPlay.Manager.getStats();
    const ms = t('MillisecondsUnit');
    return [
        {
            label: t('LabelSyncPlayTimeSyncDevice'),
            value: String(stats.TimeSyncDevice)
        },
        {
            label: t('LabelSyncPlayTimeSyncOffset'),
            value: `${stats.TimeSyncOffset} ${ms}`
        },
        {
            label: t('LabelSyncPlayPlaybackDiff'),
            value: `${stats.PlaybackDiff} ${ms}`
        },
        { label: t('LabelSyncPlaySyncMethod'), value: String(stats.SyncMethod) }
    ];
}

const METHOD_NAMES: Record<string, string> = {
    DirectPlay: 'DirectPlaying',
    Remux: 'Remuxing',
    DirectStream: 'DirectStreaming',
    Transcode: 'Transcoding'
};

const TRANSCODING_TITLES: Record<string, string> = {
    Remux: 'LabelRemuxingInfo',
    DirectStream: 'LabelDirectStreamingInfo'
};

/** "Html Video Player  (Direct playing)". */
function playerName(
    player: PlayerWithStats,
    method: string | null | undefined
): string {
    if (!method) return String(player.name);
    const name = METHOD_NAMES[method] ? t(METHOD_NAMES[method]) : method;
    return `${player.name}  (${name})`;
}

const SESSION_MAX_AGE_MS = 10000;

export interface StatsReader {
    /** The panel's categories, or null when the playback is no longer the player's. */
    read(): Promise<StatCategory[] | null>;
}

/** A reader for one playback, with its own 10 s session cache. */
export function createStatsReader(ref: PlaybackRef): StatsReader {
    let session: Session = {};
    let sessionAt = 0;

    const getSession = async (): Promise<Session> => {
        if (Date.now() - sessionAt < SESSION_MAX_AGE_MS) return session;
        const apiClient = ServerConnections.getApiClient(
            playbackManager.currentItem(ref.player)?.ServerId
        );
        if (!apiClient) return {};
        try {
            const sessions: Session[] = await apiClient.getSessions({
                deviceId: apiClient.deviceId()
            });
            session = sessions[0] || {};
            sessionAt = Date.now();
            return session;
        } catch {
            return {};
        }
    };

    return {
        async read() {
            if (!isCurrent(ref)) return null;
            const player = ref.player as PlaybackRef['player'] &
                PlayerWithStats;
            const [playerStats, current] = await Promise.all([
                player.getStats
                    ? player.getStats()
                    : Promise.resolve<PlayerStatsResult>({}),
                getSession()
            ]);
            if (!isCurrent(ref)) return null;

            const method: string | null | undefined =
                playMethodHelper.getDisplayPlayMethod(current);
            const categories: StatCategory[] = [
                {
                    name: t('LabelPlaybackInfo'),
                    rows: [
                        {
                            label: t('LabelPlayer'),
                            value: playerName(player, method)
                        }
                    ]
                },
                ...(playerStats.categories || []).map((c) => ({
                    name: c.name,
                    subText: c.subText,
                    rows: c.stats
                }))
            ];
            if (current.TranscodingInfo) {
                categories.push({
                    name: t(
                        TRANSCODING_TITLES[method ?? ''] ??
                            'LabelTranscodingInfo'
                    ),
                    rows: transcodingRows(current, player, method)
                });
            }
            categories.push({
                name: t('LabelOriginalMediaInfo'),
                rows: mediaSourceRows(player)
            });
            const sync = syncPlayRows();
            if (sync.length)
                categories.push({ name: t('LabelSyncPlayInfo'), rows: sync });
            return categories;
        }
    };
}

/* Whether the panel is open; shared by the settings menu, the `togglestats` command and the panel. */

let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    for (const listener of listeners) listener();
}

export function isStatsOpen(): boolean {
    return open;
}

export function subscribeStats(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function toggleStats(): void {
    setOpen(!open);
}

export function closeStats(): void {
    setOpen(false);
}

/**
 * Manual mirror of `Reefin.Playback.Decision` + `Reefin.Api.Models.PlaybackSessionDtos` (repo
 * `reefin`). These routes are Reefin-specific and are not part of `@jellyfin/sdk`, so there is no
 * generated client to lean on — keep this file synchronized by hand with the server DTOs until
 * RFC-0001 §9 Q2 decides on OpenAPI generation.
 *
 * Verified against `reefin` source on 2026-07-16 (not just the design doc):
 * - `Reefin.Api/Controllers/PlaybackDiagnosticsSessionsController.cs`
 * - `Reefin.Api/Models/PlaybackSessionDtos/PlaybackSessionResponse.cs`
 * - `Reefin.Api/Models/PlaybackSessionDtos/PlaybackSessionListItem.cs`
 * - `src/Reefin.Playback.Decision/{OutputSpec,SelectedStreams,Resolution,MediaKind,PlaybackMethod,StreamingProtocol}.cs`
 * - `src/Reefin.Extensions/Json/JsonDefaults.cs` (serializer options)
 *
 * Two things confirmed by that reading that the design doc did not spell out:
 * 1. Enums serialize as their PascalCase member names (`JsonStringEnumConverter` is registered in
 *    `JsonDefaults.Options`), not as integers — the string-literal unions below are correct.
 * 2. `JsonDefaults.Options` sets `DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull`.
 *    A C# `null` property is *omitted* from the JSON payload, not serialized as an explicit
 *    `null`. At the JS boundary this means a field typed `T | null` below will actually be
 *    `undefined` (missing key) at runtime, never a literal `null` value from `JSON.parse`. Treat
 *    nullable fields as falsy (`!value`) rather than doing strict `=== null` checks; the `| null`
 *    in these types documents server intent ("explicitly absent"), not the literal runtime tag.
 *
 * The rest of this file (ReasonNode, ClientCapabilities, etc.) mirrors the design doc's proposed
 * shape but is not exercised by PR1 (list-only) — PR2 (detail view) is what will actually read
 * these fields off a live server response and can catch any remaining drift then.
 */

export type MediaKind = 'Audio' | 'Video';
export type PlaybackMethod = 'DirectPlay' | 'Remux' | 'Transcode';
export type StreamingProtocol = 'Http' | 'Hls';
export type SubtitleDeliveryMethod = 'Embed' | 'External' | 'Burn' | 'Hls';

export type TransformKind =
    | 'RemuxContainer' | 'TranscodeVideo' | 'TranscodeAudio' | 'CopyVideo' | 'CopyAudio'
    | 'Downmix' | 'Tonemap' | 'BurnInSubtitle' | 'ExtractSubtitle' | 'ConvertSubtitle';

export type ReasonCode =
    | 'ContainerNotSupported' | 'VideoCodecNotSupported' | 'AudioCodecNotSupported'
    | 'SubtitleCodecNotSupported' | 'AudioIsExternal' | 'SecondaryAudioNotSupported'
    | 'StreamCountExceedsLimit' | 'VideoProfileNotSupported' | 'VideoRangeTypeNotSupported'
    | 'VideoCodecTagNotSupported' | 'VideoLevelNotSupported' | 'VideoResolutionNotSupported'
    | 'VideoBitDepthNotSupported' | 'VideoFramerateNotSupported' | 'VideoRotationNotSupported'
    | 'RefFramesNotSupported' | 'AnamorphicVideoNotSupported' | 'InterlacedVideoNotSupported'
    | 'AudioChannelsNotSupported' | 'AudioProfileNotSupported' | 'AudioSampleRateNotSupported'
    | 'AudioBitDepthNotSupported' | 'ContainerBitrateExceedsLimit' | 'VideoBitrateNotSupported'
    | 'AudioBitrateNotSupported' | 'UnknownVideoStreamInfo' | 'UnknownAudioStreamInfo'
    | 'DirectPlayError' | 'StreamCopyable' | 'SourceSelected' | 'MethodChosen'
    | 'SubtitleBurnInRequired' | 'SubtitleFormatConverted' | 'DownmixRequired' | 'TonemapRequired'
    | 'NoViablePlan' | 'OutputProfileFallbackUsed' | 'RequestedSourceNotFound';

export type ReasonOutcome = 'Rejected' | 'Accepted' | 'Chosen';
export type ReasonSubjectKind = 'Container' | 'VideoStream' | 'AudioStream' | 'Subtitle' | 'Source' | 'Method';
export type DivergenceClass =
    | 'Equivalent' | 'ExpectedImprovement' | 'KnownV2Limitation' | 'PotentialRegression' | 'Unexplained';

export interface Resolution { Width: number; Height: number }

export interface OutputSpec {
    Container: string | null;
    VideoCodec: string | null;
    AudioCodec: string | null;
    Resolution: Resolution | null;
    VideoRange: string | null;
    AudioChannels: number | null;
    TotalBitrate: number | null;
    VideoBitrate: number | null;
    AudioBitrate: number | null;
    Protocol: StreamingProtocol;
    SubtitleFormat: string | null;
}

export interface SelectedSubtitle { Index: number; Delivery: SubtitleDeliveryMethod }

export interface SelectedStreams {
    Video: number | null;
    Audio: number | null;
    Subtitle: SelectedSubtitle | null;
}

/** docs/pr92-design-playback-api-and-diagnostics.md §4.2 — stable client-facing response, never
 * StreamInfo/DeviceProfile/MediaOptions. */
export interface PlaybackSessionResponse {
    Id: string; // GUID
    Kind: MediaKind;
    /** 0 = LegacyDecisionVersion (sentinel — source is the legacy planner until PR115 ships). */
    DecisionVersion: number;
    Method: PlaybackMethod;
    Output: OutputSpec;
    SelectedStreams: SelectedStreams;
    Transforms: TransformKind[];
    Reasons: ReasonCode[];
    CreatedAt: string; // ISO 8601
    UpdatedAt: string;
}

/** One row of `GET /System/PlaybackDiagnostics/Sessions`. */
export interface PlaybackSessionListItem {
    Session: PlaybackSessionResponse;
    /** false for almost all sessions while the server-side shadow mode is disabled (the default). */
    HasDiagnostic: boolean;
}

export interface ReasonSubject {
    Kind: ReasonSubjectKind;
    StreamIndex: number | null;
    SourceId: string | null;
}

export interface ReasonNode {
    Code: ReasonCode;
    Outcome: ReasonOutcome;
    Subject: ReasonSubject;
    Detail: string | null;
    Children: ReasonNode[];
}

export interface PlaybackRequestContext {
    RequestId: string;
    ItemId: string;
    MediaSourceId: string | null;
    UserId: string;
    MediaKind: MediaKind;
    RequestedAt: string;
    EngineVersion: number;
}

/** The raw shape here is still unstable server-side (see `ClientCapabilities.cs` remarks on the
 * PR102 decode/output split) — deliberately left opaque rather than modeled precisely. */
export type DecodeProfileLike = Record<string, unknown>;

export interface ClientCapabilities {
    Decode: {
        DirectPlayProfiles: DecodeProfileLike[];
        VideoCodecs: Array<{
            Codec: string; Profiles: string[]; MaxLevel: number | null; MaxBitDepth: number | null;
            VideoRangeTypes: string[]; MaxResolution: Resolution | null; MaxBitrate: number | null;
        }>;
        AudioCodecs: Array<{
            Codec: string; MaxChannels: number | null; MaxSampleRate: number | null;
            MaxBitDepth: number | null; MaxBitrate: number | null;
        }>;
        SubtitleDelivery: Array<{ Format: string; Method: SubtitleDeliveryMethod }>;
        SupportsHls: boolean;
        SupportsDash: boolean;
    };
    OutputProfiles: Array<{
        Type: MediaKind; Protocol: StreamingProtocol; Container: string;
        VideoCodecs: string[]; AudioCodecs: string[];
        MaxVideoBitrate: number | null; MaxAudioBitrate: number | null; MaxAudioChannels: number | null;
    }>;
}

export interface VideoStreamSnapshot {
    Index: number; Codec: string; Profile: string | null; Level: number | null;
    Width: number | null; Height: number | null; BitDepth: number | null; VideoRange: string | null;
    Framerate: number | null; Bitrate: number | null; IsAnamorphic: boolean; IsInterlaced: boolean;
}

export interface AudioStreamSnapshot {
    Index: number; Codec: string; Channels: number | null; SampleRate: number | null;
    BitDepth: number | null; Bitrate: number | null; Language: string | null; IsDefault: boolean;
}

export interface SubtitleStreamSnapshot {
    Index: number; Format: string; IsExternal: boolean; IsForced: boolean;
    IsDefault: boolean; Language: string | null;
}

export interface MediaSourceSnapshot {
    MediaSourceId: string; Container: string; Protocol: string;
    Bitrate: number | null; RunTimeTicks: number | null;
    VideoStreams: VideoStreamSnapshot[];
    AudioStreams: AudioStreamSnapshot[];
    SubtitleStreams: SubtitleStreamSnapshot[];
    SupportsDirectPlay: boolean; SupportsDirectStream: boolean; SupportsTranscoding: boolean;
}

export interface DiagnosticComparison {
    LegacyMethod: PlaybackMethod;
    LegacyReasons: ReasonCode[];
    DivergenceClass: DivergenceClass;
}

export type DiagnosticTimelineStage = 'Created' | 'Updated' | 'FfmpegStarted' | 'PlaybackStarted' | 'PlaybackStopped';

export interface DiagnosticTimelineEntry { Stage: DiagnosticTimelineStage; At: string }

/** docs/pr92-design-playback-api-and-diagnostics.md §4.3 — filtered admin projection, never
 * Path/TranscodingUrl/token/ffmpeg args. Nullable fields mean no shadow diagnostic was retained
 * for this session (the nominal case while the server-side shadow mode is disabled). Not
 * consumed by PR1 (list-only) — reserved for the PR2 detail view. */
export interface PlaybackDiagnosticDetail extends PlaybackSessionResponse {
    RequestContext: PlaybackRequestContext | null;
    Capabilities: ClientCapabilities | null;
    SourceSnapshot: MediaSourceSnapshot[] | null;
    Reasoning: ReasonNode | null;
    Comparison: DiagnosticComparison | null;
    Timeline: DiagnosticTimelineEntry[];
}

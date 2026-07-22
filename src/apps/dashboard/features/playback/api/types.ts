/**
 * Playback diagnostics types, sourced from the generated Reefin API client
 * (`src/lib/tesserafin-sdk/generated/`, see `docs/tesserafin/design-tesserafin-api-layer.md`) rather than
 * hand-mirrored from the C# DTOs as this file did before PR2 of that design.
 *
 * The generated model interfaces mark every property optional (`'Foo'?: T`), including properties
 * the server contract guarantees are always present - Swashbuckle does not mark C# non-nullable
 * reference/value-type properties as OpenAPI `required` here, so the generator has no way to know
 * they can't be missing. `DeepRequired<T>` below removes exactly that generator-introduced
 * optionality (`?`) while leaving genuine domain nullability (`T | null`) untouched, restoring the
 * required/nullable split this file previously hand-maintained - now re-derived from the generated
 * shape instead of retyped from the C# source, so structural drift (new/renamed/removed fields) is
 * caught by `tsc` the next time `npm run generate:tesserafin-sdk` runs, not discovered at runtime.
 *
 * This still relies on the same two facts about the wire format the pre-generation version of this
 * file verified directly against `reefin` source (`src/Reefin.Extensions/Json/JsonDefaults.cs`),
 * which the generated types do not (and can't) express:
 * 1. Enums serialize as their PascalCase member names, not integers.
 * 2. `DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull` - a `null`-valued C# property is
 *    omitted from the JSON payload entirely, never sent as an explicit `null`. At the JS boundary a
 *    field typed `T | null` below is actually `undefined` (missing key) at runtime. Treat nullable
 *    fields as falsy (`!value`/`!= null`), never `=== null` - components in this feature already do.
 *
 * One thing genuinely NOT in the generated output, kept hand-declared here: `DiagnosticTimelineEntry.Stage`
 * is generated as a plain `string` (docs/pr92-design-playback-api-and-diagnostics.md §4.3's five
 * stage names aren't modeled as an OpenAPI enum server-side), so `DiagnosticTimelineStage` below
 * stays a manually maintained literal union, same as before PR2.
 */

import type {
    DiagnosticComparison as GeneratedDiagnosticComparison,
    DivergenceClass,
    PlaybackDecisionAudioStreamSnapshot as GeneratedAudioStreamSnapshot,
    PlaybackDecisionClientCapabilities as GeneratedClientCapabilities,
    PlaybackDecisionMediaKind as MediaKind,
    PlaybackDecisionMediaSourceSnapshot as GeneratedMediaSourceSnapshot,
    PlaybackDecisionOutputSpec as GeneratedOutputSpec,
    PlaybackDecisionPlaybackMethod as PlaybackMethod,
    PlaybackDecisionPlaybackRequestContext as GeneratedPlaybackRequestContext,
    PlaybackDecisionReasonCode as ReasonCode,
    PlaybackDecisionReasonNode as GeneratedReasonNode,
    PlaybackDecisionReasonOutcome as ReasonOutcome,
    PlaybackDecisionReasonSubject as GeneratedReasonSubject,
    PlaybackDecisionReasonSubjectKind as ReasonSubjectKind,
    PlaybackDecisionResolution as GeneratedResolution,
    PlaybackDecisionSelectedStreams as GeneratedSelectedStreams,
    PlaybackDecisionSelectedSubtitle as GeneratedSelectedSubtitle,
    PlaybackDecisionStreamingProtocol as StreamingProtocol,
    PlaybackDecisionSubtitleDeliveryMethod as SubtitleDeliveryMethod,
    PlaybackDecisionSubtitleStreamSnapshot as GeneratedSubtitleStreamSnapshot,
    PlaybackDecisionTransformKind as TransformKind,
    PlaybackDecisionVideoStreamSnapshot as GeneratedVideoStreamSnapshot,
    PlaybackDiagnosticDetail as GeneratedPlaybackDiagnosticDetail,
    PlaybackSessionListItem as GeneratedPlaybackSessionListItem,
    PlaybackSessionResponse as GeneratedPlaybackSessionResponse
} from 'lib/tesserafin-sdk';

export type {
    DivergenceClass,
    MediaKind,
    PlaybackMethod,
    ReasonCode,
    ReasonOutcome,
    ReasonSubjectKind,
    StreamingProtocol,
    SubtitleDeliveryMethod,
    TransformKind
};

/** Removes generator-introduced `?` optionality while preserving genuine `T | null` domain
 * nullability - see file-level doc comment. Recurses into nested objects/arrays so a type built
 * from this needs no further per-field adjustment. */
type DeepRequired<T> = T extends (infer U)[]
    ? DeepRequired<U>[]
    : T extends object
      ? { [K in keyof T]-?: DeepRequired<T[K]> }
      : T;

export type Resolution = DeepRequired<GeneratedResolution>;
export type OutputSpec = DeepRequired<GeneratedOutputSpec>;
export type SelectedSubtitle = DeepRequired<GeneratedSelectedSubtitle>;
export type SelectedStreams = DeepRequired<GeneratedSelectedStreams>;
export type ReasonSubject = DeepRequired<GeneratedReasonSubject>;
export type ReasonNode = DeepRequired<GeneratedReasonNode>;
export type PlaybackRequestContext =
    DeepRequired<GeneratedPlaybackRequestContext>;
export type ClientCapabilities = DeepRequired<GeneratedClientCapabilities>;
export type VideoStreamSnapshot = DeepRequired<GeneratedVideoStreamSnapshot>;
export type AudioStreamSnapshot = DeepRequired<GeneratedAudioStreamSnapshot>;
export type SubtitleStreamSnapshot =
    DeepRequired<GeneratedSubtitleStreamSnapshot>;
export type MediaSourceSnapshot = DeepRequired<GeneratedMediaSourceSnapshot>;
export type DiagnosticComparison = DeepRequired<GeneratedDiagnosticComparison>;

/** docs/pr92-design-playback-api-and-diagnostics.md §4.2 — stable client-facing response, never
 * StreamInfo/DeviceProfile/MediaOptions. */
export type PlaybackSessionResponse =
    DeepRequired<GeneratedPlaybackSessionResponse>;

/** One row of `GET /System/PlaybackDiagnostics/Sessions`. */
export type PlaybackSessionListItem =
    DeepRequired<GeneratedPlaybackSessionListItem>;

/** Not modeled as an OpenAPI enum server-side (`DiagnosticTimelineEntry.Stage` generates as a
 * plain `string`) - kept hand-declared, the one thing genuinely not in the generated output. */
export type DiagnosticTimelineStage =
    | 'Created'
    | 'Updated'
    | 'FfmpegStarted'
    | 'PlaybackStarted'
    | 'PlaybackStopped';

export interface DiagnosticTimelineEntry {
    Stage: DiagnosticTimelineStage;
    At: string;
}

/** docs/pr92-design-playback-api-and-diagnostics.md §4.3 — filtered admin projection, never
 * Path/TranscodingUrl/token/ffmpeg args. Nullable fields mean no shadow diagnostic was retained
 * for this session (the nominal case while the server-side shadow mode is disabled). */
export type PlaybackDiagnosticDetail = Omit<
    DeepRequired<GeneratedPlaybackDiagnosticDetail>,
    'Timeline'
> & { Timeline: DiagnosticTimelineEntry[] };

/**
 * The typed "how is this stream actually being executed?" record carried on `streamInfo`
 * (`playbackmanager.js#createStreamInfo`) and, on the v2 path, replaced wholesale by
 * `playbackSessionV2Url.ts#applyV2PlaybackUrlToStreamInfo`.
 *
 * Why this exists (reefin issue #41, LANE W): `onPlaybackError` used to recover its retry inputs by
 * string-matching the stream URL - `url.includes('transcodereasons')`,
 * `url.indexOf('allowvideostreamcopy=false')`. That works only because the legacy
 * `mediaSource.TranscodingUrl` happens to be a server-built query string carrying those params. A v2
 * URL (`GET Playback/Sessions/{id}/Stream`) carries none of them, so with the v2 flag ON every one
 * of those flags silently read `false` and the transcoding-retry ladder degraded without a single
 * error. The fix is to stop recovering state from a URL and instead carry it explicitly, from the
 * place that actually knows it.
 *
 * Where each retry input actually comes from (verified against the SDK, not assumed):
 *
 * - `preventsVideoStreamCopy` / `preventsAudioStreamCopy` are **client-originated**. They are not
 *   server state at all: `onPlaybackError` itself asks for them via `changeStream(player, time,
 *   { AllowVideoStreamCopy: false, ... })`, which becomes `options.allowVideoStreamCopy` and is then
 *   serialized into the `PlaybackInfo` query (`playbackmanager.js` ~L599). The URL round-trip was
 *   only ever a way to persist what this client had already requested, so the request options are
 *   the honest source and are threaded into `createStreamInfo` directly.
 *
 * - `isAlreadyFallbacking` maps to `playMethod === 'Transcode'`. `MediaSourceInfo` carries **no**
 *   `TranscodeReasons` field (checked: `@jellyfin/sdk`'s `media-source-info.d.ts` has
 *   `TranscodingUrl`/`TranscodingSubProtocol`/`TranscodingContainer` and nothing else), so the URL
 *   really was the only carrier. The server stamps `TranscodeReasons` into every `TranscodingUrl` it
 *   builds, and that URL is used precisely on the branch that sets `playMethod = 'Transcode'` -
 *   which makes the play method an equivalent, and far more legible, signal.
 *
 * The retry metadata is deliberately derived from the **final** play method, i.e. after any v2
 * overwrite. Deriving it before would let a v2 DirectPlay result keep the legacy plan's transcode
 * retry metadata - exactly the "v2 URL + legacy execution state" mix this lane exists to remove.
 */

/** Which path produced the execution state on a given `streamInfo`. Purely diagnostic - no consumer
 * branches on it - but it makes a mixed legacy/v2 `streamInfo` immediately visible in logs and in
 * the debugger, which is the failure mode LANE W is about. */
export type PlaybackExecutionSource = 'legacy' | 'v2';

/** The inputs `onPlaybackError`'s transcoding-retry ladder needs. Previously parsed out of the
 * stream URL; now carried explicitly. */
export interface PlaybackRetryMetadata {
    /** The current stream is already a transcode, so a retry must not ask for stream copy again.
     * Legacy equivalent: `url.includes('transcodereasons')`. */
    isAlreadyFallbacking: boolean;
    /** This stream was requested with video stream copy disabled. Legacy equivalent:
     * `url.indexOf('allowvideostreamcopy=false') !== -1`. */
    preventsVideoStreamCopy: boolean;
    /** This stream was requested with audio stream copy disabled. Legacy equivalent:
     * `url.indexOf('allowaudiostreamcopy=false') !== -1`. */
    preventsAudioStreamCopy: boolean;
}

/** Every field on `streamInfo` that describes *how playback is actually executed*, as opposed to
 * what is being played. These are the fields that must move together: a v2 URL paired with a legacy
 * transcoding offset (or legacy mime type) is the concrete bug this type prevents. */
export interface PlaybackExecutionDecision {
    source: PlaybackExecutionSource;
    url: string;
    playMethod: string;
    mimeType?: string;
    transcodingOffsetTicks: number;
    /** Client-generated id for the playback attempt; the legacy path parses it out of the media URL,
     * the v2 path generates it and sends it in the `POST`. */
    playSessionId?: string;
    /** v2 only: the server-created `Playback/Sessions` resource id (the `{id}` the `GET .../Stream`
     * was issued against). Distinct from `playSessionId`. Carried for diagnostics and so the v2
     * execution state is complete rather than partially dropped; `undefined` on the legacy path,
     * which has no such resource. */
    playbackSessionId?: string;
    /** v2 only: the streaming protocol the server reported (e.g. `Hls`). */
    protocol?: string;
    /** v2 only: the effective output container the server reported (`reefin` #46 -
     * `PlaybackSessionStreamDescriptor.Container`); the segment container when `protocol` is `Hls`.
     * Carried rather than consumed: `mimeType` above is the server's own mapping of this container
     * and is what playback actually uses, while this is what lets a canary attribute a play method
     * to a concrete output format without re-parsing the URL. `undefined` against a pre-#46 server,
     * and legitimately `undefined` on HLS even against a #46 server, so nothing may branch on its
     * presence. */
    container?: string;
    retry: PlaybackRetryMetadata;
}

/** The subset of the `PlaybackInfo` request options that determined how this stream was requested.
 * `null`/`undefined` mean "not constrained", matching the `!= null` checks the query builder uses. */
export interface PlaybackRequestOptions {
    allowVideoStreamCopy?: boolean | null;
    allowAudioStreamCopy?: boolean | null;
}

/**
 * Derives the retry inputs from the final play method plus the options this stream was requested
 * with. Shared by both paths on purpose: the legacy and v2 paths disagree about how a URL is built,
 * but they agree completely about what "already transcoding" and "was asked not to copy streams"
 * mean.
 */
export function buildRetryMetadata(
    playMethod: string | undefined,
    requestOptions: PlaybackRequestOptions | undefined | null
): PlaybackRetryMetadata {
    return {
        isAlreadyFallbacking: playMethod === 'Transcode',
        preventsVideoStreamCopy: requestOptions?.allowVideoStreamCopy === false,
        preventsAudioStreamCopy: requestOptions?.allowAudioStreamCopy === false
    };
}

/** The `streamInfo` fields `buildLegacyExecutionDecision` reads. Kept structural so
 * `playbackmanager.js` can pass its plain object without a cast. */
export interface LegacyExecutionStreamInfo {
    url?: string;
    mimeType?: string;
    playMethod?: string;
    transcodingOffsetTicks?: number;
    playSessionId?: string;
}

/**
 * Snapshots an already-built legacy `streamInfo` into a decision. This is a pure read of fields
 * `createStreamInfo` just computed - it deliberately does not recompute or second-guess the legacy
 * URL/offset logic, so the legacy path's behavior is unchanged by this refactor.
 */
export function buildLegacyExecutionDecision(
    streamInfo: LegacyExecutionStreamInfo,
    requestOptions?: PlaybackRequestOptions | null
): PlaybackExecutionDecision {
    return {
        source: 'legacy',
        url: streamInfo.url ?? '',
        playMethod: streamInfo.playMethod ?? 'Transcode',
        mimeType: streamInfo.mimeType,
        transcodingOffsetTicks: streamInfo.transcodingOffsetTicks ?? 0,
        playSessionId: streamInfo.playSessionId,
        retry: buildRetryMetadata(streamInfo.playMethod, requestOptions)
    };
}

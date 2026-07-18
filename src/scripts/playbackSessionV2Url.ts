/**
 * PR116d wiring (`docs/pr116-client-migration-design.md` §3 PR116d, `docs/pr116d-url-contract-design.md`,
 * `reefin` repo, PR117 merged): behind a flag (default off), turn the v2 `Playback/Sessions`
 * protocol into the actual playback URL - `POST Playback/Sessions` (native capabilities, PR116a
 * builder) followed by `GET Playback/Sessions/{id}/Stream` (PR117, hand-written wrapper - the
 * generated client is still pinned to the pre-PR117 OpenAPI spec, §5 below), used *instead of* the
 * legacy `mediaSource.TranscodingUrl`-derived URL in `playbackmanager.js`'s real playback-start path.
 *
 * TOCTOU contract (`docs/pr116d-url-contract-design.md` §3, load-bearing): the `POST`'s
 * `DecisionVersion` is a planning-time snapshot: it is deliberately never read here. Only the
 * `GET .../Stream` response's `ServedBy`/`FallbackReason` describe what will actually be served -
 * they are the fields this module logs and returns.
 *
 * Robust fallback (requirement driving every branch below): ANY failure - flag off, network error,
 * 4xx/5xx (including the contract's own `409` no-`PlaySessionId`/`403` not-owner), a response
 * missing `Url` - resolves to `null`/leaves `streamInfo` untouched. This module never throws and
 * never rejects; the legacy `streamInfo` that `playbackmanager.js` already built synchronously
 * before calling into here is always a valid, complete fallback, so a v2 failure can never leave
 * playback without a URL.
 *
 * Bridge pattern for the `POST`: `playbackApiFor()` mirrors `systemApiFor()`
 * (`apps/dashboard/features/playback/api/playbackDiagnosticsApi.ts`) and `playbackSessionShadow.ts`'s
 * own copy of the same helper - configures the generated `PlaybackApi` from the CURRENT
 * `@jellyfin/sdk` session (`api.basePath`/`api.axiosInstance`/`api.authorizationHeader`) instead of
 * `lib/reefin-sdk`'s independent `createReefinApi()`, so the server never sees a second `DeviceId`
 * for the same browser session. Deliberately duplicated here rather than imported from
 * `playbackSessionShadow.ts` - same repo precedent as `reefinPlaybackCapabilities.ts`'s file-level
 * comment on deliberate duplication over a drive-by extraction of an unrelated, already-shipped file.
 *
 * Hand-written wrapper for the `GET`: `Reefin.Api/Controllers/PlaybackSessionsController.cs`'s
 * `Playback/Sessions/{id}/Stream` (PR117) postdates the pinned OpenAPI spec
 * (`src/lib/reefin-sdk/spec/version.json`) the generated client was built from, so no
 * `PlaybackApi.getPlaybackSessionStream()` method exists to call. `fetchPlaybackSessionStream()`
 * below calls it directly through the same `api.axiosInstance`/`api.basePath`/
 * `api.authorizationHeader` triple the bridge above uses - same session identity, no generated
 * method required. Regenerating the whole client is out of scope for this PR (task instructions);
 * revisit once `npm run generate:reefin-sdk` is re-run against a spec that includes PR117.
 *
 * `PlaySessionId` (`docs/pr116d-url-contract-design.md` §2.3): unlike PR116b's shadow call (which
 * deliberately never supplies the real session's id - see `playbackSessionShadow.ts`), this IS the
 * real playback attempt, so a `PlaySessionId` is always generated and sent - omitting it would make
 * the server's `GET .../Stream` respond `409` every time (the contract's documented guard).
 */

import type { Api } from '@jellyfin/sdk';

import appSettings from './settings/appSettings';
import { applyPlaybackAttemptId } from './playbackAttemptId';
import {
    buildRetryMetadata,
    type PlaybackExecutionDecision,
    type PlaybackRequestOptions
} from './playbackExecutionDecision';
import {
    buildClientCapabilities,
    buildPlaybackConstraints
} from './reefinPlaybackCapabilities';
import {
    Configuration,
    PlaybackApi,
    PlaybackDecisionPlaybackMethod,
    PlaybackDecisionStreamingProtocol,
    type CreatePlaybackSessionRequest,
    type PlaybackSessionResponse
} from 'lib/reefin-sdk';

/** `reefin` #43 added an optional `PlaybackAttemptId` to `CreatePlaybackSessionRequest`, but the
 * pinned OpenAPI spec (`src/lib/reefin-sdk/spec/version.json`) predates it, so the generated model
 * has no such property yet. Hand-extended here rather than regenerating the whole client - the same
 * precedent this file already sets for `PlaybackSessionStreamDescriptor` (see the file-level doc
 * comment on the PR117 `GET .../Stream` wrapper). Drop this once
 * `npm run generate:reefin-sdk` is re-run against a spec that includes #47. */
type CreatePlaybackSessionRequestWithAttemptId =
    CreatePlaybackSessionRequest & {
        PlaybackAttemptId?: string;
    };

/** Configures a generated `PlaybackApi` from an existing `@jellyfin/sdk` session - see file-level
 * doc comment for why this reuses the session instead of `createReefinApi()`. */
const playbackApiFor = (api: Api): PlaybackApi =>
    new PlaybackApi(
        new Configuration({
            basePath: api.basePath,
            baseOptions: { headers: { Authorization: api.authorizationHeader } }
        }),
        api.basePath,
        api.axiosInstance
    );

/** `Reefin.MediaEncoding/Playback/PlaybackLiveFallbackReason.cs` - projected as a plain string here
 * (the descriptor never carries anything richer than the code itself, per the design doc). Not
 * exhaustively typed against the server enum: unrecognized values still round-trip and log fine, a
 * client-side enum drifting behind the server's is not a reason to drop the value on the floor. */
export type PlaybackSessionFallbackReason = string;

/** `docs/pr116d-url-contract-design.md` §2.2 - the PR117 response shape. No generated model exists
 * for this yet (see file-level doc comment), so it is hand-typed here, matching the contract
 * field-for-field. Every field is optional/nullable defensively: this module must survive a
 * malformed or partial response exactly like it survives a network error. */
export interface PlaybackSessionStreamDescriptor {
    Url?: string | null;
    Protocol?: (typeof PlaybackDecisionStreamingProtocol)[keyof typeof PlaybackDecisionStreamingProtocol];
    ServedBy?: number;
    FallbackReason?: PlaybackSessionFallbackReason | null;
    SubtitleUrl?: string | null;
    /** `reefin` PR #46: the *effective* output container the server chose, read off the same
     * `StreamInfo` that produced `Url` - so it is literally what the URL carries (`/stream.{container}`
     * over `Http`, `&SegmentContainer={container}` over `Hls`, where it is the **segment** container,
     * not `m3u8`). This is the field whose absence forced #24 to fold remux/transcode back onto
     * legacy. Nullable: a pre-#46 server omits it, and PR #46 notes a v2 HLS response may carry
     * `Container: null` alongside a correct `MimeType` - which is why nothing on the HLS path below
     * is allowed to depend on it. */
    Container?: string | null;
    /** `reefin` PR #46: the content type the delivery endpoint will actually respond with -
     * `application/vnd.apple.mpegurl` over HLS (the **playlist's** type, not the segments'),
     * otherwise the server's own `GetMimeType("." + Container)`. `null` when the container has no
     * known mapping: the server distinguishes "I don't know" from "opaque bytes" and deliberately
     * does not send `application/octet-stream`, so a `null` here must be handled as absence rather
     * than consumed as a value. */
    MimeType?: string | null;
}

/** Calls `GET Playback/Sessions/{id}/Stream` directly through the session's `axiosInstance` - see
 * file-level doc comment on why no generated method exists for this yet. Uses `.request(...)`
 * (rather than the `.get()` sugar) so tests can mock the same single `{ request }` seam the
 * generated `PlaybackApi` above already dispatches through (`playbackSessionShadow.test.ts`'s
 * pattern). */
async function fetchPlaybackSessionStream(
    api: Api,
    sessionId: string,
    startTimeTicks: number
): Promise<PlaybackSessionStreamDescriptor> {
    const response =
        await api.axiosInstance.request<PlaybackSessionStreamDescriptor>({
            url: `${api.basePath}/Playback/Sessions/${encodeURIComponent(sessionId)}/Stream`,
            method: 'GET',
            params: { startTimeTicks },
            headers: { Authorization: api.authorizationHeader }
        });

    return response.data;
}

/** Legacy `playMethod` vocabulary `playbackmanager.js#createStreamInfo` produces
 * (`'DirectPlay' | 'DirectStream' | 'Transcode'`) mapped from the v2
 * `PlaybackDecisionPlaybackMethod` the `POST` response carries. `Remux` (server changes container,
 * no re-encode) is the v2 name for what legacy calls `DirectStream` - same client-observable
 * behavior (seek via the same HTTP range/HLS mechanics as direct play, no ffmpeg re-encode cost). */
const PLAY_METHOD_MAP: Record<string, string> = {
    [PlaybackDecisionPlaybackMethod.DirectPlay]: 'DirectPlay',
    [PlaybackDecisionPlaybackMethod.Remux]: 'DirectStream',
    [PlaybackDecisionPlaybackMethod.Transcode]: 'Transcode'
};

export interface ResolveV2PlaybackUrlParams {
    /** The current `@jellyfin/sdk` session - reused, never a second independent identity. */
    api: Api;
    itemId: string;
    /** Only `'Video'`/`'Audio'` are attempted - mirrors the same gate
     * `createStreamInfo`'s legacy URL-construction branch already applies; other media types (e.g.
     * `Book`) never reach this call site in `playbackmanager.js` today, but the guard is kept here
     * too so this module stays correct if a future call site changes that. */
    mediaType?: string;
    userId?: string;
    mediaSourceId?: string | null;
    startTimeTicks: number;
    /** `reefin` #43: the id of the playback attempt this call belongs to, minted once by
     * `playbackmanager.js#playInternal()` and threaded down. A REQUEST-scoped value rather than a
     * module-level read, because two attempts can legitimately overlap (double-click Play, autoplay
     * landing mid-start) and an ambient read would let this POST carry the other attempt's id - see
     * `playbackAttemptId.ts`. Optional: absent is a valid request, and the caller passes nothing
     * when minting produced no usable value. */
    playbackAttemptId?: string;
}

/** Injectable seams for tests - production call sites use every default. */
export interface ResolveV2PlaybackUrlDeps {
    /** Defaults to `appSettings.enableV2PlaybackPath()`. */
    isEnabled?: () => boolean;
    /** Defaults to `crypto.randomUUID()` - unlike the PR116b shadow call, this IS the real
     * `PlaySessionId` for the playback attempt (see file-level doc comment). */
    generatePlaySessionId?: () => string;
    buildCapabilities?: typeof buildClientCapabilities;
    buildConstraints?: typeof buildPlaybackConstraints;
    /** Defaults to the real `fetchPlaybackSessionStream()` - swapped out in tests. */
    fetchStream?: typeof fetchPlaybackSessionStream;
    /** Defaults to `console`. Only `.debug` is used. */
    logger?: Pick<Console, 'debug'>;
}

export interface V2PlaybackUrlResult {
    /** Relative - same convention as legacy `mediaSource.TranscodingUrl`; callers resolve it through
     * `apiClient.getUrl()` exactly like the legacy URL. */
    url: string;
    protocol?: (typeof PlaybackDecisionStreamingProtocol)[keyof typeof PlaybackDecisionStreamingProtocol];
    playMethod: string;
    playSessionId: string;
    /** The server-created `Playback/Sessions` resource id the `GET .../Stream` was issued against.
     * Distinct from `playSessionId` (which this client generates and sends in the `POST`): this one
     * is assigned by the server. Returned so the caller can carry the *complete* v2 execution state
     * rather than silently dropping a field - see `playbackExecutionDecision.ts`. */
    playbackSessionId: string;
    /** Relative, same convention as `url` - present only when the GET's `SelectedStreams.Subtitle`
     * is externally delivered (`docs/pr116d-url-contract-design.md` §2.2). */
    subtitleUrl?: string;
    /** The engine version that actually produced `url`, resolved at `GET` time - authoritative for
     * what will play, per the TOCTOU contract (see file-level doc comment). Distinct from the
     * `POST`'s `DecisionVersion`, which this module never reads. */
    servedBy?: number;
    fallbackReason?: PlaybackSessionFallbackReason | null;
    /** The server-reported effective output container (`reefin` #46). `undefined` against a pre-#46
     * server, and legitimately `undefined` on HLS even against a #46 server. */
    container?: string;
    /** The server-reported content type of what `url` delivers (`reefin` #46). `undefined` when the
     * server reported `null`, i.e. it has no mapping for the container - never coerced to a
     * placeholder type. */
    mimeType?: string;
}

const LOG_PREFIX = '[playbackSessionV2Url]';

function isSupportedMediaType(mediaType: string | undefined): boolean {
    return mediaType == null || mediaType === 'Video' || mediaType === 'Audio';
}

type ResolvedDeps = Required<
    Pick<
        ResolveV2PlaybackUrlDeps,
        | 'generatePlaySessionId'
        | 'buildCapabilities'
        | 'buildConstraints'
        | 'fetchStream'
    >
>;

function resolveDeps(deps: ResolveV2PlaybackUrlDeps): ResolvedDeps {
    return {
        generatePlaySessionId:
            deps.generatePlaySessionId ?? (() => crypto.randomUUID()),
        buildCapabilities: deps.buildCapabilities ?? buildClientCapabilities,
        buildConstraints: deps.buildConstraints ?? buildPlaybackConstraints,
        fetchStream: deps.fetchStream ?? fetchPlaybackSessionStream
    };
}

/** POSTs `Playback/Sessions` and returns the created session, or `null` (already logged) when the
 * response carries no `Id` to `GET .../Stream` against. Errors are left to the caller's `try`/
 * `catch` - this only handles the "succeeded but unusable" case. */
async function createV2Session(
    params: ResolveV2PlaybackUrlParams,
    resolved: ResolvedDeps,
    playSessionId: string,
    logger: Pick<Console, 'debug'>
): Promise<PlaybackSessionResponse | null> {
    const createPlaybackSessionRequest: CreatePlaybackSessionRequestWithAttemptId =
        {
            ItemId: params.itemId,
            UserId: params.userId,
            MediaSourceId: params.mediaSourceId ?? undefined,
            PlaySessionId: playSessionId,
            Capabilities: resolved.buildCapabilities(),
            Constraints: resolved.buildConstraints({
                startTimeTicks: params.startTimeTicks
            })
        };

    // reefin #43: the same attempt id the `PlaybackInfo` call of this attempt already sent - carried
    // in as a parameter, never minted and never read from module state here, so a concurrent second
    // attempt cannot substitute its own id (see `playbackAttemptId.ts`). The helper omits the key
    // entirely when there is no usable id: the server accepts an absent `PlaybackAttemptId` and
    // rejects a blank one with a 400. Nothing below branches on it - diagnostics only.
    applyPlaybackAttemptId(
        createPlaybackSessionRequest,
        params.playbackAttemptId
    );

    const { data: session }: { data: PlaybackSessionResponse } =
        await playbackApiFor(params.api).createPlaybackSession({
            createPlaybackSessionRequest
        });

    if (!session.Id) {
        logger.debug(
            `${LOG_PREFIX} POST Playback/Sessions returned no session id - falling back to legacy playback URL`,
            session
        );
        return null;
    }

    return session;
}

/** GETs `.../Stream` for an already-created session and returns the descriptor, or `null` (already
 * logged) when it carries no `Url` to play. Logs `ServedBy`/`FallbackReason`/`Protocol`
 * unconditionally on a successful response, per the TOCTOU contract (module-level doc comment). */
async function fetchAndValidateStream(
    params: ResolveV2PlaybackUrlParams,
    resolved: ResolvedDeps,
    sessionId: string,
    logger: Pick<Console, 'debug'>
): Promise<PlaybackSessionStreamDescriptor | null> {
    const descriptor = await resolved.fetchStream(
        params.api,
        sessionId,
        params.startTimeTicks
    );

    logger.debug(`${LOG_PREFIX} GET Playback/Sessions/{id}/Stream resolved`, {
        ServedBy: descriptor.ServedBy,
        FallbackReason: descriptor.FallbackReason,
        Protocol: descriptor.Protocol
    });

    if (!descriptor.Url) {
        logger.debug(
            `${LOG_PREFIX} descriptor has no Url - falling back to legacy playback URL`
        );
        return null;
    }

    return descriptor;
}

/**
 * Resolves the v2 playback URL, or `null` on any failure/flag-off - never throws, never rejects.
 * Fallback matrix (every branch below funnels into a `null` return with a debug log naming the
 * reason): flag off (no network call at all); `mediaType` not `Video`/`Audio`; `POST` network
 * failure; `POST` 4xx/5xx; `POST` response missing `Id`; `GET` network failure; `GET` 4xx/5xx
 * (including the contract's `409` no-`PlaySessionId` and `403` not-owner cases); `GET` response
 * missing `Url`; any other unexpected exception.
 */
export async function resolveV2PlaybackUrl(
    params: ResolveV2PlaybackUrlParams,
    deps: ResolveV2PlaybackUrlDeps = {}
): Promise<V2PlaybackUrlResult | null> {
    const isEnabled =
        deps.isEnabled ?? (() => appSettings.enableV2PlaybackPath());

    if (!isEnabled()) {
        return null;
    }

    const logger = deps.logger ?? console;

    if (!isSupportedMediaType(params.mediaType)) {
        logger.debug(
            `${LOG_PREFIX} unsupported mediaType for v2 playback (${params.mediaType}) - falling back to legacy playback URL`
        );
        return null;
    }

    const resolved = resolveDeps(deps);

    try {
        const playSessionId = resolved.generatePlaySessionId();

        const session = await createV2Session(
            params,
            resolved,
            playSessionId,
            logger
        );
        if (!session?.Id) {
            return null;
        }

        const descriptor = await fetchAndValidateStream(
            params,
            resolved,
            session.Id,
            logger
        );
        if (!descriptor) {
            return null;
        }

        return {
            url: descriptor.Url as string,
            protocol: descriptor.Protocol,
            playMethod: PLAY_METHOD_MAP[session.Method ?? ''] ?? 'Transcode',
            playSessionId,
            playbackSessionId: session.Id,
            subtitleUrl: descriptor.SubtitleUrl ?? undefined,
            servedBy: descriptor.ServedBy,
            fallbackReason: descriptor.FallbackReason ?? null,
            // `?? undefined` collapses the server's explicit `null` ("no mapping exists") into
            // plain absence, so exactly one shape reaches the decision builder. The distinction the
            // server draws is between "known" and "unknown", and both `null` and a missing field
            // mean unknown here.
            container: descriptor.Container ?? undefined,
            mimeType: descriptor.MimeType ?? undefined
        };
    } catch (err) {
        // Robust fallback (module-level doc comment): network failures, 4xx/5xx responses (incl.
        // the contract's 409/403), or a missing/misconfigured api must never surface beyond a log -
        // the legacy streamInfo the caller already built is untouched either way.
        logger.debug(
            `${LOG_PREFIX} v2 playback URL resolution failed - falling back to legacy playback URL`,
            err
        );
        return null;
    }
}

/** Minimal shape this module needs from `playbackmanager.js`'s legacy `apiClient` wrapper - only
 * `getUrl()`, used to resolve the (relative) v2 URLs the same way the legacy
 * `apiClient.getUrl(mediaSource.TranscodingUrl)` call already does. */
export interface PlaybackUrlResolvingApiClient {
    getUrl(url: string): string;
}

/** Minimal shape of the legacy `streamInfo` object (`playbackmanager.js#createStreamInfo`'s return
 * value) this module overwrites fields on. Deliberately untyped beyond what is written here -
 * `streamInfo` carries many more fields this module never touches. */
export interface V2PatchableStreamInfo {
    url?: string;
    mimeType?: string;
    playMethod?: string;
    playSessionId?: string;
    transcodingOffsetTicks?: number;
    executionDecision?: PlaybackExecutionDecision;
    textTracks?: Array<{ url?: string; isDefault?: boolean }>;
    tracks?: Array<{ url?: string; isDefault?: boolean }>;
}

/** Context the caller (`playbackmanager.js`) must supply so a v2 success can produce a *complete*
 * execution state. Everything here is information the v2 responses do not carry. */
export interface V2ExecutionContext {
    /** Fallback mime type for a `DirectPlay` over a non-HLS protocol **when the server reported
     * none** (a pre-#46 server): the served bytes are then the source file itself, so the caller
     * derives this from the media source's own container (`getMimeType(type, mediaSource.Container)`)
     * - a statement about the source, not a guess at a server-side choice. Since `reefin` #46 this
     * is no longer the primary path: `PlaybackSessionStreamDescriptor.MimeType` outranks it for every
     * play method. `undefined` when the caller cannot determine it, which forces a whole-decision
     * fallback to legacy rather than a guess. */
    directPlayMimeType?: string;
    /** The `PlaybackInfo` request options this stream was requested with - the honest source for the
     * stream-copy retry flags (see `playbackExecutionDecision.ts`). */
    requestOptions?: PlaybackRequestOptions | null;
}

/** Used only when an HLS response carries no `MimeType` - i.e. a pre-#46 server, which reports
 * neither field. The playlist type is fixed by the protocol itself, so it is knowable without the
 * server saying so; the output *container* never is, which is the whole asymmetry #46 resolves. */
const HLS_PLAYLIST_MIME_TYPE = 'application/x-mpegURL';

/**
 * Builds the complete v2 execution state, or `null` when neither the server nor the caller can name
 * the type of what will be delivered.
 *
 * **The mime type comes from the server, never from the URL.** `reefin` #46 added `MimeType` (and
 * `Container`) to `PlaybackSessionStreamDescriptor` precisely so this function no longer has to
 * infer the output format. #24 had to fold **all** remux and transcode over non-HLS back onto the
 * legacy decision, because the chosen output container was reported nowhere and borrowing the legacy
 * plan's `TranscodingContainer` would have re-created the v2-URL/legacy-state mix this lane exists to
 * remove. That restriction cut the v2 path down to DirectPlay + HLS and would have biased the
 * canary's play-method metrics by construction (issue #44 §8-A). With `MimeType` reported, the
 * server's own answer is authoritative for every play method, so the full perimeter is restored.
 *
 * Resolution order, most authoritative first:
 *
 * 1. **`result.mimeType`** - what the delivery endpoint will actually respond with, for any protocol
 *    and any play method. This single source is what re-enables Remux and Transcode over non-HLS.
 * 2. **HLS with no reported mime** - the playlist type is implied by the protocol (see
 *    `HLS_PLAYLIST_MIME_TYPE`). Deliberately keyed off `protocol` alone and never off `container`:
 *    #46 notes an HLS response may carry `Container: null` with a correct `MimeType`, and on HLS the
 *    container describes the *segments* rather than the playlist that `url` addresses.
 * 3. **DirectPlay over non-HLS with no reported mime** - the served bytes are the source file
 *    itself, so the caller's `directPlayMimeType` (from `mediaSource.Container`) is not a guess about
 *    a server-side choice; it describes the source, which the client legitimately knows. Retained so
 *    a pre-#46 server keeps exactly the #24 behavior rather than regressing.
 * 4. **Otherwise** (remux/transcode over non-HLS against a pre-#46 server, or a container the server
 *    has no mime mapping for) - nothing can name the output type without inventing it, so this
 *    returns `null` and the caller keeps the legacy decision whole. Note the server sends `null`
 *    rather than `application/octet-stream` exactly so this case stays distinguishable.
 *
 * `Container` is carried onto the decision but is never used to *derive* the mime type: the server
 * already applied its own container-to-mime mapping in step 1, and re-deriving client-side would
 * substitute our table for its authority and could disagree with the header actually sent.
 *
 * Note the resulting invariant: `transcodingOffsetTicks` is still always 0 on the v2 path, and it is
 * now a stronger statement than in #24, where transcode-over-non-HLS could not reach here at all.
 * It holds because the v2 `url` is always addressed from its own start - the offset exists in legacy
 * only to compensate for a transcode URL whose timestamps were rebased, which is a property of how
 * legacy builds its URL, not of transcoding. This is the direct fix for the second half of issue
 * #41, where a non-zero legacy offset could survive onto a v2 URL and shift every reported position.
 */
function buildV2ExecutionDecision(
    result: V2PlaybackUrlResult,
    absoluteUrl: string,
    context: V2ExecutionContext
): PlaybackExecutionDecision | null {
    const isHls = result.protocol === PlaybackDecisionStreamingProtocol.Hls;

    let mimeType = result.mimeType;
    if (!mimeType && isHls) {
        mimeType = HLS_PLAYLIST_MIME_TYPE;
    } else if (!mimeType && result.playMethod === 'DirectPlay') {
        mimeType = context.directPlayMimeType;
    }

    if (!mimeType) {
        return null;
    }

    return {
        source: 'v2',
        url: absoluteUrl,
        playMethod: result.playMethod,
        mimeType,
        transcodingOffsetTicks: 0,
        playSessionId: result.playSessionId,
        playbackSessionId: result.playbackSessionId,
        protocol: result.protocol,
        container: result.container,
        // Derived from the v2 play method, not the legacy one: a v2 DirectPlay result must not
        // inherit the legacy plan's "already transcoding" state.
        retry: buildRetryMetadata(result.playMethod, context.requestOptions)
    };
}

function overrideDefaultSubtitleTrackUrl(
    streamInfo: V2PatchableStreamInfo,
    subtitleUrl: string
): void {
    for (const list of [streamInfo.textTracks, streamInfo.tracks]) {
        const defaultTrack = list?.find((track) => track.isDefault);
        if (defaultTrack) {
            defaultTrack.url = subtitleUrl;
        }
    }
}

/**
 * The single decision point that produces the playback URL: resolves the v2 URL and, only when it
 * can supply a *complete* execution state, replaces every execution-derived field on `streamInfo` in
 * one uninterrupted block - `url`, `playMethod`, `playSessionId`, `mimeType`,
 * `transcodingOffsetTicks` and the typed `executionDecision` (which carries the protocol, the server
 * session id and the retry metadata).
 *
 * All-or-nothing, in both directions (issue #41, requirement 4). Nothing is written until every
 * value is computed and validated, so there is no state in which a v2 URL coexists with a legacy
 * mime type or a legacy transcoding offset. Any failure - flag off, network error, 4xx/5xx, a
 * missing `Url`, a `getUrl()` throw, or a decision whose mime type the v2 responses cannot supply -
 * leaves `streamInfo` completely untouched, keeping the legacy decision the caller already built
 * synchronously as a whole. Returns whether v2 was applied, for logging/tests.
 */
export async function applyV2PlaybackUrlToStreamInfo(
    streamInfo: V2PatchableStreamInfo,
    params: ResolveV2PlaybackUrlParams,
    apiClient: PlaybackUrlResolvingApiClient,
    context: V2ExecutionContext = {},
    deps: ResolveV2PlaybackUrlDeps = {}
): Promise<boolean> {
    const result = await resolveV2PlaybackUrl(params, deps);

    if (!result) {
        return false;
    }

    const logger = deps.logger ?? console;

    // Resolve every absolute URL BEFORE the first mutation: getUrl() throwing halfway through
    // would otherwise leave streamInfo half-patched, violating this function's all-or-nothing
    // contract.
    let absoluteUrl: string;
    let absoluteSubtitleUrl: string | undefined;
    try {
        absoluteUrl = apiClient.getUrl(result.url);
        absoluteSubtitleUrl = result.subtitleUrl
            ? apiClient.getUrl(result.subtitleUrl)
            : undefined;
    } catch (err) {
        logger.debug(
            `${LOG_PREFIX} URL resolution failed - keeping the legacy decision whole`,
            err
        );
        return false;
    }

    const decision = buildV2ExecutionDecision(result, absoluteUrl, context);

    if (!decision) {
        logger.debug(
            `${LOG_PREFIX} v2 responses cannot supply a complete execution state (playMethod=${result.playMethod}, protocol=${result.protocol}) - keeping the legacy decision whole`
        );
        return false;
    }

    // Single atomic write of every execution-derived field. Read this block as one unit: adding a
    // field to PlaybackExecutionDecision without assigning it here reintroduces exactly the
    // partial-assignment defect issue #41 describes.
    streamInfo.url = decision.url;
    streamInfo.playMethod = decision.playMethod;
    streamInfo.playSessionId = decision.playSessionId;
    streamInfo.mimeType = decision.mimeType;
    streamInfo.transcodingOffsetTicks = decision.transcodingOffsetTicks;
    streamInfo.executionDecision = decision;

    if (absoluteSubtitleUrl) {
        overrideDefaultSubtitleTrackUrl(streamInfo, absoluteSubtitleUrl);
    }

    return true;
}

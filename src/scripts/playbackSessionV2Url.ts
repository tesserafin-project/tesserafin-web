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
    type PlaybackSessionResponse
} from 'lib/reefin-sdk';

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
    const { data: session }: { data: PlaybackSessionResponse } =
        await playbackApiFor(params.api).createPlaybackSession({
            createPlaybackSessionRequest: {
                ItemId: params.itemId,
                UserId: params.userId,
                MediaSourceId: params.mediaSourceId ?? undefined,
                PlaySessionId: playSessionId,
                Capabilities: resolved.buildCapabilities(),
                Constraints: resolved.buildConstraints({
                    startTimeTicks: params.startTimeTicks
                })
            }
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
            fallbackReason: descriptor.FallbackReason ?? null
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
    /** Mime type to use when the v2 decision is a `DirectPlay` over a non-HLS protocol: the served
     * bytes are then the source file itself, so the caller derives this from the media source's own
     * container (`getMimeType(type, mediaSource.Container)`). `undefined` when the caller cannot
     * determine it, which forces a whole-decision fallback to legacy rather than a guess. */
    directPlayMimeType?: string;
    /** The `PlaybackInfo` request options this stream was requested with - the honest source for the
     * stream-copy retry flags (see `playbackExecutionDecision.ts`). */
    requestOptions?: PlaybackRequestOptions | null;
}

/**
 * Builds the complete v2 execution state, or `null` when the v2 responses cannot supply every field.
 *
 * The mime-type/offset matrix (the part the v2 contract does not cover) - `PlaybackSessionStream
 * Descriptor` carries `Url`/`Protocol`/`ServedBy`/`FallbackReason`/`SubtitleUrl` and no container:
 *
 * - **HLS, any play method** - mime is the HLS playlist type; the offset is 0 because an HLS
 *   playlist is always addressed from its own start.
 * - **DirectPlay over a non-HLS protocol** - the served bytes are the source file, so the caller's
 *   `directPlayMimeType` (derived from `mediaSource.Container`) is exactly right; offset 0 because
 *   nothing is being re-timestamped.
 * - **Remux/Transcode over a non-HLS protocol** - the output container is chosen by the server and
 *   is not reported anywhere in the v2 responses. Deriving it from the *legacy* plan's
 *   `TranscodingContainer` would pair a v2 URL with legacy-derived state, which is the precise
 *   defect this lane removes, so this case returns `null` and the caller keeps the legacy decision
 *   whole.
 *
 * Note the resulting invariant: `transcodingOffsetTicks` is always 0 on the v2 path. That is not a
 * simplification - the only case legacy ever sets it non-zero (transcode, non-HLS subprotocol,
 * no `copytimestamps`) is exactly the case that falls back above. It is also the direct fix for the
 * second half of issue #41, where a non-zero legacy offset could survive onto a v2 direct-play URL
 * and shift every reported position.
 */
function buildV2ExecutionDecision(
    result: V2PlaybackUrlResult,
    absoluteUrl: string,
    context: V2ExecutionContext
): PlaybackExecutionDecision | null {
    const isHls = result.protocol === PlaybackDecisionStreamingProtocol.Hls;
    const mimeType = isHls
        ? 'application/x-mpegURL'
        : result.playMethod === 'DirectPlay'
          ? context.directPlayMimeType
          : undefined;

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

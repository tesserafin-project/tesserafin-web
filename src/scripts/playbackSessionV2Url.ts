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
import { getCurrentPlaybackAttemptId } from './playbackAttemptId';
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
    /** Defaults to `getCurrentPlaybackAttemptId()`. Distinct from `generatePlaySessionId` above and
     * deliberately a READ, not a mint: the attempt id belongs to the whole playback attempt that
     * `playbackmanager.js#playInternal()` already started, so this module must never create one of
     * its own - doing so would hand the v2 POST a different id than the `PlaybackInfo` call of the
     * same attempt (`reefin` #43). */
    getAttemptId?: () => string | undefined;
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
        | 'getAttemptId'
        | 'buildCapabilities'
        | 'buildConstraints'
        | 'fetchStream'
    >
>;

function resolveDeps(deps: ResolveV2PlaybackUrlDeps): ResolvedDeps {
    return {
        generatePlaySessionId:
            deps.generatePlaySessionId ?? (() => crypto.randomUUID()),
        getAttemptId: deps.getAttemptId ?? getCurrentPlaybackAttemptId,
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

    // reefin #43: the same attempt id the `PlaybackInfo` call of this attempt already sent - read,
    // never minted here (see `getAttemptId` above). Assigned conditionally so the key is simply
    // absent when there is no id: the server accepts an absent `PlaybackAttemptId` and rejects a
    // blank one with a 400. Nothing below branches on it - it is carried for diagnostics only.
    const attemptId = resolved.getAttemptId();
    if (attemptId) {
        createPlaybackSessionRequest.PlaybackAttemptId = attemptId;
    }

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
    textTracks?: Array<{ url?: string; isDefault?: boolean }>;
    tracks?: Array<{ url?: string; isDefault?: boolean }>;
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
 * The single decision point (task requirement: "one decision point ... that produces the playback
 * URL"): resolves the v2 URL and, only on success, overwrites `streamInfo`'s `url`/`playMethod`/
 * `playSessionId`/`mimeType`(HLS only)/default-subtitle-track `url` in place. On any failure
 * (including flag-off), `streamInfo` - already fully built by the caller's synchronous legacy
 * `createStreamInfo()` call before this runs - is left completely untouched. Returns whether v2 was
 * applied, for logging/tests; the caller does not need to branch on it.
 */
export async function applyV2PlaybackUrlToStreamInfo(
    streamInfo: V2PatchableStreamInfo,
    params: ResolveV2PlaybackUrlParams,
    apiClient: PlaybackUrlResolvingApiClient,
    deps: ResolveV2PlaybackUrlDeps = {}
): Promise<boolean> {
    const result = await resolveV2PlaybackUrl(params, deps);

    if (!result) {
        return false;
    }

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
        console.debug(
            '[playbackSessionV2Url] URL resolution failed, keeping legacy streamInfo',
            err
        );
        return false;
    }

    streamInfo.url = absoluteUrl;
    streamInfo.playMethod = result.playMethod;
    streamInfo.playSessionId = result.playSessionId;

    if (result.protocol === PlaybackDecisionStreamingProtocol.Hls) {
        streamInfo.mimeType = 'application/x-mpegURL';
    }

    if (absoluteSubtitleUrl) {
        overrideDefaultSubtitleTrackUrl(streamInfo, absoluteSubtitleUrl);
    }

    return true;
}

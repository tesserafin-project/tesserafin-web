/**
 * Best-effort shadow `POST Playback/Sessions` call (`docs/pr116-client-migration-design.md` PR116b,
 * `reefin` repo). Fires a v2 `Playback/Sessions` request alongside the real, unchanged
 * `PlaybackInfo` flow in `playbackmanager.js` purely for `DecisionVersion`/`Method` diagnostics -
 * never read by, and never able to affect, real playback. Behind `appSettings.enablePlaybackSessionShadow()`
 * (default off, `./settings/appSettings.js`).
 *
 * Bridge pattern: `playbackApiFor()` below mirrors `systemApiFor()`
 * (`apps/dashboard/features/playback/api/playbackDiagnosticsApi.ts`) - it configures the generated
 * `PlaybackApi` from the CURRENT `@jellyfin/sdk` session (`api.basePath`/`api.axiosInstance`/
 * `api.authorizationHeader`) rather than through `lib/reefin-sdk`'s independent `createReefinApi()`,
 * for the same reason: avoid the server seeing a second `DeviceId` for the same browser session
 * (design doc §1.4/§3 PR116b).
 *
 * PlaySessionId collision risk (design doc §4.2, "the real risk"): `CreatePlaybackSessionRequest`
 * treats `PlaySessionId` as an upsert key - "at most one session per id, creating with the same id
 * again replaces it". Reusing the real session's `PlaySessionId` here would silently clobber its
 * `V2PlanRecord`/shadow retention. `generatePlaySessionId()` therefore always mints a fresh id
 * (`crypto.randomUUID()` by default), never the caller's real one - the caller doesn't even have a
 * way to pass one in, by design.
 */

import type { Api } from '@jellyfin/sdk';

import appSettings from './settings/appSettings';
import {
    buildClientCapabilities,
    buildPlaybackConstraints
} from './reefinPlaybackCapabilities';
import {
    Configuration,
    PlaybackApi,
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

export interface ShadowPlaybackSessionParams {
    /** The current `@jellyfin/sdk` session - reused, never a second independent identity. */
    api: Api;
    itemId: string;
    userId?: string;
    mediaSourceId?: string | null;
}

/** Injectable seams for tests - production call sites use every default. */
export interface ShadowPlaybackSessionDeps {
    /** Defaults to `appSettings.enablePlaybackSessionShadow()`. */
    isEnabled?: () => boolean;
    /** Defaults to `crypto.randomUUID()` - see file-level doc comment on why this must never be the
     * real session's PlaySessionId. */
    generatePlaySessionId?: () => string;
    buildCapabilities?: typeof buildClientCapabilities;
    buildConstraints?: typeof buildPlaybackConstraints;
    /** Defaults to `console`. Only `.debug` is used - swapped out in tests to assert on logging
     * without polluting real test output. */
    logger?: Pick<Console, 'debug'>;
}

/**
 * Fires the shadow `POST Playback/Sessions` call. Never throws, never rejects: a no-op when the
 * flag is off, and every failure (network, 4xx/5xx, a missing/misconfigured api) is caught and
 * reduced to a single debug log - "best-effort", per the design doc's PR116b exit criteria. Callers
 * should not `await` this in the real playback path; it is safe to call without awaiting since it
 * never rejects.
 */
export async function sendShadowPlaybackSession(
    params: ShadowPlaybackSessionParams,
    deps: ShadowPlaybackSessionDeps = {}
): Promise<void> {
    const isEnabled =
        deps.isEnabled ?? (() => appSettings.enablePlaybackSessionShadow());

    if (!isEnabled()) {
        return;
    }

    const logger = deps.logger ?? console;
    const generatePlaySessionId =
        deps.generatePlaySessionId ?? (() => crypto.randomUUID());
    const buildCapabilities = deps.buildCapabilities ?? buildClientCapabilities;
    const buildConstraints = deps.buildConstraints ?? buildPlaybackConstraints;

    try {
        const shadowPlaySessionId = generatePlaySessionId();

        const { data }: { data: PlaybackSessionResponse } =
            await playbackApiFor(params.api).createPlaybackSession({
                createPlaybackSessionRequest: {
                    ItemId: params.itemId,
                    UserId: params.userId,
                    MediaSourceId: params.mediaSourceId ?? undefined,
                    PlaySessionId: shadowPlaySessionId,
                    Capabilities: buildCapabilities(),
                    Constraints: buildConstraints()
                }
            });

        logger.debug(
            '[playbackSessionShadow] shadow Playback/Sessions decision',
            {
                DecisionVersion: data.DecisionVersion,
                Method: data.Method,
                shadowPlaySessionId
            }
        );
    } catch (err) {
        // Best-effort only (design doc §3 PR116b exit criteria): network failures, 4xx/5xx
        // responses, or a missing/misconfigured api must never surface beyond a log - the real
        // playback flow that triggered this call is entirely unaffected either way.
        logger.debug(
            '[playbackSessionShadow] shadow Playback/Sessions call failed',
            err
        );
    }
}

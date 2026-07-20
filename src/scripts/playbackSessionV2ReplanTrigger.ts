/**
 * The `changeStream()` half of `reefin` issue #43's session cycle: the retry/stream-change path's
 * re-entry into v2, mirroring `playbackSessionV2UrlTrigger.ts` exactly - a tiny, eager gate that
 * decides WHETHER to re-plan, with the whole SDK-touching implementation staying behind the same
 * lazy `playback-v2-url` chunk the initial `POST` path already uses.
 *
 * Why this module exists at all: before it, the retry path was the one place the v2 protocol was
 * silently abandoned. `onPlaybackError` -> `changeStream()` -> `createStreamInfo()` rebuilt a
 * LEGACY URL and played it, while the server-side v2 session the player had adopted at start kept
 * serving a plan nobody was reading - no `PUT`, no log line, nothing. This gate closes that hole:
 * a player that holds an adopted v2 session re-plans it with `PUT Playback/Sessions/{id}` and
 * plays the re-planned stream; a player that does not (flag off, legacy playback, v2 never
 * established a session) takes the legacy path exactly as before, byte for byte.
 *
 * The fork, in decision order (each step is unit-tested in isolation):
 *   1. flag off  -> legacy, silently: v2 was never in play, so there is nothing to fall back FROM,
 *      and - same as the `POST` trigger - the `playback-v2-url` chunk must never even be requested.
 *   2. no adopted v2 session id (or no `PlaySessionId` to go with it) -> legacy, with a debug line:
 *      the flag is on but this player is playing a legacy stream (the initial `POST` fell back),
 *      so there is no session to re-plan and inventing one via a fresh `POST` mid-retry would
 *      detach the teardown tracker from what the server serves.
 *   3. otherwise -> load the chunk and delegate to `applyV2PlaybackReplanToStreamInfo()`, whose
 *      own contract is the loud one: any `PUT`/`GET` failure logs a single `console.warn` naming
 *      the reason and leaves the legacy `streamInfo` untouched.
 *
 * Deliberately `async`/awaited for the same reason the `POST` trigger is: the caller hands the
 * (possibly patched) `streamInfo` straight to `changeStreamToUrl()` -> `player.play()`, so the
 * patch must be complete before the caller proceeds. And like every other module on this path, a
 * chunk-load failure resolves `false` - it can never throw into the player.
 */
import type {
    PlaybackUrlResolvingApiClient,
    ReplanV2PlaybackUrlDeps,
    ResolveV2PlaybackUrlParams,
    V2ExecutionContext,
    V2PatchableStreamInfo,
    V2ReplanConstraintOverrides
} from './playbackSessionV2Url';
import appSettings from './settings/appSettings';

/** The trigger-level params: the `POST` params shape plus the re-plan identities, both OPTIONAL
 * here because resolving them is exactly the decision this gate exists to make - `changeStream()`
 * passes whatever it recovered from per-player state, and absence means "legacy retry". Once the
 * gate passes, they are narrowed to the required strings the wrapped module demands. */
export interface V2PlaybackReplanTriggerParams
    extends ResolveV2PlaybackUrlParams {
    /** The adopted v2 session id, from `adoptedV2PlaybackSessionId()`
     * (`playbackSessionTeardownTrigger.ts` - the teardown owner is the one place that knows which
     * session this player currently holds). Absent/blank selects the legacy fork. */
    sessionId?: string | null;
    /** The `PlaySessionId` the current (v2) `streamInfo` carries - the one the session was created
     * with. Absent/blank selects the legacy fork too: a session provably exists but the client no
     * longer knows its `PlaySessionId`, and a re-plan whose patched `streamInfo` carried a blank
     * one would desynchronize progress reporting from what the server tracks. */
    playSessionId?: string | null;
    /** Retry constraints for the re-plan body - see `V2ReplanConstraintOverrides`. */
    constraintOverrides?: V2ReplanConstraintOverrides;
}

/** Injectable seams for tests - production call sites use every default. */
export interface V2PlaybackReplanTriggerDeps {
    /** Defaults to `appSettings.enableV2PlaybackPath()`. Checked BEFORE the dynamic `import()` -
     * flag off must keep `playback-v2-url.chunk.js` off the wire entirely, exactly like the
     * `POST` trigger. */
    isEnabled?: () => boolean;
    /** Defaults to a dynamic `import('./playbackSessionV2Url')` - the SAME
     * `webpackChunkName: "playback-v2-url"` as the `POST` trigger, so webpack folds both paths
     * into the one existing lazy chunk rather than minting a second one. */
    loadV2UrlModule?: () => Promise<typeof import('./playbackSessionV2Url')>;
    /** Forwarded to `applyV2PlaybackReplanToStreamInfo()` once the module has loaded. */
    v2Deps?: ReplanV2PlaybackUrlDeps;
    /** Defaults to `console`. `.debug` for the routine legacy fork, `.warn` for failures that
     * happen AFTER the fork chose v2 - by then an adopted session exists and falling back is a
     * real event the explicit-fallback contract requires naming. */
    logger?: Pick<Console, 'debug' | 'warn'>;
}

const LOG_PREFIX = '[playbackSessionV2Replan]';

/**
 * Entry point for the retry-path v2 re-plan from `playbackmanager.js#changeStream()`. No-op - and
 * no chunk request at all - when the flag is off; a logged no-op when the player holds no adopted
 * v2 session (the "else legacy" fork). Returns whether the re-plan was applied; `false` always
 * means the legacy `streamInfo` the caller built is untouched and will play.
 */
export async function applyV2PlaybackReplanIfEnabled(
    streamInfo: V2PatchableStreamInfo,
    params: V2PlaybackReplanTriggerParams,
    apiClient: PlaybackUrlResolvingApiClient,
    context: V2ExecutionContext = {},
    deps: V2PlaybackReplanTriggerDeps = {}
): Promise<boolean> {
    const isEnabled =
        deps.isEnabled ?? (() => appSettings.enableV2PlaybackPath());

    if (!isEnabled()) {
        return false;
    }

    const logger = deps.logger ?? console;

    // The "else legacy" side of the fork. Blank-collapsing (`trim()`) mirrors the teardown
    // tracker's own adopt() guard: a whitespace id is as absent as no id.
    const sessionId = params.sessionId?.trim();
    const playSessionId = params.playSessionId?.trim();
    if (!sessionId || !playSessionId) {
        logger.debug(
            `${LOG_PREFIX} no adopted v2 session on this player - the retry keeps the legacy stream URL`
        );
        return false;
    }

    const loadV2UrlModule =
        deps.loadV2UrlModule ??
        (() =>
            import(
                /* webpackChunkName: "playback-v2-url" */ './playbackSessionV2Url'
            ));

    try {
        const mod = await loadV2UrlModule();

        // Same arity discipline as the POST trigger (see its `context` MUST-land-on-arg-4
        // comment): `context` is arg 4, deps are arg 5, and mixing them up silently drops the
        // execution context. `applies the execution context through to the wrapped module` in the
        // test file guards this trigger the same way.
        return await mod.applyV2PlaybackReplanToStreamInfo(
            streamInfo,
            { ...params, sessionId, playSessionId },
            apiClient,
            context,
            deps.v2Deps ?? {}
        );
    } catch (err) {
        // Past the fork, an adopted session exists, so this is the explicit-fallback contract's
        // territory: one warning naming the reason, never a throw - the legacy streamInfo is a
        // complete fallback exactly as on the initial path.
        logger.warn(
            `${LOG_PREFIX} failed to load the v2 playback URL module for the re-plan - falling back to the legacy stream URL for this retry`,
            err
        );
        return false;
    }
}

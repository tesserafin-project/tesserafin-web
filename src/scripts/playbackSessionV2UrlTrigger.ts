/**
 * PR116f (bundle-hardening follow-up to PR116d, mirroring PR116e's
 * `playbackSessionShadowTrigger.ts`): lazy-loads the *real* v2 playback-URL chain instead of
 * pulling it into the main bundle unconditionally.
 *
 * The problem this fixes: `playbackmanager.js` `import`ed `playbackSessionV2Url.ts` statically, and
 * that module in turn statically imports the native `reefinPlaybackCapabilities.ts` builder plus
 * `PlaybackApi`/`Configuration`/the decision enums from `lib/reefin-sdk`. `resolveV2PlaybackUrl()`
 * only *checks* `enableV2PlaybackPath()` at call time - by then webpack has already had to bundle
 * the whole chain into the main chunk, flag OFF or not, because a static `import` is resolved at
 * build time regardless of what runs at runtime. PR116e fixed exactly this for the shadow chain
 * (~515 B); the real path still carried the builder and the SDK.
 *
 * The fix (same shape as the shadow trigger): gate on the flag BEFORE ever reaching for the module,
 * and reach for it with a dynamic `import()` (own named chunk, `playback-v2-url`) rather than a
 * static one. Webpack only emits code to fetch that chunk; it is only actually requested over the
 * network the first time playback starts with the flag on. Flag OFF (the default): this function
 * returns without ever touching the network or evaluating `playback-v2-url.chunk.js`.
 *
 * Deliberately `async`/awaited, unlike the fire-and-forget shadow trigger:
 * `applyV2PlaybackUrlToStreamInfo()` mutates `streamInfo` in place and the caller hands that same
 * object straight to `player.play()`, so the caller must await the patch before playing. The
 * never-throws/never-rejects contract of the wrapped module is preserved here: a chunk-load failure
 * resolves `false` (legacy `streamInfo` untouched) exactly like every other v2 failure mode.
 */
import type {
    PlaybackUrlResolvingApiClient,
    ResolveV2PlaybackUrlDeps,
    ResolveV2PlaybackUrlParams,
    V2ExecutionContext,
    V2PatchableStreamInfo
} from './playbackSessionV2Url';
import appSettings from './settings/appSettings';

/** Injectable seams for tests - production call sites use every default. */
export interface V2PlaybackUrlTriggerDeps {
    /** Defaults to `appSettings.enableV2PlaybackPath()`. Checked BEFORE the dynamic `import()`
     * below - this is what keeps `playback-v2-url.chunk.js` from ever being requested while the
     * flag is off. Also forwarded to `resolveV2PlaybackUrl()` so the flag is read from a single
     * source per call. */
    isEnabled?: () => boolean;
    /** Defaults to a dynamic `import('./playbackSessionV2Url')` (own webpack chunk,
     * `webpackChunkName: "playback-v2-url"`). Swapped out in tests to avoid exercising real
     * code-splitting. */
    loadV2UrlModule?: () => Promise<typeof import('./playbackSessionV2Url')>;
    /** Forwarded to `applyV2PlaybackUrlToStreamInfo()` once the module has loaded. */
    v2Deps?: ResolveV2PlaybackUrlDeps;
    /** Defaults to `console`. Only `.debug` is used - a chunk-load failure (offline, CDN hiccup) is
     * exactly as recoverable as any other v2 failure: the legacy `streamInfo` is a complete
     * fallback, so it must never surface beyond a log. */
    logger?: Pick<Console, 'debug'>;
}

/**
 * Entry point for the real v2 playback-URL attempt from `playbackmanager.js`. No-op - and no
 * `playback-v2-url` chunk request at all - when the flag is off. When on, dynamically imports the
 * v2 module and delegates to `applyV2PlaybackUrlToStreamInfo()`, which carries its own
 * all-or-nothing patch contract. Returns whether v2 was applied, for logging/tests; the caller does
 * not need to branch on it.
 */
export async function applyV2PlaybackUrlIfEnabled(
    streamInfo: V2PatchableStreamInfo,
    params: ResolveV2PlaybackUrlParams,
    apiClient: PlaybackUrlResolvingApiClient,
    context: V2ExecutionContext = {},
    deps: V2PlaybackUrlTriggerDeps = {}
): Promise<boolean> {
    const isEnabled =
        deps.isEnabled ?? (() => appSettings.enableV2PlaybackPath());

    if (!isEnabled()) {
        return false;
    }

    const logger = deps.logger ?? console;
    const loadV2UrlModule =
        deps.loadV2UrlModule ??
        (() =>
            import(
                /* webpackChunkName: "playback-v2-url" */ './playbackSessionV2Url'
            ));

    try {
        const mod = await loadV2UrlModule();

        // `context` MUST land on arg 4 and the resolve deps on arg 5. Passing the deps as arg 4
        // (the pre-#24 arity) silently drops the whole execution context - `directPlayMimeType`,
        // `requestOptions` and the server-reported container/mime - which reads as "v2 cannot
        // supply a complete execution state" and collapses v2 to HLS-only, with the retry
        // stream-copy flags always false. Every unit test would still pass, because they call the
        // wrapped module directly. `applies the execution context through to the wrapped module`
        // in the test file is the regression guard for exactly this.
        return await mod.applyV2PlaybackUrlToStreamInfo(
            streamInfo,
            params,
            apiClient,
            context,
            { isEnabled, ...deps.v2Deps }
        );
    } catch (err) {
        // Same exit criteria as the wrapped module's own fallback matrix: a failure to even load
        // the chunk (offline, CDN hiccup) must never surface beyond a log - the legacy `streamInfo`
        // the caller already built synchronously is untouched and is a complete fallback.
        logger.debug(
            '[playbackSessionV2Url] failed to load the v2 playback URL module - falling back to legacy playback URL',
            err
        );
        return false;
    }
}

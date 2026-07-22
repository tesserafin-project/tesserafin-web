/**
 * PR116e (bundle-hardening follow-up to PR116b): lazy-loads the shadow `Playback/Sessions` chain
 * instead of pulling it into the main bundle unconditionally.
 *
 * The problem this fixes: `playbackmanager.js` used to `import` `playbackSessionShadow.ts`
 * statically, and `playbackSessionShadow.ts` in turn statically imports the native
 * `tesserafinPlaybackCapabilities.ts` builder (792 lines) and `PlaybackApi`/`Configuration` from
 * `lib/tesserafin-sdk`. `sendShadowPlaybackSession()` itself only *checks* `enablePlaybackSessionShadow()`
 * at call time - by then webpack has already had to bundle the whole chain into the main chunk,
 * flag OFF or not, because a static `import` is resolved at build time regardless of what runs at
 * runtime.
 *
 * The fix: gate on the flag BEFORE ever reaching for the module, and reach for it with a dynamic
 * `import()` (own named chunk, `playback-shadow`) rather than a static one. Webpack only emits code
 * to fetch that chunk; it is only actually requested over the network the first time a real
 * `POST PlaybackInfo` call is made with the flag on. Flag OFF (the default): this function returns
 * synchronously without ever touching the network or evaluating `playback-shadow.chunk.js`.
 *
 * Deliberately synchronous return type: mirrors `sendShadowPlaybackSession()`'s own contract (never
 * throws, never rejects, safe to fire-and-forget) so call sites need neither `await` nor `void`.
 */
import type {
    ShadowPlaybackSessionDeps,
    ShadowPlaybackSessionParams
} from './playbackSessionShadow';
import appSettings from './settings/appSettings';

/** Injectable seams for tests - production call sites use every default. */
export interface ShadowPlaybackSessionTriggerDeps {
    /** Defaults to `appSettings.enablePlaybackSessionShadow()`. Checked BEFORE the dynamic
     * `import()` below - this is what keeps `playback-shadow.chunk.js` from ever being requested
     * while the flag is off. */
    isEnabled?: () => boolean;
    /** Defaults to a dynamic `import('./playbackSessionShadow')` (own webpack chunk,
     * `webpackChunkName: "playback-shadow"`). Swapped out in tests to avoid exercising real
     * code-splitting. */
    loadShadowModule?: () => Promise<typeof import('./playbackSessionShadow')>;
    /** Forwarded to `sendShadowPlaybackSession()` once the module has loaded. */
    shadowDeps?: ShadowPlaybackSessionDeps;
    /** Defaults to `console`. Only `.debug` is used - a chunk-load failure (offline, CDN hiccup) is
     * exactly as "best-effort" as the shadow call itself and must never surface beyond a log. */
    logger?: Pick<Console, 'debug'>;
}

/**
 * Fire-and-forget entry point for the shadow `Playback/Sessions` call from the real playback-info
 * flow (`playbackmanager.js`). No-op, and no `playback-shadow` chunk request at all, when the flag
 * is off. When on, dynamically imports the shadow module and delegates to
 * `sendShadowPlaybackSession()`, which carries its own best-effort guarantees (never throws, never
 * rejects). A failure to load the chunk itself (network/offline) is caught here the same way.
 */
export function triggerShadowPlaybackSession(
    params: ShadowPlaybackSessionParams,
    deps: ShadowPlaybackSessionTriggerDeps = {}
): void {
    const isEnabled =
        deps.isEnabled ?? (() => appSettings.enablePlaybackSessionShadow());

    if (!isEnabled()) {
        return;
    }

    const logger = deps.logger ?? console;
    const loadShadowModule =
        deps.loadShadowModule ??
        (() =>
            import(
                /* webpackChunkName: "playback-shadow" */ './playbackSessionShadow'
            ));

    loadShadowModule()
        .then((mod) => mod.sendShadowPlaybackSession(params, deps.shadowDeps))
        .catch((err) => {
            // Best-effort only, same exit criteria as sendShadowPlaybackSession() itself (design
            // doc §3 PR116b): a failure to even load the chunk (offline, CDN hiccup) must never
            // surface beyond a log - the real playback flow that triggered this is unaffected.
            logger.debug(
                '[playbackSessionShadow] failed to load the shadow module',
                err
            );
        });
}

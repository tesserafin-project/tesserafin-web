/**
 * Client half of the `reefin` issue #43 session cycle: owning a server-created
 * `PlaybackSessionId` for as long as it is playing, and giving it back with
 * `DELETE Playback/Sessions/{id}` when it stops.
 *
 * Design: `reefin` `docs/issue43-design-playback-session-lifecycle.md`.
 * Measurements behind §6: `docs/issue43-browser-teardown-measurements.md`.
 *
 * Scope gate (load-bearing): every function here is a no-op unless a v2 session was actually
 * established, i.e. the caller hands over a `PlaybackSessionId` that only the v2 path can
 * produce. Legacy playback never reaches these code paths, so wiring this into
 * `playbackmanager.js`'s generic stop path does NOT activate v2 for anyone. Playback v2 stays
 * behind `appSettings.enableV2PlaybackPath()`, off by default.
 *
 * Deliberately zero imports, same constraint `playbackAttemptId.ts` documents: this module is
 * reachable from `playbackmanager.js`'s main chunk, so anything it pulled in would land in the
 * bundle. The `DELETE` therefore goes out through a plain `fetch` against the session's own
 * `basePath`/`authorizationHeader` rather than through the generated SDK client - which also
 * keeps `lib/tesserafin-sdk` behind the existing lazy `playback-v2-url` boundary.
 *
 * ## Why teardown keys on the SERVER id
 *
 * The stale-teardown hazard is real: attempt A stops, its `DELETE` is queued behind a slow
 * network; attempt B starts and establishes a session; A's `DELETE` lands afterwards. Keying
 * on `PlaySessionId` would make A's teardown address B's session, because a `POST` reusing a
 * `PlaySessionId` deliberately returns the SAME session. Keying on the server-assigned
 * `PlaybackSessionId` makes that structurally impossible: a new attempt mints a new
 * `PlaySessionId`, so the server mints a new `PlaybackSessionId`, and A's `DELETE` can only
 * ever 404. See the design doc §5.
 *
 * The generation counter below is the second, independent guard, and it covers the one case
 * the id alone cannot: a `POST` that REUSES the same `PlaySessionId` gets the same server id
 * back, so ids do not separate the old record from the new one - but the generation does.
 */

/** The minimum this module needs from an `@jellyfin/sdk` `Api`. Structural rather than an
 * import of the real type, to keep the module import-free (see the file-level comment). */
export interface TeardownApi {
    basePath: string;
    authorizationHeader: string;
}

/** A session this client currently owns. Immutable: a replacement produces a new record
 * rather than mutating this one, so an in-flight teardown holding a reference cannot observe
 * its own record being repurposed. */
interface OwnedSession {
    readonly api: TeardownApi;
    readonly sessionId: string;
    readonly generation: number;
    /** Set once playback for this record has ended - i.e. a teardown is genuinely OWED.
     * Distinct from `released`: a session can be owed a teardown that has not been issued. */
    ended: boolean;
    /** Set once the `DELETE` for this record has actually been DISPATCHED, so a second trigger
     * (stop followed by `pagehide`, the common case) cannot issue a duplicate.
     *
     * "Dispatched" and not "succeeded", deliberately: a request that left the client is the
     * server's problem from then on, and re-issuing it later is the stale-teardown hazard §5
     * exists to prevent. The one case that does NOT set it is a dispatch that never happened at
     * all - an absent or synchronously throwing `fetch` - because there the backstop is the only
     * remaining route and suppressing it would lose the session for a whole TTL. See
     * {@link PlaybackSessionTracker.release}. */
    released: boolean;
}

/**
 * Tracks the one session a player currently owns. One instance per player, parked on
 * `playerData` so it survives `changeStream()` replacing `streamInfo` wholesale.
 *
 * NOT a module-level singleton, for exactly the reason `playbackAttemptId.ts` gives for its
 * own value: `playInternal()` is invoked fire-and-forget, so two attempts can legitimately
 * overlap, and a shared mutable "current session" would let one attempt tear down the other's.
 */
export class PlaybackSessionTracker {
    private current: OwnedSession | null = null;

    private generationCounter = 0;

    private readonly deps: TeardownDeps;

    /**
     * @param deps Injectable seams; production callers pass nothing. Held on the tracker
     * rather than passed per call because {@link adopt} issues a teardown of its own (the
     * outgoing session) and would otherwise have no way to reach them.
     */
    constructor(deps: TeardownDeps = {}) {
        this.deps = deps;
    }

    /**
     * Takes ownership of a newly established v2 session, releasing whatever this tracker
     * previously held. The release of the outgoing session is issued BEFORE the new one is
     * recorded, but carries the outgoing generation, so its completing late cannot touch the
     * incoming session.
     *
     * `sessionId` absent/blank is a valid no-op: it means the v2 path did not establish a
     * session (flag off, fallback to legacy), and there is nothing to own.
     */
    adopt(
        api: TeardownApi | null | undefined,
        sessionId: string | null | undefined
    ): void {
        const trimmed = sessionId?.trim();

        // Release the outgoing session first - a replacement is a teardown of the old one.
        this.release('replaced');

        if (!trimmed || !api) {
            return;
        }

        this.generationCounter += 1;
        this.current = {
            api,
            sessionId: trimmed,
            generation: this.generationCounter,
            ended: false,
            released: false
        };
    }

    /** The session id currently owned, for tests and diagnostics. Note this still reports a
     * session whose `DELETE` has already been issued - `release()` marks the record rather than
     * dropping it, precisely so a second trigger stays a no-op. Callers that need "may I still
     * address this session on the server?" must use {@link liveSessionId} instead. */
    get ownedSessionId(): string | null {
        return this.current?.sessionId ?? null;
    }

    /** The session id currently owned AND not yet released - i.e. one the server should still be
     * holding on this client's behalf, which is the only kind a `PUT` re-plan
     * (`playbackSessionV2ReplanTrigger.ts`) may address. `null` once `release()` has run: the
     * `DELETE` is (at least) in flight by then, and re-planning a session being torn down would
     * race the teardown it can no longer win. */
    get liveSessionId(): string | null {
        return this.current && !this.current.released
            ? this.current.sessionId
            : null;
    }

    /**
     * Gives the current session back to the server. Idempotent in the strongest sense: the
     * SECOND call issues no request at all, rather than issuing one and tolerating the 404.
     * That matters because the ordinary path fires it twice - once from the player's `stopped`
     * event, once again from `pagehide` as the tab closes.
     *
     * Never throws and never rejects. Playback has already ended by the time this runs, so
     * there is no user-visible outcome that a failure could usefully change.
     *
     * ## Dispatch is synchronous, and that is the contract (`tesserafin-web#60`)
     *
     * The `DELETE` is handed to the network stack before this method returns. Nothing is queued,
     * deferred to a microtask or scheduled on a timer, because a caller whose next statement
     * navigates has no way to wait for work that has not started. A stop path that returns
     * before the request left is indistinguishable from one that never sent it.
     *
     * @param reason Diagnostic only - recorded in the debug log, never sent to the server.
     * @param options `expectSessionId` is the stale-teardown guard described below.
     * @returns `true` when the `DELETE` was dispatched by THIS call. `false` covers both "there
     * was nothing to release" and "the transport refused it"; {@link hasPendingRelease}
     * separates the two.
     */
    release(
        reason: string,
        options: { expectSessionId?: string } = {}
    ): boolean {
        const session = this.current;

        if (!session || session.released) {
            return false;
        }

        // The stale-teardown guard, and the reason a caller that CAN name the session it is
        // ending should always do so. A stop path that fires late - attempt A's `stopped`
        // event arriving after attempt B has already been adopted - would otherwise tear down
        // whatever the tracker currently holds, which is B. Naming A's id makes that a no-op.
        //
        // Optional because the unload flush genuinely cannot name a session: it means "the
        // document is going away, end whatever is playing", and that is correct there.
        if (
            options.expectSessionId !== undefined &&
            options.expectSessionId !== session.sessionId
        ) {
            return false;
        }

        // Mark before issuing, not after: `sendDelete` is async, and a second trigger arriving
        // while the first request is still in flight must not produce a duplicate. `ended` is
        // set here too - calling release IS the statement that playback is over.
        this.current = { ...session, ended: true, released: true };

        const dispatched = sendDelete(session, reason, this.deps);

        if (!dispatched) {
            // The request never left. Re-arm the backstop rather than pretending a teardown is
            // in flight: `ended` stays true so `hasPendingRelease` reports an owed teardown and
            // `pagehide`/`visibilitychange` can still try. This is the ONLY path that clears
            // `released`, and it is reached only when `fetch` is absent or threw synchronously -
            // never for a request that left and failed, which is the server's TTL to recover.
            this.current = { ...session, ended: true, released: false };
        }

        return dispatched;
    }

    /**
     * Records that playback for the owned session has ended WITHOUT issuing the `DELETE` yet.
     *
     * The narrow purpose: it makes a teardown *owed*, which is the precondition
     * {@link hasPendingRelease} reports and the `visibilitychange` flush requires. Used when
     * the stop path knows playback is over but cannot issue the request there and then.
     */
    markEnded(): void {
        if (this.current && !this.current.ended) {
            this.current = { ...this.current, ended: true };
        }
    }

    /**
     * Drops the tracked session WITHOUT contacting the server. For the case where the server
     * has already told us the session is gone (a 404 from `PUT`/`GET .../Stream`), so issuing
     * a `DELETE` would be a pointless request against an id we know is dead.
     */
    forget(): void {
        this.current = null;
    }

    /**
     * True only when playback has ENDED and the `DELETE` has still not been issued - i.e. a
     * teardown is genuinely owed.
     *
     * Deliberately false for a session that is still playing, and that is the entire point.
     * On mobile, `visibilitychange -> hidden` fires on an ordinary tab switch and is
     * frequently the only teardown signal delivered; a flush keyed on "owns a session" rather
     * than "owes a teardown" would kill live playback every time the user switched apps.
     * `ended` is what distinguishes the two, which is why it is tracked separately from
     * `released`.
     */
    get hasPendingRelease(): boolean {
        return (
            this.current !== null &&
            this.current.ended &&
            !this.current.released
        );
    }
}

/** Injectable seams for tests - production callers use every default. */
export interface TeardownDeps {
    /** Defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
    /** Defaults to `console`. Only `.debug` is used. */
    logger?: Pick<Console, 'debug'>;
}

const LOG_PREFIX = '[playbackSessionTeardown]';

/**
 * Issues the `DELETE`, swallowing every outcome. Returns whether the request was actually handed
 * to the transport - see {@link PlaybackSessionTracker.release} for what the caller does with it.
 *
 * ## `keepalive: true`, unconditionally (`tesserafin-web#60`)
 *
 * This used to be opt-in, set only by the `pagehide`/`visibilitychange` flush, so the PRIMARY
 * stop-time teardown went out as an ordinary `fetch`. An ordinary `fetch` belongs to its
 * document's fetch group and is ABORTED when that document is destroyed. A user who stops
 * playback and navigates within the same few tens of milliseconds therefore had the request
 * cancelled in flight - and because `release()` had already marked the record released, the
 * keepalive `pagehide` backstop was suppressed and issued nothing. The session survived to its
 * TTL with the server never having seen a single request. Observed once in eight runs of
 * `tests/e2e/playback-v2-lifecycle-oracle.spec.ts`.
 *
 * There is no teardown for which the ordinary transport is correct: this request exists
 * precisely to outlive the playback context that produced it. Making it unconditional removes
 * the failure mode rather than narrowing it, and costs nothing measurable - the body is empty,
 * so none of the 64 KiB keepalive quota is consumed.
 *
 * Status handling (design doc §4/§7):
 * - **204** - done.
 * - **404** - treated as SUCCESS, not failure. The goal is "the session is not there", and a
 *   404 says exactly that. Very often the server's own `PlaybackStopped`/`TranscodingJobEnded`
 *   handler reaped it first, which is correct behaviour, not an error.
 * - **403** - logged, never retried: a permanent statement about this caller. Since the
 *   `StoreOrReplace` fix this should not occur for a session's own owner; if it does it is a
 *   genuine bug, and a silent retry would hide it.
 * - **network error / 5xx** - one attempt, no retry loop. Re-issuing a `DELETE` after an
 *   arbitrary delay is precisely the stale-teardown hazard the design exists to prevent, and
 *   the server's 6 h TTL sweep already covers a teardown that never lands.
 */
function sendDelete(
    session: OwnedSession,
    reason: string,
    deps: TeardownDeps
): boolean {
    const logger = deps.logger ?? console;
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

    if (typeof fetchImpl !== 'function') {
        return false;
    }

    const url = `${session.api.basePath}/Playback/Sessions/${encodeURIComponent(session.sessionId)}`;

    let result: ReturnType<typeof fetchImpl>;

    try {
        result = fetchImpl(url, {
            method: 'DELETE',
            headers: { Authorization: session.api.authorizationHeader },
            keepalive: true
        });
    } catch (err) {
        // A synchronous throw from a patched/absent fetch must not escape into the stop path.
        // Reported as NOT dispatched, which re-arms the unload backstop.
        logger.debug(
            `${LOG_PREFIX} DELETE ${session.sessionId} (${reason}) could not be issued`,
            err
        );
        return false;
    }

    // Emitted at dispatch, not at completion, and naming the trigger: this line is the only
    // client-side evidence of WHICH path issued a teardown, and the E2E stress rig reads it to
    // tell "the primary stop path sent it" from "the unload backstop sent it".
    logger.debug(
        `${LOG_PREFIX} DELETE ${session.sessionId} (${reason}) dispatched keepalive`
    );

    // `fetch` rejects on network failure; nothing here may surface beyond a debug line. The
    // outcome is observed but never acted on: ONE attempt, no retry, no timeout, no fallback
    // transport. A request that left and failed is left to the server's TTL sweep, which is the
    // last-resort recovery the design reserves for exactly this - re-issuing it later would be
    // the stale-teardown hazard §5 exists to prevent.
    void Promise.resolve(result)
        .then((response) => {
            if (response && !response.ok && response.status !== 404) {
                logger.debug(
                    `${LOG_PREFIX} DELETE ${session.sessionId} (${reason}) answered ${response.status} - not retrying`
                );
            }
        })
        .catch((err: unknown) => {
            logger.debug(
                `${LOG_PREFIX} DELETE ${session.sessionId} (${reason}) failed - leaving the session to the server's own expiry`,
                err
            );
        });

    return true;
}

/**
 * Registers the unload-time flush for a tracker and returns an unregister function.
 *
 * Which events, and why - all four claims below are measured
 * (`docs/issue43-browser-teardown-measurements.md`):
 *
 * - **`pagehide`** - fires on both navigate-away and tab close, and its keepalive `DELETE`
 *   was delivered in both. The primary signal.
 * - **`visibilitychange -> hidden`** - also delivered on tab close, and on real mobile
 *   browsers it is frequently the ONLY signal delivered. Registered as well, and made safe by
 *   `hasPendingRelease`: it flushes a teardown already owed and never starts one, so an
 *   ordinary tab switch during live playback does not kill the session.
 * - **`beforeunload`** - deliberately NOT registered. It was delivered only in the scenario
 *   where `pagehide` was also delivered, it is skipped on bfcache eviction, and registering it
 *   can make the page ineligible for the back/forward cache. It would add cost and no coverage.
 * - **`keepalive: true`** - mandatory rather than an optimisation: on tab close the plain
 *   `fetch` was dropped and the keepalive one was delivered. It is no longer requested here
 *   because `sendDelete` now applies it to every teardown, for the reason that function
 *   documents (`tesserafin-web#60`).
 *
 * ## This is a BACKSTOP, not the route (`tesserafin-web#60`)
 *
 * The primary teardown is the explicit stop path -
 * `releasePlaybackSessionOnStop()` from `playbackSessionTeardownTrigger.ts`, called
 * synchronously by the manager's `playbackstop` handling. By the time an unload event fires
 * after an ordinary stop, the record is already released and both handlers here are no-ops.
 * They exist for the cases the stop path cannot cover: a tab closed mid-playback, or a
 * navigation that destroys the document before the player ever reports a stop.
 *
 * None of this is a guarantee, and the design does not treat it as one: closing the browser
 * process delivered nothing at all, by any transport. The authoritative cleanup stays
 * server-side (`PlaybackStopped`/`TranscodingJobEnded` reaping, plus the 6 h `SweepExpired`
 * TTL backstop). This is a promptness optimisation on top of that, not a correctness
 * dependency.
 */
export function registerTeardownFlush(
    tracker: PlaybackSessionTracker,
    target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
    doc: { visibilityState: string } | undefined
): () => void {
    const onPageHide = () => {
        tracker.release('pagehide');
    };

    const onVisibilityChange = () => {
        // Only ever FLUSHES an owed teardown - never initiates one. See the doc comment.
        if (doc?.visibilityState === 'hidden' && tracker.hasPendingRelease) {
            tracker.release('visibilitychange');
        }
    };

    target.addEventListener('pagehide', onPageHide);
    target.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
        target.removeEventListener('pagehide', onPageHide);
        target.removeEventListener('visibilitychange', onVisibilityChange);
    };
}

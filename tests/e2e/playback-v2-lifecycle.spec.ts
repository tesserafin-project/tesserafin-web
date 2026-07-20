import { expect, request, test } from '@playwright/test';

/**
 * THE FULL v2 SESSION LIFECYCLE — REAL browser E2E, real server (reefin issue #43).
 *
 * What this file proves, app-driven (a real play button, a real player error, a real stop —
 * never a synthetic API call standing in for the product flow):
 *
 *   a. ONE attempt establishes the session: `PlaybackInfo` POST → `POST /Playback/Sessions`
 *      answering exactly 200 → `GET /Playback/Sessions/{id}/Stream` observed on the wire.
 *   b. A media failure re-enters v2 through the retry path: `onPlaybackError` → `changeStream()`
 *      issues a REAL `PUT /Playback/Sessions/{id}` — same session id, the SAME
 *      `PlaybackAttemptId` in its body as the POST's (the retry belongs to the attempt that
 *      started it, `playbackAttemptId.ts`), a DIFFERENT `X-Request-Id` (per-request, issue #42) —
 *      and playback continues from the re-planned stream: the descriptor the post-PUT
 *      `GET .../Stream` returns is what the player actually fetches next, successfully.
 *   c. A user stop gives the session back: `DELETE /Playback/Sessions/{id}` observed, naming the
 *      same session the POST created.
 *   d. The NEXT play press mints a NEW `PlaybackAttemptId` — asserted cheaply here (it is proven
 *      exhaustively in `playback-attempt-id-contract.spec.ts`) so this file witnesses the cycle
 *      end-to-end: create, re-plan, delete, next attempt.
 *   e. Anti-vacuity: inside the lifecycle test the client flag is still on and the lazy
 *      `playback-v2-url` chunk was genuinely fetched; and in a SEPARATE flag-OFF test, playback
 *      works with ZERO `/Playback/Sessions` traffic of any verb and no v2 chunk — the legacy path
 *      is untouched by this feature.
 *
 * SCOPE — same discipline as `playback-attempt-id-contract.spec.ts`, which this file is modeled
 * on: every assertion is on ACTUALLY CAPTURED NETWORK TRAFFIC via an observe-only `instrument()`,
 * there is NO request-body rewriting anywhere (the single `route.abort()` on a media URL fails a
 * delivery, it patches no bytes), no retries, no serial mode, and every wait polls the exact
 * collection the subsequent assertion reads — never `networkidle`.
 *
 * The client v2 flag (`appSettings.enableV2PlaybackPath()`, plain `localStorage`) is turned ON
 * in-browser via `addInitScript` for the lifecycle test only; the source default (OFF) is never
 * modified. The server-side v2 ENGINE is flipped through the real admin API, exactly as the model
 * spec does.
 */

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const E2E_AUTH_HEADER =
    'MediaBrowser Client="Reefin Web E2E", Device="Playwright", DeviceId="reefin-e2e-v2-lifecycle", Version="0.0.0"';

/** The lazily-loaded chunk BOTH v2 triggers (`playbackSessionV2UrlTrigger.ts` and
 * `playbackSessionV2ReplanTrigger.ts`) reach for ONLY when the flag is on. Its presence in
 * captured traffic is the positive control that the flag genuinely took effect. */
const V2_CHUNK = /playback-v2-url\.[a-f0-9]+\.chunk\.js/i;
/** The session COLLECTION — only the initial `POST` addresses it. */
const V2_SESSIONS = /\/Playback\/Sessions(\?|$)/i;
/** A session RESOURCE (`PUT`/`DELETE` target). Deliberately excludes `/Stream`. */
const V2_SESSION_ITEM = /\/Playback\/Sessions\/[^/?]+(\?|$)/i;
/** The PR117 stream-descriptor read, issued after the `POST` and again after the `PUT`. */
const V2_SESSION_STREAM = /\/Playback\/Sessions\/[^/?]+\/Stream(\?|$)/i;
const PLAYBACK_INFO = /\/Items\/[^/]+\/PlaybackInfo(\?|$)/i;
/** Media deliveries, both direct (`stream.*`) and HLS (`master.*`/`main.*`) — the same shape the
 * model spec's retry traversal proved against this rig. */
const MEDIA_LEG = /\/videos\/[^/]+\/(stream|master|main)\./i;

/** `RequestCorrelation.ResponseHeaderName`; Playwright lowercases header keys. */
const REQUEST_ID_HEADER = 'x-request-id';

interface WireRequest {
    method: string;
    url: string;
    postData: string | null;
}
interface WireResponse {
    method: string;
    status: number;
    url: string;
    headers: Record<string, string>;
}
interface CapturedBody {
    method: string;
    status: number;
    url: string;
    text: string;
}
interface Wire {
    requests: WireRequest[];
    responses: WireResponse[];
    /** Parsed `/Playback/Sessions` and `/Playback/Sessions/{id}` response bodies (POST and PUT
     * both land here, told apart by `method`), in arrival order. */
    sessionBodies: CapturedBody[];
    /** `GET /Playback/Sessions/{id}/Stream` response bodies, in arrival order — index 0 belongs
     * to the POST's plan, the last one to the most recent (post-PUT) plan. */
    streamBodies: CapturedBody[];
}

function instrument(page: import('@playwright/test').Page): Wire {
    const wire: Wire = {
        requests: [],
        responses: [],
        sessionBodies: [],
        streamBodies: []
    };
    page.on('request', (r) =>
        wire.requests.push({
            method: r.method(),
            url: r.url(),
            postData: r.postData()
        })
    );
    page.on('response', (r) =>
        wire.responses.push({
            method: r.request().method(),
            status: r.status(),
            url: r.url(),
            headers: r.headers()
        })
    );
    page.on('response', async (r) => {
        const isStream = V2_SESSION_STREAM.test(r.url());
        const isSession =
            !isStream &&
            (V2_SESSIONS.test(r.url()) || V2_SESSION_ITEM.test(r.url()));
        if (!isStream && !isSession) return;
        try {
            const captured: CapturedBody = {
                method: r.request().method(),
                status: r.status(),
                url: r.url(),
                text: await r.text()
            };
            (isStream ? wire.streamBodies : wire.sessionBodies).push(captured);
        } catch {
            /* body already consumed / navigation cancelled it */
        }
    });
    return wire;
}

/** Reads `PlaybackAttemptId` out of a captured request body. Returns '' when absent, so a missing
 * key is visibly distinct and can never satisfy an equality assertion twice. */
function attemptIdOf(postData: string | null): string {
    if (!postData) return '';
    try {
        const parsed = JSON.parse(postData);
        const id = parsed?.PlaybackAttemptId;
        return typeof id === 'string' ? id : '';
    } catch {
        return '';
    }
}

function requestsBy(wire: Wire, method: string, re: RegExp): WireRequest[] {
    return wire.requests.filter(
        (r) =>
            r.method === method &&
            re.test(r.url) &&
            !V2_SESSION_STREAM.test(r.url)
    );
}

async function adminContext() {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await (
        await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        })
    ).json();
    return {
        api,
        userId: String(auth.User.Id),
        token: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
    };
}

/** Every movie the rig seeded (`ci/serve-e2e.sh` synthesizes two), so phase (d)'s second attempt
 * runs on a genuinely different item. */
async function resolveMovieIds(): Promise<string[]> {
    const { api, userId, token } = await adminContext();
    const items = await (
        await api.get('/Items', {
            params: {
                userId,
                recursive: 'true',
                includeItemTypes: 'Movie',
                sortBy: 'SortName'
            },
            headers: { Authorization: token }
        })
    ).json();
    const ids = (items.Items ?? []).map((i: { Id: string }) => String(i.Id));
    await api.dispose();
    if (ids.length === 0)
        throw new Error('no movie fixture found on the server');
    return ids;
}

/** The v2 EXECUTION engine, flipped through the real admin API — server runtime configuration,
 * unrelated to the client's own `enableV2PlaybackPath` flag. Re-asserted in this file's own
 * beforeAll because `playback-v2-client.spec.ts` legitimately leaves the engine on `Legacy` for
 * its kill-switch case, and file order is not this file's to assume. */
async function enableV2Engine() {
    const { api, token } = await adminContext();
    const cfg = await (
        await api.get('/System/Configuration', {
            headers: { Authorization: token }
        })
    ).json();
    cfg.PlaybackShadow = { ...(cfg.PlaybackShadow ?? {}), Mode: 'V2' };
    const posted = await api.post('/System/Configuration', {
        headers: { Authorization: token },
        data: cfg
    });
    if (!posted.ok()) {
        throw new Error(`could not enable the v2 engine: ${posted.status()}`);
    }
    await api.dispose();
}

/** Signs in without `networkidle`: the app lands on either the login form or home, and the poll
 * below waits on that concrete outcome — the collections/URL actually read — not on the network
 * going quiet. */
async function signIn(page: import('@playwright/test').Page) {
    await page.goto('/');
    await expect
        .poll(() => page.url(), { timeout: 30_000 })
        .toMatch(/#\/(login|home)/);
    if (page.url().includes('/login')) {
        await page.locator('#txtManualName:visible').fill(USER);
        await page.locator('#txtManualPassword:visible').fill(PASSWORD);
        await page.locator('button[type="submit"]:visible').first().click();
        await page.waitForURL('**/#/home**', { timeout: 20_000 });
    }
}

/** ONE user-initiated playback start — a separate `playInternal()` invocation, i.e. a separate
 * ATTEMPT by `playbackAttemptId.ts`'s definition. The play button's own visibility wait is the
 * readiness signal; no `networkidle`. */
async function pressPlay(
    page: import('@playwright/test').Page,
    itemId: string
) {
    await page.goto(`/#/details?id=${itemId}`);
    const play = page
        .locator('button.btnPlay:visible, button[title*="Play" i]:visible')
        .first();
    await expect(play).toBeVisible({ timeout: 20_000 });
    await play.click();
}

/** A real user stop, exactly as the model spec leaves an active player: Escape out of the OSD and
 * navigate home. The caller polls for the DELETE this produces — that poll IS the wait, so no
 * `networkidle` here either. */
async function stopPlayback(page: import('@playwright/test').Page) {
    await page.keyboard.press('Escape');
    await page.goto('/#/home');
}

/** Anti-vacuity (requirement e), run inside the lifecycle test: the flag must still be on AND the
 * lazy v2 chunk must actually have been fetched, otherwise every assertion would silently be
 * about the legacy path, where no `/Playback/Sessions` traffic exists at all. */
async function assertV2PathReallyRan(
    page: import('@playwright/test').Page,
    wire: Wire
) {
    await expect
        .poll(() =>
            page.evaluate(() => localStorage.getItem('enableV2PlaybackPath'))
        )
        .toBe('true');
    await expect
        .poll(() => wire.requests.filter((r) => V2_CHUNK.test(r.url)).length, {
            timeout: 30_000
        })
        .toBeGreaterThan(0);
}

test.describe('v2 playback session lifecycle', () => {
    let movieIds: string[] = [];

    test.beforeAll(async () => {
        movieIds = await resolveMovieIds();
        await enableV2Engine();
    });

    test('full cycle: POST + Stream on play, PUT re-plan on retry (same attempt id, new request id), DELETE on stop, new attempt id on next play', async ({
        page
    }) => {
        test.setTimeout(280_000);
        const wire = instrument(page);

        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );

        // Fail the FIRST media delivery exactly once, then let everything through untouched —
        // the only way to provoke a genuine `onPlaybackError` without patching client source,
        // and it rewrites no request body (model spec's own precedent).
        let abortedUrl = '';
        await page.route(MEDIA_LEG, (route) => {
            if (!abortedUrl) {
                abortedUrl = route.request().url();
                console.log(
                    `[lifecycle] aborting first media request: ${abortedUrl}`
                );
                return route.abort('failed');
            }
            return route.continue();
        });

        await signIn(page);
        await pressPlay(page, movieIds[0]);
        await assertV2PathReallyRan(page, wire);

        // ---- (a) one attempt: PlaybackInfo → POST 200 → GET .../Stream. --------------------
        await expect
            .poll(() => requestsBy(wire, 'POST', PLAYBACK_INFO).length, {
                timeout: 45_000
            })
            .toBeGreaterThan(0);
        await expect
            .poll(() => requestsBy(wire, 'POST', V2_SESSIONS).length, {
                timeout: 45_000
            })
            .toBeGreaterThan(0);
        // Wait on the RESPONSES the status/body assertions read, not the requests that provoked
        // them (the model spec's issue-#39 correction).
        await expect
            .poll(
                () =>
                    wire.sessionBodies.filter((b) => b.method === 'POST')
                        .length,
                { timeout: 45_000 }
            )
            .toBeGreaterThan(0);

        const postBody = wire.sessionBodies.filter(
            (b) => b.method === 'POST'
        )[0];
        expect(
            postBody.status,
            `POST /Playback/Sessions must answer exactly 200; body: ${postBody.text.slice(0, 300)}`
        ).toBe(200);
        const sessionId = String(JSON.parse(postBody.text)?.Id ?? '');
        expect(sessionId, 'the POST returned no session Id').not.toBe('');
        console.log(`[lifecycle] session created: ${sessionId}`);

        await expect
            .poll(
                () =>
                    wire.requests.filter(
                        (r) =>
                            r.method === 'GET' && V2_SESSION_STREAM.test(r.url)
                    ).length,
                { timeout: 45_000 }
            )
            .toBeGreaterThan(0);

        const postAttemptId = attemptIdOf(
            requestsBy(wire, 'POST', V2_SESSIONS)[0].postData
        );
        expect(postAttemptId, 'the POST carried no PlaybackAttemptId').not.toBe(
            ''
        );

        // ---- (b) the media failure drives a PUT re-plan on the SAME session/attempt. --------
        await expect.poll(() => abortedUrl, { timeout: 45_000 }).not.toBe('');

        await expect
            .poll(() => requestsBy(wire, 'PUT', V2_SESSION_ITEM).length, {
                timeout: 60_000
            })
            .toBeGreaterThan(0);
        const putRequest = requestsBy(wire, 'PUT', V2_SESSION_ITEM)[0];
        console.log(`[lifecycle] PUT observed: ${putRequest.url}`);
        expect(
            putRequest.url,
            'the PUT must address the session the POST created'
        ).toContain(`/Playback/Sessions/${sessionId}`);

        // SAME attempt id — the retry belongs to the user action that started playback. Both
        // halves matter: non-empty first, then equality (two absent ids satisfy equality free).
        const putAttemptId = attemptIdOf(putRequest.postData);
        console.log(
            `[lifecycle] attempt ids: POST=${postAttemptId} PUT=${putAttemptId}`
        );
        expect(putAttemptId, 'the PUT carried no PlaybackAttemptId').not.toBe(
            ''
        );
        expect(putAttemptId).toBe(postAttemptId);

        // The PUT answered exactly 200 — a 422 here means the server found nothing plannable,
        // and its body is printed rather than the assertion loosened.
        await expect
            .poll(
                () =>
                    wire.sessionBodies.filter((b) => b.method === 'PUT').length,
                { timeout: 60_000 }
            )
            .toBeGreaterThan(0);
        const putBody = wire.sessionBodies.filter((b) => b.method === 'PUT')[0];
        expect(
            putBody.status,
            `PUT /Playback/Sessions/{id} must answer exactly 200; body: ${putBody.text.slice(0, 500)}`
        ).toBe(200);

        // Per-request correlation still varies across the same attempt (issue #42): the PUT's
        // X-Request-Id is distinct from the POST's. Polled on the responses actually read.
        const ridOf = (method: string) =>
            wire.responses.find(
                (r) =>
                    r.method === method &&
                    !V2_SESSION_STREAM.test(r.url) &&
                    (method === 'POST'
                        ? V2_SESSIONS.test(r.url)
                        : V2_SESSION_ITEM.test(r.url))
            )?.headers[REQUEST_ID_HEADER];
        await expect
            .poll(() => ridOf('PUT') ?? '', { timeout: 30_000 })
            .not.toBe('');
        const postRid = ridOf('POST');
        const putRid = ridOf('PUT');
        console.log(`[lifecycle] X-Request-Id: POST=${postRid} PUT=${putRid}`);
        expect(postRid, 'the POST response carried no request id').toBeTruthy();
        expect(putRid).not.toBe(postRid);

        // The re-plan was READ back: a second GET .../Stream resolves the new plan's URL...
        await expect
            .poll(() => wire.streamBodies.length, { timeout: 60_000 })
            .toBeGreaterThanOrEqual(2);
        const replannedDescriptor = JSON.parse(
            wire.streamBodies[wire.streamBodies.length - 1].text
        );
        const replannedPath = String(replannedDescriptor?.Url ?? '').split(
            '?'
        )[0];
        console.log(`[lifecycle] re-planned stream path: ${replannedPath}`);
        expect(
            replannedPath,
            'the post-PUT stream descriptor carried no Url'
        ).not.toBe('');

        // ...and the media KEEPS PLAYING from the PUT's plan: the player's next media fetch is
        // the re-planned URL, and it succeeds. This is the load-bearing "the retry actually
        // recovered through v2" assertion — polled on the response collection it reads.
        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            r.url.includes(replannedPath) &&
                            r.status >= 200 &&
                            r.status < 300
                    ).length,
                { timeout: 60_000 }
            )
            .toBeGreaterThan(0);

        // ---- (c) user stop → DELETE names the same session. --------------------------------
        await stopPlayback(page);
        await expect
            .poll(() => requestsBy(wire, 'DELETE', V2_SESSION_ITEM).length, {
                timeout: 45_000
            })
            .toBeGreaterThan(0);
        const deleteRequest = requestsBy(wire, 'DELETE', V2_SESSION_ITEM)[0];
        console.log(`[lifecycle] DELETE observed: ${deleteRequest.url}`);
        expect(deleteRequest.url).toContain(`/Playback/Sessions/${sessionId}`);

        // ---- (d) the next play press is a NEW attempt. -------------------------------------
        await pressPlay(page, movieIds[1]);
        await expect
            .poll(
                () =>
                    requestsBy(wire, 'POST', PLAYBACK_INFO)
                        .map((r) => attemptIdOf(r.postData))
                        .filter((id) => id !== '' && id !== postAttemptId)
                        .length,
                { timeout: 60_000 }
            )
            .toBeGreaterThan(0);

        // ---- (e, in-cycle half) the whole cycle really ran on the v2 path. -----------------
        await assertV2PathReallyRan(page, wire);
    });

    test('flag OFF: playback works with ZERO /Playback/Sessions traffic and no v2 chunk — the legacy path is untouched', async ({
        page
    }) => {
        test.setTimeout(150_000);
        const wire = instrument(page);

        // Deliberately NO addInitScript: the source default (flag off) is the state under test.
        await signIn(page);
        await pressPlay(page, movieIds[0]);

        // Playback must genuinely start — a vacuously idle page would also show zero v2 traffic.
        // Poll the collections the assertions below read: the PlaybackInfo response and a real
        // media delivery.
        await expect
            .poll(
                () =>
                    wire.responses.filter((r) => PLAYBACK_INFO.test(r.url))
                        .length,
                { timeout: 45_000 }
            )
            .toBeGreaterThan(0);
        await expect
            .poll(
                () => wire.requests.filter((r) => MEDIA_LEG.test(r.url)).length,
                { timeout: 60_000 }
            )
            .toBeGreaterThan(0);

        // The negative space: no session collection POST, no resource PUT/DELETE, no stream
        // descriptor read, no lazy v2 chunk. Every verb checked separately so a failure names
        // exactly what leaked.
        const sessionTraffic = wire.requests.filter(
            (r) =>
                V2_SESSIONS.test(r.url) ||
                V2_SESSION_ITEM.test(r.url) ||
                V2_SESSION_STREAM.test(r.url)
        );
        expect(
            sessionTraffic.map((r) => `${r.method} ${r.url}`),
            'flag OFF must produce no /Playback/Sessions traffic at all'
        ).toEqual([]);
        expect(
            wire.requests.filter((r) => V2_CHUNK.test(r.url)),
            'flag OFF must not even fetch the lazy v2 chunk'
        ).toEqual([]);

        const flag = await page.evaluate(() =>
            localStorage.getItem('enableV2PlaybackPath')
        );
        expect(flag).not.toBe('true');
    });
});

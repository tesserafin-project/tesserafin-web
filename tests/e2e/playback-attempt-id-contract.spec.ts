import { expect, request, test } from '@playwright/test';

/**
 * `PlaybackAttemptId` WIRE CONTRACT — REAL browser E2E, real server.
 *
 * What this file proves (reefin issue #43, client half = reefin-web PR #28):
 *   The client mints ONE opaque `PlaybackAttemptId` per user-initiated playback start
 *   (`playbackmanager.js#playInternal()`) and threads that SAME value onto every request belonging
 *   to that attempt — the `PlaybackInfo` POST and the v2 `POST /Playback/Sessions`. The next play
 *   press mints a NEW one. That asymmetry is the whole feature: it is what lets an operator stitch
 *   a retry chain back to the single user action that caused it, which neither the per-session
 *   `Id` nor the per-request `RequestId` (issue #42) can do.
 *
 * SCOPE — every assertion below is on ACTUALLY CAPTURED NETWORK TRAFFIC. Never on client source,
 * never on a unit-level seam, and there is NO `page.route` request-body rewriting anywhere in this
 * file by design: the point is that the real, unpatched bundle puts these bytes on the wire.
 *
 *   1. Within ONE attempt, the `PlaybackInfo` POST body and the `POST /Playback/Sessions` body
 *      carry the SAME, NON-EMPTY `PlaybackAttemptId`. Both halves matter — asserting equality
 *      alone would be satisfied by two `undefined`s.
 *   2. `POST /Playback/Sessions` answers exactly `200`. Asserted as `=== 200`, not "not 400": a
 *      422 or 500 is a failure, not a fix.
 *   3. TWO DISTINCT attempts — two genuinely separate user-initiated starts, on two different
 *      library items — carry TWO DIFFERENT ids. Never triggered by reloading the module.
 *   4. The server ECHOES the id: `PlaybackSessionResponse.PlaybackAttemptId`
 *      (Reefin.Api/Models/PlaybackSessionDtos/PlaybackSessionResponse.cs) is returned verbatim in
 *      the POST response body, populated unconditionally by `PlaybackSessionResponseMapper`. The
 *      admin diagnostics surface `GET /System/PlaybackDiagnostics/Sessions/{id}` →
 *      `PlaybackDiagnosticDetail.PlaybackAttemptId` is probed as corroboration and its real
 *      finding is printed; it is NOT the load-bearing assertion, because diagnostic retention is
 *      an independent server knob and its absence is not a `PlaybackAttemptId` defect.
 *   5. `RequestId` (issue #42) is per-REQUEST, not per-attempt: the server echoes it on the
 *      `X-Request-Id` response header (`RequestCorrelation.ResponseHeaderName`), and two separate
 *      HTTP requests inside ONE attempt carry two DIFFERENT values while the `PlaybackAttemptId`
 *      of those same two requests is identical.
 *
 * The client v2 flag (`appSettings.enableV2PlaybackPath()`, plain `localStorage`) is turned ON
 * in-browser via `addInitScript`; the source default (OFF) is never modified. The server-side v2
 * ENGINE is a separate runtime knob, flipped through the real admin API exactly as
 * `playback-capabilities-contract.spec.ts` does.
 */

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const E2E_AUTH_HEADER =
    'MediaBrowser Client="Reefin Web E2E", Device="Playwright", DeviceId="reefin-e2e-attempt-id-contract", Version="0.0.0"';

/** The lazily-loaded chunk `playbackSessionV2UrlTrigger.ts` reaches for ONLY when the flag is on.
 * Its presence in captured traffic is the positive control that the flag genuinely took effect. */
const V2_CHUNK = /playback-v2-url\.[a-f0-9]+\.chunk\.js/i;
const V2_SESSIONS = /\/Playback\/Sessions(\?|$)/i;
const PLAYBACK_INFO = /\/Items\/[^/]+\/PlaybackInfo(\?|$)/i;

/** `RequestCorrelation.ResponseHeaderName` in Reefin.Api/Middleware/RequestCorrelation.cs.
 * Playwright lowercases header keys on `response.headers()`. */
const REQUEST_ID_HEADER = 'x-request-id';

interface WireRequest {
    method: string;
    url: string;
    postData: string | null;
}
interface WireResponse {
    status: number;
    url: string;
    headers: Record<string, string>;
}
interface Wire {
    requests: WireRequest[];
    responses: WireResponse[];
    /** Parsed `POST /Playback/Sessions` response bodies, in arrival order. */
    sessionBodies: { status: number; text: string }[];
}

function instrument(page: import('@playwright/test').Page): Wire {
    const wire: Wire = { requests: [], responses: [], sessionBodies: [] };
    page.on('request', (r) =>
        wire.requests.push({
            method: r.method(),
            url: r.url(),
            postData: r.postData()
        })
    );
    page.on('response', (r) =>
        wire.responses.push({
            status: r.status(),
            url: r.url(),
            headers: r.headers()
        })
    );
    page.on('response', async (r) => {
        if (!V2_SESSIONS.test(r.url())) return;
        try {
            wire.sessionBodies.push({
                status: r.status(),
                text: await r.text()
            });
        } catch {
            /* body already consumed / navigation cancelled it */
        }
    });
    return wire;
}

/** Reads `PlaybackAttemptId` out of a captured request body. Returns '' when absent, so a missing
 * key is visibly distinct from a present one and can never satisfy an equality assertion twice. */
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

function postsTo(wire: Wire, re: RegExp): WireRequest[] {
    return wire.requests.filter((r) => r.method === 'POST' && re.test(r.url));
}

function attemptIdsOn(wire: Wire, re: RegExp): string[] {
    return [...new Set(postsTo(wire, re).map((r) => attemptIdOf(r.postData)))];
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

/** Every movie the rig seeded. `ci/serve-e2e.sh` synthesizes two ("Smoke Test Movie",
 * "Transcode Probe"), which is what makes the two-attempt case exercisable on two DIFFERENT
 * items rather than by replaying one. */
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
    if (ids.length === 0) throw new Error('no movie fixture found on the server');
    return ids;
}

/** The v2 EXECUTION engine is kill-switched off by default. Flipped through the real admin API —
 * server runtime configuration, not a source default, and unrelated to the client's own
 * `enableV2PlaybackPath` flag. */
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

async function signIn(page: import('@playwright/test').Page) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
        await page.locator('#txtManualName:visible').fill(USER);
        await page.locator('#txtManualPassword:visible').fill(PASSWORD);
        await page.locator('button[type="submit"]:visible').first().click();
        await page.waitForURL('**/#/home**', { timeout: 20_000 });
    }
    await page.waitForLoadState('networkidle');
}

/**
 * ONE user-initiated playback start: land on the item's detail page and press Play. Each call is a
 * separate `playInternal()` invocation, i.e. a separate ATTEMPT by the definition in
 * `src/scripts/playbackAttemptId.ts` — no module reload, no page reload, no state surgery.
 */
async function pressPlay(
    page: import('@playwright/test').Page,
    itemId: string
) {
    await page.goto(`/#/details?id=${itemId}`);
    await page.waitForLoadState('networkidle');
    const play = page
        .locator('button.btnPlay:visible, button[title*="Play" i]:visible')
        .first();
    await expect(play).toBeVisible({ timeout: 20_000 });
    await play.click();
}

/** Leaves any active player so the NEXT play press is unambiguously a fresh start rather than a
 * resume of the session already in flight. */
async function stopPlayback(page: import('@playwright/test').Page) {
    await page.keyboard.press('Escape');
    await page.goto('/#/home');
    await page.waitForLoadState('networkidle');
}

/** Anti-vacuity, run inside every test: the flag must still be on AND the lazy v2 chunk must
 * actually have been fetched, otherwise every assertion below would silently be about the legacy
 * path, where no `POST /Playback/Sessions` exists at all. */
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

async function waitForSessionPosts(wire: Wire, count: number) {
    await expect
        .poll(() => postsTo(wire, V2_SESSIONS).length, { timeout: 45_000 })
        .toBeGreaterThanOrEqual(count);
}

test.describe('PlaybackAttemptId wire contract', () => {
    let movieIds: string[] = [];

    test.beforeAll(async () => {
        movieIds = await resolveMovieIds();
        await enableV2Engine();
    });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );
    });

    test('one attempt: PlaybackInfo and POST /Playback/Sessions carry the SAME non-empty PlaybackAttemptId, and the POST is exactly 200', async ({
        page
    }) => {
        test.setTimeout(150_000);
        const wire = instrument(page);

        await signIn(page);
        await pressPlay(page, movieIds[0]);

        await assertV2PathReallyRan(page, wire);
        await waitForSessionPosts(wire, 1);

        const infoIds = attemptIdsOn(wire, PLAYBACK_INFO);
        const sessionIds = attemptIdsOn(wire, V2_SESSIONS);
        console.log(
            `[wire] PlaybackInfo PlaybackAttemptId(s)=${JSON.stringify(infoIds)}`
        );
        console.log(
            `[wire] Playback/Sessions PlaybackAttemptId(s)=${JSON.stringify(sessionIds)}`
        );

        // A POST must actually have happened before its body means anything.
        expect(
            postsTo(wire, PLAYBACK_INFO).length,
            'no PlaybackInfo POST reached the wire'
        ).toBeGreaterThan(0);

        // One attempt => exactly one distinct id on each surface.
        expect(infoIds, 'PlaybackInfo posts disagreed on the attempt id').toHaveLength(1);
        expect(sessionIds, 'Playback/Sessions posts disagreed on the attempt id').toHaveLength(1);

        // NON-EMPTY is half the assertion: two absent values would satisfy equality for free.
        expect(
            infoIds[0],
            'PlaybackInfo carried no PlaybackAttemptId'
        ).not.toBe('');
        expect(
            sessionIds[0],
            'Playback/Sessions carried no PlaybackAttemptId'
        ).not.toBe('');
        expect(sessionIds[0]).toBe(infoIds[0]);

        // ---- requirement 2: exactly 200, not merely "not 400". ----
        const sessionResponses = wire.responses.filter((r) =>
            V2_SESSIONS.test(r.url)
        );
        const statuses = sessionResponses.map((r) => r.status);
        console.log(`[wire] Playback/Sessions statuses=${JSON.stringify(statuses)}`);
        expect(
            statuses.length,
            'no Playback/Sessions response was observed'
        ).toBeGreaterThan(0);
        expect(
            statuses,
            `every Playback/Sessions response must be exactly 200; bodies: ${wire.sessionBodies
                .map((b) => `${b.status}: ${b.text.slice(0, 300)}`)
                .join(' | ')}`
        ).toEqual(statuses.map(() => 200));
    });

    test('two separate user-initiated attempts carry two DIFFERENT PlaybackAttemptIds', async ({
        page
    }) => {
        test.setTimeout(180_000);

        // Requirement 3 wants two GENUINELY separate starts. Two different library items is the
        // cleanest form of that — no resume ambiguity, no reload, no module re-import.
        expect(
            movieIds.length,
            'the rig must seed at least two movies to exercise two distinct attempts'
        ).toBeGreaterThanOrEqual(2);

        const wire = instrument(page);

        await signIn(page);

        await pressPlay(page, movieIds[0]);
        await assertV2PathReallyRan(page, wire);
        await waitForSessionPosts(wire, 1);

        await stopPlayback(page);

        // Second user-initiated start, on a different item.
        await pressPlay(page, movieIds[1]);
        await waitForSessionPosts(wire, 2);

        const sessionPosts = postsTo(wire, V2_SESSIONS);
        const ids = sessionPosts.map((r) => attemptIdOf(r.postData));
        console.log(
            `[wire] Playback/Sessions attempt ids in order=${JSON.stringify(ids)}`
        );

        // Two POSTs must genuinely have landed — otherwise "two different ids" is untestable.
        expect(
            sessionPosts.length,
            'fewer than two Playback/Sessions POSTs landed'
        ).toBeGreaterThanOrEqual(2);

        const distinct = [...new Set(ids)];
        expect(distinct.every((id) => id !== '')).toBe(true);
        expect(
            distinct.length,
            `two attempts must mint two ids; observed ${JSON.stringify(ids)}`
        ).toBeGreaterThanOrEqual(2);

        // And the PlaybackInfo surface must agree: two attempts, two ids there too.
        const infoIds = attemptIdsOn(wire, PLAYBACK_INFO).filter((i) => i !== '');
        console.log(`[wire] PlaybackInfo attempt ids=${JSON.stringify(infoIds)}`);
        expect(infoIds.length).toBeGreaterThanOrEqual(2);
    });

    test('the server ECHOES the PlaybackAttemptId back in the PlaybackSessionResponse body', async ({
        page
    }) => {
        test.setTimeout(150_000);
        const wire = instrument(page);

        await signIn(page);
        await pressPlay(page, movieIds[0]);
        await assertV2PathReallyRan(page, wire);
        await waitForSessionPosts(wire, 1);
        await expect
            .poll(() => wire.sessionBodies.length, { timeout: 30_000 })
            .toBeGreaterThan(0);

        const sent = attemptIdOf(postsTo(wire, V2_SESSIONS)[0].postData);
        expect(sent, 'nothing was sent, so nothing can be echoed').not.toBe('');

        const body = JSON.parse(wire.sessionBodies[0].text);
        console.log(
            `[wire] sent PlaybackAttemptId=${sent}  echoed=${JSON.stringify(body?.PlaybackAttemptId)}  sessionId=${body?.Id}`
        );

        // Load-bearing: PlaybackSessionResponseMapper populates this unconditionally from the
        // session record, so an absent/mismatched value here is a real product defect.
        expect(body?.PlaybackAttemptId).toBe(sent);

        // Corroboration on the admin diagnostics surface. Reported, not load-bearing: diagnostic
        // retention is an independent server knob, so a 404/absent detail here is not a
        // PlaybackAttemptId defect and must not be dressed up as one.
        const sessionId = body?.Id;
        const { api, token } = await adminContext();
        const diag = await api.get(
            `/System/PlaybackDiagnostics/Sessions/${sessionId}`,
            { headers: { Authorization: token } }
        );
        const diagText = await diag.text();
        console.log(
            `[diagnostics] GET /System/PlaybackDiagnostics/Sessions/${sessionId} -> ${diag.status()}`
        );
        if (diag.ok()) {
            const detail = JSON.parse(diagText);
            console.log(
                `[diagnostics] PlaybackDiagnosticDetail.PlaybackAttemptId=${JSON.stringify(detail?.PlaybackAttemptId)}`
            );
            // Only assert once the surface is genuinely reachable: if it answers, it must answer
            // with the SAME id — a diagnostics view that files the attempt under a different
            // value would defeat the entire purpose of the field.
            expect(detail?.PlaybackAttemptId).toBe(sent);
        } else {
            console.log(
                `[diagnostics] not exposed for this session (status ${diag.status()}): ${diagText.slice(0, 300)}`
            );
        }
        await api.dispose();
    });

    test('RequestId is per-REQUEST: X-Request-Id differs between two requests of the SAME attempt', async ({
        page
    }) => {
        test.setTimeout(150_000);
        const wire = instrument(page);

        await signIn(page);
        await pressPlay(page, movieIds[0]);
        await assertV2PathReallyRan(page, wire);
        await waitForSessionPosts(wire, 1);

        const infoResponse = wire.responses.find((r) =>
            PLAYBACK_INFO.test(r.url)
        );
        const sessionResponse = wire.responses.find((r) =>
            V2_SESSIONS.test(r.url)
        );
        expect(infoResponse, 'no PlaybackInfo response captured').toBeTruthy();
        expect(
            sessionResponse,
            'no Playback/Sessions response captured'
        ).toBeTruthy();

        const infoRid = infoResponse!.headers[REQUEST_ID_HEADER];
        const sessionRid = sessionResponse!.headers[REQUEST_ID_HEADER];
        console.log(
            `[wire] X-Request-Id  PlaybackInfo=${infoRid}  Playback/Sessions=${sessionRid}`
        );

        // The header must exist at all — RequestCorrelationMiddleware sets it on OnStarting for
        // every response, including error ones.
        expect(
            infoRid,
            `PlaybackInfo response carried no ${REQUEST_ID_HEADER}; headers: ${JSON.stringify(infoResponse!.headers)}`
        ).toBeTruthy();
        expect(
            sessionRid,
            `Playback/Sessions response carried no ${REQUEST_ID_HEADER}; headers: ${JSON.stringify(sessionResponse!.headers)}`
        ).toBeTruthy();

        // The discriminating assertion: two requests, two RequestIds...
        expect(sessionRid).not.toBe(infoRid);

        // ...while the PlaybackAttemptId of those same two requests is IDENTICAL. This is the
        // per-request vs per-attempt distinction the server documents, proven on real traffic.
        const infoAttempt = attemptIdsOn(wire, PLAYBACK_INFO);
        const sessionAttempt = attemptIdsOn(wire, V2_SESSIONS);
        expect(infoAttempt).toHaveLength(1);
        expect(sessionAttempt).toHaveLength(1);
        expect(infoAttempt[0]).not.toBe('');
        expect(sessionAttempt[0]).toBe(infoAttempt[0]);

        // Broader corroboration: across the whole capture, RequestIds are not a constant.
        const allRids = [
            ...new Set(
                wire.responses
                    .map((r) => r.headers[REQUEST_ID_HEADER])
                    .filter(Boolean)
            )
        ];
        console.log(`[wire] distinct X-Request-Id count=${allRids.length}`);
        expect(allRids.length).toBeGreaterThan(1);
    });
});

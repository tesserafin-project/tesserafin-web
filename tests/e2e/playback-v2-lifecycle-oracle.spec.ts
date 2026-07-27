import { execFileSync } from 'node:child_process';
import { expect, test } from './support/origin-inventory';
import { request } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * THE HARD ORACLE for the v2 playback session lifecycle (all3f0r1/reefin#43).
 *
 * `playback-v2-lifecycle.spec.ts` (this file's predecessor on the same branch) narrates the cycle:
 * a good deal of what it learns it PRINTS — the session id, the attempt ids, the request ids, the
 * re-planned path — and printing is not a verdict. This file is the same cycle with every
 * observation promoted to a hard assertion, plus the checks the narrative version never made at
 * all, all of which need evidence from OUTSIDE the browser:
 *
 *   - the first plan is genuinely `DirectPlay` and the re-plan is genuinely `Transcode`
 *     (`PlaybackSessionResponse.Method`, `PlaybackDecisionPlaybackMethod`), and the SessionId
 *     survives the `PUT`;
 *   - both stream reads are served BY V2, not by a legacy fallback
 *     (`PlaybackSessionStreamDescriptor.ServedBy` > `PlaybackSessionResponse.LegacyDecisionVersion`
 *     = 0, and `FallbackReason` empty);
 *   - the bytes the player actually received are REALLY TRANSCODED — ffprobe/ffmpeg run against the
 *     exact media URL captured off the wire, asserting an HLS/MPEG-TS container the source `.mp4`
 *     could not have produced and video frames that genuinely decode. A `200` on the `PUT` and a
 *     descriptor body are claims; a decoded frame is evidence;
 *   - the SERVER agrees, in its own log read over `/System/Logs`: the issue-#43 lifecycle lines
 *     (`created` / `replaced` / `deleted`) name this session — the `deleted` one also naming the
 *     attempt — while `served from legacy`, `PlanNotExecutable` and `already gone` are absent;
 *   - the `DELETE` acts on a session proven live from outside the browser immediately before the
 *     stop, and answers exactly 204;
 *   - a late `DELETE` naming a dead session cannot take a NEWER attempt down with it.
 *
 * DELIBERATELY NOT MOCKED. There is exactly one `page.route`, on a media URL, and it `abort()`s —
 * it fails a delivery, which is how a real `onPlaybackError` is provoked without patching client
 * source. `POST`/`PUT`/`GET .../Stream`/`DELETE` are never intercepted, never rewritten, never
 * fulfilled from a fixture. Every status, body and header asserted here came off a real socket
 * from a real Reefin server (`reefin/ci/serve-e2e.sh`), and the transcoded bytes came out of a
 * real ffmpeg.
 *
 * RIG: `reefin/ci/serve-e2e.sh --webdir <this repo>/dist --exec 'npx playwright test ...'`.
 * `TESSERAFIN_E2E_BASE_URL` / `TESSERAFIN_E2E_USER` / `TESSERAFIN_E2E_PASSWORD` come from it. The fixtures this
 * file needs are the rig's own: the H264 + AAC in MP4 movie (the DIRECT PLAY fixture, the only one
 * whose first plan can legitimately be `DirectPlay`) and a second movie for the new-attempt leg.
 *
 * NOTHING here is allowed to pass by absence: every negative assertion (no `served from legacy`, no
 * `PlanNotExecutable`, no `already gone`, no v2 traffic when the flag is off) is paired with a
 * positive control proving the channel it reads was live and non-empty at the time.
 *
 * WHY THE LIFECYCLE TEST USES `expect.soft` AND A STAGE LEDGER, AND WHY THAT IS NOT A SOFTENING:
 * the chain is ONE session, so it has to be one test, and a plain `expect` aborts at the first
 * violation — which would mean a failure at stage 3 hides whether stages 5..11 also fail. Every
 * condition below is still asserted and still fails the test; `expect.soft` only changes WHEN the
 * runner stops, so a single red run reports the complete set of violations instead of the first
 * one. Stages that cannot even be entered (no `PUT` ever arrived, so there is nothing to assert
 * about it) are recorded in a ledger which is compared, HARD, against the full chain at the end —
 * a stage that never happened is a failure naming itself, never a silent skip.
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const E2E_AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-v2-oracle", Version="0.0.0"';

/** The lazily-loaded chunk both v2 triggers reach for ONLY when the client flag is on. */
const V2_CHUNK = /playback-v2-url\.[a-f0-9]+\.chunk\.js/i;
const V2_SESSIONS = /\/Playback\/Sessions(\?|$)/i;
const V2_SESSION_ITEM = /\/Playback\/Sessions\/[^/?]+(\?|$)/i;
const V2_SESSION_STREAM = /\/Playback\/Sessions\/[^/?]+\/Stream(\?|$)/i;
const PLAYBACK_INFO = /\/Items\/[^/]+\/PlaybackInfo(\?|$)/i;
const MEDIA_LEG = /\/videos\/[^/]+\/(stream|master|main)\./i;
/** The HLS delivery routes — the ONLY shape a transcode can be served over. A `stream.<ext>` URL is
 * the static-file route: no ffmpeg is involved there, whatever a descriptor claims. */
const HLS_LEG = /\/videos\/[^/]+\/(master|main)\.m3u8/i;

/** `RequestCorrelation.ResponseHeaderName`; Playwright lowercases header keys. */
const REQUEST_ID_HEADER = 'x-request-id';

/** `PlaybackSessionResponse.LegacyDecisionVersion` — the sentinel meaning "a legacy projection".
 * `ServedBy` equal to it is precisely "NOT served by v2". */
const LEGACY_DECISION_VERSION = 0;

/** The chain the test must traverse. Compared, hard, against what actually happened. */
const CHAIN = [
    'PlaybackInfo',
    'POST Sessions',
    'GET Stream (DirectPlay plan)',
    'real product error',
    'PUT Sessions/{id}',
    'GET Stream (re-planned)',
    'transcoded bytes delivered',
    'DELETE 204 on a live session',
    'distinct X-Request-Id per request',
    'new attempt id on the next play',
    'server log agrees'
] as const;

// ---------------------------------------------------------------------------------------------
// Wire capture — observe-only. Nothing below ever mutates a request or a response.
// ---------------------------------------------------------------------------------------------

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
    sessionBodies: CapturedBody[];
    streamBodies: CapturedBody[];
    /** Browser console text, in order. The teardown `DELETE` goes out as a keepalive `fetch`
     * that Playwright's request instrumentation does not surface (see stage 8), so the client's
     * own dispatch line is the only place the CLIENT side of that request is observable — which
     * trigger issued it, and whether it was issued at all. `tesserafin-web#60`. */
    console: string[];
}

function instrument(page: Page): Wire {
    const wire: Wire = {
        requests: [],
        responses: [],
        sessionBodies: [],
        streamBodies: [],
        console: []
    };
    page.on('console', (m) => wire.console.push(m.text()));
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
            (isStream ? wire.streamBodies : wire.sessionBodies).push({
                method: r.request().method(),
                status: r.status(),
                url: r.url(),
                text: await r.text()
            });
        } catch {
            /* body already consumed / navigation cancelled it */
        }
    });
    return wire;
}

/** Reads `PlaybackAttemptId` out of a captured request body. Returns '' when absent, so a missing
 * key is visibly distinct and can never satisfy an equality assertion twice over. */
function attemptIdOf(postData: string | null): string {
    if (!postData) return '';
    try {
        const id = JSON.parse(postData)?.PlaybackAttemptId;
        return typeof id === 'string' ? id : '';
    } catch {
        return '';
    }
}

/** Parses a captured JSON body without ever throwing — a malformed body must surface as a failed
 * assertion on the value that mattered, not as an exception that skips the rest of the chain. */
function jsonOf(text: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
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

function responsesBy(wire: Wire, method: string, re: RegExp): WireResponse[] {
    return wire.responses.filter(
        (r) =>
            r.method === method &&
            re.test(r.url) &&
            !V2_SESSION_STREAM.test(r.url)
    );
}

function streamResponses(wire: Wire): WireResponse[] {
    return wire.responses.filter(
        (r) => r.method === 'GET' && V2_SESSION_STREAM.test(r.url)
    );
}

/**
 * Waits for a condition and REPORTS whether it held, instead of throwing. Every call site turns the
 * result straight into an assertion — the condition is never merely "hoped for" — but a stage that
 * never happens no longer aborts the run before the later stages have been observed.
 */
async function waitFor(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs: number
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await predicate()) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

// ---------------------------------------------------------------------------------------------
// Server-side evidence: the real admin API and the real server log file.
// ---------------------------------------------------------------------------------------------

interface Admin {
    api: APIRequestContext;
    userId: string;
    token: string;
}

async function adminContext(): Promise<Admin> {
    const api = await request.newContext({ baseURL: BASE_URL });
    const authResponse = await api.post('/Users/AuthenticateByName', {
        headers: { Authorization: E2E_AUTH_HEADER },
        data: { Username: USER, Pw: PASSWORD }
    });
    expect(
        authResponse.status(),
        `the rig's admin credentials (${USER}) must authenticate — without them nothing below can be observed`
    ).toBe(200);
    const auth = await authResponse.json();
    return {
        api,
        userId: String(auth.User.Id),
        token: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
    };
}

interface MovieFixture {
    id: string;
    name: string;
    container: string;
    videoCodec: string;
}

/** Every movie the rig seeded, with the source container/codec the server indexed — the baseline
 * the delivered transcode is later proven to DIFFER from. */
async function resolveMovies(admin: Admin): Promise<MovieFixture[]> {
    const response = await admin.api.get('/Items', {
        params: {
            userId: admin.userId,
            recursive: 'true',
            includeItemTypes: 'Movie',
            sortBy: 'SortName',
            fields: 'MediaSources'
        },
        headers: { Authorization: admin.token }
    });
    expect(response.status(), 'GET /Items must answer 200').toBe(200);
    const body = await response.json();
    const movies: MovieFixture[] = (body.Items ?? []).map(
        (item: {
            Id: string;
            Name: string;
            MediaSources?: {
                Container?: string;
                MediaStreams?: { Type?: string; Codec?: string }[];
            }[];
        }) => {
            const source = item.MediaSources?.[0];
            const video = (source?.MediaStreams ?? []).find(
                (s) => s.Type === 'Video'
            );
            return {
                id: String(item.Id),
                name: String(item.Name),
                container: String(source?.Container ?? ''),
                videoCodec: String(video?.Codec ?? '')
            };
        }
    );
    expect(
        movies.length,
        'the rig must have seeded at least two movies (ci/serve-e2e.sh seeds exactly two)'
    ).toBeGreaterThanOrEqual(2);
    return movies;
}

/** The v2 EXECUTION engine, flipped through the real admin API. Re-asserted here because sibling
 * specs legitimately leave the engine on `Legacy`, and file order is not this file's to assume. */
async function enableV2Engine(admin: Admin) {
    const current = await admin.api.get('/System/Configuration', {
        headers: { Authorization: admin.token }
    });
    expect(current.status(), 'GET /System/Configuration must answer 200').toBe(
        200
    );
    const cfg = await current.json();
    cfg.PlaybackShadow = { ...(cfg.PlaybackShadow ?? {}), Mode: 'V2' };
    const posted = await admin.api.post('/System/Configuration', {
        headers: { Authorization: admin.token },
        data: cfg
    });
    expect(
        posted.status(),
        'the v2 engine must be enablable through the real admin API'
    ).toBeLessThan(300);
}

/**
 * The server's OWN account of what happened, read over the real `/System/Logs` API — the only
 * channel in which the issue-#43 lifecycle lines and the `served from legacy` / `already gone`
 * failure lines exist at all. Returns the newest log file's full text.
 */
async function readServerLog(admin: Admin): Promise<string> {
    const list = await admin.api.get('/System/Logs', {
        headers: { Authorization: admin.token }
    });
    expect(
        list.status(),
        'GET /System/Logs must answer 200 — every log assertion below reads through it'
    ).toBe(200);
    const files = (await list.json()) as {
        Name: string;
        DateModified: string;
    }[];
    expect(
        files.length,
        'the server must be writing at least one log file (the rig sets TESSERAFIN_LOG_DIR)'
    ).toBeGreaterThan(0);
    const newest = [...files].sort((a, b) =>
        String(a.DateModified).localeCompare(String(b.DateModified))
    )[files.length - 1];
    const content = await admin.api.get('/System/Logs/Log', {
        params: { name: newest.Name },
        headers: { Authorization: admin.token }
    });
    expect(
        content.status(),
        `GET /System/Logs/Log?name=${newest.Name} must answer 200`
    ).toBe(200);
    return await content.text();
}

/** The slice of the server log written SINCE `baseline` was taken, so a global assertion
 * ("no `PlanNotExecutable` anywhere") is about this test's own window and not about whatever a
 * sibling spec did ten minutes ago. */
function logTail(full: string, baseline: string): string {
    return full.startsWith(baseline) ? full.slice(baseline.length) : full;
}

function linesMatching(log: string, ...needles: string[]): string[] {
    return log
        .split('\n')
        .filter((line) => needles.every((n) => line.includes(n)));
}

// ---------------------------------------------------------------------------------------------
// Real transcoded bytes: ffprobe/ffmpeg against the URL the player actually fetched.
// ---------------------------------------------------------------------------------------------

interface ProbeResult {
    ok: boolean;
    error: string;
    formatName: string;
    hasVideo: boolean;
}

function ffprobe(url: string): ProbeResult {
    try {
        const raw = execFileSync(
            'ffprobe',
            [
                '-v',
                'error',
                '-print_format',
                'json',
                '-show_format',
                '-show_streams',
                '-i',
                url
            ],
            { encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }
        );
        const parsed = JSON.parse(raw) as {
            format?: { format_name?: string };
            streams?: { codec_type?: string }[];
        };
        return {
            ok: true,
            error: '',
            formatName: String(parsed.format?.format_name ?? ''),
            hasVideo: (parsed.streams ?? []).some(
                (s) => s.codec_type === 'video'
            )
        };
    } catch (error) {
        return {
            ok: false,
            error: String((error as Error)?.message ?? error).slice(0, 500),
            formatName: '',
            hasVideo: false
        };
    }
}

/** Frames that genuinely DECODED out of the delivered stream. A manifest that parses proves the
 * server wrote a manifest; a decoded frame proves ffmpeg produced real picture data. Returns -1
 * when ffmpeg could not read the stream at all, which is itself a failing observation. */
function decodedFrameCount(url: string): number {
    try {
        const output = execFileSync(
            'ffmpeg',
            [
                '-v',
                'error',
                '-hide_banner',
                '-t',
                '3',
                '-i',
                url,
                '-map',
                '0:v:0',
                '-f',
                'null',
                '-progress',
                'pipe:1',
                '-'
            ],
            {
                encoding: 'utf8',
                timeout: 180_000,
                maxBuffer: 32 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );
        const frames = [...output.matchAll(/^frame=\s*(\d+)$/gm)].map((m) =>
            Number(m[1])
        );
        return frames.length === 0 ? 0 : Math.max(...frames);
    } catch {
        return -1;
    }
}

// ---------------------------------------------------------------------------------------------
// Browser driving — a real user, a real play button, a real stop.
// ---------------------------------------------------------------------------------------------

async function signIn(page: Page) {
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

/** ONE user-initiated playback start — a separate `playInternal()`, i.e. a separate ATTEMPT by
 * `playbackAttemptId.ts`'s definition.
 *
 * The 60 s budget on the play button is a READINESS WAIT, not an assertion about the product: the
 * first details view of a run pays for the SPA's cold chunk load against a freshly booted server,
 * and a measured run aborted here at 20 s while the identical navigation later in the same run
 * rendered in under two seconds. Waiting longer changes nothing about what is asserted — the button
 * must still appear, and the chain assertions downstream are untouched. */
async function pressPlay(page: Page, itemId: string) {
    const play = page
        .locator('button.btnPlay:visible, button[title*="Play" i]:visible')
        .first();
    // A full `page.goto` re-bootstraps the SPA from persisted credentials, and `jellyfin-apiclient`
    // writes those asynchronously AFTER the route has already flipped to `#/home`. A `goto` that
    // wins that race boots an unauthenticated app and lands on the login form, where no play button
    // exists and none ever will — two measured runs died exactly there, screenshot and all. So a
    // bounce back to login is treated as what it is (the app not being ready yet) and re-driven
    // through the real login form. This is a readiness retry on the way IN to the scenario; it
    // asserts nothing, weakens nothing, and every assertion of the chain runs after it.
    for (let attempt = 0; attempt < 3; attempt++) {
        await page.goto(`/#/details?id=${itemId}`);
        const ready = await Promise.race([
            play
                .waitFor({ state: 'visible', timeout: 30_000 })
                .then(() => 'play' as const)
                .catch(() => 'timeout' as const),
            page
                .waitForURL('**/#/login**', { timeout: 30_000 })
                .then(() => 'login' as const)
                .catch(() => 'timeout' as const)
        ]);
        if (ready === 'play') {
            await play.click();
            return;
        }
        await signIn(page);
    }
    // Out of retries: assert on the play button so the failure names the real condition.
    await expect(play).toBeVisible({ timeout: 30_000 });
    await play.click();
}

async function stopPlayback(page: Page) {
    await page.keyboard.press('Escape');
    await page.goto('/#/home');
}

/** Anti-vacuity: without these two, every v2 assertion in this file would be an assertion about
 * the legacy path, where no `/Playback/Sessions` traffic exists at all and every negative passes
 * for free. */
async function assertV2PathReallyRan(page: Page, wire: Wire) {
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

// ---------------------------------------------------------------------------------------------

test.describe('v2 playback session lifecycle — hard oracle (#43)', () => {
    let admin: Admin;
    let directPlayMovie: MovieFixture;
    let otherMovie: MovieFixture;

    test.beforeAll(async () => {
        admin = await adminContext();
        const movies = await resolveMovies(admin);
        // The rig's DIRECT PLAY fixture is the H264-in-MP4 one; the transcode probe (mpeg4 + ac3)
        // can never yield a DirectPlay first plan, so naming it here would make the first leg of
        // the chain untestable by construction.
        const found = movies.find(
            (m) => m.container.includes('mp4') && m.videoCodec === 'h264'
        );
        expect(
            found,
            `no H264-in-MP4 movie fixture found — the DirectPlay leg of the chain has no subject. Seen: ${movies
                .map((m) => `${m.name} (${m.videoCodec}/${m.container})`)
                .join(', ')}`
        ).toBeTruthy();
        directPlayMovie = found as MovieFixture;
        const second = movies.find((m) => m.id !== directPlayMovie.id);
        expect(
            second,
            'a second, distinct movie fixture is required for the new-attempt leg'
        ).toBeTruthy();
        otherMovie = second as MovieFixture;
        await enableV2Engine(admin);
    });

    test.afterAll(async () => {
        await admin?.api.dispose();
    });

    test('POST → GET Stream (DirectPlay) → real error → PUT (Transcode) → v2-served, really transcoded bytes → DELETE 204, all under one attempt id', async ({
        page
    }) => {
        test.setTimeout(600_000);
        const reached: string[] = [];
        const logBaseline = await readServerLog(admin);
        const wire = instrument(page);

        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );

        // Fail the FIRST media delivery exactly once, then let everything through untouched. This
        // is the "REAL product error" of the chain: a genuine delivery failure the player observes
        // as `onPlaybackError`. No request body is rewritten and no v2 endpoint is intercepted.
        let abortedUrl = '';
        await page.route(MEDIA_LEG, (route) => {
            if (!abortedUrl) {
                abortedUrl = route.request().url();
                return route.abort('failed');
            }
            return route.continue();
        });

        await signIn(page);
        await pressPlay(page, directPlayMovie.id);
        await assertV2PathReallyRan(page, wire);

        // ---- 1. POST Playback/PlaybackInfo -------------------------------------------------
        const sawInfo = await waitFor(
            () => requestsBy(wire, 'POST', PLAYBACK_INFO).length > 0,
            60_000
        );
        expect
            .soft(sawInfo, 'a POST /Items/{id}/PlaybackInfo must be issued')
            .toBe(true);
        let infoAttemptId = '';
        if (sawInfo) {
            reached.push('PlaybackInfo');
            infoAttemptId = attemptIdOf(
                requestsBy(wire, 'POST', PLAYBACK_INFO)[0].postData
            );
            expect
                .soft(
                    infoAttemptId,
                    'PlaybackInfo must carry the PlaybackAttemptId — it is the first request of the attempt (#43)'
                )
                .not.toBe('');
        }

        // ---- 2. POST Playback/Sessions -----------------------------------------------------
        const sawPost = await waitFor(
            () =>
                wire.sessionBodies.filter((b) => b.method === 'POST').length >
                0,
            60_000
        );
        expect
            .soft(sawPost, 'a POST /Playback/Sessions must be issued')
            .toBe(true);
        let sessionId = '';
        let postAttemptId = '';
        let postJson: Record<string, unknown> = {};
        if (sawPost) {
            const postBody = wire.sessionBodies.filter(
                (b) => b.method === 'POST'
            )[0];
            expect
                .soft(
                    postBody.status,
                    `POST /Playback/Sessions must answer exactly 200; body: ${postBody.text.slice(0, 400)}`
                )
                .toBe(200);
            postJson = jsonOf(postBody.text);
            sessionId = String(postJson.Id ?? '');
            expect
                .soft(sessionId, 'the POST returned no session Id')
                .not.toBe('');
            postAttemptId = attemptIdOf(
                requestsBy(wire, 'POST', V2_SESSIONS)[0]?.postData ?? null
            );
            expect
                .soft(
                    postAttemptId,
                    'the POST /Playback/Sessions body carried no PlaybackAttemptId'
                )
                .not.toBe('');
            expect
                .soft(
                    postAttemptId,
                    'the POST must belong to the SAME attempt as the PlaybackInfo that preceded it'
                )
                .toBe(infoAttemptId);
            expect
                .soft(
                    String(postJson.PlaybackAttemptId ?? ''),
                    'the POST response must echo the attempt id back verbatim (#43)'
                )
                .toBe(postAttemptId);
            if (sessionId !== '') reached.push('POST Sessions');
        }

        // ---- 3. GET Playback/Sessions/{id}/Stream giving a DirectPlay plan ------------------
        expect
            .soft(
                String(postJson.Method ?? ''),
                `the first plan for the H264/MP4 fixture "${directPlayMovie.name}" must be DirectPlay — the chain under test is DirectPlay → real error → Transcode`
            )
            .toBe('DirectPlay');
        const sawFirstStream = await waitFor(
            () => wire.streamBodies.length > 0,
            60_000
        );
        expect
            .soft(
                sawFirstStream,
                'the client must read the plan back through GET /Playback/Sessions/{id}/Stream'
            )
            .toBe(true);
        if (sawFirstStream) {
            const firstStream = wire.streamBodies[0];
            expect
                .soft(
                    firstStream.status,
                    `the first GET .../Stream must answer 200; body: ${firstStream.text.slice(0, 400)}`
                )
                .toBe(200);
            expect
                .soft(
                    firstStream.url,
                    'the first stream read must address the session the POST created'
                )
                .toContain(`/Playback/Sessions/${sessionId}/Stream`);
            const firstDescriptor = jsonOf(firstStream.text);
            expect
                .soft(
                    Number(firstDescriptor.ServedBy ?? LEGACY_DECISION_VERSION),
                    `the first stream descriptor must be served BY V2, not by a legacy fallback (ServedBy > ${LEGACY_DECISION_VERSION}); FallbackReason=${firstDescriptor.FallbackReason}`
                )
                .toBeGreaterThan(LEGACY_DECISION_VERSION);
            expect
                .soft(
                    firstDescriptor.FallbackReason ?? null,
                    'the DirectPlay leg must carry NO fallback reason'
                )
                .toBeNull();
            reached.push('GET Stream (DirectPlay plan)');
        }

        // ---- 4. A REAL product error surfaces ----------------------------------------------
        const sawError = await waitFor(() => abortedUrl !== '', 30_000);
        expect
            .soft(
                sawError,
                'no media delivery was ever attempted, so no real playback error could be provoked'
            )
            .toBe(true);
        if (sawError) reached.push('real product error');

        // ---- 5. PUT Playback/Sessions/{id} re-planning to Transcode ------------------------
        const sawPut = await waitFor(
            () => requestsBy(wire, 'PUT', V2_SESSION_ITEM).length > 0,
            30_000
        );
        expect
            .soft(
                sawPut,
                'the media failure must drive a PUT /Playback/Sessions/{id} re-plan — without it there is no v2 recovery at all'
            )
            .toBe(true);
        if (sawPut) {
            const putRequest = requestsBy(wire, 'PUT', V2_SESSION_ITEM)[0];
            expect
                .soft(
                    putRequest.url,
                    'the PUT must address the session the POST created'
                )
                .toContain(`/Playback/Sessions/${sessionId}`);
            const putAttemptId = attemptIdOf(putRequest.postData);
            expect
                .soft(
                    putAttemptId,
                    'the PUT carried no PlaybackAttemptId — the retry would be unjoinable to the attempt that provoked it'
                )
                .not.toBe('');
            expect
                .soft(
                    putAttemptId,
                    'the retry belongs to the attempt that started playback: SAME PlaybackAttemptId as the POST'
                )
                .toBe(postAttemptId);

            const sawPutBody = await waitFor(
                () =>
                    wire.sessionBodies.filter((b) => b.method === 'PUT')
                        .length > 0,
                30_000
            );
            expect
                .soft(sawPutBody, 'the PUT produced no response body')
                .toBe(true);
            if (sawPutBody) {
                const putBody = wire.sessionBodies.filter(
                    (b) => b.method === 'PUT'
                )[0];
                expect
                    .soft(
                        putBody.status,
                        `PUT /Playback/Sessions/{id} must answer exactly 200 (422 = the server found nothing plannable); body: ${putBody.text.slice(0, 600)}`
                    )
                    .toBe(200);
                const putJson = jsonOf(putBody.text);
                expect
                    .soft(
                        String(putJson.Id ?? ''),
                        'the PUT must preserve the SessionId — a re-plan replaces the plan, never the session'
                    )
                    .toBe(sessionId);
                expect
                    .soft(
                        String(putJson.PlaybackAttemptId ?? ''),
                        'the PUT response must echo the SAME attempt id'
                    )
                    .toBe(postAttemptId);
                expect
                    .soft(
                        String(putJson.Method ?? ''),
                        `the re-plan must land on Transcode — DirectPlay failed to deliver; body: ${putBody.text.slice(0, 600)}`
                    )
                    .toBe('Transcode');
                reached.push('PUT Sessions/{id}');
            }
        }

        // ---- 6. GET Stream served by v2 ----------------------------------------------------
        const sawReplanStream = await waitFor(
            () => wire.streamBodies.length >= 2,
            30_000
        );
        expect
            .soft(
                sawReplanStream,
                'the re-planned stream must be read back through a second GET .../Stream'
            )
            .toBe(true);
        let replannedPath = '';
        if (sawReplanStream) {
            const replanStream =
                wire.streamBodies[wire.streamBodies.length - 1];
            expect
                .soft(
                    replanStream.status,
                    `the post-PUT GET .../Stream must answer 200; body: ${replanStream.text.slice(0, 400)}`
                )
                .toBe(200);
            const replanDescriptor = jsonOf(replanStream.text);
            expect
                .soft(
                    Number(
                        replanDescriptor.ServedBy ?? LEGACY_DECISION_VERSION
                    ),
                    `the re-planned stream must be served BY V2 (ServedBy > ${LEGACY_DECISION_VERSION}); FallbackReason=${replanDescriptor.FallbackReason}`
                )
                .toBeGreaterThan(LEGACY_DECISION_VERSION);
            expect
                .soft(
                    replanDescriptor.FallbackReason ?? null,
                    'the re-planned stream must carry NO fallback reason — any value here means v2 did not serve it'
                )
                .toBeNull();
            replannedPath = String(replanDescriptor.Url ?? '').split('?')[0];
            expect
                .soft(
                    replannedPath,
                    'the post-PUT stream descriptor carried no Url'
                )
                .not.toBe('');
            if (replannedPath !== '') reached.push('GET Stream (re-planned)');
        }

        // ---- 7. Actually transcoded bytes ---------------------------------------------------
        if (replannedPath !== '') {
            const delivered = () =>
                wire.responses.filter(
                    (r) =>
                        r.url.includes(replannedPath) &&
                        r.status >= 200 &&
                        r.status < 300
                );
            const sawDelivery = await waitFor(
                () => delivered().length > 0,
                30_000
            );
            expect
                .soft(
                    sawDelivery,
                    'the player never successfully fetched the re-planned URL — a descriptor nobody fetches is a claim, not a delivery'
                )
                .toBe(true);
            if (sawDelivery) {
                const deliveredUrl = delivered()[0].url;
                expect
                    .soft(
                        deliveredUrl,
                        `a transcode can only be delivered over the HLS routes; the player fetched ${deliveredUrl}, which is the static-file route — no ffmpeg is involved there whatever the descriptor claimed`
                    )
                    .toMatch(HLS_LEG);

                const probe = ffprobe(deliveredUrl);
                expect
                    .soft(
                        probe.ok,
                        `ffprobe could not read the delivered stream (${deliveredUrl}): ${probe.error}`
                    )
                    .toBe(true);
                expect
                    .soft(
                        probe.hasVideo,
                        `ffprobe found no video stream in the delivered transcode (${deliveredUrl}); format=${probe.formatName}`
                    )
                    .toBe(true);
                expect
                    .soft(
                        probe.formatName,
                        `the delivered stream's container (${probe.formatName}) must be the HLS/MPEG-TS output of a live ffmpeg — the source fixture is "${directPlayMovie.container}", so an identical container would mean the original file was handed over untouched`
                    )
                    .toMatch(/hls|mpegts/i);
                expect
                    .soft(
                        probe.formatName.includes(directPlayMovie.container),
                        `the delivered container must differ from the source container "${directPlayMovie.container}"`
                    )
                    .toBe(false);
                const frames = decodedFrameCount(deliveredUrl);
                expect
                    .soft(
                        frames,
                        'ffmpeg decoded no video frames out of the delivered stream (-1 = it could not read it at all) — a manifest that parses is not transcoded picture data'
                    )
                    .toBeGreaterThan(0);
                if (probe.ok && frames > 0)
                    reached.push('transcoded bytes delivered');
            }
        }

        // ---- 8. DELETE acts on a STILL-LIVE session, returning 204 --------------------------
        // Liveness proven independently, from outside the browser, immediately before the stop.
        const preStop = await admin.api.get(
            `/Playback/Sessions/${sessionId}/Stream`,
            { headers: { Authorization: admin.token } }
        );
        expect
            .soft(
                preStop.status(),
                'the session must still be LIVE at the moment the user stops — otherwise the DELETE below tests nothing'
            )
            .toBe(200);

        await stopPlayback(page);

        // #60: the CLIENT half of the teardown, which the wire cannot see.
        //
        // `stopPlayback()` presses Escape and navigates immediately, and that navigation is what
        // ends playback here: `beforeunload` -> `onAppClose()` -> the stop path, then `pagehide`
        // -> the backstop. Which of the two dispatches is a property of that ordering, not of
        // the contract — when the manager no longer considers itself playing at `beforeunload`,
        // the backstop is legitimately the only route left, and clause 3 of the #60 contract
        // says so. What the contract DOES fix is that the request is dispatched exactly once and
        // over a transport the navigation cannot abort.
        //
        // Before the fix this list could be empty while the session survived to its TTL: the
        // stop path issued an ordinary `fetch` that the navigation killed, and because the
        // record was already marked released the `pagehide` backstop issued nothing at all.
        const teardownDispatch = wire.console
            .filter(
                (l) =>
                    l.includes('dispatched keepalive') && l.includes(sessionId)
            )
            .map((l) => /\(([a-z-]+)\) dispatched keepalive/.exec(l)?.[1] ?? '')
            .filter(Boolean);
        expect
            .soft(
                teardownDispatch.length,
                `the client must dispatch the teardown DELETE for this session exactly once — 0 means it never left the browser (the #60 defect), more than 1 means the single-flight guard broke; dispatches seen: ${JSON.stringify(teardownDispatch)}`
            )
            .toBe(1);
        expect
            .soft(
                ['stopped', 'error', 'pagehide', 'visibilitychange'],
                'the teardown must come from a recognised lifecycle trigger'
            )
            .toContain(teardownDispatch[0]);

        // The teardown DELETE is issued by `playbackSessionTeardown.ts` as a `keepalive` `fetch`,
        // which Playwright's page instrumentation does not surface: a measured run in which the
        // server logged the DELETE 180 ms after the POST recorded NO DELETE at all on the wire, and
        // the trace confirmed only this file's own admin-context DELETE. So the DELETE is asserted
        // where it is genuinely observable — the server's own log, whose two outcomes are exactly
        // the controller's two return paths: a `deleted` line IS the 204, an `already gone` line IS
        // the 404. That is stronger evidence than the status line, not weaker: it is the server
        // stating which branch it took.
        const sawDeleteLine = await waitFor(
            async () =>
                linesMatching(
                    logTail(await readServerLog(admin), logBaseline),
                    sessionId,
                    'deleted'
                ).length > 0,
            60_000
        );
        expect
            .soft(
                sawDeleteLine,
                'a user stop must DELETE /Playback/Sessions/{id} and the server must record it as deleted — the 204 branch of the controller'
            )
            .toBe(true);

        // When the DELETE IS visible on the wire (it is not, through a keepalive fetch), its status
        // must be 204. Conditional on observability, never on the outcome.
        const wireDeletes = responsesBy(wire, 'DELETE', V2_SESSION_ITEM);
        if (wireDeletes.length > 0) {
            expect
                .soft(
                    wireDeletes[0].url,
                    'the DELETE must name the session the POST created'
                )
                .toContain(`/Playback/Sessions/${sessionId}`);
            expect
                .soft(
                    wireDeletes[0].status,
                    'DELETE /Playback/Sessions/{id} on a live session must answer exactly 204 (404 = it was already gone)'
                )
                .toBe(204);
        }

        const postStop = await admin.api.get(
            `/Playback/Sessions/${sessionId}/Stream`,
            { headers: { Authorization: admin.token } }
        );
        expect
            .soft(
                postStop.status(),
                'after the DELETE the session must be genuinely gone — 404, not still serving'
            )
            .toBe(404);
        if (sawDeleteLine && postStop.status() === 404)
            reached.push('DELETE 204 on a live session');

        // ---- 9. A DISTINCT X-Request-Id per request -----------------------------------------
        // Per-request correlation (#42), strictly separate from the per-attempt id (#43): the legs
        // of ONE attempt must produce DIFFERENT request ids. The DELETE leg is absent from this
        // list for the observability reason above — its response never reaches the browser context
        // this file can read, and the server's log template carries no RequestId to join on. That
        // gap is reported, never papered over.
        const legs = [
            {
                label: 'POST /Playback/Sessions',
                header: responsesBy(wire, 'POST', V2_SESSIONS)[0]?.headers[
                    REQUEST_ID_HEADER
                ]
            },
            {
                label: 'GET .../Stream (DirectPlay)',
                header: streamResponses(wire)[0]?.headers[REQUEST_ID_HEADER]
            },
            {
                label: 'PUT /Playback/Sessions/{id}',
                header: responsesBy(wire, 'PUT', V2_SESSION_ITEM)[0]?.headers[
                    REQUEST_ID_HEADER
                ]
            },
            {
                label: 'GET .../Stream (Transcode)',
                header: streamResponses(wire)[streamResponses(wire).length - 1]
                    ?.headers[REQUEST_ID_HEADER]
            }
        ];
        expect
            .soft(
                legs.filter((l) => !l.header).map((l) => l.label),
                `every leg of the cycle must carry an ${REQUEST_ID_HEADER} response header (#42)`
            )
            .toEqual([]);
        const requestIds = legs.map((l) => String(l.header));
        expect
            .soft(
                new Set(requestIds).size,
                `the ${REQUEST_ID_HEADER} must be DISTINCT per request; observed ${JSON.stringify(
                    legs.map((l) => `${l.label}=${l.header}`)
                )}`
            )
            .toBe(legs.length);
        expect
            .soft(
                requestIds.includes(postAttemptId),
                'the per-request id and the per-attempt id are different scopes and must never coincide'
            )
            .toBe(false);
        if (
            legs.every((l) => l.header) &&
            new Set(requestIds).size === legs.length
        )
            reached.push('distinct X-Request-Id per request');

        // ---- 10. A NEW user attempt yields a NEW PlaybackAttemptId --------------------------
        await pressPlay(page, otherMovie.id);
        const newInfoAttempt = await waitFor(
            () =>
                requestsBy(wire, 'POST', PLAYBACK_INFO)
                    .map((r) => attemptIdOf(r.postData))
                    .some((id) => id !== '' && id !== postAttemptId),
            30_000
        );
        expect
            .soft(
                newInfoAttempt,
                'the next play press must mint a NEW PlaybackAttemptId on PlaybackInfo'
            )
            .toBe(true);
        const newPostAttempt = await waitFor(
            () =>
                requestsBy(wire, 'POST', V2_SESSIONS)
                    .map((r) => attemptIdOf(r.postData))
                    .some((id) => id !== '' && id !== postAttemptId),
            30_000
        );
        expect
            .soft(
                newPostAttempt,
                'the next attempt must carry its new PlaybackAttemptId onto POST /Playback/Sessions too'
            )
            .toBe(true);
        if (newInfoAttempt && newPostAttempt)
            reached.push('new attempt id on the next play');

        // ---- 11. The SERVER's own account of this cycle -------------------------------------
        // Positive control FIRST: the log channel is live and contains this session's own
        // lifecycle lines. Only then do the absence assertions below mean anything.
        const sawDeletedLine = await waitFor(
            async () =>
                linesMatching(
                    logTail(await readServerLog(admin), logBaseline),
                    sessionId,
                    'deleted'
                ).length > 0,
            30_000
        );
        const tail = logTail(await readServerLog(admin), logBaseline);
        expect
            .soft(
                sawDeletedLine,
                `the server must log this session's deletion (#43 lifecycle line); session ${sessionId}`
            )
            .toBe(true);
        expect
            .soft(
                linesMatching(tail, sessionId, 'created').length,
                `the server must have logged this session's creation (#43 lifecycle line); session ${sessionId}`
            )
            .toBeGreaterThan(0);
        expect
            .soft(
                linesMatching(tail, sessionId, 'replaced').length,
                'the server must have logged the re-plan transition for this session'
            )
            .toBeGreaterThan(0);
        // The `deleted` line must be CORRELATED — it names the attempt this cycle ran under.
        expect
            .soft(
                linesMatching(tail, sessionId, 'deleted', postAttemptId).length,
                `the "deleted" line must name BOTH this session and the attempt it belonged to; lines seen: ${JSON.stringify(
                    linesMatching(tail, sessionId, 'deleted')
                )}`
            )
            .toBeGreaterThan(0);
        expect
            .soft(
                linesMatching(tail, sessionId, 'served from legacy'),
                'ZERO "served from legacy" lines are allowed for this session — every one of them means v2 did not serve what this test asserted it served'
            )
            .toEqual([]);
        expect
            .soft(
                linesMatching(tail, 'PlanNotExecutable'),
                'ZERO "PlanNotExecutable" lines are allowed in this test window'
            )
            .toEqual([]);
        expect
            .soft(
                linesMatching(tail, sessionId, 'already gone'),
                'ZERO "already gone" lines are allowed for this cycle — the DELETE acted on a live session'
            )
            .toEqual([]);
        if (
            linesMatching(tail, sessionId, 'created').length > 0 &&
            linesMatching(tail, sessionId, 'deleted', postAttemptId).length >
                0 &&
            linesMatching(tail, sessionId, 'served from legacy').length === 0 &&
            linesMatching(tail, 'PlanNotExecutable').length === 0 &&
            linesMatching(tail, sessionId, 'already gone').length === 0
        )
            reached.push('server log agrees');

        await assertV2PathReallyRan(page, wire);

        // The ledger, HARD: a stage that never happened is a failure that names itself.
        expect(
            reached,
            'the full chain must have been traversed, in order, with every stage satisfied'
        ).toEqual([...CHAIN]);
    });

    test('a late DELETE naming a dead session must not destroy a NEWER attempt', async ({
        page
    }) => {
        test.setTimeout(420_000);
        const logBaseline = await readServerLog(admin);
        const wire = instrument(page);

        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );

        await signIn(page);

        // ---- attempt A: create, then stop it (the session the late DELETE will name) --------
        await pressPlay(page, directPlayMovie.id);
        await assertV2PathReallyRan(page, wire);
        const okA = await waitFor(
            () =>
                wire.sessionBodies.filter(
                    (b) => b.method === 'POST' && b.status === 200
                ).length > 0,
            30_000
        );
        expect(
            okA,
            'attempt A never produced a 200 POST /Playback/Sessions — the premise of this test'
        ).toBe(true);
        const bodyA = jsonOf(
            wire.sessionBodies.filter(
                (b) => b.method === 'POST' && b.status === 200
            )[0].text
        );
        const sessionA = String(bodyA.Id ?? '');
        const attemptA = String(bodyA.PlaybackAttemptId ?? '');
        expect(sessionA, 'attempt A produced no session id').not.toBe('');

        await stopPlayback(page);
        // Same observability point as the lifecycle test: the teardown DELETE is a keepalive fetch
        // Playwright cannot see, so the server's own `deleted` line is the evidence that attempt A
        // really was torn down before the late DELETE is replayed below.
        const stoppedA = await waitFor(
            async () =>
                linesMatching(
                    logTail(await readServerLog(admin), logBaseline),
                    sessionA,
                    'deleted'
                ).length > 0,
            60_000
        );
        expect
            .soft(stoppedA, 'attempt A must be stopped through a real DELETE')
            .toBe(true);

        // ---- attempt B: a genuinely NEW attempt on the SAME item and the SAME device --------
        // Same item + same device is the exact shape in which an id could be reused, which is what
        // would let a stale DELETE take a live session down.
        await pressPlay(page, directPlayMovie.id);
        const okB = await waitFor(
            () =>
                wire.sessionBodies.filter(
                    (b) =>
                        b.method === 'POST' &&
                        b.status === 200 &&
                        String(jsonOf(b.text).Id ?? '') !== sessionA
                ).length > 0,
            30_000
        );
        expect(
            okB,
            'the second play press never produced a second, distinct session — nothing newer exists to protect'
        ).toBe(true);
        const bodyB = jsonOf(
            wire.sessionBodies.filter(
                (b) =>
                    b.method === 'POST' &&
                    b.status === 200 &&
                    String(jsonOf(b.text).Id ?? '') !== sessionA
            )[0].text
        );
        const sessionB = String(bodyB.Id ?? '');
        const attemptB = String(bodyB.PlaybackAttemptId ?? '');
        expect
            .soft(
                sessionB,
                'the second attempt must get its OWN session id — a reused id is exactly how a stale DELETE kills a live session'
            )
            .not.toBe(sessionA);
        expect
            .soft(
                attemptB,
                'the second attempt must mint a NEW PlaybackAttemptId'
            )
            .not.toBe(attemptA);

        // ---- the late DELETE: attempt A's own stop request, arriving now ---------------------
        //
        // RE-ANCHORED — issue #71 ("Classification du bloquant B", ARTEFACT DE RIG).
        //
        // WHAT THE OLD ASSERTIONS CHECKED, AND WHY THAT WAS WRONG.
        // The invariant this test exists to defend is causal: *A's DELETE must not touch B*. The
        // assertions that stood here were not:
        //   - `expect(afterLate.status()).toBe(200)` checked B's liveness at whatever wall-clock
        //     moment the test happened to fire a GET. ANY cause of B's death in that stretch failed
        //     it, with a message blaming A's DELETE. And there IS another cause: the SPA page tears
        //     its own session down 0.2-0.6 s after creating it, with a DELETE carrying B's OWN
        //     session id and B's OWN attempt id. Measured margins between the late DELETE and that
        //     self-teardown ran +103 ms down to −75 ms across runs, on `origin/master` with none of
        //     the server fixes applied — the green runs were coin flips, not evidence.
        //   - the same defect applied to the pre-DELETE liveness probe (dropped below: it asserted
        //     the identical contaminated thing, and a GET /Stream can itself emit lines naming B,
        //     which would poison the very log window this block now reads).
        //   - `linesMatching(tail, sessionB, 'deleted')` was a plain substring filter over the
        //     WHOLE log since the test started: no time bound, no attempt-id bound, no causal
        //     bound. Its message said "by the late DELETE"; its predicate said "by anything, ever".
        //
        // WHAT IS ASSERTED INSTEAD. The server log is snapshotted immediately BEFORE the late
        // DELETE is issued and again immediately AFTER it returns, and the invariant is asserted
        // over THAT window only — a few milliseconds wide, causally bounded, timing-independent:
        //   (i)  exactly ONE `already gone` line, naming A. The server acted on the route id it
        //        was handed, once.
        //   (ii) every line in that window that names B belongs to B's OWN client-routed teardown,
        //        and nothing else names B.
        //
        // (ii) is not "zero lines naming B", and that is a measured fact, not a softening: the
        // SPA's teardown DELETE for B lands INSIDE this window (observed at B age 0.363 s, 10 ms
        // after A's `already gone` line, on a separate request), so a literal zero would be
        // permanently red for a reason that is not the invariant. What separates the two cases is
        // that a client-routed DELETE for B produces BOTH the manager's `removed (… attempt B,
        // reason HttpDelete …)` line AND the controller's `deleted (attempt B)` line, because the
        // controller only logs `deleted` for the id in its own route. Collateral damage from A's
        // DELETE cannot produce that second line: A's request logs `already gone` and returns
        // NotFound. So an unpaired removal of B — a `removed` line with no route-B `deleted` line
        // beside it — is exactly the shape of "A's DELETE reached B", and it fails here. Any B line
        // of any other shape fails here too.
        //
        // B's teardown is then IDENTIFIED rather than forbidden over the whole test (further
        // below): every removal of B must carry B's OWN attempt id and `reason HttpDelete`.
        const beforeLateLog = await readServerLog(admin);

        const late = await admin.api.delete(`/Playback/Sessions/${sessionA}`, {
            headers: { Authorization: admin.token }
        });
        expect
            .soft(
                late.status(),
                'a DELETE naming an already-removed session must answer 404 — never 204, which would mean it removed something it had no right to'
            )
            .toBe(404);

        // The file sink is Serilog's Async wrapper, so the line can trail the HTTP response by a
        // few milliseconds. Re-read until it lands; the window is the tail as of the first read
        // that shows it, and nothing widens it afterwards.
        let deleteWindow = '';
        const windowClosed = await waitFor(async () => {
            deleteWindow = logTail(await readServerLog(admin), beforeLateLog);
            return (
                linesMatching(deleteWindow, sessionA, 'already gone').length > 0
            );
        }, 30_000);
        expect(
            windowClosed,
            "the late DELETE must be recorded in the server log window bracketing it — without that line this block's window is vacuous"
        ).toBe(true);
        expect(
            linesMatching(deleteWindow, sessionA, 'already gone').length,
            'the late DELETE must produce exactly ONE `already gone` line, and it must name the OLD session — proving the server acted on the route id it was given'
        ).toBe(1);
        // B's own teardown, as the server writes it: the manager's removal line, and the
        // controller's `deleted` line which ONLY a DELETE routed at B's own id can produce.
        const removedB = linesMatching(
            deleteWindow,
            sessionB,
            'removed',
            attemptB,
            'reason HttpDelete'
        );
        const routedDeleteOfB = linesMatching(
            deleteWindow,
            sessionB,
            'deleted (attempt',
            attemptB
        );
        expect(
            linesMatching(deleteWindow, sessionB).filter(
                (line) =>
                    !removedB.includes(line) && !routedDeleteOfB.includes(line)
            ),
            "the late DELETE's OWN log window may name the NEWER session only as its own client-routed teardown — any other line naming it is a DELETE aimed at the older attempt reaching a session it had no right to touch"
        ).toEqual([]);
        expect(
            removedB.length,
            "every removal of the NEWER session inside the late DELETE's own window must be paired with a DELETE routed at the NEWER session's own id — an unpaired removal is A's DELETE taking B down, which is exactly what this test forbids"
        ).toBe(routedDeleteOfB.length);

        // The liveness probe is KEPT but is no longer the survival oracle, and no longer asserts a
        // bare 200: the SPA tears its own session down inside this same stretch (#71), so a bare
        // 200 is a coin flip on a fact that is not the invariant. What IS asserted, below and
        // hard, is the causal disjunction it can actually support: B is either still live right
        // after the late DELETE returned, or it was taken down by a DELETE routed at B's OWN id.
        // Any third outcome — B gone with no route-B DELETE in the log — is A's DELETE reaching B.
        const afterLate = await admin.api.get(
            `/Playback/Sessions/${sessionB}/Stream`,
            { headers: { Authorization: admin.token } }
        );
        test.info().annotations.push({
            type: 'B liveness immediately after the late DELETE',
            description: `GET /Playback/Sessions/${sessionB}/Stream -> ${afterLate.status()}`
        });

        const tail = logTail(await readServerLog(admin), logBaseline);
        if (afterLate.status() !== 200) {
            expect(
                linesMatching(tail, sessionB, 'deleted (attempt', attemptB)
                    .length,
                'the NEWER attempt was gone right after the late DELETE, so the server log must show it being deleted by a DELETE routed at its OWN id and carrying its OWN attempt id — without that line, the only thing that reached it is the late DELETE aimed at the older attempt'
            ).toBeGreaterThan(0);
        }
        // Positive control: the log window really covers this test.
        expect
            .soft(
                linesMatching(tail, sessionB, 'created').length,
                'the newer session must appear in the server log window under test'
            )
            .toBeGreaterThan(0);
        // Issue #71, step 4: identify B's teardown instead of forbidding it. A removal of B that
        // carries B's own attempt id and `reason HttpDelete` is B's client asking for it; anything
        // else — another attempt's id, or any other reason — is B being taken down by something
        // that was not B's own DELETE, which is the failure this test is about.
        const removalsOfB = linesMatching(tail, sessionB, 'removed');
        expect(
            removalsOfB.filter(
                (line) =>
                    line.includes(attemptB) &&
                    line.includes('reason HttpDelete')
            ),
            "every removal of the NEWER session must carry the NEWER session's OWN attempt id and `reason HttpDelete` — that is self-teardown; anything else is collateral damage from another attempt's DELETE"
        ).toEqual(removalsOfB);
        expect
            .soft(
                linesMatching(tail, sessionB, 'already gone'),
                'the newer session must never be reported as already gone'
            )
            .toEqual([]);
        // The late DELETE is the ONE place an `already gone` line is legitimate, and it must name
        // the OLD session — proving the server told the two apart.
        expect
            .soft(
                linesMatching(tail, sessionA, 'already gone').length,
                'the late DELETE must be recorded against the OLD session id'
            )
            .toBeGreaterThan(0);
    });

    test('feature flag OFF: zero /Playback/Sessions traffic and the v2 chunk is never loaded', async ({
        page
    }) => {
        test.setTimeout(240_000);
        const wire = instrument(page);

        // Deliberately NO addInitScript: the source default (flag off) is the state under test.
        await signIn(page);
        await pressPlay(page, directPlayMovie.id);

        // Positive control: playback genuinely starts. A vacuously idle page also shows zero v2
        // traffic.
        const sawInfo = await waitFor(
            () =>
                wire.responses.filter(
                    (r) => PLAYBACK_INFO.test(r.url) && r.status === 200
                ).length > 0,
            30_000
        );
        expect
            .soft(
                sawInfo,
                'the legacy path must still negotiate playback through PlaybackInfo'
            )
            .toBe(true);
        const sawMedia = await waitFor(
            () => wire.requests.filter((r) => MEDIA_LEG.test(r.url)).length > 0,
            30_000
        );
        expect
            .soft(
                sawMedia,
                'the legacy path must still deliver media — without it the negatives below are vacuous'
            )
            .toBe(true);

        expect
            .soft(
                wire.requests
                    .filter(
                        (r) =>
                            V2_SESSIONS.test(r.url) ||
                            V2_SESSION_ITEM.test(r.url) ||
                            V2_SESSION_STREAM.test(r.url)
                    )
                    .map((r) => `${r.method} ${r.url}`),
                'flag OFF must produce no /Playback/Sessions traffic at all, of any verb'
            )
            .toEqual([]);
        expect
            .soft(
                wire.requests
                    .filter((r) => V2_CHUNK.test(r.url))
                    .map((r) => r.url),
                'flag OFF must not even fetch the lazy v2 chunk'
            )
            .toEqual([]);
        expect(
            await page.evaluate(() =>
                localStorage.getItem('enableV2PlaybackPath')
            ),
            'the client flag must still be off at the end of the test'
        ).not.toBe('true');
    });
});

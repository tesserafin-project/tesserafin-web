import { execFileSync } from 'node:child_process';
import { expect, request, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * THE HARD ORACLE for the v2 playback session lifecycle (all3f0r1/reefin#43).
 *
 * `playback-v2-lifecycle.spec.ts` (this file's predecessor on the same branch) narrates the cycle:
 * a good deal of what it learns it PRINTS — the session id, the attempt ids, the request ids, the
 * re-planned path — and printing is not a verdict. This file is the same cycle with every
 * observation promoted to a hard assertion, plus the five checks the narrative version never made
 * at all, all of which need evidence from OUTSIDE the browser:
 *
 *   - the first plan is genuinely `DirectPlay` and the re-plan is genuinely `Transcode`
 *     (`PlaybackSessionResponse.Method`, `PlaybackDecisionPlaybackMethod`);
 *   - the re-planned stream is served BY V2, not by a legacy fallback
 *     (`PlaybackSessionStreamDescriptor.ServedBy` > `PlaybackSessionResponse.LegacyDecisionVersion`
 *     = 0, and `FallbackReason` empty);
 *   - the bytes the player actually received are REALLY TRANSCODED — ffprobe/ffmpeg run against the
 *     exact media URL captured off the wire, asserting a container the source file does not have
 *     and frames that genuinely decode. A `200` on the `PUT` and a descriptor body are claims; a
 *     decoded frame out of an MPEG-TS segment that the source `.mp4` could not have produced is
 *     evidence;
 *   - the SERVER agrees, in its own log: the issue-#43 lifecycle lines
 *     (`created` / `replaced` / `deleted`) name this session, and the failure lines
 *     (`served from legacy`, `PlanNotExecutable`, `already gone`) do not;
 *   - a late DELETE naming a dead session cannot take a NEWER attempt down with it.
 *
 * DELIBERATELY NOT MOCKED. There is exactly one `page.route`, on a media URL, and it `abort()`s —
 * it fails a delivery, which is how a real `onPlaybackError` is provoked without patching client
 * source. `POST`/`PUT`/`GET .../Stream`/`DELETE` are never intercepted, never rewritten, never
 * fulfilled from a fixture. Every status, body and header asserted here came off a real socket
 * from a real Reefin server (`reefin/ci/serve-e2e.sh`), and the transcoded bytes came out of a
 * real ffmpeg.
 *
 * RIG: `reefin/ci/serve-e2e.sh --webdir <this repo>/dist --exec 'npx playwright test ...'`.
 * `REEFIN_E2E_BASE_URL` / `REEFIN_E2E_USER` / `REEFIN_E2E_PASSWORD` come from it. The fixtures this
 * file needs are the rig's own: `Smoke Test Movie (2020)` (H264 + AAC in MP4 — the DIRECT PLAY
 * fixture, the only one whose first plan can legitimately be `DirectPlay`) and a second movie for
 * the new-attempt leg.
 *
 * NOTHING here is allowed to pass by absence: every negative assertion (no `served from legacy`, no
 * `PlanNotExecutable`, no `already gone`, no v2 traffic when the flag is off) is paired with a
 * positive control proving the channel it reads was live and non-empty at the time.
 */

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const E2E_AUTH_HEADER =
    'MediaBrowser Client="Reefin Web E2E", Device="Playwright", DeviceId="reefin-e2e-v2-oracle", Version="0.0.0"';

/** The lazily-loaded chunk both v2 triggers reach for ONLY when the client flag is on. */
const V2_CHUNK = /playback-v2-url\.[a-f0-9]+\.chunk\.js/i;
const V2_SESSIONS = /\/Playback\/Sessions(\?|$)/i;
const V2_SESSION_ITEM = /\/Playback\/Sessions\/[^/?]+(\?|$)/i;
const V2_SESSION_STREAM = /\/Playback\/Sessions\/[^/?]+\/Stream(\?|$)/i;
const PLAYBACK_INFO = /\/Items\/[^/]+\/PlaybackInfo(\?|$)/i;
const MEDIA_LEG = /\/videos\/[^/]+\/(stream|master|main)\./i;
/** The HLS delivery routes — the ONLY shape a transcode can be served over. A `stream.<ext>` URL
 * is the static-file route and can never be a transcode, whatever a descriptor claims. */
const HLS_LEG = /\/videos\/[^/]+\/(master|main)\.m3u8/i;

/** `RequestCorrelation.ResponseHeaderName`; Playwright lowercases header keys. */
const REQUEST_ID_HEADER = 'x-request-id';

/** `PlaybackSessionResponse.LegacyDecisionVersion` — the sentinel meaning "a legacy projection".
 * `ServedBy` equal to it is precisely "NOT served by v2". */
const LEGACY_DECISION_VERSION = 0;

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
}

function instrument(page: Page): Wire {
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

/** Every movie the rig seeded, with the source container/codec ffprobe would report — the baseline
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
 * channel in which the issue-#43 lifecycle lines and the `served from legacy` /
 * `already gone` failure lines exist at all. Returns the newest log file's full text.
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
        'the server must be writing at least one log file (the rig sets REEFIN_LOG_DIR)'
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
    formatName: string;
    videoCodecs: string[];
    hasVideo: boolean;
}

function ffprobe(url: string): ProbeResult {
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
        { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }
    );
    const parsed = JSON.parse(raw) as {
        format?: { format_name?: string };
        streams?: { codec_type?: string; codec_name?: string }[];
    };
    const streams = parsed.streams ?? [];
    return {
        formatName: String(parsed.format?.format_name ?? ''),
        videoCodecs: streams
            .filter((s) => s.codec_type === 'video')
            .map((s) => String(s.codec_name ?? '')),
        hasVideo: streams.some((s) => s.codec_type === 'video')
    };
}

/** Frames that genuinely DECODED out of the delivered stream. A manifest that parses proves the
 * server wrote a manifest; a decoded frame proves ffmpeg produced real picture data. */
function decodedFrameCount(url: string): number {
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
            timeout: 120_000,
            maxBuffer: 32 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe']
        }
    );
    const frames = [...output.matchAll(/^frame=(\d+)$/gm)].map((m) =>
        Number(m[1])
    );
    return frames.length === 0 ? 0 : Math.max(...frames);
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
 * `playbackAttemptId.ts`'s definition. */
async function pressPlay(page: Page, itemId: string) {
    await page.goto(`/#/details?id=${itemId}`);
    const play = page
        .locator('button.btnPlay:visible, button[title*="Play" i]:visible')
        .first();
    await expect(play).toBeVisible({ timeout: 20_000 });
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
    let movies: MovieFixture[];
    let directPlayMovie: MovieFixture;
    let otherMovie: MovieFixture;

    test.beforeAll(async () => {
        admin = await adminContext();
        movies = await resolveMovies(admin);
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
        test.setTimeout(420_000);
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
        await expect
            .poll(() => requestsBy(wire, 'POST', PLAYBACK_INFO).length, {
                timeout: 45_000
            })
            .toBeGreaterThan(0);
        const playbackInfoRequest = requestsBy(wire, 'POST', PLAYBACK_INFO)[0];
        const infoAttemptId = attemptIdOf(playbackInfoRequest.postData);
        expect(
            infoAttemptId,
            'PlaybackInfo must carry the PlaybackAttemptId — it is the first request of the attempt (#43)'
        ).not.toBe('');

        // ---- 2. POST Playback/Sessions -----------------------------------------------------
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
            `POST /Playback/Sessions must answer exactly 200; body: ${postBody.text.slice(0, 400)}`
        ).toBe(200);
        const postJson = JSON.parse(postBody.text);
        const sessionId = String(postJson?.Id ?? '');
        expect(sessionId, 'the POST returned no session Id').not.toBe('');

        const postAttemptId = attemptIdOf(
            requestsBy(wire, 'POST', V2_SESSIONS)[0].postData
        );
        expect(
            postAttemptId,
            'the POST /Playback/Sessions body carried no PlaybackAttemptId'
        ).not.toBe('');
        expect(
            postAttemptId,
            'the POST must belong to the SAME attempt as the PlaybackInfo that preceded it'
        ).toBe(infoAttemptId);
        expect(
            String(postJson?.PlaybackAttemptId ?? ''),
            'the POST response must echo the attempt id back verbatim (#43)'
        ).toBe(postAttemptId);

        // ---- 3. GET Playback/Sessions/{id}/Stream giving a DirectPlay plan ------------------
        expect(
            String(postJson?.Method ?? ''),
            `the first plan for the H264/MP4 fixture "${directPlayMovie.name}" must be DirectPlay — the chain under test is DirectPlay → real error → Transcode`
        ).toBe('DirectPlay');

        await expect
            .poll(() => wire.streamBodies.length, { timeout: 45_000 })
            .toBeGreaterThan(0);
        const firstStream = wire.streamBodies[0];
        expect(
            firstStream.status,
            `the first GET /Playback/Sessions/{id}/Stream must answer 200; body: ${firstStream.text.slice(0, 400)}`
        ).toBe(200);
        expect(
            firstStream.url,
            'the first stream read must address the session the POST created'
        ).toContain(`/Playback/Sessions/${sessionId}/Stream`);
        const firstDescriptor = JSON.parse(firstStream.text);
        expect(
            Number(firstDescriptor?.ServedBy ?? LEGACY_DECISION_VERSION),
            `the first stream descriptor must be served BY V2, not by a legacy fallback (ServedBy > ${LEGACY_DECISION_VERSION}); FallbackReason=${firstDescriptor?.FallbackReason}`
        ).toBeGreaterThan(LEGACY_DECISION_VERSION);
        expect(
            firstDescriptor?.FallbackReason ?? null,
            'the DirectPlay leg must carry NO fallback reason'
        ).toBeNull();

        // ---- 4. A REAL product error surfaces ----------------------------------------------
        await expect
            .poll(() => abortedUrl, { timeout: 60_000 })
            .not.toBe('');

        // ---- 5. PUT Playback/Sessions/{id} re-planning to Transcode ------------------------
        await expect
            .poll(() => requestsBy(wire, 'PUT', V2_SESSION_ITEM).length, {
                timeout: 90_000
            })
            .toBeGreaterThan(0);
        const putRequest = requestsBy(wire, 'PUT', V2_SESSION_ITEM)[0];
        expect(
            putRequest.url,
            'the PUT must address the session the POST created'
        ).toContain(`/Playback/Sessions/${sessionId}`);

        const putAttemptId = attemptIdOf(putRequest.postData);
        expect(
            putAttemptId,
            'the PUT carried no PlaybackAttemptId — the retry would be unjoinable to the attempt that provoked it'
        ).not.toBe('');
        expect(
            putAttemptId,
            'the retry belongs to the attempt that started playback: SAME PlaybackAttemptId as the POST'
        ).toBe(postAttemptId);

        await expect
            .poll(
                () =>
                    wire.sessionBodies.filter((b) => b.method === 'PUT').length,
                { timeout: 90_000 }
            )
            .toBeGreaterThan(0);
        const putBody = wire.sessionBodies.filter((b) => b.method === 'PUT')[0];
        expect(
            putBody.status,
            `PUT /Playback/Sessions/{id} must answer exactly 200 (422 = the server found nothing plannable); body: ${putBody.text.slice(0, 600)}`
        ).toBe(200);
        const putJson = JSON.parse(putBody.text);
        expect(
            String(putJson?.Id ?? ''),
            'the PUT must preserve the SessionId — a re-plan replaces the plan, never the session'
        ).toBe(sessionId);
        expect(
            String(putJson?.PlaybackAttemptId ?? ''),
            'the PUT response must echo the SAME attempt id'
        ).toBe(postAttemptId);
        expect(
            String(putJson?.Method ?? ''),
            `the re-plan must land on Transcode — DirectPlay failed to deliver; body: ${putBody.text.slice(0, 600)}`
        ).toBe('Transcode');

        // ---- 6. GET Stream served by v2 ----------------------------------------------------
        await expect
            .poll(() => wire.streamBodies.length, { timeout: 90_000 })
            .toBeGreaterThanOrEqual(2);
        const replanStream = wire.streamBodies[wire.streamBodies.length - 1];
        expect(
            replanStream.status,
            `the post-PUT GET /Playback/Sessions/{id}/Stream must answer 200; body: ${replanStream.text.slice(0, 400)}`
        ).toBe(200);
        const replanDescriptor = JSON.parse(replanStream.text);
        expect(
            Number(replanDescriptor?.ServedBy ?? LEGACY_DECISION_VERSION),
            `the re-planned stream must be served BY V2 (ServedBy > ${LEGACY_DECISION_VERSION}); FallbackReason=${replanDescriptor?.FallbackReason}`
        ).toBeGreaterThan(LEGACY_DECISION_VERSION);
        expect(
            replanDescriptor?.FallbackReason ?? null,
            'the re-planned stream must carry NO fallback reason — any value here means v2 did not serve it'
        ).toBeNull();
        const replannedPath = String(replanDescriptor?.Url ?? '').split('?')[0];
        expect(
            replannedPath,
            'the post-PUT stream descriptor carried no Url'
        ).not.toBe('');

        // ---- 7. Actually transcoded bytes ---------------------------------------------------
        // The player must FETCH the re-planned URL successfully — a descriptor nobody fetches is
        // a claim, not a delivery.
        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            r.url.includes(replannedPath) &&
                            r.status >= 200 &&
                            r.status < 300
                    ).length,
                { timeout: 90_000 }
            )
            .toBeGreaterThan(0);
        const deliveredUrl = wire.responses.filter(
            (r) =>
                r.url.includes(replannedPath) &&
                r.status >= 200 &&
                r.status < 300
        )[0].url;
        expect(
            deliveredUrl,
            `a transcode can only be delivered over the HLS routes; the player fetched ${deliveredUrl}, which is the static-file route — no ffmpeg is involved there whatever the descriptor claimed`
        ).toMatch(HLS_LEG);

        // ffprobe/ffmpeg on the EXACT url the browser fetched (it carries its own ApiKey).
        const probe = ffprobe(deliveredUrl);
        expect(
            probe.hasVideo,
            `ffprobe found no video stream in the delivered transcode (${deliveredUrl}); format=${probe.formatName}`
        ).toBe(true);
        expect(
            probe.formatName,
            `the delivered stream's container (${probe.formatName}) must be the HLS/MPEG-TS output of a live ffmpeg — the source fixture is "${directPlayMovie.container}", so an identical container would mean the original file was handed over untouched`
        ).toMatch(/hls|mpegts/i);
        expect(
            probe.formatName.includes(directPlayMovie.container),
            `the delivered container must differ from the source container "${directPlayMovie.container}"`
        ).toBe(false);
        expect(
            decodedFrameCount(deliveredUrl),
            'ffmpeg decoded ZERO video frames out of the delivered stream — a manifest that parses is not transcoded picture data'
        ).toBeGreaterThan(0);

        // ---- 8. DELETE acts on a STILL-LIVE session, returning 204 --------------------------
        // Liveness proven independently, from outside the browser, immediately before the stop.
        const preStop = await admin.api.get(
            `/Playback/Sessions/${sessionId}/Stream`,
            { headers: { Authorization: admin.token } }
        );
        expect(
            preStop.status(),
            'the session must still be LIVE at the moment the user stops — otherwise the DELETE below tests nothing'
        ).toBe(200);

        await stopPlayback(page);
        await expect
            .poll(() => responsesBy(wire, 'DELETE', V2_SESSION_ITEM).length, {
                timeout: 60_000
            })
            .toBeGreaterThan(0);
        const deleteResponse = responsesBy(wire, 'DELETE', V2_SESSION_ITEM)[0];
        expect(
            deleteResponse.url,
            'the DELETE must name the session the POST created'
        ).toContain(`/Playback/Sessions/${sessionId}`);
        expect(
            deleteResponse.status,
            'DELETE /Playback/Sessions/{id} on a live session must answer exactly 204 (404 = it was already gone)'
        ).toBe(204);

        const postStop = await admin.api.get(
            `/Playback/Sessions/${sessionId}/Stream`,
            { headers: { Authorization: admin.token } }
        );
        expect(
            postStop.status(),
            'after the DELETE the session must be genuinely gone — 404, not still serving'
        ).toBe(404);

        // ---- 9. A DISTINCT X-Request-Id per request -----------------------------------------
        // Per-request correlation (#42), strictly separate from the per-attempt id (#43): the five
        // legs of ONE attempt must produce five DIFFERENT request ids.
        const legs: { label: string; header: string | undefined }[] = [
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
            },
            {
                label: 'DELETE /Playback/Sessions/{id}',
                header: deleteResponse.headers[REQUEST_ID_HEADER]
            }
        ];
        expect(
            legs.filter((l) => !l.header).map((l) => l.label),
            `every leg of the cycle must carry an ${REQUEST_ID_HEADER} response header (#42)`
        ).toEqual([]);
        const requestIds = legs.map((l) => String(l.header));
        expect(
            new Set(requestIds).size,
            `the ${REQUEST_ID_HEADER} must be DISTINCT per request; observed ${JSON.stringify(
                legs.map((l) => `${l.label}=${l.header}`)
            )}`
        ).toBe(legs.length);
        expect(
            requestIds.includes(postAttemptId),
            'the per-request id and the per-attempt id are different scopes and must never coincide'
        ).toBe(false);

        // ---- 10. A NEW user attempt yields a NEW PlaybackAttemptId --------------------------
        await pressPlay(page, otherMovie.id);
        await expect
            .poll(
                () =>
                    requestsBy(wire, 'POST', PLAYBACK_INFO)
                        .map((r) => attemptIdOf(r.postData))
                        .filter((id) => id !== '' && id !== postAttemptId)
                        .length,
                { timeout: 90_000 }
            )
            .toBeGreaterThan(0);
        await expect
            .poll(
                () =>
                    requestsBy(wire, 'POST', V2_SESSIONS)
                        .map((r) => attemptIdOf(r.postData))
                        .filter((id) => id !== '' && id !== postAttemptId)
                        .length,
                { timeout: 90_000 }
            )
            .toBeGreaterThan(0);

        // ---- 11. The SERVER's own account of this cycle -------------------------------------
        // Positive control FIRST: the log channel is live and contains this session's own
        // lifecycle lines. Only then do the absence assertions below mean anything.
        await expect
            .poll(
                async () =>
                    linesMatching(
                        logTail(await readServerLog(admin), logBaseline),
                        sessionId,
                        'deleted'
                    ).length,
                { timeout: 60_000 }
            )
            .toBeGreaterThan(0);
        const tail = logTail(await readServerLog(admin), logBaseline);

        expect(
            linesMatching(tail, sessionId, 'created').length,
            `the server must have logged this session's creation (#43 lifecycle line); session ${sessionId}`
        ).toBeGreaterThan(0);
        expect(
            linesMatching(tail, sessionId, 'replaced').length,
            'the server must have logged the re-plan transition for this session'
        ).toBeGreaterThan(0);
        // The `deleted` line must be CORRELATED — it names the attempt this cycle ran under.
        expect(
            linesMatching(tail, sessionId, 'deleted', postAttemptId).length,
            `the "deleted" line must name BOTH this session and the attempt it belonged to; lines seen: ${JSON.stringify(
                linesMatching(tail, sessionId, 'deleted')
            )}`
        ).toBeGreaterThan(0);

        expect(
            linesMatching(tail, sessionId, 'served from legacy'),
            'ZERO "served from legacy" lines are allowed for this session — every one of them means v2 did not serve what the test just asserted it served'
        ).toEqual([]);
        expect(
            linesMatching(tail, 'PlanNotExecutable'),
            'ZERO "PlanNotExecutable" lines are allowed in this test window'
        ).toEqual([]);
        expect(
            linesMatching(tail, sessionId, 'already gone'),
            'ZERO "already gone" lines are allowed for this cycle — the DELETE acted on a live session'
        ).toEqual([]);

        await assertV2PathReallyRan(page, wire);
    });

    test('a late DELETE naming a dead session must not destroy a NEWER attempt', async ({
        page
    }) => {
        test.setTimeout(360_000);
        const logBaseline = await readServerLog(admin);
        const wire = instrument(page);

        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );

        await signIn(page);

        // ---- attempt A: create, then stop it (the session the late DELETE will name) --------
        await pressPlay(page, directPlayMovie.id);
        await assertV2PathReallyRan(page, wire);
        await expect
            .poll(
                () =>
                    wire.sessionBodies.filter(
                        (b) => b.method === 'POST' && b.status === 200
                    ).length,
                { timeout: 60_000 }
            )
            .toBeGreaterThan(0);
        const bodyA = wire.sessionBodies.filter(
            (b) => b.method === 'POST' && b.status === 200
        )[0];
        const sessionA = String(JSON.parse(bodyA.text)?.Id ?? '');
        const attemptA = String(JSON.parse(bodyA.text)?.PlaybackAttemptId ?? '');
        expect(sessionA, 'attempt A produced no session id').not.toBe('');

        await stopPlayback(page);
        await expect
            .poll(
                () =>
                    responsesBy(wire, 'DELETE', V2_SESSION_ITEM).filter((r) =>
                        r.url.includes(sessionA)
                    ).length,
                { timeout: 60_000 }
            )
            .toBeGreaterThan(0);

        // ---- attempt B: a genuinely NEW attempt on the SAME item and the SAME device --------
        // Same item + same device is the exact shape in which an id could be reused, which is what
        // would let a stale DELETE take a live session down.
        await pressPlay(page, directPlayMovie.id);
        await expect
            .poll(
                () =>
                    wire.sessionBodies.filter(
                        (b) =>
                            b.method === 'POST' &&
                            b.status === 200 &&
                            String(JSON.parse(b.text)?.Id ?? '') !== sessionA
                    ).length,
                { timeout: 90_000 }
            )
            .toBeGreaterThan(0);
        const bodyB = wire.sessionBodies.filter(
            (b) =>
                b.method === 'POST' &&
                b.status === 200 &&
                String(JSON.parse(b.text)?.Id ?? '') !== sessionA
        )[0];
        const sessionB = String(JSON.parse(bodyB.text)?.Id ?? '');
        const attemptB = String(JSON.parse(bodyB.text)?.PlaybackAttemptId ?? '');
        expect(
            sessionB,
            'the second attempt must get its OWN session id — a reused id is exactly how a stale DELETE kills a live session'
        ).not.toBe(sessionA);
        expect(
            attemptB,
            'the second attempt must mint a NEW PlaybackAttemptId'
        ).not.toBe(attemptA);

        // B must be live before the late DELETE, or the assertion after it is vacuous.
        const beforeLate = await admin.api.get(
            `/Playback/Sessions/${sessionB}/Stream`,
            { headers: { Authorization: admin.token } }
        );
        expect(
            beforeLate.status(),
            'the newer session must be live before the late DELETE is replayed'
        ).toBe(200);

        // ---- the late DELETE: attempt A's own stop request, arriving now ---------------------
        const late = await admin.api.delete(`/Playback/Sessions/${sessionA}`, {
            headers: { Authorization: admin.token }
        });
        expect(
            late.status(),
            'a DELETE naming an already-removed session must answer 404 — never 204, which would mean it removed something it had no right to'
        ).toBe(404);

        const afterLate = await admin.api.get(
            `/Playback/Sessions/${sessionB}/Stream`,
            { headers: { Authorization: admin.token } }
        );
        expect(
            afterLate.status(),
            'the NEWER attempt must survive a late DELETE aimed at the older one'
        ).toBe(200);

        const tail = logTail(await readServerLog(admin), logBaseline);
        // Positive control: the log window really covers this test.
        expect(
            linesMatching(tail, sessionB, 'created').length,
            'the newer session must appear in the server log window under test'
        ).toBeGreaterThan(0);
        expect(
            linesMatching(tail, sessionB, 'deleted'),
            'the newer session must NEVER be logged as deleted by the late DELETE aimed at the older one'
        ).toEqual([]);
        expect(
            linesMatching(tail, sessionB, 'already gone'),
            'the newer session must never be reported as already gone'
        ).toEqual([]);
        // The late DELETE is the ONE place an `already gone` line is legitimate, and it must name
        // the OLD session — proving the server told the two apart.
        expect(
            linesMatching(tail, sessionA, 'already gone').length,
            'the late DELETE must be recorded against the OLD session id'
        ).toBeGreaterThan(0);
    });

    test('feature flag OFF: zero /Playback/Sessions traffic and the v2 chunk is never loaded', async ({
        page
    }) => {
        test.setTimeout(180_000);
        const wire = instrument(page);

        // Deliberately NO addInitScript: the source default (flag off) is the state under test.
        await signIn(page);
        await pressPlay(page, directPlayMovie.id);

        // Positive control: playback genuinely starts. A vacuously idle page also shows zero v2
        // traffic.
        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) => PLAYBACK_INFO.test(r.url) && r.status === 200
                    ).length,
                { timeout: 60_000 }
            )
            .toBeGreaterThan(0);
        await expect
            .poll(
                () => wire.requests.filter((r) => MEDIA_LEG.test(r.url)).length,
                { timeout: 90_000 }
            )
            .toBeGreaterThan(0);

        expect(
            wire.requests
                .filter(
                    (r) =>
                        V2_SESSIONS.test(r.url) ||
                        V2_SESSION_ITEM.test(r.url) ||
                        V2_SESSION_STREAM.test(r.url)
                )
                .map((r) => `${r.method} ${r.url}`),
            'flag OFF must produce no /Playback/Sessions traffic at all, of any verb'
        ).toEqual([]);
        expect(
            wire.requests.filter((r) => V2_CHUNK.test(r.url)).map((r) => r.url),
            'flag OFF must not even fetch the lazy v2 chunk'
        ).toEqual([]);
        expect(
            await page.evaluate(() =>
                localStorage.getItem('enableV2PlaybackPath')
            ),
            'the client flag must still be off at the end of the test'
        ).not.toBe('true');
    });
});

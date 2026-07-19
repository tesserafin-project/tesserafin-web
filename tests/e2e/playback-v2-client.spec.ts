import { expect, request, test } from '@playwright/test';

/**
 * Playback v2 (PR #26, `fix/playback-v2-descriptor-consumption`) — REAL browser E2E.
 *
 * What this file proves, and what it deliberately does not:
 *  - It drives the actual UI (`button.btnPlay` on `/#/details`) against a real server booted by
 *    `reefin/ci/serve-e2e.sh`, and asserts on ACTUAL network traffic captured through
 *    `page.on('request'|'response')`. Nothing here is asserted by reading client source.
 *  - The v2 flag (`appSettings.enableV2PlaybackPath()`, plain `localStorage`) is turned ON
 *    in-browser per test via `addInitScript`. The source default (OFF) is never modified.
 *
 * There is NO `page.route` request-body rewriting anywhere in this file, by design — the same
 * discipline `playback-attempt-id-contract.spec.ts` and `playback-capabilities-contract.spec.ts`
 * document for themselves. The bytes asserted on are the bytes the real, unpatched bundle put on
 * the wire; a test that rewrites the request it then asserts about proves only its own injection.
 *
 * Formerly this file carried a KNOWN BLOCKER: `reefinPlaybackCapabilities.ts` emitted
 * `VideoCodecs: [{Codec}]` while the server's `Reefin.Playback.Decision/VideoCodecCapability` is a
 * positional record whose `Profiles`/`VideoRangeTypes` members are non-nullable, so every
 * `POST /Playback/Sessions` from the real client was rejected `400` and the v2 SUCCESS path was
 * unreachable without patching the outgoing body. That blocker is GONE: the builder now emits
 * `Profiles: []` and `VideoRangeTypes: ['SDR']` on every video codec entry
 * (`src/scripts/reefinPlaybackCapabilities.ts`), so the unmodified client creates a v2 session on
 * its own and #26's descriptor consumption executes end-to-end with no patching at all.
 */

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const E2E_AUTH_HEADER =
    'MediaBrowser Client="Reefin Web E2E", Device="Playwright", DeviceId="reefin-e2e-playback-v2", Version="0.0.0"';

/** The lazily-loaded chunk `playbackSessionV2UrlTrigger.ts` reaches for ONLY when the flag is on.
 * Its presence/absence in the captured traffic is the positive/negative control that the flag was
 * genuinely in effect — independent of anything the client logs. */
const V2_CHUNK = /playback-v2-url\.[a-f0-9]+\.chunk\.js/i;
const V2_SESSIONS = /\/Playback\/Sessions(\?|$)/i;
const V2_STREAM = /\/Playback\/Sessions\/[^/]+\/Stream/i;
/** The legacy server-built delivery URL shape. */
const LEGACY_STREAM = /\/Videos\/[^/]+\/(stream|master|main)\./i;

interface Wire {
    requests: { method: string; url: string; postData: string | null }[];
    responses: { status: number; url: string; contentType: string }[];
}

function instrument(page: import('@playwright/test').Page): Wire {
    const wire: Wire = { requests: [], responses: [] };
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
            contentType: r.headers()['content-type'] ?? ''
        })
    );
    return wire;
}

async function resolveFirstMovieId(): Promise<string> {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await (
        await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        })
    ).json();
    const items = await (
        await api.get('/Items', {
            params: {
                userId: auth.User.Id,
                recursive: 'true',
                includeItemTypes: 'Movie'
            },
            headers: {
                Authorization: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
            }
        })
    ).json();
    const id = items.Items?.[0]?.Id;
    if (!id) throw new Error('no movie fixture found on the server');
    await api.dispose();
    return String(id);
}

async function signInAndPlay(
    page: import('@playwright/test').Page,
    itemId: string
) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
        await page.locator('#txtManualName:visible').fill(USER);
        await page.locator('#txtManualPassword:visible').fill(PASSWORD);
        await page.locator('button[type="submit"]:visible').first().click();
        await page.waitForURL('**/#/home**', { timeout: 20_000 });
    }
    await page.waitForLoadState('networkidle');

    await page.goto(`/#/details?id=${itemId}`);
    await page.waitForLoadState('networkidle');
    const play = page
        .locator('button.btnPlay:visible, button[title*="Play" i]:visible')
        .first();
    await expect(play).toBeVisible({ timeout: 20_000 });
    await play.click();
}

/** The v2 EXECUTION engine is kill-switched off by default (`PlaybackLiveStreamResolver` falls back
 * to legacy with `FallbackReason: "KillSwitch"` unless `PlaybackShadow.GetEffectiveMode()` is
 * Canary/V2). Flipped here through the real admin API — server runtime configuration, not a source
 * default, and unrelated to the client's own `enableV2PlaybackPath` flag.
 *
 * This writes PERSISTENT server state, so every test whose outcome depends on the engine mode must
 * set the mode it needs rather than inheriting whatever an earlier test left behind. */
async function setV2EngineMode(mode: 'V2' | 'Off') {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await (
        await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        })
    ).json();
    const token = `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`;
    const cfg = await (
        await api.get('/System/Configuration', {
            headers: { Authorization: token }
        })
    ).json();
    cfg.PlaybackShadow = { ...(cfg.PlaybackShadow ?? {}), Mode: mode };
    const posted = await api.post('/System/Configuration', {
        headers: { Authorization: token },
        data: cfg
    });
    if (!posted.ok()) {
        throw new Error(
            `could not set the v2 engine mode to ${mode}: ${posted.status()}`
        );
    }
    await api.dispose();
}

const enableV2Engine = () => setV2EngineMode('V2');
const disableV2Engine = () => setV2EngineMode('Off');

test.describe('playback v2 — flag ON', () => {
    let itemId = '';
    test.beforeAll(async () => {
        itemId = await resolveFirstMovieId();
    });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );
    });

    test('the v2 path is genuinely entered: lazy chunk fetched and POST Playback/Sessions issued', async ({
        page
    }) => {
        test.setTimeout(120_000);
        const wire = instrument(page);
        await signInAndPlay(page, itemId);

        // Anti-vacuity: the flag must still be on at the moment playback is triggered. If login had
        // cleared localStorage, every assertion below would be about the legacy path instead.
        await expect
            .poll(() =>
                page.evaluate(() =>
                    localStorage.getItem('enableV2PlaybackPath')
                )
            )
            .toBe('true');

        // Positive control that the flag actually took effect in the bundle: the dedicated chunk is
        // only requested from behind the `isEnabled()` check in playbackSessionV2UrlTrigger.ts.
        await expect
            .poll(
                () => wire.requests.filter((r) => V2_CHUNK.test(r.url)).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // Requirement 1 (first half): a real POST to Playback/Sessions happens on the wire.
        await expect
            .poll(
                () =>
                    wire.requests.filter(
                        (r) => r.method === 'POST' && V2_SESSIONS.test(r.url)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // …and it is the REAL v2 path, not the shadow one: the real path generates and sends a
        // PlaySessionId (docs/pr116d-url-contract-design.md §2.3).
        const post = wire.requests.find(
            (r) => r.method === 'POST' && V2_SESSIONS.test(r.url)
        )!;
        expect(post.postData).toBeTruthy();
        expect(JSON.parse(post.postData!).PlaySessionId).toBeTruthy();
    });

    test('the UNPATCHED client body is accepted 200 and the descriptor is fetched and played', async ({
        page
    }) => {
        test.setTimeout(120_000);

        // NO `page.route`, and that absence is the whole point of this test. The outgoing
        // `POST /Playback/Sessions` body is exactly what the real bundle produced; it is captured
        // through `page.on('request')` in `instrument()` — pure observation, never mutation — and
        // asserted on below. An earlier revision rewrote this body to inject
        // `Profiles`/`VideoRangeTypes` before letting it through, which made the test prove only
        // its own injection. The builder now emits both fields itself, so nothing needs patching.
        await enableV2Engine();

        const wire = instrument(page);
        let descriptor: Record<string, unknown> | null = null;
        page.on('response', async (r) => {
            if (V2_STREAM.test(r.url()) && r.status() === 200) {
                try {
                    descriptor = await r.json();
                } catch {
                    /* not json */
                }
            }
        });

        await signInAndPlay(page, itemId);

        // Requirement 1, second half — now reachable THROUGH THE CLIENT. This endpoint exists only
        // on the v2 path, so a request to it is itself the proof that v2 was used.
        await expect
            .poll(
                () => wire.requests.filter((r) => V2_STREAM.test(r.url)).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // The body the REAL client produced, read back off the wire and never modified. These two
        // fields are the ones the server's positional `VideoCodecCapability` record requires; the
        // assertion is what makes this test a genuine contract check on
        // `reefinPlaybackCapabilities.ts` rather than on a test-side injection.
        const post = wire.requests.find(
            (r) => r.method === 'POST' && V2_SESSIONS.test(r.url)
        )!;
        expect(post, 'no POST Playback/Sessions was captured').toBeTruthy();
        expect(post.postData).toBeTruthy();
        const videoCodecs = JSON.parse(post.postData!)?.Capabilities?.Decode
            ?.VideoCodecs as
            | {
                  Codec: string;
                  Profiles?: string[];
                  VideoRangeTypes?: string[];
              }[]
            | undefined;
        expect(
            videoCodecs?.length,
            'client sent no VideoCodecs'
        ).toBeGreaterThan(0);
        for (const vc of videoCodecs!) {
            expect(vc.Profiles, `codec ${vc.Codec} Profiles`).toEqual([]);
            expect(
                vc.VideoRangeTypes,
                `codec ${vc.Codec} VideoRangeTypes`
            ).toEqual(['SDR']);
        }

        // EXACTLY 200 — not "not 4xx", not "ok". Every response the collection endpoint produced in
        // this run must be a 200, so a single stray 400 fails the test instead of being masked by a
        // later success.
        await expect
            .poll(
                () =>
                    wire.responses.filter((r) => V2_SESSIONS.test(r.url))
                        .length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        for (const sessionResponse of wire.responses.filter((r) =>
            V2_SESSIONS.test(r.url)
        )) {
            expect(
                sessionResponse.status,
                `POST ${sessionResponse.url} status`
            ).toBe(200);
        }

        await expect.poll(() => descriptor, { timeout: 30_000 }).toBeTruthy();
        const d = descriptor as unknown as Record<string, string>;

        // The descriptor must be a complete execution state, else #26 deliberately keeps legacy.
        expect(d.Url, 'descriptor carried no Url').toBeTruthy();
        expect(d.MimeType, 'descriptor carried no MimeType').toBeTruthy();
        expect(
            d.FallbackReason,
            `v2 did not serve this (${d.FallbackReason})`
        ).toBeFalsy();

        // Requirement 2 through the client: the media the player actually requested is the URL the
        // descriptor handed out, and the bytes served carry the MimeType the descriptor promised.
        const descriptorPath = String(d.Url).split('?')[0];
        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            r.url.includes(descriptorPath) &&
                            (r.status === 200 || r.status === 206)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        const played = wire.responses.find(
            (r) =>
                r.url.includes(descriptorPath) &&
                (r.status === 200 || r.status === 206)
        )!;
        expect(played.contentType.split(';')[0].trim().toLowerCase()).toBe(
            String(d.MimeType).toLowerCase()
        );

        // Requirement 3: no legacy playback parameters are parsed out of the URL by the client —
        // the v2 URL carries none of the params the pre-#26 retry heuristics string-matched.
        expect(played.url.toLowerCase()).not.toContain('transcodereasons');
        expect(played.url.toLowerCase()).not.toContain('allowvideostreamcopy');
        expect(played.url.toLowerCase()).not.toContain('allowaudiostreamcopy');

        // Requirement 4: no mixed state. NOTE the v2 descriptor Url has the SAME path shape as the
        // legacy delivery URL (`/videos/{id}/stream.mp4?...`), so "a LEGACY_STREAM-shaped URL was
        // fetched" proves nothing on its own. The real invariant is that EVERY media delivery the
        // player performed was the descriptor's own Url - i.e. no second, legacy-built URL was
        // fetched alongside the v2 one.
        const mediaFetches = wire.responses.filter(
            (r) =>
                LEGACY_STREAM.test(r.url) &&
                (r.status === 200 || r.status === 206)
        );
        expect(mediaFetches.length).toBeGreaterThan(0);
        for (const m of mediaFetches) {
            expect(
                m.url,
                'a media URL other than the v2 descriptor Url was played - v2/legacy mixed state'
            ).toContain(descriptorPath);
        }

        // The v2 URL is also the one carrying the descriptor's own PlaySessionId, not a legacy one.
        expect(played.url).toContain('PlaySessionId=');
    });

    test('when the server engine is kill-switched off, playback falls back to a PURELY legacy stream (no mixed state)', async ({
        page
    }) => {
        test.setTimeout(120_000);

        // The fallback must be FORCED, explicitly. This test used to get its fallback for free from
        // the capability-contract `400` — the client could not create a session at all, so legacy
        // was the only outcome. Now that the client emits `Profiles`/`VideoRangeTypes` and the
        // server accepts the body, that free fallback is gone: without this line the test would
        // inherit `Mode: 'V2'` from the preceding test and v2 would genuinely serve the media,
        // failing the `V2_STREAM` assertion below. The server kill switch is the documented
        // fallback mechanism (`FallbackReason: "KillSwitch"`), and it is exercised through the real
        // admin API — no request-body rewriting.
        await disableV2Engine();

        const wire = instrument(page);
        await signInAndPlay(page, itemId);

        // The media actually gets served, through the legacy delivery URL.
        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            LEGACY_STREAM.test(r.url) &&
                            (r.status === 200 || r.status === 206)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        const served = wire.responses.find(
            (r) =>
                LEGACY_STREAM.test(r.url) &&
                (r.status === 200 || r.status === 206)
        )!;

        // Requirement 4: no mixing. The URL actually played is the legacy one; no descriptor-issued
        // v2 URL was fetched at all, so there is no state in which a v2 URL coexists with the legacy
        // execution fields the client built synchronously.
        expect(wire.requests.filter((r) => V2_STREAM.test(r.url))).toHaveLength(
            0
        );

        // The bytes served match what a legacy DirectPlay of an mp4 fixture must be.
        expect(served.contentType).toMatch(/^video\/mp4/);
        expect(served.url).toMatch(/Static=true/i);
    });
});

test.describe('playback v2 — flag OFF (default)', () => {
    let itemId = '';
    test.beforeAll(async () => {
        itemId = await resolveFirstMovieId();
    });

    test('no v2 chunk and no Playback/Sessions traffic; playback is whole-legacy', async ({
        page
    }) => {
        test.setTimeout(120_000);
        const wire = instrument(page);
        // Deliberately NO addInitScript here: this exercises the shipped default.
        await signInAndPlay(page, itemId);

        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            LEGACY_STREAM.test(r.url) &&
                            (r.status === 200 || r.status === 206)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // The default really is off…
        expect(
            await page.evaluate(() =>
                localStorage.getItem('enableV2PlaybackPath')
            )
        ).toBeNull();

        // …and with it off, the v2 chain is never even fetched over the network (PR116f's whole
        // point), let alone called.
        expect(wire.requests.filter((r) => V2_CHUNK.test(r.url))).toHaveLength(
            0
        );
        expect(
            wire.requests.filter((r) => V2_SESSIONS.test(r.url))
        ).toHaveLength(0);
        expect(wire.requests.filter((r) => V2_STREAM.test(r.url))).toHaveLength(
            0
        );

        const served = wire.responses.find(
            (r) =>
                LEGACY_STREAM.test(r.url) &&
                (r.status === 200 || r.status === 206)
        )!;
        expect(served.contentType).toMatch(/^video\/mp4/);
    });
});

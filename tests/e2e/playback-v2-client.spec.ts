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
 * KNOWN BLOCKER (not caused by #26 — see `v2 session creation` below): the client's
 * `reefinPlaybackCapabilities.ts` emits `VideoCodecs: [{Codec}]`, while the server's
 * `Reefin.Playback.Decision/VideoCodecCapability` is a positional record whose `Profiles` and
 * `VideoRangeTypes` members are non-nullable and therefore required by ASP.NET model binding.
 * Every `POST /Playback/Sessions` from the real client is consequently rejected `400`. That file is
 * untouched by #26, so the mismatch is pre-existing; but it means the v2 SUCCESS path (and with it
 * #26's descriptor consumption) cannot execute end-to-end against these pinned SHAs.
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

    test('v2 session creation succeeds and the descriptor is fetched', async ({
        page
    }) => {
        test.setTimeout(120_000);
        // EXPECTED TO FAIL against reefin master 522416764b + reefin-web 188faad689.
        // Cause (NOT #26): reefinPlaybackCapabilities.ts omits Profiles/VideoRangeTypes on each
        // Capabilities.Decode.VideoCodecs[] entry; VideoCodecCapability requires both. The server
        // answers 400 and the v2 chain falls back to legacy, so GET .../Stream is never reached.
        // Flip this to a normal test once the capability builder is aligned.
        test.fail();

        const wire = instrument(page);
        await signInAndPlay(page, itemId);

        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) => V2_SESSIONS.test(r.url) && r.status === 200
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // Requirement 1 (second half): the descriptor endpoint is actually called.
        await expect
            .poll(
                () => wire.requests.filter((r) => V2_STREAM.test(r.url)).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);
    });

    test('when v2 session creation is rejected, playback falls back to a PURELY legacy stream (no mixed state)', async ({
        page
    }) => {
        test.setTimeout(120_000);
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

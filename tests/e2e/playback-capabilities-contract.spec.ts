import { expect, request, test } from '@playwright/test';

/**
 * `POST /Playback/Sessions` CAPABILITY CONTRACT — REAL browser E2E, real server.
 *
 * What this file proves:
 *   The client's `reefinPlaybackCapabilities.ts` used to emit `VideoCodecs: [{Codec}]`, omitting
 *   `Profiles` and `VideoRangeTypes`. The server's `VideoCodecCapability`
 *   (`Reefin.Playback.Decision`) is a positional record whose corresponding members are non-nullable
 *   `IReadOnlyList<string>`, so ASP.NET model binding required both to be present and rejected every
 *   real request with:
 *       "Capabilities.Decode.VideoCodecs[0].Profiles":["The Profiles field is required."]
 *       "Capabilities.Decode.VideoCodecs[0].VideoRangeTypes":["The VideoRangeTypes field is required."]
 *   Neither side's unit tests could catch it — each is self-consistent, and the generated TS model
 *   marks both fields `?`-optional so omitting them type-checks.
 *
 * SCOPE — this file asserts on ACTUAL captured network traffic, never on client source:
 *   1. The real, UNPATCHED client POSTs `/Playback/Sessions` and the server answers `200`
 *      (asserted as exactly 200 — a 422/500 is still a failure, not "no longer 400").
 *   2. The body that reaches the wire carries `Profiles: []` and `VideoRangeTypes: ['SDR']` on
 *      EVERY `Capabilities.Decode.VideoCodecs[]` entry. This is the load-bearing check: the fix
 *      depends on an EMPTY array surviving serialization, which a builder-level unit test cannot
 *      prove. There is no `page.route` body rewriting anywhere in this file, by design.
 *
 * The v2 flag (`appSettings.enableV2PlaybackPath()`, plain `localStorage`) is turned ON in-browser
 * via `addInitScript`. The source default (OFF) is never modified.
 */

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const E2E_AUTH_HEADER =
    'MediaBrowser Client="Reefin Web E2E", Device="Playwright", DeviceId="reefin-e2e-capability-contract", Version="0.0.0"';

/** The lazily-loaded chunk `playbackSessionV2UrlTrigger.ts` reaches for ONLY when the flag is on.
 * Its presence in captured traffic is the positive control that the flag genuinely took effect, and
 * incidentally that PR #21's lazy chunk boundary still holds. */
const V2_CHUNK = /playback-v2-url\.[a-f0-9]+\.chunk\.js/i;
const V2_SESSIONS = /\/Playback\/Sessions(\?|$)/i;

interface Wire {
    requests: { method: string; url: string; postData: string | null }[];
    responses: { status: number; url: string }[];
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
        wire.responses.push({ status: r.status(), url: r.url() })
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

/** The v2 EXECUTION engine is kill-switched off by default. Flipped through the real admin API —
 * server runtime configuration, not a source default, and unrelated to the client's own
 * `enableV2PlaybackPath` flag. */
async function enableV2Engine() {
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

test.describe('POST /Playback/Sessions capability contract', () => {
    let itemId = '';

    test.beforeAll(async () => {
        itemId = await resolveFirstMovieId();
        await enableV2Engine();
    });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );
    });

    test('the unpatched client creates a v2 session: 200, not the 400 capability rejection', async ({
        page
    }) => {
        test.setTimeout(120_000);
        const wire = instrument(page);
        const bodies: { status: number; text: string }[] = [];
        page.on('response', async (r) => {
            if (V2_SESSIONS.test(r.url())) {
                try {
                    bodies.push({ status: r.status(), text: await r.text() });
                } catch {
                    /* body already consumed */
                }
            }
        });

        await signInAndPlay(page, itemId);

        // Anti-vacuity: the flag must still be on when playback is triggered, else every assertion
        // below would silently be about the legacy path.
        await expect
            .poll(() =>
                page.evaluate(() =>
                    localStorage.getItem('enableV2PlaybackPath')
                )
            )
            .toBe('true');

        // Positive control that the flag took effect in the bundle: this chunk is only requested
        // from behind the `isEnabled()` check in playbackSessionV2UrlTrigger.ts.
        await expect
            .poll(
                () => wire.requests.filter((r) => V2_CHUNK.test(r.url)).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // A POST must actually have happened before its status means anything.
        await expect
            .poll(
                () =>
                    wire.responses.filter((r) => V2_SESSIONS.test(r.url))
                        .length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        const sessionResponses = wire.responses.filter((r) =>
            V2_SESSIONS.test(r.url)
        );
        console.log(
            `[wire] Playback/Sessions statuses=${JSON.stringify(sessionResponses.map((r) => r.status))}`
        );

        // Exactly 200 — asserting merely "not 400" would let a 422/500 pass as a fix.
        expect(
            sessionResponses.map((r) => r.status),
            `Playback/Sessions responses; bodies: ${bodies
                .map((b) => `${b.status}: ${b.text.slice(0, 300)}`)
                .join(' | ')}`
        ).not.toContain(400);
        expect(sessionResponses.some((r) => r.status === 200)).toBe(true);

        // The specific rejection this fix targets must be absent from every response body.
        const allBodies = bodies.map((b) => b.text).join('\n');
        expect(allBodies).not.toContain('The Profiles field is required.');
        expect(allBodies).not.toContain(
            'The VideoRangeTypes field is required.'
        );
    });

    test('the server RECEIVES Profiles: [] and VideoRangeTypes: ["SDR"] on every video codec', async ({
        page
    }) => {
        test.setTimeout(120_000);
        const wire = instrument(page);

        await signInAndPlay(page, itemId);

        await expect
            .poll(
                () =>
                    wire.requests.filter(
                        (r) => r.method === 'POST' && V2_SESSIONS.test(r.url)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        const post = wire.requests.find(
            (r) => r.method === 'POST' && V2_SESSIONS.test(r.url)
        )!;
        expect(post.postData, 'POST Playback/Sessions had no body').toBeTruthy();

        // Assert on the bytes that left the browser, NOT on the builder's return value: the fix
        // depends on an empty array surviving JSON serialization all the way onto the wire.
        const body = JSON.parse(post.postData!);
        const codecs = body?.Capabilities?.Decode?.VideoCodecs ?? [];

        // Printed so a CI run carries the wire evidence itself, not just a green tick.
        console.log(
            `[wire] POST ${post.url}\n[wire] VideoCodecs=${JSON.stringify(codecs)}`
        );

        // Anti-vacuity: an empty list would satisfy the per-entry loop for free.
        expect(
            codecs.length,
            `no VideoCodecs on the wire; body: ${post.postData!.slice(0, 500)}`
        ).toBeGreaterThan(0);

        // Structural assertion over the WHOLE emitted list, not one hand-picked entry.
        expect(
            codecs.map((c: Record<string, unknown>) => ({
                Codec: c.Codec,
                Profiles: c.Profiles,
                VideoRangeTypes: c.VideoRangeTypes
            }))
        ).toEqual(
            codecs.map((c: Record<string, unknown>) => ({
                Codec: c.Codec,
                Profiles: [],
                VideoRangeTypes: ['SDR']
            }))
        );
    });
});

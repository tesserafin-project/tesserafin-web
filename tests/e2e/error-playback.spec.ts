import { expect, test } from './support/origin-inventory';
import { request, type Page, type Route } from '@playwright/test';

/**
 * B1 (#54) — playback failure, through the real product UI.
 *
 * The suite already proves a great deal about playback SUCCEEDING, and
 * `playback-attempt-id-contract.spec.ts` proves that ONE failed media URL is retried under
 * the same attempt id. What nothing proved is what a user is left with when playback fails
 * for good: whether the retry ladder ends in a visible error or in silence, whether the
 * application is still usable afterwards, and whether the dead attempt leaves a transcode
 * running on the server.
 *
 * DETERMINISTIC BY CONSTRUCTION. The failure is produced by refusing every media-byte
 * request in the browser — `route.abort('connectionrefused')` on `/videos/**` — while
 * leaving `PlaybackInfo`, `/Playback/Sessions` and the rest of the API healthy. So a real
 * plan is made, a real session is created, and only the bytes never arrive. No external
 * network, no timing window, no unplayable file that a future codec change might make
 * playable.
 *
 * WHY NOT A BROKEN FIXTURE. A file the browser cannot decode does not fail the same way:
 * the server transcodes it and playback succeeds, which is exactly what
 * `playback-v2-server-contract.spec.ts` asserts. The failure B1 asks about is the one where
 * the media itself cannot be obtained.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * #67 — NO TEST IN THIS FILE IS DECLARED FAILING ANY MORE.
 *
 * "a media failure reaches a visible error state" used to carry a `test.fail()`. It recorded
 * a real defect found by writing it:
 *
 *   after the retry ladder exhausts, NOTHING appeared. No dialog, no toast, no error state,
 *   for at least 24 s. The player OSD stayed mounted over a <video> that would never play,
 *   and the user was given no indication that anything had gone wrong.
 *
 * The code always intended otherwise — `onPlaybackError` falls through to `onPlaybackStopped`
 * with a `displayErrorCode`, and `onPlaybackStopped` calls `showPlaybackInfoErrorMessage`,
 * which shows a real in-DOM dialog. What swallowed it was `onPlaybackStopped`'s in-flight
 * guard: `changeStreamToUrl()` sets `isChangingStream` and only clears it when
 * `player.play()` settles, and a fatal HLS error surfaces through the player's error event
 * instead — so the flag was still set when the terminal stop was dispatched and the whole
 * terminal path, error dialog included, was skipped.
 *
 * The annotation is gone and the assertion is an ordinary one. It is also wider than it was:
 * a visible surface alone is not what B1 asks for. The terminal failure must carry a real
 * translated message, must not sit behind an active spinner or a blank page, must tear the
 * player down rather than leave it over dead media, must be dismissable deterministically
 * without reloading the application, and must still release the server-side session.
 * ────────────────────────────────────────────────────────────────────────────────────────
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-playback-error", Version="0.0.0"';

/** Every media-byte path the player can reach for. Nothing else is touched. */
const MEDIA_BYTES = /\/videos\//i;

/** See auth-session.spec.ts: the element persists; only `mdlSpinnerActive` means "waiting". */
const activeSpinner = (page: Page) =>
    page.locator('.docspinner.mdlSpinnerActive');

/**
 * Every surface the product could legitimately use to say "playback failed": the alert
 * dialog `showPlaybackInfoErrorMessage` builds, a toast, or a React error state. Broad on
 * purpose — B1 requires that SOMETHING visible appears, not that a particular component
 * appears.
 */
const errorSurface = (page: Page) =>
    page
        .locator('dialog[open], .dialogContainer, [role="dialog"]')
        .or(page.locator('.toastContainer .toast'))
        .or(page.locator('[data-rf-slot="state-error"]'))
        .first();

interface Admin {
    api: import('@playwright/test').APIRequestContext;
    token: string;
    userId: string;
}

async function admin(): Promise<Admin> {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await api.post('/Users/AuthenticateByName', {
        headers: { Authorization: AUTH_HEADER },
        data: { Username: USER, Pw: PASSWORD }
    });
    expect(auth.ok(), 'the admin credentials must authenticate').toBe(true);
    const body = await auth.json();
    return {
        api,
        token: `${AUTH_HEADER}, Token="${body.AccessToken}"`,
        userId: String(body.User.Id)
    };
}

async function firstMovieId(a: Admin): Promise<string> {
    const items = await a.api.get('/Items', {
        params: {
            userId: a.userId,
            recursive: 'true',
            includeItemTypes: 'Movie'
        },
        headers: { Authorization: a.token }
    });
    expect(items.status(), 'GET /Items must answer 200').toBe(200);
    const id = (await items.json()).Items?.[0]?.Id;
    expect(id, 'the rig must expose at least one movie fixture').toBeTruthy();
    return String(id);
}

/** How many sessions the server is TRANSCODING right now — the concrete resource a leak costs. */
async function activeTranscodes(a: Admin): Promise<number> {
    const sessions = await a.api.get('/Sessions', {
        headers: { Authorization: a.token }
    });
    expect(sessions.status(), 'GET /Sessions must answer 200').toBe(200);
    const body = (await sessions.json()) as Array<{
        TranscodingInfo?: unknown;
    }>;
    return body.filter((s) => s.TranscodingInfo).length;
}

async function signIn(page: Page) {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), 'the server did not serve the SPA').toBeTruthy();
    const loginName = page.locator('#txtManualName:visible');
    const homeTab = page.getByRole('tab', { name: /accueil|home/i });
    await expect(loginName.or(homeTab).first()).toBeVisible({
        timeout: 25_000
    });
    if (page.url().includes('/login')) {
        const accepted = page.waitForResponse(
            (res) =>
                /\/users\/authenticatebyname/i.test(res.url()) &&
                res.status() < 400,
            { timeout: 15_000 }
        );
        await loginName.fill(USER);
        await page.locator('#txtManualPassword:visible').fill(PASSWORD);
        await page.locator('button[type="submit"]:visible').first().click();
        await accepted;
        await page.waitForURL('**/#/home**', { timeout: 15_000 });
    }
    await expect(page.getByRole('tab', { name: /accueil|home/i })).toBeVisible({
        timeout: 25_000
    });
}

/** Opens the item's real detail page and presses its real play button. */
async function pressPlay(page: Page, itemId: string) {
    await page.goto(`/#/details?id=${itemId}`);
    const play = page
        .locator('button.btnPlay:visible, button[title*="Play" i]:visible')
        .first();
    await expect(
        play,
        'the item detail page must offer a play control'
    ).toBeVisible({ timeout: 25_000 });
    await play.click();
}

const refuseMediaBytes = (route: Route) =>
    MEDIA_BYTES.test(new URL(route.request().url()).pathname)
        ? route.abort('connectionrefused')
        : route.continue();

/** Plays with every media byte refused, and returns the media URLs the player did request. */
async function failPlayback(page: Page, itemId: string): Promise<string[]> {
    const attempted: string[] = [];
    await page.route('**/*', (route) => {
        const url = route.request().url();
        if (MEDIA_BYTES.test(new URL(url).pathname)) attempted.push(url);
        return refuseMediaBytes(route);
    });
    await pressPlay(page, itemId);
    // The player must actually have TRIED — otherwise there is no playback failure to
    // observe, and everything below would be vacuous.
    await expect
        .poll(() => attempted.length, {
            timeout: 25_000,
            message:
                'the player never requested any media bytes, so no playback failure was produced'
        })
        .toBeGreaterThan(0);
    return attempted;
}

test.describe('playback failure (B1)', () => {
    test('a media failure leaves the application usable, exposes no secret, and starts no transcode that outlives it', async ({
        page
    }, testInfo) => {
        const a = await admin();
        try {
            const itemId = await firstMovieId(a);
            const transcodesBefore = await activeTranscodes(a);

            await signIn(page);

            const attempted = await failPlayback(page, itemId);

            // A marker on the document that is live at the moment playback has just failed.
            // It is stamped HERE, not before `pressPlay`, because `pressPlay` reaches the
            // item page through `page.goto`, which is a real document navigation and would
            // wipe it. What must survive is the step under test — leaving the failed
            // playback — and that is the only navigation between this line and the check.
            await page.evaluate(() => {
                (window as unknown as Record<string, unknown>).__b1SpaMarker =
                    'alive';
            });
            testInfo.annotations.push({
                type: 'refused-media-legs',
                description: String(attempted.length)
            });

            // Wait for the terminal error surface before adjudicating anything about the
            // screen. Since #67 the exhausted ladder ends in a real modal dialog, and it
            // arrives asynchronously — so every step below has to be taken relative to it,
            // not relative to the moment the media requests were refused. Its content is the
            // sibling test's subject; here it only has to have arrived.
            const surface = errorSurface(page);
            await expect(
                surface,
                'a playback failure must reach a visible error state before the user can leave it'
            ).toBeVisible({ timeout: 25_000 });

            // Nothing sensitive on screen: not the container's media path, not an API key,
            // not a token, not the password. Asserted on whatever IS shown — the item page
            // the player left behind, with the error dialog over it — see the file header.
            const shown = (
                (await page.locator('body').innerText()) || ''
            ).trim();
            testInfo.annotations.push({
                type: 'after-playback-failure',
                description: shown.slice(0, 300)
            });
            expect(
                shown,
                'the failed attempt must not put the password on screen'
            ).not.toContain(PASSWORD);
            expect(
                shown,
                'the failed attempt must not expose the server-internal media path'
            ).not.toContain('/media/');
            expect(
                /api[_-]?key=|accesstoken|token="/i.test(shown),
                'the failed attempt must not display an API key or access token'
            ).toBe(false);

            // No spinner left spinning.
            await expect(
                activeSpinner(page),
                'the loading indicator must not still be active once playback has failed'
            ).toHaveCount(0);

            // The error dialog is modal: it holds the application until it is dismissed, so
            // "the user can leave" means dismissing it first and then leaving, which is what
            // a user does. Pressing its own button is the deterministic way to do that.
            // Without this step the route change below races the dialog, and a round in
            // which the dialog wins finds no home tab behind it.
            const dismiss = surface
                .locator('button[type="submit"], button')
                .first();
            await expect(
                dismiss,
                'the playback error must be dismissable'
            ).toBeVisible({ timeout: 10_000 });
            await dismiss.click();
            await expect(
                surface,
                'dismissing the playback error must actually close it'
            ).toBeHidden({ timeout: 10_000 });

            // The user can leave. The hash is set directly rather than through `page.goto`,
            // because Playwright's `goto` performs a real document navigation even when only
            // the fragment differs — which would destroy the marker and prove nothing. A
            // hash assignment is what the application's own in-page links do, so this is the
            // client-side route change a user actually performs.
            await page.evaluate(() => {
                window.location.hash = '#/home';
            });
            await expect(
                page.getByRole('tab', { name: /accueil|home/i }),
                'the user must be able to leave a failed playback and reach the app again'
            ).toBeVisible({ timeout: 25_000 });
            expect(
                await page.evaluate(
                    () =>
                        (window as unknown as Record<string, unknown>)
                            .__b1SpaMarker
                ),
                'leaving a failed playback must not require reloading the whole application'
            ).toBe('alive');

            // The dead attempt must not have left an encoder running. Polled, because
            // teardown is asynchronous server-side: a leak is a transcode that is STILL
            // there after the budget, not one that is on its way out.
            await page.unroute('**/*');
            await expect
                .poll(() => activeTranscodes(a), {
                    timeout: 20_000,
                    message:
                        'a failed playback attempt left a transcoding session running on the server'
                })
                .toBeLessThanOrEqual(transcodesBefore);
        } finally {
            await a.api.dispose();
        }
    });

    test('a media failure reaches a visible error state', async ({ page }) => {
        // #67: this was a declared `test.fail()` while the exhausted retry ladder ended in
        // silence. It is an ordinary assertion now, and the assertions below were widened at
        // the same time: "something visible appeared" was never the whole of what B1 asks —
        // the terminal failure also has to end the attempt, release the server-side session
        // and be dismissable deterministically.
        const a = await admin();
        try {
            const itemId = await firstMovieId(a);
            const transcodesBefore = await activeTranscodes(a);

            await signIn(page);
            await failPlayback(page, itemId);

            // The no-reload marker is stamped HERE, after the attempt has been started, and
            // not before it: `failPlayback` reaches the item through `pressPlay`, which uses
            // `page.goto` — a real document navigation that wipes any marker set beforehand.
            // Stamped at this point it covers exactly the window under test: the terminal
            // error appearing, being dismissed, and the user carrying on. Same reasoning, and
            // the same placement, as the sibling test above.
            await page.evaluate(() => {
                (window as unknown as Record<string, unknown>).__b1SpaMarker =
                    'alive';
            });

            // 1. A VISIBLE ERROR SURFACE. The exhausted ladder must say so on screen.
            const surface = errorSurface(page);
            await expect(
                surface,
                'a playback failure must reach a visible error state, not fail silently'
            ).toBeVisible({ timeout: 25_000 });

            // 2. IT MUST CARRY A REAL MESSAGE, not an empty shell. `showPlaybackInfoErrorMessage`
            //    builds `HeaderPlaybackError` + `PlaybackError.<type>`; both are translated, so
            //    this matches the shipped English and French wording rather than a raw key.
            //    A bare key leaking through ("PlaybackError.NETWORK_ERROR") fails here.
            const shown = ((await surface.innerText()) || '').trim();
            expect(
                shown.length,
                'the playback error surface appeared but carries no text'
            ).toBeGreaterThan(0);
            expect(
                shown,
                'the error surface must name a playback failure in the shipped wording'
            ).toMatch(/playback error|erreur de lecture/i);
            expect(
                shown,
                'an untranslated message key reached the screen'
            ).not.toMatch(/PlaybackError\./);

            // 3. NO FALSE SUCCESS AND NO SILENT STOP. The failure is reported while the
            //    application is not pretending to still be working on it: the spinner is not
            //    active behind the message, and the page has not gone blank.
            await expect(
                activeSpinner(page),
                'the application still shows a loading state behind the playback error'
            ).toHaveCount(0);
            expect(
                (await page.locator('body').innerText()).trim().length,
                'the page went blank instead of reporting the playback failure'
            ).toBeGreaterThan(0);

            // 4. THE PLAYER MUST NOT BE LEFT MOUNTED OVER DEAD MEDIA. Before the fix the OSD
            //    and the <video> stayed up indefinitely over media that would never play.
            //    Polled, because teardown is asynchronous.
            await expect
                .poll(
                    () =>
                        page
                            .locator(
                                'video, .videoOsdBottom, .videoPlayerContainer'
                            )
                            .count(),
                    {
                        timeout: 25_000,
                        message:
                            'the player is still mounted over media that will never play'
                    }
                )
                .toBe(0);

            // 5. DISMISSAL IS DETERMINISTIC. The dialog's own button closes it, and the
            //    application is usable immediately afterwards — with no reload (the marker
            //    stamped on the live document before playback must survive).
            const dismiss = surface
                .locator('button[type="submit"], button')
                .first();
            await expect(
                dismiss,
                'the playback error must be dismissable'
            ).toBeVisible({ timeout: 10_000 });
            await dismiss.click();
            await expect(
                surface,
                'dismissing the playback error must actually close it'
            ).toBeHidden({ timeout: 10_000 });

            // Dismissal leaves the user on the item page the failed attempt started from, so
            // "usable again" is asserted the same way the sibling test above asserts it: by
            // performing the client-side route change the application's own links perform, and
            // then requiring the destination to render. `page.goto` is deliberately NOT used —
            // it is a real document navigation even when only the fragment differs, which would
            // reload the SPA and destroy the marker that proves no reload was needed.
            await expect(
                page.locator('button.btnPlay:visible').first(),
                'the item page must still be interactive after the error is dismissed'
            ).toBeVisible({ timeout: 25_000 });
            await page.evaluate(() => {
                window.location.hash = '#/home';
            });
            await expect(
                page.getByRole('tab', { name: /accueil|home/i }),
                'the application must be usable again after the error is dismissed'
            ).toBeVisible({ timeout: 25_000 });
            expect(
                await page.evaluate(
                    () =>
                        (window as unknown as Record<string, unknown>)
                            .__b1SpaMarker
                ),
                'recovering from a playback error must not require reloading the application'
            ).toBe('alive');

            // 6. TEARDOWN STILL COMPLETES. Making the error visible must not cost the
            //    session cleanup that the silent path happened to perform.
            await page.unroute('**/*');
            await expect
                .poll(() => activeTranscodes(a), {
                    timeout: 20_000,
                    message:
                        'reporting the playback error left a transcoding session running on the server'
                })
                .toBeLessThanOrEqual(transcodesBefore);
        } finally {
            await a.api.dispose();
        }
    });

    test('after a failed attempt, playing the same item again is served real media bytes', async ({
        page
    }) => {
        const a = await admin();
        try {
            const itemId = await firstMovieId(a);
            await signIn(page);
            await failPlayback(page, itemId);

            // Let the media through and press play again. No reload, no new context: this is
            // the retry a user performs.
            await page.unroute('**/*');
            const served = page.waitForResponse(
                (res) =>
                    MEDIA_BYTES.test(new URL(res.url()).pathname) &&
                    res.status() < 400,
                { timeout: 25_000 }
            );
            await pressPlay(page, itemId);
            const response = await served;
            expect(
                response.status(),
                'the retry after a failed attempt must actually be served media bytes'
            ).toBeLessThan(400);
        } finally {
            await a.api.dispose();
        }
    });
});

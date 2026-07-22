import { expect, request, test, type Page } from '@playwright/test';

/**
 * First E2E journey of the repo (design-tesserafin-shell-and-routing.md §5):
 * sign in through the real login form, land on the rewritten React /home,
 * check its sections and the keyboard accessibility of the tab strip.
 *
 * ISSUE #38 — why this file waits the way it does.
 *
 * `shows the home sections after sign-in` used to fail intermittently, but only under full-suite
 * load, on `getByRole('tab', …)` with the DEFAULT 5 s `expect` timeout. The old `beforeEach` waited
 * with `page.waitForLoadState('networkidle')` and nothing else, which is not a product condition at
 * all — it is "the network happened to be quiet for 500 ms". Two things make that unreliable here:
 *
 *   1. `waitForURL('** /#/home**')` matches on a HASH change, which is not a navigation. The
 *      document's load state was already `complete` from the /login render, so the `networkidle`
 *      that followed could resolve INSTANTLY, in the quiet gap between the auth response landing
 *      and React requesting the lazily-imported /home chunk. The test then started asserting on a
 *      shell that had not begun mounting, with only 5 s of budget.
 *   2. The app deliberately keeps network activity going: `hooks/useApi` holds the
 *      jellyfin-apiclient WebSocket (`.subscribe()`), and `features/syncPlay`'s
 *      `useSyncPlayGroups` polls on a 60 s `refetchInterval`. `networkidle` is the wrong primitive
 *      for an app that is never idle by design, and Playwright discourages it outright.
 *
 * So `networkidle` is gone from this file. Every wait below is a state of the PRODUCT, and the five
 * states issue #38 asks to tell apart are probed explicitly by {@link readHomeReadiness}, so a
 * future red names WHICH state stalled instead of just "element not found":
 *
 *   navigation terminée   -> `documentReady`   (document.readyState === 'complete')
 *   authentification      -> `authenticated`   (POST /Users/AuthenticateByName observed on the
 *                                               wire with a 2xx, and the URL left /login)
 *   shell Home monté      -> `shellMounted`    (the `role=tablist` strip plus its visible tabpanel
 *                                               exist — static React chrome built from `globalize`,
 *                                               so this proves the /home chunk was fetched AND
 *                                               hydrated, independently of any server data)
 *   sections chargées     -> `pendingSections` (0 `HomeSection`s still rendering `LoadingState`,
 *                                               i.e. every section reached shelf/empty/error)
 *   serveur occupé        -> {@link activeTranscodes} (`GET /Sessions` on the real server, counted
 *                                               before the journey starts)
 *
 * NOTE ON THE OLD "mes médias" ASSERTION: it was never a sections-loaded check. `HomeSection`
 * renders its `<h2>` title in ALL FOUR of its states, loading included, so that title appears the
 * moment the shell mounts. `waitForHomeSectionsSettled` below is the real one.
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-home", Version="0.0.0"';

/** The five states issue #38 asks to distinguish, read straight off the live DOM. */
interface HomeReadiness {
    url: string;
    documentReady: boolean;
    authenticated: boolean;
    shellMounted: boolean;
    /** `HomeSection`s still showing `LoadingState` (`data-rf-slot="state-loading"`). */
    pendingSections: number;
    /** `HomeSection`s that reached a terminal state: shelf, empty or error. */
    settledSections: number;
}

const readHomeReadiness = (page: Page): Promise<HomeReadiness> =>
    page.evaluate(() => {
        const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
        const tabs = document.querySelectorAll('[role="tablist"] [role="tab"]');

        return {
            url: window.location.href,
            documentReady: document.readyState === 'complete',
            authenticated: !window.location.hash.includes('/login'),
            shellMounted: tabs.length > 0 && panel !== null,
            pendingSections: panel
                ? panel.querySelectorAll('[data-rf-slot="state-loading"]')
                      .length
                : -1,
            settledSections: panel
                ? panel.querySelectorAll(
                      '[data-rf-slot="media-shelf"], [data-rf-slot="state-empty"], [data-rf-slot="state-error"]'
                  ).length
                : -1
        };
    });

/**
 * How many playback sessions the server is transcoding RIGHT NOW. Issue #38's leading hypothesis is
 * that a transcode left running by an earlier spec is what makes /home slow at the tail of a full
 * suite run, so the number is recorded rather than assumed — if a red ever comes back, the
 * annotation says whether the server was in fact busy. Returns -1 if the probe itself could not
 * reach the server, which is never a reason to fail the journey under test.
 */
async function activeTranscodes(): Promise<number> {
    const api = await request.newContext({ baseURL: BASE_URL });

    try {
        const auth = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        if (!auth.ok()) return -1;

        const token = (await auth.json()).AccessToken as string;
        const sessions = await api.get('/Sessions', {
            headers: { Authorization: `${AUTH_HEADER}, Token="${token}"` }
        });
        if (!sessions.ok()) return -1;

        const body = (await sessions.json()) as Array<{
            TranscodingInfo?: unknown;
        }>;

        return body.filter((session) => session.TranscodingInfo).length;
    } catch {
        return -1;
    } finally {
        await api.dispose();
    }
}

/**
 * Waits for the PRODUCT condition "the home sections finished loading": every `HomeSection` in the
 * visible tabpanel has left `LoadingState`, and at least one reached a terminal state. Deliberately
 * state-based, not time-based — it returns the instant the last section resolves, so it costs
 * nothing on an idle server while still tolerating a loaded one. It does NOT assert that sections
 * have CONTENT: an empty or errored section is a legitimately settled section, and asserting
 * content here would couple this spec to the rig's media fixtures.
 */
async function waitForHomeSectionsSettled(page: Page, timeout = 30_000) {
    await expect
        .poll(
            async () => {
                const readiness = await readHomeReadiness(page);
                return (
                    readiness.shellMounted &&
                    readiness.pendingSections === 0 &&
                    readiness.settledSections > 0
                );
            },
            {
                timeout,
                message:
                    'home sections never settled — see the home-readiness annotation for the state that stalled'
            }
        )
        .toBe(true);
}

test.describe('home', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        testInfo.annotations.push({
            type: 'server-transcodes-before',
            description: String(await activeTranscodes())
        });

        // navigation terminée, in two parts, because the document is only half the story.
        //   a) the server actually served the SPA — asserted on the response, not on idleness;
        //   b) the SPA booted far enough for its router to DECIDE where we are. `page.goto`
        //      resolves on the document; the hash route is set client-side afterwards, so reading
        //      `page.url()` right away sees a bare `/` and would silently skip the sign-in below.
        //      Standing in for that gap is precisely what the old `networkidle` was doing — badly.
        //      The product condition is "one of the two landing surfaces is on screen".
        const response = await page.goto('/', {
            waitUntil: 'domcontentloaded'
        });
        expect(response?.ok(), 'the server did not serve the SPA').toBeTruthy();

        const loginField = page.locator('#txtManualName:visible');
        const homeTab = page.getByRole('tab', { name: /accueil|home/i });
        await expect(
            loginField.or(homeTab).first(),
            'the SPA never rendered either the login form or the home shell'
        ).toBeVisible({ timeout: 30_000 });

        if (page.url().includes('/login')) {
            await page.locator('#txtManualName:visible').fill(USER);
            await page.locator('#txtManualPassword:visible').fill(PASSWORD);

            // authentification terminée: the auth call itself, observed on the wire, is the signal
            // — not a URL that changed while the token exchange was still in flight.
            // Case-insensitive on purpose: jellyfin-apiclient posts the path lowercased
            // (`Users/authenticatebyname`) while the server documents it in PascalCase, and ASP.NET
            // routes both. Matching one casing literally is a silent way to never match at all.
            const authenticated = page.waitForResponse(
                (res) =>
                    /\/users\/authenticatebyname/i.test(res.url()) &&
                    res.status() < 400,
                { timeout: 20_000 }
            );
            await page.locator('button[type="submit"]:visible').first().click();
            await authenticated;
            await page.waitForURL('**/#/home**', { timeout: 20_000 });
        }

        // shell Home monté: the tab strip is static React chrome, so its presence proves the /home
        // chunk was fetched, evaluated and hydrated. 30 s is a budget for THIS wait only — the
        // global `timeout` in playwright.config.ts is untouched.
        await expect(
            homeTab,
            'the /home shell never mounted its tab strip'
        ).toBeVisible({ timeout: 30_000 });

        testInfo.annotations.push({
            type: 'home-readiness',
            description: JSON.stringify(await readHomeReadiness(page))
        });
    });

    test('shows the home sections after sign-in', async ({
        page
    }, testInfo) => {
        await expect(
            page.getByRole('tab', { name: /accueil|home/i })
        ).toBeVisible();
        await expect(
            page.getByRole('tab', { name: /favoris|favorites/i })
        ).toBeVisible();

        // sections réellement chargées — the product condition that replaces the old 5 s gamble.
        await waitForHomeSectionsSettled(page);

        testInfo.annotations.push({
            type: 'home-readiness-settled',
            description: JSON.stringify(await readHomeReadiness(page))
        });

        const homePanel = page.getByRole('tabpanel');
        await expect(homePanel.getByText(/mes médias|my media/i)).toBeVisible();
    });

    test('switches to favorites and syncs the ?tab= url param', async ({
        page
    }) => {
        await page.getByRole('tab', { name: /favoris|favorites/i }).click();
        await expect(page).toHaveURL(/tab=1/);

        await page.getByRole('tab', { name: /accueil|home/i }).click();
        await expect(page).toHaveURL(/tab=0/);
    });

    test('tab strip is keyboard operable (arrow keys, roving tabindex)', async ({
        page
    }) => {
        const homeTab = page.getByRole('tab', { name: /accueil|home/i });
        const favoritesTab = page.getByRole('tab', {
            name: /favoris|favorites/i
        });

        await homeTab.focus();
        await expect(homeTab).toBeFocused();

        await page.keyboard.press('ArrowRight');
        await expect(favoritesTab).toBeFocused();

        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/tab=1/);
    });
});

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { expect, test } from './support/origin-inventory';
import { request } from '@playwright/test';

/**
 * Reefin Glass (RFC-0005 §8.2) capture + regression journey (W13.8a).
 *
 * Proves that selecting the lazy-loaded `official.glass` theme actually pushes its `--rf-*`
 * frosted tokens onto `/home` and `/library` — not just that the theme is registered. The
 * discriminator is the resolved `--rf-blur-md` custom property on `<html>`, which can only differ
 * if the Glass token chunk really loaded and its `[data-rf-theme="official.glass"]` rules won the
 * cascade: it resolves to `0` under Classic (statically bundled) and `16px` under Glass. Note that
 * the media card does not consume `--rf-blur-md` directly — it reads the *derived*
 * `--rf-backdrop-filter-md` (`src/ui/styles/_glass-surface.scss`), since `blur(0)` and `none` are
 * not equivalent; `--rf-blur-md` is asserted here purely as the discriminator for chunk arrival,
 * which keeps the check independent of transient shelf/library render state.
 * Both themes are also screenshotted on both routes so the visual difference can be reviewed as an
 * artifact (RFC-0005 §8.2 asks for dedicated Playwright captures).
 *
 * Theme selection mirrors a returning user: the app persists the chosen theme under the
 * user-scoped `"<userId>-appTheme"` localStorage key (`scripts/settings/appSettings.js`'s
 * `#getKey`), read back on boot by `scripts/themeManager.js`, so the test writes that key and
 * reloads rather than reaching into the React tree. `userId`/`libraryId` are resolved once via a
 * direct API login, the same pattern `library.spec.ts` uses.
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const CAPTURE_DIR =
    process.env.TESSERAFIN_E2E_CAPTURE_DIR ??
    resolve(process.cwd(), 'test-results', 'glass-captures');

const AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-glass", Version="0.0.0"';

const capturePath = (name: string): string => {
    const path = resolve(CAPTURE_DIR, name);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return path;
};

test.describe('theme: Reefin Glass', () => {
    let userId = '';
    let libraryId = '';

    test.beforeAll(async () => {
        const api = await request.newContext({ baseURL: BASE_URL });

        const authResponse = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        expect(authResponse.ok()).toBeTruthy();
        const auth = await authResponse.json();
        userId = auth.User.Id;

        const viewsResponse = await api.get('/UserViews', {
            params: { userId },
            headers: {
                Authorization: `${AUTH_HEADER}, Token="${auth.AccessToken}"`
            }
        });
        expect(viewsResponse.ok()).toBeTruthy();
        const views = await viewsResponse.json();
        const moviesView = (
            views.Items as Array<Record<string, unknown>>
        )?.find((item) => item.CollectionType === 'movies');
        expect(moviesView?.Id).toBeTruthy();
        libraryId = String(moviesView?.Id);

        await api.dispose();
    });

    /**
     * The app has finished booting into an authenticated session and is rendering real content.
     *
     * Home tabs only exist behind a live session, so this is false on the login screen and false
     * mid-boot — which is exactly the distinction every helper below needs, and exactly the one a
     * network-idle wait cannot make.
     */
    const expectSignedIn = async (page: import('@playwright/test').Page) => {
        await expect(page.getByRole('tab').first()).toBeVisible({
            timeout: 20_000
        });
    };

    /**
     * Signs in, waiting on product conditions rather than on a network state (issue #38).
     *
     * `networkidle` is the wrong instrument for this app: it keeps connections open (the session
     * websocket, background polling), so "no network activity for 500ms" is not a state it
     * reliably reaches. When it does not, `waitForLoadState` fails on its own timeout — which is a
     * failure of the wait, not of the product, and is exactly the flake class #38 exists to remove.
     * Every wait below is instead an observable fact this spec actually depends on.
     */
    const signIn = async (page: import('@playwright/test').Page) => {
        await page.goto('/');

        const userField = page.locator('#txtManualName:visible');
        const homeTab = page.getByRole('tab').first();

        // Wait for whichever of the two possible screens actually arrives — the sign-in form, or
        // an already-authenticated home.
        //
        // The URL is deliberately NOT the discriminator, and this is the trap that makes
        // `networkidle` look load-bearing here: the router settles on `#/home` while the sign-in
        // form is still what is on screen, only later rewriting the URL to `#/login?...`. A check
        // like `page.url().includes('/login')` therefore reports "already signed in" for a
        // signed-out visitor unless something has slowed the test down enough for the URL to
        // catch up — which is all `networkidle` was really contributing. Asserting on the form
        // itself is both faster and correct at any speed.
        await expect(userField.or(homeTab).first()).toBeVisible({
            timeout: 20_000
        });

        if (await userField.isVisible()) {
            await userField.fill(USER);
            await page.locator('#txtManualPassword:visible').fill(PASSWORD);
            await page.locator('button[type="submit"]:visible').first().click();
        }

        // Authenticated content is rendering. This is the readiness every later step depends on,
        // and unlike a network state it cannot be true while the app is still on the login screen.
        await expectSignedIn(page);
    };

    const applyTheme = async (
        page: import('@playwright/test').Page,
        themeId: string
    ) => {
        await page.evaluate(
            ([key, value]) => window.localStorage.setItem(key, value),
            [`${userId}-appTheme`, themeId]
        );
        await page.reload();

        // Two conditions, and the first is not redundant.
        //
        // `data-rf-theme` alone is NOT a sufficient readiness signal, because for the DEFAULT
        // theme it is already correct while the app is still on the login screen: the theme
        // runtime mounts and writes `official.classic` before any session is restored. A helper
        // that waited only on the attribute would therefore return a half-booted page for Classic
        // (and only for Classic), and the navigation that follows would interrupt the session
        // restore — landing the next assertion on the sign-in form. That is precisely the failure
        // `networkidle` used to mask, and why removing it exposed a defect only in the Classic
        // test while the Glass test kept passing.
        //
        // So: wait for the session to be genuinely back, THEN for the requested theme to be the
        // one applied.
        await expectSignedIn(page);
        await expect(page.locator('html')).toHaveAttribute(
            'data-rf-theme',
            themeId,
            { timeout: 20_000 }
        );
    };

    // The frosted identity is delivered by the `--rf-blur-md` token, which resolves to `0` under
    // Classic (statically bundled) and `16px` under Glass — but only once Glass's lazy token chunk
    // has injected its `[data-rf-theme="official.glass"]` rules. Asserting the resolved custom
    // property on `<html>` proves the frosted chunk actually reached the page, independently of
    // whether any given media shelf has rendered a `.rf-media-card` yet (which varies with library
    // state and lazy shelves) — the card CSS that consumes this token is unit-covered separately.
    // `data-rf-theme` flips before the chunk lands, so poll rather than read once.
    const readBlurToken = (
        page: import('@playwright/test').Page
    ): Promise<string> =>
        page.evaluate(() =>
            getComputedStyle(document.documentElement)
                .getPropertyValue('--rf-blur-md')
                .trim()
        );

    const expectBlurToken = async (
        page: import('@playwright/test').Page,
        pattern: RegExp
    ) => {
        await expect
            .poll(() => readBlurToken(page), { timeout: 20_000 })
            .toMatch(pattern);
    };

    // These routes are reached with a plain `goto`, and deliberately without the `reload()` that
    // used to follow it.
    //
    // The reload was there because a goto that only changes the HASH is treated as
    // already-complete and can leave the SPA mid-transition. That reasoning does not apply to
    // these two calls: the app is served from `/web/`, so navigating to `/#/...` changes the path
    // as well as the hash and is a real document navigation that boots the app on the target
    // route. The extra reload therefore forced a SECOND boot that interrupted the first one — and
    // interrupting a boot is what strands the app on the sign-in form, since the session restore
    // never completes.
    //
    // The route-specific element each helper waits for is the readiness condition on its own: it
    // is something the route renders and the other route does not, so it proves both that the page
    // is up and that the /home and /library captures cannot alias. No network-state wait sits in
    // front of it, since `networkidle` would only add a weaker gate that can time out while the
    // product is perfectly ready (see `signIn`).
    const gotoHome = async (page: import('@playwright/test').Page) => {
        await page.goto('/#/home');
        await expectSignedIn(page);
    };

    const gotoLibrary = async (page: import('@playwright/test').Page) => {
        await page.goto(`/#/library/${libraryId}`);
        await expect(page.locator('[data-rf-slot="media-grid"]')).toBeVisible({
            timeout: 20_000
        });
    };

    test('Classic (default) renders flat surfaces on /home and /library', async ({
        page
    }) => {
        await signIn(page);
        await applyTheme(page, 'official.classic');

        await gotoHome(page);
        await expectBlurToken(page, /^0(px)?$/);
        await page.screenshot({ path: capturePath('classic-home.png') });

        await gotoLibrary(page);
        await expectBlurToken(page, /^0(px)?$/);
        await page.screenshot({ path: capturePath('classic-library.png') });
    });

    test('Glass frosts the same surfaces on /home and /library', async ({
        page
    }) => {
        await signIn(page);
        await applyTheme(page, 'official.glass');

        await gotoHome(page);
        await expectBlurToken(page, /^16px$/);
        await page.screenshot({ path: capturePath('glass-home.png') });

        await gotoLibrary(page);
        await expectBlurToken(page, /^16px$/);
        await page.screenshot({ path: capturePath('glass-library.png') });
    });
});

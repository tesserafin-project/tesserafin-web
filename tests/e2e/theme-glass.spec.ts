import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { expect, request, test } from '@playwright/test';

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

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const CAPTURE_DIR =
    process.env.REEFIN_E2E_CAPTURE_DIR ??
    resolve(process.cwd(), 'test-results', 'glass-captures');

const AUTH_HEADER =
    'MediaBrowser Client="Reefin Web E2E", Device="Playwright", DeviceId="reefin-e2e-glass", Version="0.0.0"';

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

    const signIn = async (page: import('@playwright/test').Page) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        if (page.url().includes('/login')) {
            await page.locator('#txtManualName:visible').fill(USER);
            await page.locator('#txtManualPassword:visible').fill(PASSWORD);
            await page.locator('button[type="submit"]:visible').first().click();
            await page.waitForURL('**/#/home**', { timeout: 20_000 });
        }
        await page.waitForLoadState('networkidle');
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
        await page.waitForLoadState('networkidle');
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

    // A goto that only changes the hash is treated as already-complete by Playwright and can leave
    // the SPA mid-transition, so navigate then `reload()` to force a real boot + route render (the
    // theme persists in localStorage, so the reload keeps whichever theme `applyTheme` selected).
    // Then wait for a route-specific element so the /home and /library captures can't alias.
    const gotoHome = async (page: import('@playwright/test').Page) => {
        await page.goto('/#/home');
        await page.reload();
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('tab').first()).toBeVisible({
            timeout: 20_000
        });
    };

    const gotoLibrary = async (page: import('@playwright/test').Page) => {
        await page.goto(`/#/library/${libraryId}`);
        await page.reload();
        await page.waitForLoadState('networkidle');
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

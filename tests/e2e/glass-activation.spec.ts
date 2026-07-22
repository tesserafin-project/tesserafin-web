import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { expect, request, test, type Page } from '@playwright/test';

/**
 * Reefin Glass activation journey and captures (RFC-0005 §8.2, issue #18 / W13.8b).
 *
 * This is the half of the Glass proof that a real Reefin server is required for. Its companions —
 * `./glass-interaction-profiles.spec.ts` and `./glass-light-and-sidebar.spec.ts` — prove what the
 * browser *computes* for the token chain against a `setContent` fixture, and deliberately need no
 * server. What they cannot show is that a user can actually get there: that Glass appears in the
 * real theme picker now that `experimental` is lifted, that choosing it applies the theme, and that
 * the choice survives a reload. Those are assertions about the application, so they are made
 * against the application.
 *
 * RFC-0005 §8.2 also asks for dedicated desktop/mobile/TV captures. They are produced here, at the
 * three viewports, for both Glass modes — against the running app, never against a fixture page.
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const CAPTURE_DIR =
    process.env.TESSERAFIN_E2E_CAPTURE_DIR ??
    resolve(process.cwd(), 'test-results', 'glass-captures');

const AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-glass-activation", Version="0.0.0"';

/** The three form factors RFC-0005 §8.2 asks for captures at. */
const VIEWPORTS = {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
    tv: { width: 1920, height: 1080 }
} as const;

const capturePath = (name: string): string => {
    const path = resolve(CAPTURE_DIR, name);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return path;
};

test.describe('Reefin Glass: activation', () => {
    let userId = '';

    test.beforeAll(async () => {
        const api = await request.newContext({ baseURL: BASE_URL });
        const authResponse = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        expect(authResponse.ok()).toBeTruthy();
        const auth = await authResponse.json();
        userId = auth.User.Id;
        await api.dispose();
    });

    const signIn = async (page: Page) => {
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

    /**
     * The theme picker is a MUI `Select` (`DisplayPreferences.tsx`), not a native `<select>`: it
     * renders a `combobox` plus a hidden input, and its options exist in the DOM only while the
     * listbox is open. Hence the open/read/choose dance below rather than `selectOption`.
     *
     * `~=` rather than `=`: MUI sets `aria-labelledby` to a *space-separated* list of ids, so an
     * exact-value match never selects this element even when it is on the page.
     */
    const THEME_COMBOBOX = '[aria-labelledby~="display-settings-theme-label"]';

    /**
     * The preferences route is served by the legacy controller and needs both its `userId` query
     * parameter and an in-app (hash) navigation: a `goto` + `reload` straight at the bare path
     * boots into an empty `<main>`, which is what an earlier version of this spec was timing out
     * against.
     */
    const gotoDisplayPreferences = async (page: Page) => {
        await page.evaluate((id) => {
            window.location.hash = `#/mypreferencesdisplay?userId=${id}`;
        }, userId);
        await expect(page.locator(THEME_COMBOBOX).first()).toBeVisible({
            timeout: 20_000
        });
    };

    const openThemePicker = async (page: Page) => {
        await page.locator(THEME_COMBOBOX).first().click();
        await expect(page.locator('[role="listbox"]')).toBeVisible({
            timeout: 10_000
        });
    };

    const chooseTheme = async (page: Page, themeId: string) => {
        await openThemePicker(page);
        await page.locator(`[role="option"][data-value="${themeId}"]`).click();
        await expect(page.locator('[role="listbox"]')).toBeHidden({
            timeout: 10_000
        });
    };

    const save = async (page: Page) => {
        await page.getByRole('button', { name: /save/i }).first().click();
    };

    const readBlurToken = (page: Page): Promise<string> =>
        page.evaluate(() =>
            getComputedStyle(document.documentElement)
                .getPropertyValue('--rf-blur-md')
                .trim()
        );

    const expectBlurToken = async (page: Page, pattern: RegExp) => {
        await expect
            .poll(() => readBlurToken(page), { timeout: 20_000 })
            .toMatch(pattern);
    };

    test('offers both Glass modes in the real theme picker', async ({
        page
    }) => {
        await signIn(page);
        await gotoDisplayPreferences(page);

        await openThemePicker(page);
        const options = await page
            .locator('[role="option"]')
            .evaluateAll((nodes) =>
                nodes.map((node) => ({
                    value: (node as HTMLElement).dataset.value,
                    label: node.textContent?.trim()
                }))
            );

        // The activation itself, observed where a user would see it. While Glass was
        // `experimental`, `getSelectableThemes()` filtered both of these out.
        expect(options.map((option) => option.value)).toContain(
            'official.glass'
        );
        expect(options.map((option) => option.value)).toContain(
            'official.glass.light'
        );
        // The visible label carries the experimental badge's text ("Experimental") appended by
        // the picker — G18b-1 ships Glass badged, not bare — so match on the leading name.
        const labels = options.map((option) => option.label ?? '');
        expect(labels.some((label) => label.startsWith('Reefin Glass'))).toBe(
            true
        );
        expect(
            labels.some((label) => label.startsWith('Reefin Glass Light'))
        ).toBe(true);
    });

    test('selecting Glass from the picker applies the frosted theme', async ({
        page
    }) => {
        await signIn(page);
        await gotoDisplayPreferences(page);

        // Glass's tokens are lazy, so Classic's `0` here is also the discriminator: whatever the
        // page shows after the selection cannot have been present beforehand.
        await expectBlurToken(page, /^0(px)?$/);

        await chooseTheme(page, 'official.glass');
        await save(page);

        await expect(page.locator('html')).toHaveAttribute(
            'data-rf-theme',
            'official.glass',
            { timeout: 20_000 }
        );
        // The chunk really arrived and its rules won the cascade.
        await expectBlurToken(page, /^16px$/);
    });

    test('restores the selected theme after a reload', async ({ page }) => {
        await signIn(page);
        await gotoDisplayPreferences(page);

        await chooseTheme(page, 'official.glass');
        await save(page);
        await expectBlurToken(page, /^16px$/);

        // Persistence is the app's existing user-scoped `"<userId>-appTheme"` mechanism; what this
        // asserts is that Glass travels through it like any other theme, and that the lazy chunk is
        // re-fetched on a cold boot rather than only on the transition that selected it.
        await page.goto('/#/home');
        await page.reload();
        await page.waitForLoadState('networkidle');

        await expect(page.locator('html')).toHaveAttribute(
            'data-rf-theme',
            'official.glass',
            { timeout: 20_000 }
        );
        await expectBlurToken(page, /^16px$/);

        const persisted = await page.evaluate(
            (key) => window.localStorage.getItem(key),
            `${userId}-appTheme`
        );
        expect(persisted).toBe('official.glass');
    });

    test('selecting Glass Light applies the light tier of the same stylesheet', async ({
        page
    }) => {
        await signIn(page);
        await gotoDisplayPreferences(page);

        await chooseTheme(page, 'official.glass.light');
        await save(page);

        // The `tokenThemeId` indirection, observed in the running app: the *entry* is
        // `official.glass.light`, the stylesheet it selects is `official.glass`'s, and the mode
        // attribute is what picks the light color tier out of it.
        await expect(page.locator('html')).toHaveAttribute(
            'data-rf-theme',
            'official.glass',
            { timeout: 20_000 }
        );
        await expect(page.locator('html')).toHaveAttribute(
            'data-rf-mode',
            'light',
            { timeout: 20_000 }
        );

        // Still frosted: blur is not per-mode.
        await expectBlurToken(page, /^16px$/);

        // Resolved *through* the browser rather than read as a raw custom-property string. A
        // custom property comes back exactly as authored, and the production CSS pipeline minifies
        // `rgba(255, 255, 255, 0.55)` to `#ffffff8c` — the same color in a different notation, so a
        // textual comparison against the source would fail on a correct build. Assigning it to a
        // real `background-color` makes Chromium normalize it, which is also the form that actually
        // gets painted.
        const surface = await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.style.backgroundColor = 'var(--rf-color-surface)';
            document.body.appendChild(probe);
            const resolved = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return resolved;
        });
        // Translucent white: still frosted, and demonstrably the light tier rather than the dark
        // one (which would resolve to rgba(22, 27, 38, 0.55)).
        expect(surface).toBe('rgba(255, 255, 255, 0.55)');
    });
});

test.describe('Reefin Glass: desktop / mobile / TV captures', () => {
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

    for (const [formFactor, viewport] of Object.entries(VIEWPORTS)) {
        for (const themeId of [
            'official.glass',
            'official.glass.light'
        ] as const) {
            const label = themeId.endsWith('.light') ? 'glass-light' : 'glass';

            test(`${label} on /home and /library at ${formFactor}`, async ({
                page
            }) => {
                await page.setViewportSize(viewport);

                /**
                 * The TV form factor is a *layout*, not a resolution: `components/layoutManager`
                 * publishes it as the `layout-tv` class on `<html>`, and 1920x1080 in a desktop
                 * Chromium otherwise renders the plain desktop layout. Capturing at that size and
                 * calling it TV would label a desktop shot as something it is not — so the class is
                 * applied on the page, before capture, for the `tv` viewport only.
                 *
                 * This also makes the TV capture show the `remote` interaction profile doing its
                 * job: `interactionProfileSignals` watches exactly this class, so the larger targets
                 * and type proved in `glass-light-and-sidebar.spec.ts` are what gets photographed.
                 */
                const applyTvLayout = async () => {
                    if (formFactor !== 'tv') return;
                    await page.evaluate(() =>
                        document.documentElement.classList.add('layout-tv')
                    );
                };

                await page.goto('/');
                await page.waitForLoadState('networkidle');
                if (page.url().includes('/login')) {
                    await page.locator('#txtManualName:visible').fill(USER);
                    await page
                        .locator('#txtManualPassword:visible')
                        .fill(PASSWORD);
                    await page
                        .locator('button[type="submit"]:visible')
                        .first()
                        .click();
                    await page.waitForURL('**/#/home**', { timeout: 20_000 });
                }
                await page.waitForLoadState('networkidle');

                await page.evaluate(
                    ([key, value]) => window.localStorage.setItem(key, value),
                    [`${userId}-appTheme`, themeId]
                );

                await page.goto('/#/home');
                await page.reload();
                await page.waitForLoadState('networkidle');

                // Wait for the theme to be live before capturing, so the image cannot record a
                // pre-chunk frame that shows Classic under a Glass filename.
                await expect(page.locator('html')).toHaveAttribute(
                    'data-rf-theme',
                    'official.glass',
                    { timeout: 20_000 }
                );
                await expect
                    .poll(
                        () =>
                            page.evaluate(() =>
                                getComputedStyle(document.documentElement)
                                    .getPropertyValue('--rf-blur-md')
                                    .trim()
                            ),
                        { timeout: 20_000 }
                    )
                    .toMatch(/^16px$/);
                await expect(page.getByRole('tab').first()).toBeVisible({
                    timeout: 20_000
                });

                await applyTvLayout();
                await page.screenshot({
                    path: capturePath(`${label}-home-${formFactor}.png`)
                });

                // `/library` as well as `/home`: the home route of this fixture server has no
                // populated shelves, so a home capture shows the chrome but none of the frosted
                // media surfaces that are the point of Glass. The library grid does render them.
                await page.goto(`/#/library/${libraryId}`);
                await page.reload();
                await page.waitForLoadState('networkidle');
                await expect(
                    page.locator('[data-rf-slot="media-grid"]')
                ).toBeVisible({ timeout: 20_000 });
                await expect(page.locator('html')).toHaveAttribute(
                    'data-rf-theme',
                    'official.glass',
                    { timeout: 20_000 }
                );

                await applyTvLayout();
                // On TV the `remote` profile must actually be engaged in the captured frame, not
                // merely requested — otherwise this is a desktop shot at 1920x1080.
                if (formFactor === 'tv') {
                    await expect(page.locator('html')).toHaveAttribute(
                        'data-rf-profile',
                        'remote',
                        { timeout: 20_000 }
                    );
                }

                await page.screenshot({
                    path: capturePath(`${label}-library-${formFactor}.png`)
                });
            });
        }
    }
});

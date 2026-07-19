import { expect, request, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

/**
 * Reefin Glass selection journey (issue #18, slice G18b-1) against a real server.
 *
 * `theme-glass.spec.ts` proves what Glass *looks like* once applied, and applies it by writing the
 * persistence key directly — which was the only way to reach Glass while it was hidden. This spec
 * proves the thing that slice actually changed: that a user can **select Glass from the product's
 * own theme picker**, that the choice survives a reload, that they can get back to Classic, and
 * that Glass's interaction profiles engage under real platform signals and only under Glass.
 *
 * Every assertion reads **computed styles** out of Chromium's style engine, never just a DOM
 * attribute. `data-rf-theme` flips the moment the id changes — before Glass's lazily-imported
 * chunk has injected anything — so asserting it would pass against a theme that never actually
 * painted. The discriminator is `--rf-blur-md` on `<html>`: `0` under Classic (statically
 * bundled), `16px` under Glass, and moved to a profile's own value when a profile is active. Its
 * derived companion `--rf-backdrop-filter-md` is asserted alongside it, because that is the
 * property `_glass-surface.scss` actually reads and `blur(0)` is not `none`.
 *
 * ## Emulating the platform signals
 *
 * Playwright's `emulateMedia` covers `prefers-reduced-motion` but knows nothing about
 * `prefers-reduced-transparency` or `update`. Both are driven here through CDP
 * (`Emulation.setEmulatedMedia`), which is Chromium's own media-feature emulation — the same
 * mechanism `emulateMedia` is built on — so the browser resolves the query for real rather than
 * the page being told what to think. `remote` is not a media query at all: it is the `layout-tv`
 * class `components/layoutManager` writes on `<html>`, so the test writes exactly that.
 */

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const AUTH_HEADER =
    'MediaBrowser Client="Reefin Web E2E", Device="Playwright", DeviceId="reefin-e2e-glass-selection", Version="0.0.0"';

const GLASS_ID = 'official.glass';
const CLASSIC_ID = 'official.classic';

/** The preferences route the modern display picker renders at (`asyncRoutes/user.ts`). */
const PREFERENCES_ROUTE = '/#/mypreferencesdisplay';

test.describe('theme: selecting Reefin Glass', () => {
    let userId = '';

    test.beforeAll(async () => {
        const api = await request.newContext({ baseURL: BASE_URL });
        const authResponse = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        expect(authResponse.ok()).toBeTruthy();
        userId = (await authResponse.json()).User.Id;
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

    /** Reads a resolved custom property off `<html>` — the browser's own computed value. */
    const readVar = (page: Page, name: string): Promise<string> =>
        page.evaluate(
            (property) =>
                getComputedStyle(document.documentElement)
                    .getPropertyValue(property)
                    .trim(),
            name
        );

    const expectVar = async (page: Page, name: string, expected: string) => {
        await expect
            .poll(() => readVar(page, name), { timeout: 20_000 })
            .toBe(expected);
    };

    /** The whole frosted contract in one read: the primitive and its derived companion. */
    const expectBlur = async (
        page: Page,
        blur: string,
        backdropFilter: string
    ) => {
        await expectVar(page, '--rf-blur-md', blur);
        await expectVar(page, '--rf-backdrop-filter-md', backdropFilter);
    };

    const gotoPreferences = async (page: Page) => {
        await page.goto(PREFERENCES_ROUTE);
        // A hash-only navigation can be treated as already complete, leaving the SPA mid-render.
        await page.reload();
        await page.waitForLoadState('networkidle');
        await expect(
            page.locator('[aria-labelledby="display-settings-theme-label"]')
        ).toBeVisible({ timeout: 20_000 });
    };

    /**
     * Selects a theme the way a user does: open the picker, click the option, submit the form.
     * Deliberately no `localStorage` writes — that the *product's* selection path reaches the
     * theme runtime is the claim under test.
     */
    const selectThemeFromUi = async (page: Page, themeName: string) => {
        await page
            .locator('[aria-labelledby="display-settings-theme-label"]')
            .click();
        await page
            .getByRole('option', { name: new RegExp(themeName) })
            .click();
        await page.getByRole('button', { name: /Save/i }).click();
    };

    const setEmulatedFeatures = async (
        client: CDPSession,
        features: Array<{ name: string; value: string }>
    ) => {
        await client.send('Emulation.setEmulatedMedia', { features });
    };

    test('the picker offers Glass, badged, with Classic still the default', async ({
        page
    }) => {
        await signIn(page);
        await gotoPreferences(page);

        // Nothing was selected yet, so what the picker shows is what an unset preference resolves
        // to — Classic. This is the "no auto-activation" guarantee, observed rather than assumed.
        await expectBlur(page, '0', 'none');

        await page
            .locator('[aria-labelledby="display-settings-theme-label"]')
            .click();

        const glassOption = page.getByRole('option', { name: /Reefin Glass/ });
        await expect(glassOption).toBeVisible();
        // The badge is a real element, not a naming convention: assert the marker the component
        // sets, so a translated build still satisfies this.
        await expect(glassOption).toHaveAttribute(
            'data-rf-experimental',
            'true'
        );
        await expect(glassOption).toContainText(/Experimental/i);

        // Classic is offered and is NOT badged.
        const classicOption = page.getByRole('option', {
            name: /Reefin Classic/
        });
        await expect(classicOption).toBeVisible();
        await expect(classicOption).not.toHaveAttribute(
            'data-rf-experimental',
            'true'
        );

        await page.keyboard.press('Escape');
    });

    test('selecting Glass from the picker frosts the app, and a reload restores it', async ({
        page
    }) => {
        await signIn(page);
        await gotoPreferences(page);
        await expectBlur(page, '0', 'none');

        await selectThemeFromUi(page, 'Reefin Glass');

        // Selection alone must reach the runtime — no reload, no navigation.
        await expectBlur(page, '16px', 'blur(16px)');
        await expect(page.locator('html')).toHaveAttribute(
            'data-rf-theme',
            GLASS_ID
        );

        // Persistence + restoration: a full boot, with only what the app itself stored.
        await page.reload();
        await page.waitForLoadState('networkidle');
        await expectBlur(page, '16px', 'blur(16px)');

        // And on a different route, so this is the app's theme and not a page-local artifact.
        await page.goto('/#/home');
        await page.reload();
        await page.waitForLoadState('networkidle');
        await expectBlur(page, '16px', 'blur(16px)');
    });

    test('switching back to Classic from the picker restores flat surfaces', async ({
        page
    }) => {
        await signIn(page);
        await gotoPreferences(page);
        await selectThemeFromUi(page, 'Reefin Glass');
        await expectBlur(page, '16px', 'blur(16px)');

        await selectThemeFromUi(page, 'Reefin Classic');

        await expectBlur(page, '0', 'none');
        await expect(page.locator('html')).toHaveAttribute(
            'data-rf-theme',
            CLASSIC_ID
        );
        // Glass's profile projection must be gone, not merely overridden.
        await expect(page.locator('html')).not.toHaveAttribute(
            'data-rf-profile',
            /.*/
        );

        await page.reload();
        await page.waitForLoadState('networkidle');
        await expectBlur(page, '0', 'none');
    });

    test.describe('interaction profiles under a real signal', () => {
        test('reducedTransparency drives blur to a real none and opaque surfaces', async ({
            page
        }) => {
            await signIn(page);
            await gotoPreferences(page);
            await selectThemeFromUi(page, 'Reefin Glass');
            await expectBlur(page, '16px', 'blur(16px)');

            const client = await page.context().newCDPSession(page);
            await setEmulatedFeatures(client, [
                { name: 'prefers-reduced-transparency', value: 'reduce' }
            ]);

            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-profile',
                'reducedTransparency'
            );
            // `blur(0)` still composites; the derivation must yield a real `none`.
            await expectBlur(page, '0', 'none');
            await expectVar(page, '--rf-color-surface', '#141a22');

            // Reversible: dropping the signal restores Glass exactly.
            await setEmulatedFeatures(client, []);
            await expectBlur(page, '16px', 'blur(16px)');
            await expect(page.locator('html')).not.toHaveAttribute(
                'data-rf-profile',
                /.*/
            );
        });

        test('reducedMotion zeroes durations on its own orthogonal axis', async ({
            page
        }) => {
            await signIn(page);
            await gotoPreferences(page);
            await selectThemeFromUi(page, 'Reefin Glass');

            await page.emulateMedia({ reducedMotion: 'reduce' });

            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-reduced-motion',
                'true'
            );
            await expectVar(page, '--rf-motion-duration-normal', '0ms');
            // Orthogonal: motion is zeroed, translucency is untouched.
            await expectBlur(page, '16px', 'blur(16px)');

            await page.emulateMedia({ reducedMotion: 'no-preference' });
            await expectVar(page, '--rf-motion-duration-normal', '200ms');
        });

        test('lowPower flattens blur, and remote loses to it in the cascade', async ({
            page
        }) => {
            await signIn(page);
            await gotoPreferences(page);
            await selectThemeFromUi(page, 'Reefin Glass');

            const client = await page.context().newCDPSession(page);
            await setEmulatedFeatures(client, [
                { name: 'update', value: 'slow' }
            ]);

            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-profile',
                'lowPower'
            );
            await expectBlur(page, '4px', 'blur(4px)');

            // `remote` applies before `lowPower`, so the combination must resolve to lowPower's
            // blur while still carrying remote's own (non-conflicting) typography.
            await page.evaluate(() =>
                document.documentElement.classList.add('layout-tv')
            );
            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-profile',
                'lowPower'
            );
            await expectBlur(page, '4px', 'blur(4px)');
            await expectVar(page, '--rf-typography-font-size-lg', '1.375rem');

            // Dropping lowPower leaves remote alone, with its own cheaper blur.
            await setEmulatedFeatures(client, []);
            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-profile',
                'remote'
            );
            await expectBlur(page, '10px', 'blur(10px)');

            await page.evaluate(() =>
                document.documentElement.classList.remove('layout-tv')
            );
            await expectBlur(page, '16px', 'blur(16px)');
        });

        test('no signal moves anything while Classic is active', async ({
            page
        }) => {
            await signIn(page);
            await gotoPreferences(page);
            // Explicitly Classic, so this is a guard test and not an unset-preference test.
            await selectThemeFromUi(page, 'Reefin Classic');
            await expectBlur(page, '0', 'none');

            const client = await page.context().newCDPSession(page);
            await setEmulatedFeatures(client, [
                { name: 'prefers-reduced-transparency', value: 'reduce' },
                { name: 'update', value: 'slow' }
            ]);
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.evaluate(() =>
                document.documentElement.classList.add('layout-tv')
            );

            // Every signal is on. Classic must be untouched: no projection, no attributes.
            await expectBlur(page, '0', 'none');
            await expect(page.locator('html')).not.toHaveAttribute(
                'data-rf-profile',
                /.*/
            );
            await expect(page.locator('html')).not.toHaveAttribute(
                'data-rf-reduced-motion',
                /.*/
            );
            // `reducedTransparency` would repaint Classic's surface if the guard leaked.
            const surface = await readVar(page, '--rf-color-surface');
            expect(surface).not.toBe('#141a22');
        });
    });

    test('the picker is operable by keyboard and D-pad, and focus is visible', async ({
        page
    }) => {
        await signIn(page);
        await gotoPreferences(page);

        const select = page.locator(
            '[aria-labelledby="display-settings-theme-label"]'
        );

        // Focus the picker without a pointer, then open it with the keyboard.
        await select.focus();
        await expect(select).toBeFocused();
        await page.keyboard.press('Enter');

        const listbox = page.getByRole('listbox');
        await expect(listbox).toBeVisible();

        // D-pad navigation is arrow keys: walk to Glass and commit with Enter. MUI moves DOM focus
        // onto the active option, so the focused option is a real, assertable thing.
        const glassOption = page.getByRole('option', { name: /Reefin Glass/ });
        for (let i = 0; i < 12; i++) {
            // eslint-disable-next-line no-await-in-loop
            if (await glassOption.evaluate((el) => el === document.activeElement))
                break;
            // eslint-disable-next-line no-await-in-loop
            await page.keyboard.press('ArrowDown');
        }
        await expect(glassOption).toBeFocused();

        // Focus must be visible, not merely present — a D-pad user cannot see a caret.
        const outlineWidth = await glassOption.evaluate(
            (el) => getComputedStyle(el).outlineWidth
        );
        const backgroundColor = await glassOption.evaluate(
            (el) => getComputedStyle(el).backgroundColor
        );
        // MUI marks the focused option with a background rather than an outline; accept either,
        // but require that *something* distinguishes it from a fully transparent background.
        expect(
            outlineWidth !== '0px' || backgroundColor !== 'rgba(0, 0, 0, 0)'
        ).toBe(true);

        await page.keyboard.press('Enter');
        await expect(listbox).toBeHidden();

        await page.getByRole('button', { name: /Save/i }).click();
        await expectBlur(page, '16px', 'blur(16px)');
    });

    test.afterEach(async ({ page }) => {
        // Leave the shared server's user on Classic, so a later spec does not inherit Glass.
        await page
            .evaluate(
                ([key]) => window.localStorage.removeItem(key),
                [`${userId}-appTheme`]
            )
            .catch(() => undefined);
    });
});

import { expect, test } from './support/origin-inventory';
import { AXE_VERSION, formatViolations, scanPage } from './support/axe';
import { signIn } from './support/b2';
import type { Page } from '@playwright/test';

/**
 * `presentation.page.home` against a REAL server, in a REAL browser.
 *
 * `HomeTab.recipe.test.tsx` asserts the same behaviours under jsdom with the SDK stubbed. That is
 * fast and precise and it is NOT evidence that the live route works: it never loads the built
 * bundle, never authenticates, never receives a server response, and never lays anything out. The
 * whole claim of this vertical is
 *
 *     Theme Studio draft → explicit Apply → the live Home route changes composition
 *     → reload preserves it → reset restores the official composition
 *
 * and every arrow in that sentence crosses a boundary jsdom does not model. So this file drives the
 * product: sign in, read the composition off `/home`, author a draft in the Studio, Apply, come
 * back, and check what actually rendered.
 *
 * Needs a seeded Tesserafin server (see `tesserafin/ci/serve-e2e.sh`, or any server with a movie
 * with a resume position and a series with one watched episode, so all four sections have content).
 */

const COMPOSITION = '[data-rf-slot="home-composition"]';
const HERO = '[data-rf-slot="home-hero"]';
const APPLIED_KEY = 'tesserafin.themeStudio.appliedPresentation';

/**
 * The rendered section order, read from the DOM the way a user perceives it: the heading of each
 * shelf, top to bottom. Deliberately NOT read from the recipe — that would assert the recipe
 * against itself.
 */
async function renderedOrder(page: Page): Promise<string[]> {
    return page.evaluate((selector) => {
        const root = document.querySelector(selector);
        if (!root) return [];
        return [...root.querySelectorAll('h2')].map((heading) =>
            (heading.textContent ?? '').trim()
        );
    }, COMPOSITION);
}

/** Waits until every Home section has left its loading state. */
async function waitForHomeSettled(page: Page) {
    await expect(page.locator(COMPOSITION)).toBeVisible({ timeout: 30_000 });
    await expect
        .poll(
            async () => page.locator('[data-rf-slot="state-loading"]').count(),
            { timeout: 45_000, message: 'Home sections never finished loading' }
        )
        .toBe(0);
}

/** Writes an applied-presentation record exactly as `applyLocalThemeOverlay` does, then reloads. */
async function applyRecipeThroughStudio(
    page: Page,
    sections: string[],
    density: string
) {
    await page.goto('/#/themestudio', { waitUntil: 'domcontentloaded' });

    const start = page.getByRole('button', { name: /Copy Tesserafin Glass/i });
    const editor = page.locator(
        '[data-testid="theme-studio-home-composition"]'
    );

    /*
     * Wait for the Studio to have RENDERED one of its two states before deciding which one it is
     * in. `goto` resolves on `domcontentloaded`, which is well before the lazily-imported Studio
     * chunk has been fetched and hydrated — probing `start.isVisible()` at that moment answered
     * "no" for a page that had not drawn anything yet, so the click was skipped and the editor was
     * then waited for on a page still showing the start step.
     */
    await expect(start.or(editor).first()).toBeVisible({ timeout: 30_000 });
    if (await start.isVisible().catch(() => false)) {
        await start.click();
    }
    await expect(
        editor,
        'the Studio must offer a real Home composition control'
    ).toBeVisible({ timeout: 20_000 });

    // Drive the control itself — checkboxes and Move buttons — rather than writing storage, so the
    // test proves the CONTROL is wired, not just that the record is honoured.
    for (const section of sections) {
        const row = editor.locator('li', { hasText: section });
        const checkbox = row.getByRole('checkbox');
        if (!(await checkbox.isChecked())) await checkbox.check();
    }

    await editor
        .locator('..')
        .getByLabel('Shelf density')
        .click()
        .catch(() => undefined);
    const option = page.getByRole('option', { name: density, exact: true });
    if (await option.isVisible().catch(() => false)) await option.click();

    await page.getByRole('button', { name: /Apply to Tesserafin/i }).click();

    await expect
        .poll(
            async () =>
                page.evaluate(
                    (key) => window.localStorage.getItem(key),
                    APPLIED_KEY
                ),
            { timeout: 10_000, message: 'Apply never reached the live record' }
        )
        .not.toBeNull();
}

test.describe('Home page composition, against the live route', () => {
    test('renders the official composition, then changes it on Apply, keeps it across a reload, and gives it back on reset', async ({
        page
    }) => {
        await signIn(page);
        await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
        await waitForHomeSettled(page);

        const official = await renderedOrder(page);
        test.info().attach('composition-official', {
            body: JSON.stringify(official, null, 2),
            contentType: 'application/json'
        });

        expect(
            official.length,
            'the seeded server must give Home something to compose'
        ).toBeGreaterThan(2);
        expect(
            await page.locator(HERO).count(),
            'the official composition has no hero'
        ).toBe(0);

        // --- Apply ---------------------------------------------------------------------------
        await applyRecipeThroughStudio(
            page,
            ['Hero', 'Continue watching', 'Next up'],
            'spacious'
        );

        await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
        await waitForHomeSettled(page);

        const applied = await renderedOrder(page);
        test.info().attach('composition-applied', {
            body: JSON.stringify(applied, null, 2),
            contentType: 'application/json'
        });

        expect(
            applied,
            'Apply must change the LIVE composition, not only the preview'
        ).not.toEqual(official);
        await expect(
            page.locator(HERO),
            'the applied recipe asked for a hero'
        ).toBeVisible();
        expect(
            await page.locator('.rf-media-shelf__scroller--spacious').count(),
            'the applied recipe asked for spacious shelves'
        ).toBeGreaterThan(0);

        // --- Reload --------------------------------------------------------------------------
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForHomeSettled(page);
        expect(
            await renderedOrder(page),
            'a full document reload must preserve the applied composition'
        ).toEqual(applied);
        await expect(page.locator(HERO)).toBeVisible();

        // --- Reset ---------------------------------------------------------------------------
        await page.goto('/#/themestudio', { waitUntil: 'domcontentloaded' });
        await page
            .getByRole('button', { name: /Stop using this theme/i })
            .click();
        await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
        await waitForHomeSettled(page);

        expect(
            await renderedOrder(page),
            'reset must restore the official composition exactly'
        ).toEqual(official);
        expect(await page.locator(HERO).count()).toBe(0);
    });

    test('boots and falls back when the stored composition is corrupt', async ({
        page
    }) => {
        await signIn(page);
        await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
        await waitForHomeSettled(page);
        const official = await renderedOrder(page);

        await page.evaluate(
            ([key]) =>
                window.localStorage.setItem(
                    key,
                    '{"page":{"home":{"sections":"latestMedia","shelfDensity":"enormous"}}}'
                ),
            [APPLIED_KEY]
        );

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForHomeSettled(page);

        expect(
            await renderedOrder(page),
            'a hand-edited record must degrade to the default, never stop the boot'
        ).toEqual(official);

        await page.evaluate(
            ([key]) => window.localStorage.removeItem(key),
            [APPLIED_KEY]
        );
    });

    test('stays keyboard- and remote-operable, and honours reduced motion', async ({
        page
    }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await signIn(page);
        await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
        await waitForHomeSettled(page);

        // Tab into the composition and confirm focus lands on something inside it with a visible
        // ring — the same traversal a TV remote's directional pad drives.
        let insideComposition = false;
        for (let press = 0; press < 40 && !insideComposition; press++) {
            await page.keyboard.press('Tab');
            insideComposition = await page.evaluate((selector) => {
                const active = document.activeElement;
                const root = document.querySelector(selector);
                return !!active && !!root && root.contains(active);
            }, COMPOSITION);
        }
        expect(
            insideComposition,
            'the Home composition must be reachable by keyboard alone'
        ).toBe(true);

        const outline = await page.evaluate(() => {
            const active = document.activeElement;
            if (!active) return null;
            const style = getComputedStyle(active);
            return {
                outlineStyle: style.outlineStyle,
                outlineWidth: style.outlineWidth,
                boxShadow: style.boxShadow
            };
        });
        expect(
            outline?.outlineStyle !== 'none' || outline?.boxShadow !== 'none',
            'the focused element must have a visible focus indicator'
        ).toBe(true);

        // Reduced motion must reach the shelves rather than being a preference nobody read.
        const scrollBehaviour = await page.evaluate(() => {
            const scroller = document.querySelector(
                '.rf-media-shelf__scroller'
            );
            return scroller ? getComputedStyle(scroller).scrollBehavior : null;
        });
        expect(scrollBehaviour).not.toBe('smooth');
    });

    test.describe('layout at three viewports', () => {
        const VIEWPORTS = [
            { label: 'desktop', width: 1440, height: 900 },
            { label: 'mobile', width: 390, height: 844 },
            { label: 'tv', width: 1920, height: 1080 }
        ];

        for (const viewport of VIEWPORTS) {
            test(`composes without horizontal overflow at ${viewport.label}`, async ({
                page
            }) => {
                await page.setViewportSize({
                    width: viewport.width,
                    height: viewport.height
                });
                await signIn(page);
                await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
                await waitForHomeSettled(page);

                const order = await renderedOrder(page);
                expect(
                    order.length,
                    `${viewport.label} must render the composition`
                ).toBeGreaterThan(2);

                // A shelf scrolls inside itself; the PAGE must not scroll sideways.
                const overflows = await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth >
                        document.documentElement.clientWidth + 1
                );
                expect(
                    overflows,
                    `${viewport.label} must not scroll the page horizontally`
                ).toBe(false);
            });
        }
    });

    test('has no critical accessibility violation on the composed Home route', async ({
        page
    }) => {
        await signIn(page);
        await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
        await waitForHomeSettled(page);

        const result = await scanPage(page);
        const critical = result.violations.filter(
            (violation) => violation.impact === 'critical'
        );

        test.info().attach('axe-home-composition', {
            body: JSON.stringify(
                {
                    axe: AXE_VERSION,
                    counts: {
                        critical: critical.length,
                        serious: result.violations.filter(
                            (v) => v.impact === 'serious'
                        ).length,
                        moderate: result.violations.filter(
                            (v) => v.impact === 'moderate'
                        ).length,
                        minor: result.violations.filter(
                            (v) => v.impact === 'minor'
                        ).length,
                        passes: result.passCount,
                        incomplete: result.incompleteCount
                    },
                    violations: result.violations
                },
                null,
                2
            ),
            contentType: 'application/json'
        });

        expect(critical, formatViolations(result)).toHaveLength(0);
    });
});

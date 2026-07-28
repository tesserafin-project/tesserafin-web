import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from './support/origin-inventory';
import {
    type FormFactor,
    MOVIE_TITLE,
    type ThemeName,
    VIEWPORTS,
    apiUserId,
    applyFormFactor,
    expectTvLayout,
    measureLayoutStable,
    navLibrary,
    navSearch,
    searchResultCard,
    signIn,
    useTheme
} from './support/b2';

/**
 * B2 (#55) — desktop, mobile and TV usability, in both shipped themes.
 *
 * NOT A PIXEL SNAPSHOT GATE. A screenshot comparison fails on a font hint and passes on a control
 * that scrolled off the right edge, so it is the wrong instrument for "usable at three
 * breakpoints". What this asserts instead are the three failures that actually make a form factor
 * unusable, each read from real layout boxes in the live document:
 *
 *   1. the page scrolls horizontally at all;
 *   2. a visible interactive control sits outside the viewport with no scrollable ancestor to
 *      reach it by;
 *   3. a visible dialog's box is not fully inside the viewport.
 *
 * Screenshots ARE captured, at every theme x form factor, because #55 asks for representative
 * Classic and Glass states to be inspectable. They are evidence for a human to look at, not the
 * assertion — nothing here passes or fails on an image comparison.
 *
 * WHY THESE THREE FORM FACTORS: see `tests/e2e/support/b2.ts`. They are the repository's existing
 * ones, and TV is a layout class, not a resolution.
 */

const CAPTURE_DIR =
    process.env.TESSERAFIN_E2E_CAPTURE_DIR ??
    resolve(process.cwd(), 'test-results', 'b2-captures');

const capturePath = (name: string): string => {
    const path = resolve(CAPTURE_DIR, name);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return path;
};

const FORM_FACTORS: FormFactor[] = ['desktop', 'mobile', 'tv'];
const THEME_NAMES: ThemeName[] = ['classic', 'glass'];

test.describe('B2 responsive: primary flows are usable at all three form factors', () => {
    for (const factor of FORM_FACTORS) {
        for (const theme of THEME_NAMES) {
            test(`${theme} at ${factor} (${VIEWPORTS[factor].width}x${VIEWPORTS[factor].height}): home, library and detail lay out without overflow, unreachable controls or clipped dialogs`, async ({
                page
            }, testInfo) => {
                const userId = await apiUserId();
                await applyFormFactor(page, factor);
                await signIn(page);
                await useTheme(page, userId, theme);
                await applyFormFactor(page, factor);

                const record = async (label: string) => {
                    // Re-checked at every step, not once at the start: the TV layout is what the
                    // whole `tv` column claims, and losing it mid-run would turn the rest of this
                    // test into an unlabelled desktop run.
                    if (factor === 'tv') await expectTvLayout(page);
                    const report = await measureLayoutStable(page);
                    testInfo.annotations.push({
                        type: `layout:${theme}:${factor}:${label}`,
                        description: JSON.stringify(report)
                    });
                    expect(
                        report.horizontalOverflowPx,
                        `${label} at ${factor} in ${theme} must not scroll horizontally`
                    ).toBeLessThanOrEqual(1);
                    expect(
                        report.offscreenControls,
                        `${label} at ${factor} in ${theme} must not leave an interactive control outside the viewport with no way to scroll to it`
                    ).toEqual([]);
                    expect(
                        report.clippedDialogs,
                        `${label} at ${factor} in ${theme} must not clip a dialog`
                    ).toEqual([]);
                    await page.screenshot({
                        path: capturePath(`${theme}-${factor}-${label}.png`),
                        fullPage: false
                    });
                };

                // 1. HOME.
                await record('home');

                // 2. THE NAVIGATION ITSELF. At desktop and TV the sidebar is permanent; below
                //    MUI's `md` it is a temporary drawer that has to be OPENED, and a drawer that
                //    cannot be opened is the mobile failure this clause exists to catch.
                if (factor === 'mobile') {
                    const menuButton = page
                        .getByRole('button', {
                            name: /menu|open drawer|ouvrir/i
                        })
                        .first();
                    await expect(
                        menuButton,
                        'below the md breakpoint the shell must offer a control that opens the navigation drawer'
                    ).toBeVisible({ timeout: 25_000 });
                    await menuButton.click();
                    // The drawer's own content is the settled state to wait on.
                    await expect(
                        page
                            .getByRole('link', { name: /home|accueil/i })
                            .first()
                    ).toBeVisible({ timeout: 15_000 });
                    await record('drawer-open');
                    await page.keyboard.press('Escape');
                } else {
                    await record('navigation');
                }

                // 3. LIBRARY.
                const libraryLink = navLibrary(page);
                if (await libraryLink.isVisible().catch(() => false)) {
                    await libraryLink.click();
                    await page.waitForURL(/#\/(movies|list|library)/, {
                        timeout: 25_000
                    });
                    await record('library');
                }

                // 4. SEARCH, and then the item DETAIL page reached from it — the deepest
                //    primary flow, and the one with the most content to overflow.
                const searchControl = navSearch(page);
                await expect(searchControl).toBeVisible({ timeout: 25_000 });
                await searchControl.click();
                await page.waitForURL('**/#/search**', { timeout: 15_000 });
                const field = page
                    .locator('.searchFields input:visible')
                    .first();
                await expect(field).toBeVisible({ timeout: 15_000 });
                await field.fill(MOVIE_TITLE);
                const card = searchResultCard(page);
                await expect(
                    card,
                    'the seeded movie must be findable at every form factor'
                ).toBeVisible({ timeout: 25_000 });
                await record('search');

                // Keyboard activation, for the reason search.spec.ts documents: the card's
                // hover overlay intercepts pointer events and its Resume button would start
                // playback instead of opening the item.
                await card.focus();
                await card.press('Enter');
                await page.waitForURL('**/#/details?id=**', {
                    timeout: 25_000
                });
                await expect(
                    page.getByRole('heading', { level: 1 })
                ).toBeVisible({ timeout: 25_000 });
                await record('detail');
            });
        }
    }
});

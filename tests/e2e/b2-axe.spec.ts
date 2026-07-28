import { expect, test } from './support/origin-inventory';
import { AXE_VERSION, formatViolations, scanPage } from './support/axe';
import {
    MOVIE_TITLE,
    type ThemeName,
    apiUserId,
    navLibrary,
    navSearch,
    searchResultCard,
    signIn,
    useTheme
} from './support/b2';

/**
 * B2 (#55) — automated accessibility scans.
 *
 * #55's gate: "an a11y check (axe or equivalent) reports no critical violations on onboarding,
 * library, and player". Onboarding is pre-authentication and lives in `b2-onboarding.spec.ts`,
 * which needs a container whose startup wizard has not been completed; this file covers the two
 * authenticated targets plus the item detail and search pages the same flows pass through.
 *
 * WHAT "NO CRITICAL VIOLATIONS" MEANS HERE. axe grades each violation `minor`, `moderate`,
 * `serious` or `critical`. The gate #55 states is `critical`, and that is what fails a test.
 * Everything else is RECORDED — counted by severity and attached to the test — rather than
 * discarded, so the report cannot present a page with twelve serious violations as clean.
 *
 * NO BLANKET EXCLUSIONS. `scanPage` offers no exclusion parameter and disables no rule. The scan
 * runs the WCAG 2.0/2.1 A and AA tag sets plus axe's best-practice set over the whole document.
 */

const CRITICAL = 'critical';

interface Scanned {
    label: string;
    theme: ThemeName;
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    passes: number;
    incomplete: number;
}

const collected: Scanned[] = [];

async function scanAndRecord(
    page: import('@playwright/test').Page,
    testInfo: import('@playwright/test').TestInfo,
    label: string,
    theme: ThemeName
) {
    const result = await scanPage(page);

    // The engine must be the pinned one and must actually have run rules. A scan that evaluated
    // nothing would report zero violations and look like a pass.
    expect(
        result.engineVersion,
        'the scan must be performed by the pinned vendored engine'
    ).toBe(AXE_VERSION);
    expect(
        result.passCount,
        `the ${label} scan must have actually evaluated rules`
    ).toBeGreaterThan(0);

    testInfo.annotations.push({
        type: `axe:${theme}:${label}`,
        description: JSON.stringify({
            engine: result.engineVersion,
            bySeverity: result.bySeverity,
            passes: result.passCount,
            incomplete: result.incompleteCount,
            violations: result.violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                nodes: v.nodes.length
            }))
        })
    });

    collected.push({
        label,
        theme,
        critical: result.bySeverity.critical,
        serious: result.bySeverity.serious,
        moderate: result.bySeverity.moderate,
        minor: result.bySeverity.minor,
        passes: result.passCount,
        incomplete: result.incompleteCount
    });

    const criticals = result.violations.filter((v) => v.impact === CRITICAL);
    expect(
        criticals.map((v) => `${v.id}: ${v.help} (${v.nodes.join(', ')})`),
        `${label} in ${theme} must have no critical accessibility violations`
    ).toEqual([]);

    return result;
}

test.describe('B2 accessibility: automated scans of the authenticated flows', () => {
    for (const theme of ['classic', 'glass'] as const) {
        test(`${theme}: home, library, search, detail and the player report no critical violations`, async ({
            page
        }, testInfo) => {
            const userId = await apiUserId();
            await signIn(page);
            await useTheme(page, userId, theme);

            // 1. HOME — the shell every other page inherits.
            await scanAndRecord(page, testInfo, 'home', theme);

            // 2. LIBRARY — named explicitly in the gate.
            const libraryLink = navLibrary(page);
            await expect(
                libraryLink,
                'the shell must offer the seeded Movies library'
            ).toBeVisible({ timeout: 25_000 });
            await libraryLink.click();
            await page.waitForURL(/#\/(movies|list|library)/, {
                timeout: 25_000
            });
            // Wait for real content, not a spinner: scanning a loading state would scan nothing.
            await expect(
                page.locator('.card, [class*="card"]').first()
            ).toBeVisible({ timeout: 25_000 });
            await scanAndRecord(page, testInfo, 'library', theme);

            // 3. SEARCH.
            const searchControl = navSearch(page);
            await searchControl.click();
            await page.waitForURL('**/#/search**', { timeout: 15_000 });
            const field = page.locator('.searchFields input:visible').first();
            await expect(field).toBeVisible({ timeout: 15_000 });
            await field.fill(MOVIE_TITLE);
            const card = searchResultCard(page);
            await expect(card).toBeVisible({ timeout: 25_000 });
            await scanAndRecord(page, testInfo, 'search', theme);

            // 4. ITEM DETAIL.
            await card.focus();
            await card.press('Enter');
            await page.waitForURL('**/#/details?id=**', { timeout: 25_000 });
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
                timeout: 25_000
            });
            await scanAndRecord(page, testInfo, 'detail', theme);

            // 5. PLAYER — named explicitly in the gate. Playback is started through the real
            //    play control, and the scan runs once the video surface is actually on screen.
            const play = page
                .locator(
                    'button.btnPlay:visible, button[title*="Play" i]:visible'
                )
                .first();
            await expect(
                play,
                'the item detail page must offer a play control'
            ).toBeVisible({ timeout: 25_000 });
            await play.click();
            await page.waitForURL(/#\/video/, { timeout: 30_000 });
            await expect(
                page.locator('video'),
                'the player must reach a real video surface before it is scanned'
            ).toBeVisible({ timeout: 30_000 });
            // The on-screen display auto-hides. Move the pointer so the controls are present —
            // scanning a player with its controls hidden would scan an empty screen and pass
            // for the wrong reason.
            await page.mouse.move(400, 400);
            await page.mouse.move(420, 420);
            await scanAndRecord(page, testInfo, 'player', theme);

            // Leave playback stopped so the next test starts from a quiet server.
            await page.keyboard.press('Escape');
        });
    }

    test.afterAll(() => {
        if (collected.length === 0) return;
        const lines = collected.map(
            (c) =>
                `  ${c.theme}/${c.label}: critical=${c.critical} serious=${c.serious} moderate=${c.moderate} minor=${c.minor} passes=${c.passes} incomplete=${c.incomplete}`
        );
        console.log(
            `[b2-axe] axe-core ${AXE_VERSION} scan summary\n${lines.join('\n')}`
        );
    });
});

export { formatViolations };

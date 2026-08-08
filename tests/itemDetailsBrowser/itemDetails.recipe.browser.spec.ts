/**
 * #129 Step 2, Phase 7: both official Item Details recipes, in the real production bundle.
 *
 * The jsdom suites prove composition and the request ledger precisely; they never load the built
 * chunk, never lay anything out and never run an accessibility scan against real CSS. This drives
 * `/details` in a real Chromium, under Tesserafin Classic and under Frosted Glass, and produces
 * the pictures a maintainer needs to accept the change.
 *
 * The recipe reaches the route the way the application delivers it: the applied-presentation record
 * in `localStorage`, written before the first navigation, read by `PresentationProvider`. No theme
 * id is set and no account is involved — a recipe is a local, per-browser document.
 *
 *     npm run build:production && npm run test:item-details-browser
 *
 * The assertions here are deliberately narrow — the route reached a rendered state, the two themes
 * differ in the order they render, both show the same set of surfaces, and axe finds nothing. The
 * PICTURE is the deliverable, and judging it is the maintainer's job, not a test's.
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { type Page, expect, test } from '@playwright/test';

import { AXE_VERSION, formatViolations, scanPage } from '../e2e/support/axe';
import classicManifest from '../../tesserafin-design/themes/classic/theme.json';
import glassManifest from '../../tesserafin-design/themes/glass/theme.json';
import { SERVER_ID, installFixtureApi } from './support/fixtureApi';

const DIST = resolve(__dirname, '../../dist');
const ARTIFACTS = resolve(__dirname, '../../test-results/item-details-recipes');
const PAGE = '.rf-item-details';
const APPLIED_KEY = 'tesserafin.themeStudio.appliedPresentation';

mkdirSync(ARTIFACTS, { recursive: true });

const THEMES = [
    {
        id: 'classic',
        themeId: 'official.classic',
        label: 'Tesserafin Classic',
        manifest: classicManifest
    },
    {
        id: 'glass',
        themeId: 'official.glass',
        label: 'Frosted Glass',
        manifest: glassManifest
    }
] as const;

/** The semantic extremes Phase 7 asks for, limited to what the fixture API can serve. */
const SUBJECTS = [
    { id: 'movie', query: 'id=movie-1' },
    { id: 'series', query: 'id=series-1' },
    { id: 'season', query: 'id=season-1' },
    { id: 'episode', query: 'id=episode-1' },
    { id: 'music-album', query: 'id=album-1' },
    { id: 'person', query: 'id=person-1' },
    { id: 'series-timer', query: 'seriesTimerId=seriestimer-1' }
] as const;

const VIEWPORTS = [
    { id: 'desktop', width: 1440, height: 1000 },
    { id: 'mobile', width: 390, height: 844 }
] as const;

/**
 * The generated `--rf-*` token tier for a theme, as an emitted asset.
 *
 * `tesserafin-design/scripts/generate-web-tokens.mjs` emits one tier per non-default theme, keyed
 * on `[data-rf-theme="<id>"]`, and the app fetches it lazily through `ensureColorSchemeLoaded`.
 * Reading the emitted file rather than rebuilding the tokens here is deliberate: the projection
 * rule (`ui/tokens/projectTokens.ts`) must not have a second implementation living in a test.
 *
 * `null` for the default theme, whose tokens are in the base stylesheet already.
 */
function tokenTierFor(themeId: string): string | null {
    if (themeId === 'official.classic') return null;
    const slug = themeId.replace(/\./g, '-');
    const file = readdirSync(DIST).find(
        (name) =>
            name.startsWith(`theme-colorscheme-${slug}.`) &&
            name.endsWith('.css')
    );
    if (!file) throw new Error(`no emitted token tier for "${themeId}"`);
    return join(DIST, file);
}

/**
 * Dress the page in a theme — BOTH halves of it.
 *
 * The first cut of this suite wrote the applied-presentation record and nothing else. That
 * delivered the recipe and left the palette at the default, so the two themes differed only by
 * section order and a maintainer reasonably read them as "nearly identical". A capture that shows
 * less than a reader sees is not evidence.
 *
 * A theme reaches a reader as two things and this applies both:
 *
 *   - its TOKENS — the emitted `[data-rf-theme]` tier above, plus the attribute that selects it;
 *   - its RECIPE — `presentation`, through the record `PresentationProvider` reads.
 *
 * The picker path (`userSettings.theme()` → `themeManager` → `THEME_CHANGE`) is deliberately not
 * driven here: it needs the authenticated settings round-trip this server-free fixture does not
 * reproduce, and it is not what #129 Step 2 changes. What is asserted below is that both halves
 * arrived — `data-rf-theme` is the requested id and `--rf-color-surface` differs between the two.
 */
async function wearTheme(page: Page, themeId: string, presentation: unknown) {
    await page.addInitScript(
        ([id, key, value]) => {
            window.localStorage.setItem(key as string, value as string);
            document.documentElement.setAttribute(
                'data-rf-theme',
                id as string
            );
        },
        [themeId, APPLIED_KEY, JSON.stringify(presentation)] as const
    );
}

/** Re-assert the attribute and add the token tier once the app has booted. */
async function settleTheme(page: Page, themeId: string) {
    const tier = tokenTierFor(themeId);
    if (tier) await page.addStyleTag({ path: tier });
    await page.evaluate((id) => {
        // `useAppTheme` writes this on mount from the default entry; the capture is of a reader
        // who chose this theme, so it is set back afterwards.
        document.documentElement.setAttribute('data-rf-theme', id as string);
    }, themeId);
    await page.waitForTimeout(300);
}

async function open(page: Page, query: string) {
    await page.goto(`/#/details?${query}&serverId=${SERVER_ID}`);
    await page.waitForSelector(
        `${PAGE} [data-detail-section="nameContainer"] h1`,
        { timeout: 30_000 }
    );
    // The route fans out into independent section queries; wait for it to settle rather than for a
    // fixed number of them.
    await page.waitForTimeout(1500);
}

const sectionsOf = (page: Page) =>
    page.$$eval('[data-detail-section]', (nodes) =>
        nodes.map((node) => node.getAttribute('data-detail-section') ?? '')
    );

const slotsOf = (page: Page) =>
    page.$$eval('[data-detail-section][data-rf-slot]', (nodes) =>
        nodes.map((node) => node.getAttribute('data-rf-slot') ?? '')
    );

for (const theme of THEMES) {
    test.describe(`Item Details under ${theme.label}`, () => {
        for (const subject of SUBJECTS) {
            for (const viewport of VIEWPORTS) {
                test(`captures ${subject.id} at ${viewport.id}`, async ({
                    page,
                    baseURL
                }) => {
                    await page.setViewportSize(viewport);
                    await wearTheme(
                        page,
                        theme.themeId,
                        theme.manifest.presentation
                    );
                    await installFixtureApi(page, baseURL as string, DIST);
                    await open(page, subject.query);
                    await settleTheme(page, theme.themeId);

                    expect(await sectionsOf(page)).toContain('nameContainer');

                    // No horizontal overflow at any width — a reordered composition must stay
                    // usable, not merely render.
                    const overflow = await page.evaluate(
                        () =>
                            document.documentElement.scrollWidth >
                            document.documentElement.clientWidth + 1
                    );
                    expect(overflow, 'the page scrolls horizontally').toBe(
                        false
                    );

                    await page.screenshot({
                        path: join(
                            ARTIFACTS,
                            `${theme.id}-${subject.id}-${viewport.id}.png`
                        ),
                        fullPage: true
                    });
                });
            }
        }

        test('renders no accessibility violation at any severity', async ({
            page,
            baseURL
        }) => {
            await wearTheme(page, theme.themeId, theme.manifest.presentation);
            await installFixtureApi(page, baseURL as string, DIST);
            await open(page, 'id=movie-1');
            await settleTheme(page, theme.themeId);

            const result = await scanPage(page, [PAGE]);
            expect(AXE_VERSION).toBe('4.12.1');
            expect(
                result.violations.length,
                `accessibility violations under ${theme.label}:\n${formatViolations(result)}`
            ).toBe(0);
        });

        test('keeps the action bar reachable by keyboard alone', async ({
            page,
            baseURL
        }) => {
            // A TV-shaped viewport, driven only by Tab. Reordering content must never strand the
            // fixed header behind it.
            await page.setViewportSize({ width: 1920, height: 1080 });
            await wearTheme(page, theme.themeId, theme.manifest.presentation);
            await installFixtureApi(page, baseURL as string, DIST);
            await open(page, 'id=movie-1');
            await settleTheme(page, theme.themeId);

            let reached: string | null = null;
            for (let step = 0; step < 40 && !reached; step++) {
                await page.keyboard.press('Tab');
                reached = await page.evaluate(
                    () =>
                        document.activeElement?.getAttribute(
                            'data-detail-action'
                        ) ?? null
                );
            }
            expect(reached, 'no action was reachable by Tab').toBe('btnPlay');

            await page.screenshot({
                path: join(ARTIFACTS, `${theme.id}-movie-tv-focus.png`),
                fullPage: false
            });
        });
    });
}

test.describe('the two official recipes are materially distinct', () => {
    /**
     * One browser context per theme.
     *
     * `page.addInitScript` cannot be undone and re-runs on every navigation, so a single page
     * cannot be moved from one applied recipe to another — the first theme's record would be
     * rewritten on the reload. Two contexts is also closer to the truth being asserted: these are
     * two readers, each with their own local presentation.
     */
    test('and both expose the same set of surfaces', async ({
        browser,
        baseURL
    }) => {
        const read = async (themeId: string) => {
            const context = await browser.newContext();
            const page = await context.newPage();
            await wearTheme(
                page,
                themeId,
                themeId === 'official.classic'
                    ? classicManifest.presentation
                    : glassManifest.presentation
            );
            await installFixtureApi(page, baseURL as string, DIST);
            await open(page, 'id=movie-1');
            await settleTheme(page, themeId);
            const observed = {
                sections: await sectionsOf(page),
                slots: [...new Set(await slotsOf(page))],
                backdrop: await page.$$eval(
                    '[data-detail-backdrop]',
                    (nodes) => nodes.length
                ),
                // The palette arrives with the theme, not with the recipe. Recorded here because
                // an earlier cut of this suite delivered the recipe alone and both themes rendered
                // in the default colours — which is not what a reader sees.
                rfTheme: await page.evaluate(() =>
                    document.documentElement.getAttribute('data-rf-theme')
                ),
                surface: await page.evaluate(() =>
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--rf-color-surface')
                        .trim()
                )
            };
            await context.close();
            return observed;
        };

        const classic = await read('official.classic');
        const glass = await read('official.glass');

        // Same surfaces, different order — nothing suppressed, everything recomposed.
        expect([...glass.sections].sort()).toEqual(
            [...classic.sections].sort()
        );
        expect(glass.sections).not.toEqual(classic.sections);
        expect(glass.slots).not.toEqual(classic.slots);

        // And each page is actually wearing its own theme.
        expect(classic.rfTheme).toBe('official.classic');
        expect(glass.rfTheme).toBe('official.glass');
        expect(glass.surface).not.toBe(classic.surface);

        // And a visibly different hero: Classic draws the backdrop layer, Glass does not.
        expect(classic.backdrop).toBe(1);
        expect(glass.backdrop).toBe(0);
    });

    test('the platform default renders what Classic renders', async ({
        browser,
        baseURL
    }) => {
        // No applied record at all — the provider falls back to PLATFORM_DEFAULT_PRESENTATION.
        const bare = await browser.newContext();
        const barePage = await bare.newPage();
        await installFixtureApi(barePage, baseURL as string, DIST);
        await open(barePage, 'id=movie-1');
        const byDefault = await sectionsOf(barePage);
        await barePage.screenshot({
            path: join(ARTIFACTS, 'platform-default-movie-desktop.png'),
            fullPage: true
        });
        await bare.close();

        const themed = await browser.newContext();
        const themedPage = await themed.newPage();
        await wearTheme(
            themedPage,
            'official.classic',
            classicManifest.presentation
        );
        await installFixtureApi(themedPage, baseURL as string, DIST);
        await open(themedPage, 'id=movie-1');
        const underClassic = await sectionsOf(themedPage);
        await themed.close();

        expect(underClassic).toEqual(byDefault);
    });
});

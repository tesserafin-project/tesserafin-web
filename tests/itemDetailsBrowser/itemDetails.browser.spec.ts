/**
 * Browser proof for the MIGRATED Item Details route (tesserafin-web#129 Step 1b).
 *
 * `tests/itemDetails/*.test.tsx` asserts the frozen contract under jsdom with both API surfaces
 * stubbed. That is fast and precise and it is NOT evidence that the live route works: it never loads
 * the built bundle, never authenticates, never lays anything out. This suite drives the REAL
 * `/details` route, in the REAL production bundle, in a real Chromium.
 *
 * It needs NO Reefin server. `npm run build:production`, the tracked static server already used by
 * the reader and delivery suites, and a same-origin fixture API are the whole dependency set — see
 * `support/fixtureApi.ts` for why the API has to answer on the page's own origin.
 *
 *     npm run build:production && npm run test:item-details-browser
 *
 * The route is now a code-split async route, so this suite also proves the delivery boundary from
 * the outside: the chunk is not fetched until a viewer navigates to an item.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { type Page, expect, test } from '@playwright/test';

import { AXE_VERSION, formatViolations, scanPage } from '../e2e/support/axe';
import { SERVER_ID, installFixtureApi } from './support/fixtureApi';

const REPO_ROOT = resolve(__dirname, '..', '..');
const DIST = join(REPO_ROOT, 'dist');
const ARTIFACTS = join(REPO_ROOT, 'test-results', 'item-details-browser');

mkdirSync(ARTIFACTS, { recursive: true });

const PAGE = '#itemDetailPage';

/** The rendered semantic sections, in document order, by the names the frozen contract uses. */
async function renderedSections(page: Page): Promise<string[]> {
    return page.$$eval(`${PAGE} [data-detail-section]`, (nodes) =>
        nodes.map((node) => node.getAttribute('data-detail-section') ?? '')
    );
}

async function renderedActions(page: Page): Promise<string[]> {
    return page.$$eval(`${PAGE} [data-detail-action]`, (nodes) =>
        nodes.map((node) => node.getAttribute('data-detail-action') ?? '')
    );
}

const selectOptions = (page: Page, name: string) =>
    page.locator(`${PAGE} [data-detail-select="${name}"] option`);

async function openDetails(page: Page, id: string) {
    await page.goto(`/#/details?id=${id}&serverId=${SERVER_ID}`);
    await page.waitForSelector(
        `${PAGE} [data-detail-section="nameContainer"] h1`,
        {
            timeout: 30_000
        }
    );
    // The route fans out into independent section queries; wait for it to stop changing rather
    // than for a fixed number of them.
    await page.waitForTimeout(1500);
}

test.describe('migrated Item Details, in a real browser', () => {
    test('a movie renders the recorded composition, actions and selectors', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        expect(await renderedSections(page)).toEqual([
            'nameContainer',
            'itemMiscInfo-primary',
            'mainDetailButtons',
            'trackSelections',
            'tagline',
            'overview',
            'itemTags',
            'itemDetailsGroup',
            'castCollapsible'
        ]);

        expect(await renderedActions(page)).toEqual([
            'btnPlay',
            'btnPlaystate',
            'btnUserRating',
            'btnMoreCommands'
        ]);

        // Multi-version / multi-track case: every selector the contract records is populated.
        expect(
            await selectOptions(page, 'selectSource').allTextContents()
        ).toEqual(['Version A', 'Version B']);
        expect(
            await selectOptions(page, 'selectAudio').allTextContents()
        ).toEqual(['English AAC', 'French AC3']);
        const subtitles = await selectOptions(
            page,
            'selectSubtitles'
        ).allTextContents();
        expect(subtitles).toHaveLength(3);
        expect(subtitles.slice(1).sort()).toEqual([
            'English SRT',
            'French PGS'
        ]);

        expect(ledger.undeclared, 'undeclared API requests').toEqual([]);
        expect(ledger.requests.join('\n')).toContain('/Items/movie-1');

        await page.screenshot({
            path: join(ARTIFACTS, 'movie.png'),
            fullPage: true
        });
    });

    /**
     * The delivery boundary, proven from outside the build.
     *
     * `webpack.delivery-budget.json` asserts that no Item Details module is reachable from the
     * start-up graph. This asserts the consequence a viewer can observe: the route's chunk is not
     * fetched until they open an item.
     */
    test('the route chunk is fetched only when the route is opened', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);

        const chunkRequests: string[] = [];
        page.on('request', (request) => {
            const path = new URL(request.url()).pathname;
            if (/^\/details\..*\.(chunk\.js|css)$/.test(path)) {
                chunkRequests.push(path);
            }
        });

        await page.goto('/#/home');
        await page.waitForTimeout(2500);
        expect(
            chunkRequests,
            'the Item Details chunk was fetched at start-up'
        ).toEqual([]);

        await openDetails(page, 'movie-1');
        expect(
            chunkRequests.length,
            'navigating to /details did not fetch the route chunk'
        ).toBeGreaterThan(0);
    });

    test('the principal controls are focusable and keyboard-reachable', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        for (const selector of [
            '[data-detail-action="btnPlay"]',
            '[data-detail-action="btnPlaystate"] button',
            '[data-detail-action="btnUserRating"] button',
            '[data-detail-action="btnMoreCommands"]',
            '[data-detail-select="selectSource"]',
            '[data-detail-select="selectAudio"]',
            '[data-detail-select="selectSubtitles"]'
        ]) {
            const control = page.locator(`${PAGE} ${selector}`).first();
            await control.focus();
            await expect(
                control,
                `${selector} could not take focus`
            ).toBeFocused();
        }
    });

    test('every action control has an accessible name', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const unnamed = await page.$$eval(
            `${PAGE} [data-detail-action]`,
            (nodes) =>
                nodes
                    .map((node) => {
                        const button =
                            node.tagName === 'BUTTON'
                                ? node
                                : node.querySelector('button');
                        const name =
                            button?.getAttribute('aria-label') ??
                            button?.getAttribute('title') ??
                            button?.textContent?.trim() ??
                            '';
                        return name
                            ? null
                            : (node.getAttribute('data-detail-action') ?? '?');
                    })
                    .filter(Boolean)
        );
        expect(unnamed, 'action controls with no accessible name').toEqual([]);
    });

    test('the played control issues a user-data mutation', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const before = ledger.requests.length;
        await page
            .locator(`${PAGE} [data-detail-action="btnPlaystate"] button`)
            .first()
            .click();
        await page.waitForTimeout(1000);

        const issued = ledger.requests.slice(before);
        expect(
            issued.some((request) => /PlayedItems\/movie-1$/.test(request)),
            `no played mutation in: ${issued.join(', ')}`
        ).toBe(true);
        expect(ledger.undeclared).toEqual([]);
    });

    test('the play control is a real playback entry point', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const before = ledger.requests.length;
        await page
            .locator(`${PAGE} [data-detail-action="btnPlay"]`)
            .first()
            .click();
        await page.waitForTimeout(2000);

        // What is asserted is that pressing play reaches the playback stack for THIS item — not
        // that a video element decoded anything, which a fixture cannot honestly provide.
        const issued = ledger.requests.slice(before);
        expect(
            issued.some((request) => request.includes('movie-1')),
            `play issued nothing for the item: ${issued.join(', ')}`
        ).toBe(true);
    });

    test('selecting an alternate version keeps the page on the same item', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        await page
            .locator(`${PAGE} [data-detail-select="selectSource"]`)
            .selectOption('movie-1-alt');
        await page.waitForTimeout(500);

        expect(
            await page
                .locator(`${PAGE} [data-detail-select="selectSource"]`)
                .inputValue()
        ).toBe('movie-1-alt');
        // The audio and subtitle selectors follow the selected source and stay populated.
        expect(
            await selectOptions(page, 'selectAudio').allTextContents()
        ).toEqual(['English AAC', 'French AC3']);
        await expect(
            page.locator(`${PAGE} [data-detail-section="nameContainer"] h1`)
        ).toHaveText('Fixture Movie');
    });

    test('a season renders its episodes in server order', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'season-1');

        expect(await renderedSections(page)).toContain(
            'listChildrenCollapsible'
        );

        const names = await page
            .locator(
                `${PAGE} [data-detail-section="listChildrenCollapsible"] .rf-media-card__title`
            )
            .allTextContents();
        expect(names).toEqual(['Episode 1', 'Episode 2', 'Episode 3']);
        expect(ledger.undeclared).toEqual([]);

        await page.screenshot({
            path: join(ARTIFACTS, 'season.png'),
            fullPage: true
        });
    });

    test('a series shows seasons and never an episode list', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'series-1');

        const names = await page
            .locator(
                `${PAGE} [data-detail-section="listChildrenCollapsible"] .rf-media-card__title`
            )
            .allTextContents();
        expect(names).toEqual(['Season 1']);

        await page.screenshot({
            path: join(ARTIFACTS, 'series.png'),
            fullPage: true
        });
    });

    /** Episodic navigation: a season's child card opens that episode's own details page. */
    test('an episode is reachable from its season', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'season-1');

        await page
            .locator(
                `${PAGE} [data-detail-section="listChildrenCollapsible"] a`
            )
            .first()
            .click();
        await page.waitForTimeout(2000);

        expect(page.url()).toContain('id=episode-1');
    });

    /**
     * `SUSPECT` #1, fixed. A `/details` URL with no recognised parameter left the legacy route
     * showing a spinner forever, because `getPromise` threw past its own `.catch`.
     */
    test('a malformed URL leaves a bounded error and no spinner', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await page.goto('/#/details?nonsense=1');
        await page.waitForSelector('[data-rf-slot="state-error"]', {
            timeout: 30_000
        });
        await page.waitForTimeout(1000);

        await expect(
            page.locator('[data-rf-slot="state-loading"]')
        ).toHaveCount(0);
        await expect(
            page.locator('[data-rf-slot="state-error"]')
        ).toBeVisible();

        await page.screenshot({
            path: join(ARTIFACTS, 'malformed-route.png'),
            fullPage: true
        });
    });

    /**
     * Navigating away unmounts the route.
     *
     * The legacy view manager CACHED the view, so the old suite could only assert that it was
     * hidden. There is no view cache any more: React unmounts the tree, so the page element is
     * gone from the document entirely. That is the migration's cleanup guarantee, asserted
     * directly rather than around.
     */
    test('navigating away unmounts the route', async ({ page, baseURL }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');
        expect(await page.locator(PAGE).count()).toBe(1);

        await page.goto('/#/home');
        await page.waitForTimeout(2000);

        await expect(page.locator(PAGE)).toHaveCount(0);
        await expect(page.locator('[data-detail-section]')).toHaveCount(0);
    });
});

/**
 * Accessibility, as a GATE rather than a baseline.
 *
 * SCOPE: `#itemDetailPage` only. `tests/e2e/support/axe.ts` requires a narrowed `include` to be
 * justified where it is written, so: this loop's subject is the route, the surrounding shell
 * (header, drawer, backdrop) is untouched by it and is already scanned by `b2-axe.spec.ts`, and a
 * whole-document scan here would attribute the shell's findings to Item Details.
 *
 * The P5 baseline recorded the legacy route's violations and failed only on `critical`. The rewrite
 * is required to reach ZERO at every severity, so that is what this asserts.
 */
test.describe('migrated Item Details, accessibility', () => {
    for (const [label, id] of [
        ['movie', 'movie-1'],
        ['series', 'series-1'],
        ['season', 'season-1']
    ] as const) {
        test(`axe finds no violation on ${label}`, async ({
            page,
            baseURL
        }) => {
            await installFixtureApi(page, baseURL as string, DIST);
            await openDetails(page, id);

            const result = await scanPage(page, [PAGE]);
            // eslint-disable-next-line no-console
            console.log(
                `axe ${AXE_VERSION} on the migrated /details route (${label})\n${formatViolations(result)}`
            );

            expect(
                result.violations.length,
                `accessibility violations on ${label}:\n${formatViolations(result)}`
            ).toBe(0);
        });
    }

    test('the heading hierarchy starts at h1 and never skips a level', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const levels = await page.$$eval(
            `${PAGE} h1, ${PAGE} h2, ${PAGE} h3, ${PAGE} h4, ${PAGE} h5, ${PAGE} h6`,
            (nodes) => nodes.map((node) => Number(node.tagName.slice(1)))
        );

        expect(levels[0], 'the page does not start at h1').toBe(1);
        for (let i = 1; i < levels.length; i++) {
            expect(
                levels[i] - levels[i - 1],
                `heading level jumped from h${levels[i - 1]} to h${levels[i]}`
            ).toBeLessThanOrEqual(1);
        }
    });
});

/** Narrow mobile: the composition is the same, and nothing overflows the viewport horizontally. */
test.describe('migrated Item Details, narrow mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('renders the same composition without horizontal overflow', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        expect(await renderedSections(page)).toContain('mainDetailButtons');
        expect(await renderedActions(page)).toContain('btnPlay');

        const overflow = await page.evaluate(
            () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth
        );
        expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(
            1
        );

        const result = await scanPage(page, [PAGE]);
        expect(
            result.violations.length,
            `accessibility violations on mobile:\n${formatViolations(result)}`
        ).toBe(0);

        await page.screenshot({
            path: join(ARTIFACTS, 'movie-mobile.png'),
            fullPage: true
        });
    });
});

/** TV / 10-foot: every principal action must be reachable with the keyboard alone. */
test.describe('migrated Item Details, TV viewport', () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('the action bar is reachable by keyboard alone', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        await page.locator('body').click({ position: { x: 1, y: 1 } });

        const reached = new Set<string>();
        for (let i = 0; i < 60; i++) {
            await page.keyboard.press('Tab');
            const name = await page.evaluate(() => {
                const active = document.activeElement;
                if (!active) return null;
                const owner = active.closest('[data-detail-action]');
                return owner?.getAttribute('data-detail-action') ?? null;
            });
            if (name) reached.add(name);
            if (reached.size >= 4) break;
        }

        for (const action of [
            'btnPlay',
            'btnPlaystate',
            'btnUserRating',
            'btnMoreCommands'
        ]) {
            expect(
                reached.has(action),
                `${action} was not reachable by Tab; reached: ${[...reached].join(', ')}`
            ).toBe(true);
        }

        await page.screenshot({
            path: join(ARTIFACTS, 'movie-tv.png'),
            fullPage: true
        });
    });
});

/** Reduced motion: the route must render its whole composition with animation suppressed. */
test.describe('migrated Item Details, reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('renders the whole composition with motion suppressed', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        expect(await renderedSections(page)).toEqual([
            'nameContainer',
            'itemMiscInfo-primary',
            'mainDetailButtons',
            'trackSelections',
            'tagline',
            'overview',
            'itemTags',
            'itemDetailsGroup',
            'castCollapsible'
        ]);

        const result = await scanPage(page, [PAGE]);
        expect(
            result.violations.length,
            `accessibility violations under reduced motion:\n${formatViolations(result)}`
        ).toBe(0);
    });
});

/**
 * Side-by-side captures for owner visual acceptance.
 *
 * These assert only that the route reached a rendered state — the picture is the deliverable, and
 * judging it is the owner's job, not a test's. The equivalence classes are the ones the fixture API
 * can serve; the remaining nineteen are covered by the jsdom suite against the frozen fixture.
 */
test.describe('migrated Item Details, capture set', () => {
    for (const [label, query] of [
        ['movie', 'id=movie-1'],
        ['series', 'id=series-1'],
        ['season', 'id=season-1'],
        ['episode', 'id=episode-1'],
        ['music-album', 'id=album-1'],
        ['person', 'id=person-1'],
        ['series-timer', 'seriesTimerId=seriestimer-1']
    ] as const) {
        test(`captures ${label}`, async ({ page, baseURL }) => {
            await installFixtureApi(page, baseURL as string, DIST);
            await page.goto(`/#/details?${query}&serverId=${SERVER_ID}`);
            await page.waitForSelector(
                `${PAGE} [data-detail-section="nameContainer"] h1`,
                { timeout: 30_000 }
            );
            await page.waitForTimeout(1500);

            expect(await renderedSections(page)).toContain('nameContainer');

            await page.screenshot({
                path: join(ARTIFACTS, `capture-${label}.png`),
                fullPage: true
            });
        });
    }
});

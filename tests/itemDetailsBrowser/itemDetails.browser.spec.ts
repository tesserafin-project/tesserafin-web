/**
 * Browser corroboration for the frozen legacy Item Details contract (tesserafin-web#129 Step 1a).
 *
 * `tests/itemDetails/itemDetails.characterization.test.ts` asserts the same behaviours under jsdom
 * with both API surfaces stubbed. That is fast and precise and it is NOT evidence that the live
 * route works: it never loads the built bundle, never authenticates, never lays anything out and
 * never upgrades a custom element. This suite drives the REAL `/details` route, in the REAL
 * production bundle, in a real Chromium.
 *
 * It needs NO Reefin server. `npm run build:production`, the tracked static server already used by
 * the reader and delivery suites, and a same-origin fixture API are the whole dependency set — see
 * `support/fixtureApi.ts` for why the API has to answer on the page's own origin.
 *
 *     npm run build:production && npm run test:item-details-browser
 *
 * The durable evidence is the machine-readable record: section order, action names, the request
 * ledger, focusability and teardown. Screenshots are written alongside as artifacts, not asserted.
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

/** The sections the frozen contract names, in the order the view declares them. */
const SECTION_SELECTORS: [string, string][] = [
    ['nameContainer', '.nameContainer'],
    ['itemMiscInfo-primary', '.itemMiscInfo-primary'],
    ['itemMiscInfo-secondary', '.itemMiscInfo-secondary'],
    ['mainDetailButtons', '.mainDetailButtons'],
    ['trackSelections', '.trackSelections'],
    ['tagline', '.tagline'],
    ['overview', '.overview'],
    ['itemTags', '.itemTags'],
    ['itemExternalLinks', '.itemExternalLinks'],
    ['itemDetailsGroup', '.itemDetailsGroup'],
    ['nextUpSection', '.nextUpSection'],
    ['listChildrenCollapsible', '#listChildrenCollapsible'],
    ['childrenCollapsible', '#childrenCollapsible'],
    ['castCollapsible', '#castCollapsible'],
    ['similarCollapsible', '#similarCollapsible']
];

async function renderedSections(page: Page): Promise<string[]> {
    return page.evaluate((pairs) => {
        const visible = (element: Element | null) => {
            let node: Element | null = element;
            while (node && node.id !== 'itemDetailPage') {
                if (node.classList.contains('hide')) return false;
                node = node.parentElement;
            }
            return Boolean(node);
        };
        return pairs
            .filter(([, selector]) =>
                visible(document.querySelector(`#itemDetailPage ${selector}`))
            )
            .map(([name]) => name);
    }, SECTION_SELECTORS);
}

async function visibleActions(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const bar = document.querySelector(
            '#itemDetailPage .mainDetailButtons'
        );
        if (!bar || bar.classList.contains('hide')) return [];
        return [...bar.querySelectorAll('button')]
            .filter((button) => !button.classList.contains('hide'))
            .map(
                (button) =>
                    [...button.classList].find((c) => c.startsWith('btn')) ?? ''
            )
            .filter(Boolean);
    });
}

async function openDetails(page: Page, id: string) {
    await page.goto(`/#/details?id=${id}&serverId=${SERVER_ID}`);
    await page.waitForSelector('#itemDetailPage .nameContainer h1', {
        timeout: 30_000
    });
    // The route fans out into several independent section renders; wait for the page to stop
    // changing rather than for a fixed number of them.
    await page.waitForTimeout(1500);
}

test.describe('legacy Item Details, in a real browser', () => {
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

        expect(await visibleActions(page)).toEqual([
            'btnPlay',
            'btnPlaystate',
            'btnUserRating',
            'btnMoreCommands'
        ]);

        // Multi-version / multi-track case: every selector the contract records is populated.
        expect(
            await page
                .locator('#itemDetailPage .selectSource option')
                .allTextContents()
        ).toEqual(['Version A', 'Version B']);
        expect(
            await page
                .locator('#itemDetailPage .selectAudio option')
                .allTextContents()
        ).toEqual(['English AAC', 'French AC3']);
        const subtitles = await page
            .locator('#itemDetailPage .selectSubtitles option')
            .allTextContents();
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

    test('the principal controls are focusable and keyboard-reachable', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        for (const selector of [
            '.btnPlay',
            '.btnPlaystate',
            '.btnUserRating',
            '.btnMoreCommands',
            '.selectSource',
            '.selectAudio',
            '.selectSubtitles'
        ]) {
            const control = page.locator(`#itemDetailPage ${selector}`).first();
            await control.focus();
            await expect(
                control,
                `${selector} could not take focus`
            ).toBeFocused();
        }
    });

    test('the played control issues a user-data mutation', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const before = ledger.requests.length;
        await page.locator('#itemDetailPage .btnPlaystate').first().click();
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
        await page.locator('#itemDetailPage .btnPlay').first().click();
        await page.waitForTimeout(2000);

        // What is asserted is that pressing play reaches the playback stack for THIS item — not
        // that a video element decoded anything, which a fixture cannot honestly provide.
        const issued = ledger.requests.slice(before);
        expect(
            issued.some((request) => request.includes('movie-1')),
            `play issued nothing for the item: ${issued.join(', ')}`
        ).toBe(true);
    });

    test('a season renders its episodes in server order', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'season-1');

        const sections = await renderedSections(page);
        expect(sections).toContain('listChildrenCollapsible');

        // A list row carries `data-id` on several nested controls, so the raw node list repeats
        // each id. First-occurrence order is the rendered order.
        const ids = await page
            .locator('#listChildrenCollapsible [data-id]')
            .evaluateAll((nodes) => [
                ...new Set(nodes.map((node) => node.getAttribute('data-id')))
            ]);
        expect(ids).toEqual(['episode-1', 'episode-2', 'episode-3']);
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

        const ids = await page
            .locator('#listChildrenCollapsible [data-id]')
            .evaluateAll((nodes) => [
                ...new Set(nodes.map((node) => node.getAttribute('data-id')))
            ]);
        expect(ids).toEqual(['season-1']);
    });

    test('navigating away tears the page down', async ({ page, baseURL }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');
        expect(await page.locator('#itemDetailPage').count()).toBe(1);

        await page.goto('/#/home');
        await page.waitForTimeout(2000);

        // The view manager CACHES a view rather than removing it — `#itemDetailPage` can survive
        // in the DOM. What must be true is that it is no longer presented, and that the item's own
        // content is gone from view. Asserting removal would freeze a view-manager implementation
        // detail the migration is meant to retire.
        await expect(page.locator('#itemDetailPage')).toBeHidden();
        await expect(
            page.locator('#itemDetailPage .nameContainer h1')
        ).toBeHidden();
    });
});

test.describe('legacy Item Details, accessibility baseline', () => {
    /**
     * SCOPE: `#itemDetailPage` only. `tests/e2e/support/axe.ts` requires a narrowed `include` to be
     * justified where it is written, so: this loop's subject is the route, the surrounding shell
     * (header, drawer, backdrop) is untouched by it and is already scanned by `b2-axe.spec.ts`, and
     * a whole-document scan here would attribute the shell's findings to Item Details.
     *
     * BASELINE, NOT A GATE. The route is unchanged by this loop, so any violation here predates it.
     * The suite records what axe finds and fails only on `critical`, which is the threshold that
     * would put this work into Lane A. Everything below `critical` is written to an artifact and to
     * the test output so the migration can be measured against it.
     */
    test('axe records the unchanged route as a baseline', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const result = await scanPage(page, ['#itemDetailPage']);
        // eslint-disable-next-line no-console
        console.log(
            `axe ${AXE_VERSION} on the legacy /details route\n${formatViolations(result)}`
        );

        expect(
            result.bySeverity.critical ?? 0,
            `critical accessibility violations on the supported surface:\n${formatViolations(result)}`
        ).toBe(0);
    });
});

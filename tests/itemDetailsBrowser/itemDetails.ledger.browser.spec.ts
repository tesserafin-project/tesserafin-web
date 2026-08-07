/**
 * #129 Step 1c, in a real browser: the ledger's outward surface, observed as HTTP.
 *
 * `tests/itemDetails/itemDetails.ledger.test.tsx` judges the ledger at the ADAPTER boundary under
 * jsdom, which is precise and fast and proves nothing about the built bundle. This proves the same
 * contract one layer out — at the wire — against the real production build, driven with the real
 * keyboard, with no Reefin server anywhere:
 *
 *     npm run build:production && npm run test:item-details-browser
 *
 * Two things only this layer can show:
 *
 *   1. A control activated with the KEYBOARD alone issues the same request a click does. jsdom does
 *      not synthesise a button's activation behaviour from `Enter`, so a handler bound to `onClick`
 *      but unreachable by keyboard would pass there and fail here.
 *   2. Nothing outside the declared endpoint set is requested. `installFixtureApi` answers `501` to
 *      anything it does not recognise and records it, so an undeclared request is a failure rather
 *      than a silent success.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { type Page, expect, test } from '@playwright/test';

import { SERVER_ID, installFixtureApi } from './support/fixtureApi';

const REPO_ROOT = resolve(__dirname, '..', '..');
const DIST = join(REPO_ROOT, 'dist');
const PAGE = '#itemDetailPage';

const LEDGER = JSON.parse(
    readFileSync(
        join(
            REPO_ROOT,
            'tests',
            'fixtures',
            'item-details',
            'migrated-request-action-ledger.json'
        ),
        'utf8'
    )
) as {
    classes: {
        id: string;
        actions: { id: string }[];
        localOnly: { id: string }[];
        disabledControls: { id: string }[];
    }[];
};

const ledgerClass = (id: string) => {
    const found = LEDGER.classes.find((entry) => entry.id === id);
    if (!found) throw new Error(`no ledger class "${id}"`);
    return found;
};

async function openDetails(page: Page, id: string) {
    await page.goto(`/#/details?id=${id}&serverId=${SERVER_ID}`);
    await page.waitForSelector(
        `${PAGE} [data-detail-section="nameContainer"] h1`,
        { timeout: 30_000 }
    );
    await page.waitForTimeout(1500);
}

/** Every interactive node the page renders, with the identity the ledger computes for it. */
async function affordances(page: Page) {
    return page.$$eval(
        `${PAGE} button, ${PAGE} a[href], ${PAGE} select, ${PAGE} input, ${PAGE} [role="button"], ${PAGE} [role="link"], ${PAGE} summary`,
        (nodes) =>
            nodes.map((node) => ({
                tag: node.tagName.toLowerCase(),
                section:
                    node
                        .closest('[data-detail-section]')
                        ?.getAttribute('data-detail-section') ?? null,
                action:
                    node
                        .closest('[data-detail-action]')
                        ?.getAttribute('data-detail-action') ?? null,
                select: node.getAttribute('data-detail-select'),
                disabled: (node as HTMLButtonElement).disabled ?? false,
                href: node.getAttribute('href'),
                name: (
                    node.getAttribute('aria-label') ??
                    node.getAttribute('title') ??
                    node.textContent ??
                    ''
                )
                    .trim()
                    .slice(0, 60)
            }))
    );
}

test.describe('migrated Item Details ledger, in a real browser', () => {
    test('the initial run issues only declared endpoints', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        expect(ledger.undeclared, 'undeclared API requests').toEqual([]);

        // The primary read, at the wire, against the ITEM id.
        expect(
            ledger.requests.some((request) =>
                /^GET \/(?:Users\/[^/]+\/)?Items\/movie-1$/.test(request)
            ),
            `the primary item read is missing from:\n${ledger.requests.join('\n')}`
        ).toBe(true);

        // And never against a media-source id. `movie-1-alt` is a SOURCE of `movie-1`; a request
        // path carrying it would mean the route confused the two.
        expect(
            ledger.requests.filter((request) =>
                request.includes('movie-1-alt')
            ),
            'a request targeted a media-source id'
        ).toEqual([]);
    });

    test('every rendered affordance carries a ledger classification', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const cls = ledgerClass('movie');
        const knownActions = new Set(cls.actions.map((row) => row.id));
        const knownSelectors = new Set([
            ...cls.localOnly.map((row) => row.id),
            ...cls.disabledControls.map((row) => row.id)
        ]);

        const unclassified = (await affordances(page)).filter((node) => {
            if (node.action) return !knownActions.has(node.action);
            if (node.select) return !knownSelectors.has(node.select);
            // Navigation and the overview toggle: an anchor, or a button inside a declared section.
            if (node.tag === 'a' && node.href) return false;
            if (node.section) return false;
            return true;
        });

        expect(
            unclassified,
            `[item-details ledger] the built bundle renders control(s) the ledger does not classify:\n${JSON.stringify(
                unclassified,
                null,
                2
            )}`
        ).toEqual([]);
    });

    /**
     * The played mutation, reached with the keyboard alone.
     *
     * The control is focused by tabbing from the page, not by `.focus()`, so a control removed from
     * the tab order fails here. The assertion is on the TARGET: the mutation names the item id.
     */
    test('the played control is keyboard-reachable and mutates the ITEM', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const played = page.locator(
            `${PAGE} [data-detail-action="btnPlaystate"] button`
        );
        await expect(played).toHaveCount(1);

        await played.focus();
        await expect(played).toBeFocused();

        const before = ledger.requests.length;
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);

        const issued = ledger.requests.slice(before);
        expect(
            issued.some((request) => /PlayedItems\/movie-1$/.test(request)),
            `the played mutation is missing from:\n${issued.join('\n')}`
        ).toBe(true);
        expect(
            issued.filter((request) => request.includes('movie-1-alt')),
            'the played mutation targeted a media-source id'
        ).toEqual([]);
        expect(ledger.undeclared).toEqual([]);
    });

    test('the favourite control is keyboard-reachable and mutates the ITEM', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const favourite = page.locator(
            `${PAGE} [data-detail-action="btnUserRating"] button`
        );
        await expect(favourite).toHaveCount(1);

        await favourite.focus();
        await expect(favourite).toBeFocused();

        const before = ledger.requests.length;
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);

        const issued = ledger.requests.slice(before);
        expect(
            issued.some((request) => /FavoriteItems\/movie-1$/.test(request)),
            `the favourite mutation is missing from:\n${issued.join('\n')}`
        ).toBe(true);
        expect(ledger.undeclared).toEqual([]);
    });

    /**
     * A LOCAL_ONLY control must reach nothing outward — proven at the wire, where "nothing" is
     * checkable without knowing which adapter the route happens to use.
     */
    test('selecting an alternate version issues no request', async ({
        page,
        baseURL
    }) => {
        const ledger = await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const before = ledger.requests.length;
        await page.selectOption(`${PAGE} [data-detail-select="selectSource"]`, {
            index: 1
        });
        await page.waitForTimeout(1000);

        expect(
            ledger.requests.slice(before),
            'the media-source selector is LOCAL_ONLY and must issue no request'
        ).toEqual([]);
    });

    test('the video selector is offered and disabled, as the ledger records', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        const video = page.locator(
            `${PAGE} [data-detail-select="selectVideo"]`
        );
        await expect(video).toHaveCount(1);
        await expect(video).toBeDisabled();
    });

    /**
     * The route is still unbound, proven from the shipped bundle rather than from source.
     */
    test('the shipped route chunk reads no presentation recipe', async ({
        page,
        baseURL
    }) => {
        const chunks: string[] = [];
        page.on('response', (response) => {
            const path = new URL(response.url()).pathname;
            if (/^\/details\..*\.chunk\.js$/.test(path)) chunks.push(path);
        });

        await installFixtureApi(page, baseURL as string, DIST);
        await openDetails(page, 'movie-1');

        expect(
            chunks.length,
            'the route chunk was not fetched'
        ).toBeGreaterThan(0);
        for (const chunk of chunks) {
            const source = readFileSync(
                join(DIST, chunk.replace(/^\//, '')),
                'utf8'
            );
            expect(
                source,
                `${chunk} reads presentation.page.itemDetails`
            ).not.toMatch(/presentation[\s\S]{0,40}?\bitemDetails\b/);
        }
    });
});

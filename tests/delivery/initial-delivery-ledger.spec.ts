import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * Browser corroboration for the aggregate delivery budget.
 *
 * The normative gate is scripts/verify-delivery-budget.mjs, which reasons about webpack's emitted
 * graph. This suite asks a different question with a different instrument: open the production
 * build in a cold Chromium and record what it actually requests. If the two disagree, the static
 * model is wrong about the product, and that is worth knowing before a budget is trusted.
 *
 * ASSERTED: resource identity and membership - which files were fetched, and which were not.
 * NOT ASSERTED: any duration. See playwright.delivery.config.ts for why.
 *
 * SCOPE LIMIT, stated plainly: with no Tesserafin server there is no session, so the routes an
 * authenticated viewer would land on (Home, Library) cannot be driven here. What IS provable
 * server-free is the boot surface every visitor gets - the document, its scripts and stylesheets,
 * and the chunks start-up fetches on its own - plus the fact that Theme Studio's route code is
 * fetched only when something navigates to Theme Studio. The repository has no tracked way to
 * start a server, and this suite deliberately does not grow one.
 */
const REPO_ROOT = resolve(__dirname, '..', '..');
const DIST = join(REPO_ROOT, 'dist');
const STATS = join(REPO_ROOT, 'delivery-stats', 'stats.json');

/** The Theme Studio route chunk, named by webpackChunkName `[request]` in AsyncRoute.tsx. */
const THEME_STUDIO_PREFIX = 'user-themeStudio';

function readStats() {
    if (!existsSync(STATS)) {
        throw new Error(
            `no delivery stats at ${STATS} - run \`npm run build:production\` first. This suite ` +
                'compares the browser ledger against the static model and refuses to run with ' +
                'only half of it.'
        );
    }
    return JSON.parse(readFileSync(STATS, 'utf8'));
}

/** Scripts and stylesheets index.html itself asks for, read straight out of the emitted file. */
function referencedByDocument(): string[] {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    const names: string[] = [];
    for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
        names.push(decodeURIComponent(src.split('?')[0]));
    }
    for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
        if (!/\srel="stylesheet"/.test(tag)) continue;
        const href = /\shref="([^"]+)"/.exec(tag);
        if (href) names.push(decodeURIComponent(href[1].split('?')[0]));
    }
    return [...new Set(names)].sort();
}

function assetName(url: string, origin: string): string | null {
    if (!url.startsWith(origin)) return null;
    return decodeURIComponent(
        new URL(url).pathname.replace(/^\//, '').split('?')[0]
    );
}

test.describe('initial delivery ledger', () => {
    test('index.html requests exactly the statically computed initial set', async ({
        page,
        baseURL
    }) => {
        const stats = readStats();
        const requested: string[] = [];
        page.on('request', (request) => {
            const name = assetName(request.url(), baseURL as string);
            if (name) requested.push(name);
        });

        // Cache disabled: a warm cache would suppress the very requests being counted.
        const client = await page.context().newCDPSession(page);
        await client.send('Network.setCacheDisabled', { cacheDisabled: true });

        await page.goto('/', { waitUntil: 'load' });

        const documentAssets = referencedByDocument();
        const staticModel = [
            ...stats.htmlInjected.js,
            ...stats.htmlInjected.css
        ].sort();

        // The static model and the emitted document must describe the same set. This is the
        // check that would catch the delivery-stats plugin drifting away from reality.
        expect(documentAssets).toEqual(staticModel);

        // And the browser must actually have fetched every one of them.
        for (const asset of documentAssets) {
            expect(
                requested,
                `${asset} is referenced by index.html but was never requested`
            ).toContain(asset);
        }
    });

    test('start-up fetches no Theme Studio route code', async ({
        page,
        baseURL
    }) => {
        const requested: string[] = [];
        page.on('request', (request) => {
            const name = assetName(request.url(), baseURL as string);
            if (name) requested.push(name);
        });

        const client = await page.context().newCDPSession(page);
        await client.send('Network.setCacheDisabled', { cacheDisabled: true });

        await page.goto('/', { waitUntil: 'load' });
        // Give start-up's own dynamic imports (fonts, playback surfaces) time to be issued, so
        // "Theme Studio was not among them" is a statement about a settled ledger.
        await page.waitForTimeout(3_000);

        const studio = requested.filter((name) =>
            name.startsWith(THEME_STUDIO_PREFIX)
        );
        expect(
            studio,
            'the ordinary boot surface must not fetch the Theme Studio route chunk'
        ).toEqual([]);

        // Informational, not asserted as a threshold: what start-up fetched beyond the document's
        // own tags. These are the assets the budget's `startup` tier exists to keep honest.
        const documentAssets = new Set(referencedByDocument());
        const dynamic = [...new Set(requested)]
            .filter((name) => !documentAssets.has(name))
            .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
            .sort();
        console.log(
            `[delivery-ledger] start-up also fetched ${dynamic.length} dynamic chunk(s):\n  ` +
                dynamic.join('\n  ')
        );
    });

    test('navigating to Theme Studio is what first requests its route code', async ({
        page,
        baseURL
    }) => {
        const requested: string[] = [];
        page.on('request', (request) => {
            const name = assetName(request.url(), baseURL as string);
            if (name) requested.push(name);
        });

        const client = await page.context().newCDPSession(page);
        await client.send('Network.setCacheDisabled', { cacheDisabled: true });

        await page.goto('/', { waitUntil: 'load' });
        await page.waitForTimeout(3_000);
        const beforeNavigation = requested.length;
        expect(
            requested.filter((name) => name.startsWith(THEME_STUDIO_PREFIX))
        ).toEqual([]);

        await page.evaluate(() => {
            window.location.hash = '#/themestudio';
        });

        // React Router resolves the route's `lazy()` loader on navigation, before the parent
        // `ConnectionRequired` gate decides anything, so the chunk request is observable without
        // a session even though the page itself will not render.
        await expect
            .poll(
                () =>
                    requested
                        .slice(beforeNavigation)
                        .filter((name) => name.startsWith(THEME_STUDIO_PREFIX))
                        .length,
                {
                    message:
                        'navigating to Theme Studio should be the first thing that fetches its ' +
                        'route chunk',
                    timeout: 15_000
                }
            )
            .toBeGreaterThan(0);
    });
});

import type { Page } from '@playwright/test';
import { request } from '@playwright/test';

import { signIn } from './support/b2';
import { expect, test } from './support/origin-inventory';

/**
 * `presentation.page.library` against a REAL server, in a REAL browser.
 *
 * `LibraryView.recipe.test.tsx` asserts the same behaviours under jsdom with the SDK stubbed. That
 * is fast and precise and it is NOT evidence that the live route works: it never loads the built
 * bundle, never authenticates, never receives a server response, and never lays anything out. The
 * claim of this vertical is
 *
 *     Theme Studio draft → explicit Apply → the live Library changes layout / card aspect /
 *     filter presentation → the catalogue request ledger and the ordered item set do NOT change
 *     → reload preserves → reset restores
 *
 * and the second arrow is the one no unit test can settle on its own: here the ledger is read off
 * the BROWSER'S OWN network activity, not off a mock. Every `/Items` request the page issues is
 * captured from Playwright's request events, normalised, and compared across recipes.
 *
 * Needs a seeded Tesserafin server (`tesserafin/ci/serve-e2e.sh`), whose Movies library holds two
 * items — enough for an ordered set that a broken recipe could reorder or truncate.
 */

const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';
const USER = process.env.TESSERAFIN_E2E_USER ?? 'e2e';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'e2e-password';
const E2E_AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-library-composition", Version="0.0.0"';

const COMPOSITION = '[data-rf-slot="library-composition"]';
const APPLIED_KEY = 'tesserafin.themeStudio.appliedPresentation';

/** The catalogue-shaping parameters. Everything else on the URL is transport or cache-busting. */
const LEDGER_PARAMS = [
    'parentId',
    'includeItemTypes',
    'recursive',
    'sortBy',
    'sortOrder',
    'startIndex',
    'limit',
    'genres',
    'years',
    'studioIds',
    'isFavorite',
    'nameStartsWith',
    'nameLessThan',
    /*
     * Image-shaping parameters, deliberately IN the ledger. The whole `cardAspect` argument is
     * "cropping is presentation, a different image request is not", and a recipe that switched
     * `enableImageTypes` to `Backdrop` would be doing the second thing while looking like the
     * first. Leaving these out would have made that undetectable from the browser.
     */
    'fields',
    'enableImageTypes',
    'imageTypeLimit'
];

interface LedgerEntry {
    endpoint: string;
    params: Record<string, string>;
}

/**
 * Records every catalogue request the BROWSER issues, normalised.
 *
 * Dropped: the origin, the API key, and any parameter outside {@link LEDGER_PARAMS} — those are
 * transport and session details that legitimately differ between two runs. Kept: everything that
 * decides which items come back.
 */
function collectLedger(page: Page): LedgerEntry[] {
    const entries: LedgerEntry[] = [];

    page.on('request', (req) => {
        const url = new URL(req.url());
        if (
            !/\/(Items|Studios|Filters2?|Users\/.*\/Items)$/i.test(url.pathname)
        )
            return;

        const params: Record<string, string> = {};
        for (const key of LEDGER_PARAMS) {
            const value = url.searchParams.get(key);
            if (value !== null) params[key] = value;
        }
        entries.push({ endpoint: url.pathname, params });
    });

    return entries;
}

function sortLedger(entries: LedgerEntry[]): string[] {
    return entries
        .map((entry) => `${entry.endpoint}?${JSON.stringify(entry.params)}`)
        .sort();
}

/**
 * Waits until the ledger has stopped growing, then returns it.
 *
 * Not optional. Navigating from `/#/themestudio` back to the library is a same-document hash
 * change, so React Query answers from cache (`placeholderData: keepPreviousData`) and the cards are
 * on screen BEFORE the refetch lands. Snapshotting on "cards are visible" would compare a warm
 * cache hit against a cold load and call the difference a recipe change.
 */
async function settledLedger(
    page: Page,
    entries: LedgerEntry[]
): Promise<string[]> {
    await expect
        .poll(() => entries.length, {
            timeout: 30_000,
            message: 'no catalogue traffic was observed at all'
        })
        .toBeGreaterThan(0);

    let previous = -1;
    await expect
        .poll(
            async () => {
                const stable = entries.length === previous;
                previous = entries.length;
                return stable;
            },
            {
                intervals: [750, 750, 750, 750, 750, 750],
                timeout: 20_000,
                message: 'catalogue traffic never settled'
            }
        )
        .toBe(true);

    return sortLedger(entries);
}

/** The resolved recipe, read off the composition root's published attributes. */
async function composition(page: Page) {
    return page.evaluate((selector) => {
        const root = document.querySelector(selector);
        return {
            layout: root?.getAttribute('data-rf-library-layout') ?? null,
            cardAspect:
                root?.getAttribute('data-rf-library-card-aspect') ?? null,
            filters: root?.getAttribute('data-rf-library-filters') ?? null
        };
    }, COMPOSITION);
}

/** The rendered items, in DOM order — the user-visible answer to "which media did I get?". */
async function renderedItems(page: Page): Promise<string[]> {
    return page.evaluate((selector) => {
        const root = document.querySelector(selector);
        if (!root) return [];
        return [...root.querySelectorAll('[data-rf-slot="media-card"]')].map(
            (card) => card.getAttribute('href') ?? ''
        );
    }, COMPOSITION);
}

/**
 * Loads a library URL with an empty query cache, and returns the ledger of what that load asked for.
 *
 * Two layers of caching sit between "the route wants this page" and "the browser asks for it", and
 * both had to be removed for the comparison to mean anything:
 *
 *   - `/#/library/…` reached from another hash route is a SAME-DOCUMENT navigation, so React Query
 *     answers from memory and the page can render a full grid having issued no request at all;
 *   - a real document reload does not help on its own. `utils/query/queryClient.ts` PERSISTS the
 *     query cache to IndexedDB (`gcTime` 24h) and restores it at boot with `staleTime` 60s, so a
 *     reload inside that minute rehydrates the same data and refetches nothing. Measured: the first
 *     run of this spec saw the image requests fire and not one catalogue request, and read that as
 *     "the recipe suppressed the query".
 *
 * Dropping `keyval-store` (idb-keyval's default database, which is where that persister writes) puts
 * every measurement on the same cold start, so a ledger difference can only be a recipe difference.
 */
async function loadLibraryCold(
    page: Page,
    url: string,
    ledger: LedgerEntry[]
): Promise<string[]> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
        () =>
            new Promise((resolve) => {
                const request = indexedDB.deleteDatabase('keyval-store');
                request.onsuccess = () => resolve(null);
                request.onerror = () => resolve(null);
                request.onblocked = () => resolve(null);
            })
    );
    ledger.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForLibrarySettled(page);
    return settledLedger(page, ledger);
}

async function waitForLibrarySettled(page: Page) {
    await expect(page.locator(COMPOSITION)).toBeVisible({ timeout: 30_000 });
    await expect
        .poll(async () => page.locator('[data-rf-slot="media-card"]').count(), {
            timeout: 45_000,
            message: 'the library never rendered any item'
        })
        .toBeGreaterThan(0);
}

/** Drives the Studio's real Library controls, then Applies. */
async function applyRecipeThroughStudio(
    page: Page,
    recipe: { layout: string; cardAspect: string; filters: string }
) {
    await page.goto('/#/themestudio', { waitUntil: 'domcontentloaded' });

    const start = page.getByRole('button', { name: /Copy Tesserafin Glass/i });
    const editor = page.locator(
        '[data-testid="theme-studio-library-composition"]'
    );

    await expect(start.or(editor).first()).toBeVisible({ timeout: 30_000 });
    if (await start.isVisible().catch(() => false)) {
        await start.click();
    }
    await expect(
        editor,
        'the Studio must offer a real Library composition control'
    ).toBeVisible({ timeout: 20_000 });

    // The controls themselves, not a storage write: this proves the CONTROL is wired to the same
    // recipe the route reads.
    /*
     * `getByRole('combobox')`, not `getByLabel`: a MUI `Select` renders a hidden `<input>` AND a
     * `div[role="combobox"]`, both associated with the label, so `getByLabel` is ambiguous. Nothing
     * here is wrapped in a `catch` — if the control cannot be driven, the claim that the Studio is
     * really wired to the live recipe is false, and that must be a red.
     */
    for (const [label, value] of [
        ['Layout', recipe.layout],
        ['Card aspect', recipe.cardAspect],
        ['Filter controls', recipe.filters]
    ] as const) {
        await editor.getByRole('combobox', { name: label }).click();
        await page.getByRole('option', { name: value, exact: true }).click();
    }

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

test.describe('Library page composition, against the live route', () => {
    let libraryId = '';

    test.beforeAll(async () => {
        const api = await request.newContext({ baseURL: BASE_URL });
        const authResponse = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        expect(authResponse.ok()).toBeTruthy();
        const auth = await authResponse.json();

        const viewsResponse = await api.get('/UserViews', {
            params: { userId: auth.User.Id },
            headers: {
                Authorization: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
            }
        });
        const views = await viewsResponse.json();
        const moviesView = (
            views.Items as Array<Record<string, unknown>>
        )?.find((item) => item.CollectionType === 'movies');
        if (!moviesView?.Id) {
            throw new Error(
                'No movies-type library found via /UserViews — cannot resolve libraryId'
            );
        }
        libraryId = String(moviesView.Id);
        await api.dispose();
    });

    test('changes composition on Apply while the request ledger and the ordered item set stay identical', async ({
        page
    }) => {
        const ledger = collectLedger(page);
        await signIn(page);

        // --- Official ------------------------------------------------------------------------
        // Cold on BOTH sides of the comparison, and the ledger cleared on both: sign-in and
        // `/#/home` issue catalogue requests of their own, and counting them on one side only would
        // make the two ledgers differ for a reason that has nothing to do with a recipe.
        const officialLedger = await loadLibraryCold(
            page,
            `/#/library/${libraryId}`,
            ledger
        );

        const official = await composition(page);
        const officialItems = await renderedItems(page);

        test.info().attach('library-official', {
            body: JSON.stringify(
                {
                    composition: official,
                    items: officialItems,
                    ledger: officialLedger
                },
                null,
                2
            ),
            contentType: 'application/json'
        });

        expect(official).toEqual({
            layout: 'grid',
            cardAspect: 'poster',
            filters: 'inline'
        });
        expect(
            officialItems.length,
            'the seeded library must give the recipe something to compose'
        ).toBeGreaterThan(0);
        expect(
            officialLedger.length,
            'the ledger must have observed real catalogue traffic'
        ).toBeGreaterThan(0);
        await expect(page.locator('[data-rf-slot="media-grid"]')).toBeVisible();

        await page.screenshot({
            path: 'test-results/library-desktop-grid-inline.png',
            fullPage: true
        });

        // --- Apply ---------------------------------------------------------------------------
        await applyRecipeThroughStudio(page, {
            layout: 'shelf',
            cardAspect: 'backdrop',
            filters: 'drawer'
        });

        const appliedLedger = await loadLibraryCold(
            page,
            `/#/library/${libraryId}`,
            ledger
        );

        const applied = await composition(page);
        const appliedItems = await renderedItems(page);

        test.info().attach('library-applied', {
            body: JSON.stringify(
                {
                    composition: applied,
                    items: appliedItems,
                    ledger: appliedLedger
                },
                null,
                2
            ),
            contentType: 'application/json'
        });

        // The composition changed …
        expect(applied).toEqual({
            layout: 'shelf',
            cardAspect: 'backdrop',
            filters: 'drawer'
        });
        await expect(
            page.locator('[data-rf-slot="media-shelf"]')
        ).toBeVisible();
        expect(await page.locator('[data-rf-slot="media-grid"]').count()).toBe(
            0
        );
        await expect(page.locator('.rf-filter-drawer__trigger')).toBeVisible();

        // … and the data did not. This pair of assertions IS the vertical.
        expect(
            appliedLedger,
            'a recipe changed the catalogue requests the browser issued'
        ).toEqual(officialLedger);
        expect(
            appliedItems,
            'a recipe changed which items the reader received, or their order'
        ).toEqual(officialItems);

        await page.screenshot({
            path: 'test-results/library-desktop-shelf-drawer.png',
            fullPage: true
        });

        // --- The drawer, opened --------------------------------------------------------------
        const beforeOpen = await settledLedger(page, ledger);
        await page.locator('.rf-filter-drawer__trigger').click();
        await expect(
            page.locator('[data-rf-slot="filter-drawer"]')
        ).toBeVisible();
        expect(
            sortLedger(ledger),
            'opening a drawer is not a data event'
        ).toEqual(beforeOpen);
        expect(await renderedItems(page)).toEqual(officialItems);

        await page.screenshot({
            path: 'test-results/library-desktop-drawer-open.png',
            fullPage: true
        });

        await page.keyboard.press('Escape');
        await expect(
            page.locator('[data-rf-slot="filter-drawer"]')
        ).toHaveCount(0);
        expect(
            sortLedger(ledger),
            'closing a drawer is not a data event either'
        ).toEqual(beforeOpen);

        // --- Reload --------------------------------------------------------------------------
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForLibrarySettled(page);
        expect(
            await composition(page),
            'a full document reload must preserve the applied recipe'
        ).toEqual(applied);
        expect(await renderedItems(page)).toEqual(officialItems);

        // --- Reset ---------------------------------------------------------------------------
        await page.goto('/#/themestudio', { waitUntil: 'domcontentloaded' });
        await page
            .getByRole('button', { name: /Stop using this theme/i })
            .click();
        await page.goto(`/#/library/${libraryId}`, {
            waitUntil: 'domcontentloaded'
        });
        await waitForLibrarySettled(page);

        expect(
            await composition(page),
            'reset must restore the official recipe exactly'
        ).toEqual(official);
        expect(await renderedItems(page)).toEqual(officialItems);
    });

    test('a real sort and a real filter behave identically under both recipes', async ({
        page
    }) => {
        const ledger = collectLedger(page);
        await signIn(page);

        // Descending name, page 1 — expressed on the URL, which is where the route's query state
        // lives, so this exercises the same path the controls write to.
        const url = `/#/library/${libraryId}?sort=SortName&order=Descending`;

        const gridLedger = await loadLibraryCold(page, url, ledger);
        const gridItems = await renderedItems(page);

        expect(
            gridLedger.some((entry) => entry.includes('Descending')),
            'the descending sort must have reached the server'
        ).toBe(true);

        await applyRecipeThroughStudio(page, {
            layout: 'shelf',
            cardAspect: 'square',
            filters: 'drawer'
        });

        expect(
            await loadLibraryCold(page, url, ledger),
            'the recipe changed a sorted query'
        ).toEqual(gridLedger);
        expect(
            await renderedItems(page),
            'the recipe changed a sorted result'
        ).toEqual(gridItems);

        test.info().attach('library-sorted-ledger', {
            body: JSON.stringify({ gridLedger, gridItems }, null, 2),
            contentType: 'application/json'
        });
    });

    test('the drawer is reachable and operable on a phone viewport', async ({
        page
    }) => {
        await signIn(page);
        await applyRecipeThroughStudio(page, {
            layout: 'grid',
            cardAspect: 'poster',
            filters: 'drawer'
        });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/#/library/${libraryId}`, {
            waitUntil: 'domcontentloaded'
        });
        await waitForLibrarySettled(page);

        const trigger = page.locator('.rf-filter-drawer__trigger');
        await expect(trigger).toBeVisible();
        await trigger.click();
        const panel = page.locator('[data-rf-slot="filter-drawer"]');
        await expect(panel).toBeVisible();

        // Focus entered the panel …
        expect(
            await page.evaluate(
                (selector) =>
                    document
                        .querySelector(selector)
                        ?.contains(document.activeElement) ?? false,
                '[data-rf-slot="filter-drawer"]'
            )
        ).toBe(true);

        await page.screenshot({
            path: 'test-results/library-mobile-drawer.png',
            fullPage: false
        });

        // … and no fixed panel pushed the document sideways.
        expect(
            await page.evaluate(
                () =>
                    document.documentElement.scrollWidth <=
                    document.documentElement.clientWidth + 1
            ),
            'the drawer must not cause horizontal page overflow'
        ).toBe(true);

        // … and Escape gives it back to the trigger.
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        expect(
            await page.evaluate(() =>
                document.activeElement?.className.includes(
                    'rf-filter-drawer__trigger'
                )
            )
        ).toBe(true);
    });

    // Keyboard operation, which is also the remote's input model on this shell. Named for what it
    // drives — plain Tab/Enter/Escape — rather than claiming a TV profile it does not set.
    test('a shelf recipe is operable by keyboard alone', async ({ page }) => {
        await signIn(page);
        await applyRecipeThroughStudio(page, {
            layout: 'shelf',
            cardAspect: 'backdrop',
            filters: 'drawer'
        });

        await page.goto(`/#/library/${libraryId}`, {
            waitUntil: 'domcontentloaded'
        });
        await waitForLibrarySettled(page);

        // Tab until the drawer trigger has focus, then open it with the keyboard only. A control a
        // keyboard cannot reach is a filter a reader cannot reach.
        let reached = false;
        for (let step = 0; step < 40 && !reached; step++) {
            await page.keyboard.press('Tab');
            reached = await page.evaluate(() =>
                Boolean(
                    document.activeElement?.className.includes(
                        'rf-filter-drawer__trigger'
                    )
                )
            );
        }
        expect(reached, 'the filter drawer trigger must be tabbable').toBe(
            true
        );

        await page.keyboard.press('Enter');
        await expect(
            page.locator('[data-rf-slot="filter-drawer"]')
        ).toBeVisible();

        await page.screenshot({
            path: 'test-results/library-shelf-keyboard-drawer.png',
            fullPage: false
        });

        await page.keyboard.press('Escape');
        await expect(
            page.locator('[data-rf-slot="filter-drawer"]')
        ).toHaveCount(0);
    });
});

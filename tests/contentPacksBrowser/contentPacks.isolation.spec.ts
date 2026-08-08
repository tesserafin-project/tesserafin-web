/**
 * Two separately authenticated users, one server, no leak (#138 §5, gate 22).
 *
 * The M1 contract makes every value on these surfaces a per-user projection: the visible count, the
 * representative artwork, the authorized page, and whether a pack is visible AT ALL. This spec
 * drives two browser contexts with two authored projections and proves each UI renders its own
 * response verbatim.
 *
 * The fixture does NOT evaluate authorization. User B's absent pack is absent because B's authored
 * response does not contain it — exactly as a server that had filtered it would have answered. A
 * fixture that filtered would be proving its own filter.
 *
 * ## A note on the runtime-origin inventory
 *
 * The instrumented `test` subscribes to the fixture-provided `context`. The SECOND context created
 * here is outside that subscription, so its traffic is not in the inventory. That is not a hole in
 * the gate: user B's page reaches the same origins as user A's, and every one of them is already
 * recorded from the first context. The coverage marker for this spec is emitted regardless.
 */
import type { BrowserContext, Page } from '@playwright/test';

import {
    DIST,
    PAGE,
    cardSubtitles,
    cardTitles,
    expect,
    sel,
    settled,
    test
} from './support/harness';
import { installFixtureApi, type FixtureProfile } from './support/fixtureApi';
import { MANAGER_A, MANAGER_B, clone } from './support/profiles';

async function signedInPage(
    context: BrowserContext,
    baseURL: string,
    profile: FixtureProfile
): Promise<{
    page: Page;
    ledger: Awaited<ReturnType<typeof installFixtureApi>>;
}> {
    const page = await context.newPage();
    const ledger = await installFixtureApi(page, baseURL, DIST, clone(profile));
    return { page, ledger };
}

test('each context renders its own projection, and nothing of the other', async ({
    context,
    browser,
    baseURL
}) => {
    const a = await signedInPage(context, baseURL as string, MANAGER_A);
    const contextB = await browser.newContext();
    const b = await signedInPage(contextB, baseURL as string, MANAGER_B);

    for (const page of [a.page, b.page]) {
        await page.goto('/#/contentpacks');
        await page.waitForSelector(`${PAGE} ${sel('mosaic-heading')}`, {
            timeout: 45_000
        });
        await settled(page);
    }

    // --- the lists differ, exactly as authored -------------------------------------------------
    expect(await cardTitles(a.page)).toEqual([
        'Weeknights',
        'Archive',
        'Nothing yet'
    ]);
    expect(await cardTitles(b.page)).toEqual(['Weeknights', 'B only']);

    // `pack-archive` is not merely hidden in B's DOM — it is absent, which is how the M1 contract
    // expresses "wholly inaccessible".
    expect(await b.page.content()).not.toContain('pack-archive');
    expect(await b.page.content()).not.toContain('Nothing yet');
    // And B's own pack never appears in A's.
    expect(await a.page.content()).not.toContain('pack-solo');
    expect(await a.page.content()).not.toContain('B only');

    // --- the SHARED pack is projected differently for each ------------------------------------
    const countsA = await cardSubtitles(a.page);
    const countsB = await cardSubtitles(b.page);
    expect(countsA[0]).toContain('9');
    expect(countsB[0]).toContain('2');
    // Neither context shows a raw membership count belonging to the other.
    expect(countsB[0]).not.toContain('9');
    expect(countsA[0]).not.toContain('2');

    // Representative artwork is the server's choice per user, and each card asked only for its own.
    const artA = await a.page
        .locator(`${PAGE} [data-rf-slot="media-card"]`)
        .nth(0)
        .locator('img')
        .getAttribute('src');
    const artB = await b.page
        .locator(`${PAGE} [data-rf-slot="media-card"]`)
        .nth(0)
        .locator('img')
        .getAttribute('src');
    expect(artA).toContain('/Items/movie-1/Images');
    expect(artB).toContain('/Items/book-1/Images');
    expect(await b.page.content()).not.toContain('movie-1');

    // --- the shared pack's DETAIL route, in both contexts ---------------------------------------
    for (const page of [a.page, b.page]) {
        await page.goto('/#/contentpacks/pack-weeknights');
        await page.waitForSelector(`${PAGE} ${sel('pack-name')}`, {
            timeout: 45_000
        });
        await settled(page);
    }

    await expect(a.page.locator(sel('pack-count'))).toContainText('9');
    await expect(b.page.locator(sel('pack-count'))).toContainText('2');
    expect(await cardTitles(a.page)).toEqual([
        'Fixture Movie',
        'Fixture Episode',
        'Fixture Album',
        'Fixture Book'
    ]);
    expect(await cardTitles(b.page)).toEqual(['Fixture Book']);

    // No placeholder, no hidden node, no artwork from A's page anywhere in B's document.
    const bHtml = await b.page.content();
    for (const leaked of [
        'Fixture Movie',
        'Fixture Episode',
        'Fixture Album'
    ]) {
        expect(bHtml).not.toContain(leaked);
    }

    // --- an entirely inaccessible pack, reached by its URL --------------------------------------
    await b.page.goto('/#/contentpacks/pack-archive');
    await b.page.waitForSelector(PAGE, { timeout: 45_000 });
    await settled(b.page);
    // A 404 is "absent OR wholly inaccessible", deliberately indistinguishable. The surface says
    // the one thing it is entitled to say, and offers no retry.
    await expect(b.page.locator('[data-rf-slot="state-empty"]')).toBeVisible();
    await expect(b.page.locator(sel('pack-name'))).toHaveCount(0);
    expect(await b.page.content()).not.toContain('Archive');

    expect(a.ledger.ledger.undeclared).toEqual([]);
    expect(b.ledger.ledger.undeclared).toEqual([]);

    await contextB.close();
});

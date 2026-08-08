/**
 * Every state either route can be in that is not "here are the packs" (#138 §5, §6).
 *
 * Loading, empty, failed-and-retried, 404, missing artwork, a failed write, and the stale-response
 * race between two pack ids. Each is a distinct thing the viewer is being told, and the bug this
 * spec exists to catch is being told two of them at once.
 */
import {
    DIST,
    PAGE,
    cardTitles,
    expect,
    openList,
    openPack,
    sel,
    settled,
    test
} from './support/harness';
import { installFixtureApi } from './support/fixtureApi';
import { MANAGER_A, MANAGER_EMPTY, clone } from './support/profiles';

test.describe('the list', () => {
    test('shows a loading state until the server answers', async ({
        page,
        baseURL
    }) => {
        const profile = clone(MANAGER_A);
        profile.faults = { holdList: true };
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            profile
        );

        await openList(page);
        await expect(
            page.locator(`${PAGE} [data-rf-slot="state-loading"]`)
        ).toBeVisible();
        await expect(
            page.locator(`${PAGE} [data-rf-slot="media-card"]`)
        ).toHaveCount(0);

        fixture.releaseList();
        await settled(page);
        expect(await cardTitles(page)).toHaveLength(3);
    });

    test('says so when there are no packs, and still offers the manager a way to make one', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_EMPTY)
        );

        await openList(page);
        await settled(page);

        await expect(
            page.locator('[data-rf-slot="state-empty"]')
        ).toBeVisible();
        await expect(
            page.locator(`${PAGE} [data-rf-slot="media-card"]`)
        ).toHaveCount(0);
        // The manager's create control is still there: an empty list is where it matters most.
        await expect(page.locator(sel('create'))).toBeVisible();
        // The heading is present in this state too.
        await expect(page.locator(sel('mosaic-heading'))).toBeVisible();
    });

    test('offers a retry after a transport failure, and recovers', async ({
        page,
        baseURL
    }) => {
        const profile = clone(MANAGER_A);
        profile.faults = { listStatus: 500 };
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            profile
        );

        await openList(page);
        await settled(page);

        const error = page.locator('[data-rf-slot="state-error"]');
        await expect(error).toBeVisible();

        fixture.profile.faults = {};
        await error.locator('button').click();

        await expect.poll(() => cardTitles(page)).toHaveLength(3);
        await expect(error).toHaveCount(0);
    });
});

test.describe('one pack', () => {
    test('an empty pack says so without suggesting anything is hidden', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await openPack(page, 'pack-empty');
        await settled(page);

        await expect(page.locator(sel('pack-name'))).toHaveText('Nothing yet');
        await expect(page.locator(sel('pack-count'))).toContainText('0');
        await expect(
            page.locator('[data-rf-slot="state-empty"]')
        ).toBeVisible();
    });

    test('offers a retry after an items failure, and recovers', async ({
        page,
        baseURL
    }) => {
        const profile = clone(MANAGER_A);
        profile.faults = { itemsStatus: 500 };
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            profile
        );

        await openPack(page, 'pack-weeknights');
        await settled(page);

        // The pack itself loaded, so the heading is real and only the items region failed.
        await expect(page.locator(sel('pack-name'))).toHaveText('Weeknights');
        const error = page.locator('[data-rf-slot="state-error"]');
        await expect(error).toBeVisible();

        fixture.profile.faults = {};
        await error.locator('button').click();
        await expect.poll(() => cardTitles(page)).toHaveLength(4);
    });

    test('a 404 says the pack is unavailable and offers no retry', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await openPack(page, 'pack-that-does-not-exist');
        await settled(page);

        await expect(
            page.locator('[data-rf-slot="state-empty"]')
        ).toBeVisible();
        // No retry: a retry cannot change the answer, and offering one would imply it might.
        await expect(page.locator('[data-rf-slot="state-error"]')).toHaveCount(
            0
        );
        await expect(page.locator(sel('pack-name'))).toHaveCount(0);
    });

    test('a card whose item has no artwork shows the placeholder', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await openPack(page, 'pack-archive');
        await settled(page);

        const card = page
            .locator(`${PAGE} [data-rf-slot="media-card"]`)
            .first();
        await expect(card).toBeVisible();
        await expect(card.locator('.rf-media-card__placeholder')).toHaveCount(
            1
        );
        await expect(card.locator('img')).toHaveCount(0);
    });

    test('a rename that fails leaves the dialog open and the heading unchanged', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await openPack(page, 'pack-weeknights');
        await settled(page);

        fixture.profile.faults = { writeStatus: 500 };
        await page.locator(sel('detail-rename')).click();
        await page
            .locator('[role="dialog"] input[name="contentPackName"]')
            .fill('Something else');
        await page
            .locator('[role="dialog"] form button[type="submit"]')
            .click();

        await expect(page.locator(sel('form-error'))).toBeVisible();
        await expect(page.locator(sel('pack-name'))).toHaveText('Weeknights');
        expect(page.url()).toContain('pack-weeknights');
    });

    test('navigating rapidly between two packs never shows the wrong one', async ({
        page,
        baseURL
    }) => {
        const profile = clone(MANAGER_A);
        /*
         * The first pack's detail answers SLOWLY and the second quickly, so the responses arrive
         * out of order. A route that keyed its state on "the last response" rather than on the
         * pack it is showing would paint `Weeknights` over `Archive` here.
         */
        profile.faults = { detailDelayMs: { 'pack-weeknights': 2500 } };
        await installFixtureApi(page, baseURL as string, DIST, profile);

        await page.goto('/#/contentpacks/pack-weeknights');
        await page.waitForSelector(PAGE, { timeout: 45_000 });
        await page.goto('/#/contentpacks/pack-archive');
        await page.waitForSelector(`${PAGE} ${sel('pack-name')}`, {
            timeout: 45_000
        });

        await expect(page.locator(sel('pack-name'))).toHaveText('Archive');
        await expect(page.locator(sel('pack-count'))).toContainText('1');

        // Wait past the slow response and check again: it must not land on this route.
        await page.waitForTimeout(4000);
        await expect(page.locator(sel('pack-name'))).toHaveText('Archive');
        await expect(page.locator(sel('pack-count'))).toContainText('1');
        expect(await cardTitles(page)).toEqual([
            'Fixture Movie Without Artwork'
        ]);
    });
});

/**
 * What an authorized viewer WITHOUT `EnableContentPackManagement` sees, and what they must not
 * (#138 §7).
 *
 * Two profiles, because they fail in different ways if the gate is wrong: an ordinary viewer, and
 * an ADMINISTRATOR without the capability. The server publishes a dedicated capability precisely so
 * a deployment can grant pack management to someone who is not an administrator; substituting the
 * role in the Web would silently re-impose a policy the server does not have.
 *
 * Hiding a control is a courtesy, not a boundary — the server refuses an unauthorized write either
 * way — so this spec also proves the browse half still works, which is the thing a heavy-handed
 * gate would break.
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
import { ADMIN_WITHOUT_CAPABILITY, VIEWER_A, clone } from './support/profiles';

const MANAGEMENT_MARKERS = [
    'manager',
    'create',
    'manage-list',
    'rename',
    'delete',
    'move-up',
    'move-down',
    'detail-manager',
    'detail-rename',
    'detail-delete'
];

for (const [label, profile] of [
    ['an ordinary viewer', VIEWER_A],
    ['an administrator without the capability', ADMIN_WITHOUT_CAPABILITY]
] as const) {
    test.describe(label, () => {
        test('browses the list and a pack, with no management affordance anywhere', async ({
            page,
            baseURL
        }) => {
            const fixture = await installFixtureApi(
                page,
                baseURL as string,
                DIST,
                clone(profile)
            );

            await openList(page);
            await settled(page);

            // The browse half is untouched: same packs, same order, same server projections.
            expect(await cardTitles(page)).toEqual([
                'Weeknights',
                'Archive',
                'Nothing yet'
            ]);

            for (const marker of MANAGEMENT_MARKERS) {
                await expect(page.locator(sel(marker))).toHaveCount(0);
            }

            await openPack(page, 'pack-weeknights');
            await settled(page);
            await expect(page.locator(sel('pack-name'))).toHaveText(
                'Weeknights'
            );
            await expect(page.locator(sel('pack-count'))).toContainText('9');
            expect(await cardTitles(page)).toEqual([
                'Fixture Movie',
                'Fixture Episode',
                'Fixture Album',
                'Fixture Book'
            ]);

            for (const marker of MANAGEMENT_MARKERS) {
                await expect(page.locator(sel(marker))).toHaveCount(0);
            }

            // No management state is reachable, so no dialog exists to be opened by any means.
            await expect(page.locator('[role="dialog"]')).toHaveCount(0);
            expect(fixture.ledger.undeclared).toEqual([]);

            /*
             * And nothing was WRITTEN. An affordance that is merely hidden by CSS would still have
             * been able to fire; the ledger proves no write left the page at all.
             */
            expect(fixture.ledger.writes).toEqual([]);
        });

        test('the Item Details assignment affordance is absent too', async ({
            page,
            baseURL
        }) => {
            await installFixtureApi(
                page,
                baseURL as string,
                DIST,
                clone(profile)
            );

            await page.goto('/#/details?id=movie-1&serverId=server-1');
            await page.waitForSelector(
                '#itemDetailPage [data-detail-section="nameContainer"] h1',
                { timeout: 45_000 }
            );

            await expect(
                page.locator(
                    '#itemDetailPage [data-detail-action="btnContentPacks"]'
                )
            ).toHaveCount(0);
            // The ordinary actions are still there: only the M2 affordance is gated.
            await expect(
                page.locator('#itemDetailPage [data-detail-action="btnPlay"]')
            ).toBeVisible();
        });
    });
}

test.describe('fail-closed', () => {
    test('a non-manager who reaches the detail route directly still gets no controls', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(VIEWER_A)
        );

        // Straight to the deep link, with no list visit in between: the gate is not a side effect
        // of having rendered the mosaic first.
        await openPack(page, 'pack-archive');
        await settled(page);

        await expect(page.locator(sel('pack-name'))).toHaveText('Archive');
        await expect(page.locator(sel('detail-manager'))).toHaveCount(0);
        expect(fixture.ledger.writes).toEqual([]);
    });

    test('the capability, not the role, is what the client read', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(ADMIN_WITHOUT_CAPABILITY)
        );
        await openList(page);
        await settled(page);
        await expect(page.locator(sel('manager'))).toHaveCount(0);

        // Same account, same session, capability flipped: the controls appear. That is the only
        // difference between this navigation and the one above.
        fixture.profile.canManage = true;
        await page.reload();
        await page.waitForSelector(`${PAGE} ${sel('mosaic-heading')}`, {
            timeout: 45_000
        });
        await settled(page);
        await expect(page.locator(sel('manager'))).toHaveCount(1);
    });
});

/**
 * The same production bundle at a narrow mobile viewport (#138 §6).
 *
 * Runs in the `mobile` project (`devices['Pixel 7']`), which is also where the DRAWER lives:
 * `AppLayout.tsx` computes `isDrawerAvailable` as `isDrawerPath(...) && Boolean(user) &&
 * !isMediumScreen`, so a desktop viewport has no drawer at all and a "drawer destination is
 * reachable" assertion at 1440px would be asserting against something else.
 */
import {
    DIST,
    PAGE,
    cardTitles,
    expect,
    formDialog,
    openList,
    openPack,
    sel,
    settled,
    test
} from './support/harness';
import { installFixtureApi } from './support/fixtureApi';
import { MANAGER_A, clone } from './support/profiles';

/** WCAG 2.5.5 asks for 44x44; 40 is the smallest MUI/Material target and the honest floor here. */
const MIN_TARGET = 40;

test.describe('mobile', () => {
    test('reaches Content packs through the drawer', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await page.goto('/#/home');
        // The hamburger exists only where the drawer does, so finding it is itself the assertion
        // that this route is a drawer route.
        const menu = page.getByRole('button', { name: /menu/i }).first();
        await menu.waitFor({ state: 'visible', timeout: 45_000 });
        await menu.click();

        const destination = page.locator('a[href="#/contentpacks"]').first();
        await destination.waitFor({ state: 'visible', timeout: 45_000 });
        await destination.click();

        await page.waitForSelector(`${PAGE} ${sel('mosaic-heading')}`, {
            timeout: 45_000
        });
        await settled(page);
        expect(await cardTitles(page)).toEqual([
            'Weeknights',
            'Archive',
            'Nothing yet'
        ]);
        /*
         * Scoped to this slice on purpose. The journey starts on the legacy home screen, which
         * asks the fixture for endpoints that have nothing to do with content packs and that this
         * fixture has no reason to declare. What must be empty is the content-pack half.
         */
        expect(
            fixture.ledger.undeclared.filter((entry) =>
                entry.includes('ContentPacks')
            )
        ).toEqual([]);
    });

    test('nothing is clipped horizontally on either route', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        for (const open of [
            () => openList(page),
            () => openPack(page, 'pack-weeknights')
        ]) {
            await open();
            await settled(page);

            const overflow = await page.evaluate(() => {
                const doc = document.documentElement;
                return {
                    scrollWidth: doc.scrollWidth,
                    clientWidth: doc.clientWidth
                };
            });
            // One pixel of slack for sub-pixel layout rounding; anything more is a real overflow.
            expect(overflow.scrollWidth).toBeLessThanOrEqual(
                overflow.clientWidth + 1
            );

            // And every control is inside the viewport, not merely inside a scrollable page.
            const outside = await page.evaluate(() => {
                const width = document.documentElement.clientWidth;
                return [
                    ...document.querySelectorAll('[data-content-packs] button')
                ]
                    .map((node) => {
                        const box = node.getBoundingClientRect();
                        return box.right > width + 1 || box.left < -1
                            ? `${node.getAttribute('data-content-packs')} ${Math.round(box.left)}..${Math.round(box.right)}`
                            : null;
                    })
                    .filter(Boolean);
            });
            expect(outside).toEqual([]);
        }
    });

    test('every management control is a usable touch target', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );
        await openList(page);
        await settled(page);

        const small = await page.evaluate((minimum) => {
            return [...document.querySelectorAll('[data-content-packs] button')]
                .filter((node) => {
                    const box = node.getBoundingClientRect();
                    return box.width > 0 && box.height > 0;
                })
                .map((node) => {
                    const box = node.getBoundingClientRect();
                    return {
                        control: node.getAttribute('data-content-packs'),
                        width: Math.round(box.width),
                        height: Math.round(box.height)
                    };
                })
                .filter(
                    (entry) => entry.width < minimum || entry.height < minimum
                );
        }, MIN_TARGET);

        expect(small).toEqual([]);
    });

    test('the manager dialogs are operable at this width', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );
        await openPack(page, 'pack-weeknights');
        await settled(page);

        await page.locator(sel('detail-rename')).click();
        await expect(formDialog(page)).toHaveCount(1);

        // The dialog fits: no part of it is off-screen, so the submit button is reachable.
        const box = await formDialog(page).boundingBox();
        const viewport = page.viewportSize();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);

        await formDialog(page)
            .locator('input[name="contentPackName"]')
            .fill('Renamed on mobile');
        await formDialog(page).locator('button[type="submit"]').click();
        await expect(formDialog(page)).toHaveCount(0);
        await expect(page.locator(sel('pack-name'))).toHaveText(
            'Renamed on mobile'
        );
    });

    test('reduced motion is honoured without breaking the surface', async ({
        page,
        baseURL
    }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );
        await openList(page);
        await settled(page);

        // The page still renders everything; it simply does not animate into place.
        expect(await cardTitles(page)).toHaveLength(3);
        await expect(page.locator(sel('mosaic-heading'))).toBeVisible();

        const animated = await page.evaluate(() => {
            return [...document.querySelectorAll('#contentPacksPage *')]
                .map((node) => {
                    const style = getComputedStyle(node);
                    const duration = Number.parseFloat(
                        style.animationDuration || '0'
                    );
                    return duration > 0.05 ? style.animationName : null;
                })
                .filter(Boolean);
        });
        expect(animated).toEqual([]);
    });
});

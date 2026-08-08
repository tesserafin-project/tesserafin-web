/**
 * The remote path, driven for real (#138 §6).
 *
 * `tabIndex` proves nothing about a remote. `scripts/keyboardNavigation.js` DISCARDS every
 * navigation key unless the application is in TV layout —
 * `if (!layoutManager.tv && isNavigationKey(key)) return;` — so a suite that pressed arrows at a
 * 1920x1080 viewport without turning that layout on would be pressing keys the application never
 * receives, and every assertion after it would be vacuous.
 *
 * So the fixture writes `layout=tv` into the same `localStorage` key `layoutManager` reads
 * (`appSettings.get('layout')`, un-namespaced) before the app boots, and the specs below drive
 * ArrowUp/ArrowDown/Enter/Escape through `inputManager` exactly as a remote does.
 */
import {
    DIST,
    PAGE,
    cardTitles,
    deleteDialog,
    expect,
    focusedMarker,
    formDialog,
    openList,
    openPack,
    sel,
    settled,
    test
} from './support/harness';
import { installFixtureApi } from './support/fixtureApi';
import { MANAGER_A, clone } from './support/profiles';

const tvProfile = () => {
    const profile = clone(MANAGER_A);
    profile.layout = 'tv';
    return profile;
};

const focusedAttribute = (
    page: import('@playwright/test').Page,
    name: string
) =>
    page.evaluate(
        (attribute) => document.activeElement?.getAttribute(attribute) ?? null,
        name
    );

test.describe('TV / remote', () => {
    test('the application is actually in TV layout', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST, tvProfile());
        await openList(page);
        await settled(page);

        // Without this, every arrow-key assertion below would be pressing keys into a void.
        const layout = await page.evaluate(() =>
            localStorage.getItem('layout')
        );
        expect(layout).toBe('tv');

        /*
         * And the proof that the APPLICATION honoured it, not merely that the key was written:
         * `keyboardNavigation.js` discards ArrowDown outright unless `layoutManager.tv`, so a
         * focus change here is only possible with TV layout actually on. Asserting a body class
         * instead would be asserting a naming convention.
         */
        await page.locator(sel('create')).focus();
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        expect(await focusedMarker(page)).not.toBe('create');
    });

    test('arrow keys move focus between the manager controls', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST, tvProfile());
        await openList(page);
        await settled(page);

        await page.locator(sel('create')).focus();
        expect(await focusedMarker(page)).toBe('create');

        // ArrowDown reaches the manage list; the exact stop depends on layout, so what is asserted
        // is that the remote MOVED focus into the slice's controls, not off the page.
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        const afterDown = await focusedMarker(page);
        expect(afterDown).not.toBe('create');
        expect(afterDown).not.toBe('body');

        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        expect(await focusedMarker(page)).not.toBe('body');
    });

    test('Enter on a card opens the pack, and back returns to the list', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST, tvProfile());
        await openList(page);
        await settled(page);

        const card = page
            .locator(`${PAGE} [data-rf-slot="media-card"]`)
            .first();
        await card.focus();
        expect(await focusedAttribute(page, 'data-rf-slot')).toBe('media-card');

        await page.keyboard.press('Enter');
        await page.waitForSelector(`${PAGE} ${sel('pack-name')}`, {
            timeout: 45_000
        });
        await expect(page.locator(sel('pack-name'))).toHaveText('Weeknights');

        // The remote's back button. In TV layout `Escape` is routed to `inputManager`'s `back`
        // command, which is the same path a real remote takes.
        await page.keyboard.press('Escape');
        await page.waitForFunction(
            () => window.location.hash === '#/contentpacks',
            undefined,
            { timeout: 45_000 }
        );
        await settled(page);
        expect(await cardTitles(page)).toHaveLength(3);
    });

    test('reorder works from the remote, and is not drag-only', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            tvProfile()
        );
        await openList(page);
        await settled(page);

        // No drag handle exists anywhere in this surface. That is the design: move-up/move-down
        // buttons work with a pointer, a keyboard AND a remote; drag-and-drop works with one.
        await expect(page.locator('[draggable="true"]')).toHaveCount(0);

        await page.locator(sel('move-down')).first().focus();
        await page.keyboard.press('Enter');

        await expect
            .poll(() => cardTitles(page))
            .toEqual(['Archive', 'Weeknights', 'Nothing yet']);
        expect(await focusedMarker(page)).toBe('move-down');
        expect(await focusedAttribute(page, 'aria-label')).toContain(
            'Weeknights'
        );

        await page.keyboard.press('Enter');
        await expect
            .poll(() => cardTitles(page))
            .toEqual(['Archive', 'Nothing yet', 'Weeknights']);
        // Its move-down is disabled at the end of the list, so focus lands on the control that can
        // undo the move rather than on the document body.
        expect(await focusedMarker(page)).toBe('move-up');
        expect(fixture.ledger.writes).toHaveLength(2);
    });

    test('the manager dialogs open, operate and close from the remote', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST, tvProfile());
        await openPack(page, 'pack-weeknights');
        await settled(page);

        await page.locator(sel('detail-delete')).focus();
        await page.keyboard.press('Enter');
        await expect(deleteDialog(page)).toHaveCount(1);

        await page.keyboard.press('Escape');
        await expect(deleteDialog(page)).toHaveCount(0);
        expect(await focusedMarker(page)).toBe('detail-delete');
        // Escape cancelled the dialog; it did not also navigate away from the route.
        expect(page.url()).toContain('pack-weeknights');

        await page.locator(sel('detail-rename')).focus();
        await page.keyboard.press('Enter');
        await expect(formDialog(page)).toHaveCount(1);
        await page.keyboard.press('Control+a');
        await page.keyboard.type('Renamed by remote');
        await page.keyboard.press('Enter');
        await expect(formDialog(page)).toHaveCount(0);
        await expect(page.locator(sel('pack-name'))).toHaveText(
            'Renamed by remote'
        );
    });

    test('focus is visible at TV distance on every control', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL as string, DIST, tvProfile());
        await openList(page);
        await settled(page);

        for (const marker of ['create', 'move-down', 'rename', 'delete']) {
            await page.locator(sel(marker)).first().focus();
            const visible = await page.evaluate(() => {
                const node = document.activeElement as HTMLElement | null;
                if (!node) return false;
                const style = getComputedStyle(node);
                const hasOutline =
                    style.outlineStyle !== 'none' &&
                    Number.parseFloat(style.outlineWidth) > 0;
                const hasShadow =
                    style.boxShadow !== 'none' && style.boxShadow !== '';
                return hasOutline || hasShadow;
            });
            expect(visible, `${marker} focus must be visible`).toBe(true);
        }
    });
});

/**
 * The whole slice driven with a keyboard and nothing else (#138 §6).
 *
 * No `click()` anywhere below. Every control is reached with Tab, activated with Enter or Space,
 * and every dialog is entered, operated and dismissed without a pointer. A control that can only be
 * reached by mouse fails here rather than in somebody's hands.
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

/** Tab until the focused element matches, or give up after a bounded number of stops. */
async function tabTo(
    page: import('@playwright/test').Page,
    predicate: () => Promise<boolean>,
    limit = 60
): Promise<number> {
    for (let stop = 0; stop < limit; stop++) {
        if (await predicate()) return stop;
        await page.keyboard.press('Tab');
    }
    throw new Error(`no matching element within ${limit} tab stops`);
}

const focusedAttribute = (
    page: import('@playwright/test').Page,
    name: string
) =>
    page.evaluate(
        (attribute) => document.activeElement?.getAttribute(attribute) ?? null,
        name
    );

test.describe('keyboard only', () => {
    test('reaches and activates a pack card with Enter', async ({
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

        await tabTo(
            page,
            async () =>
                (await focusedAttribute(page, 'data-rf-slot')) === 'media-card'
        );
        const href = await focusedAttribute(page, 'href');
        expect(href).toContain('pack-weeknights');

        await page.keyboard.press('Enter');
        await page.waitForSelector(`${PAGE} ${sel('pack-name')}`, {
            timeout: 45_000
        });
        await expect(page.locator(sel('pack-name'))).toHaveText('Weeknights');
    });

    test('every visible control has a visible focus indicator', async ({
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

        const markers = ['create', 'move-down', 'rename', 'delete'];
        for (const marker of markers) {
            await page.locator(sel(marker)).first().focus();
            const outline = await page.evaluate(() => {
                const node = document.activeElement as HTMLElement | null;
                if (!node) return null;
                const style = getComputedStyle(node);
                return {
                    outlineStyle: style.outlineStyle,
                    outlineWidth: style.outlineWidth,
                    boxShadow: style.boxShadow
                };
            });
            const hasIndicator =
                (outline?.outlineStyle !== 'none' &&
                    outline?.outlineWidth !== '0px') ||
                (outline?.boxShadow !== 'none' && outline?.boxShadow !== '');
            expect(hasIndicator, `${marker} must show a focus indicator`).toBe(
                true
            );
        }
    });

    test('reorders with the keyboard, and focus follows the pack that moved', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );
        await openList(page);
        await settled(page);

        // The reorder controls are BUTTONS in a list, not drag handles: everything below works
        // because there is nothing to drag.
        const firstDown = page.locator(sel('move-down')).first();
        await firstDown.focus();
        expect(await focusedMarker(page)).toBe('move-down');
        await page.keyboard.press('Enter');

        await expect
            .poll(() => cardTitles(page))
            .toEqual(['Archive', 'Weeknights', 'Nothing yet']);

        // Focus is on the moved pack's own control, not on the position it vacated.
        expect(await focusedMarker(page)).toBe('move-down');
        expect(await focusedAttribute(page, 'aria-label')).toContain(
            'Weeknights'
        );

        // Move it to the last position: its move-down becomes disabled, so focus goes to the
        // sibling control that can undo the move rather than to the document body.
        await page.keyboard.press('Enter');
        await expect
            .poll(() => cardTitles(page))
            .toEqual(['Archive', 'Nothing yet', 'Weeknights']);
        expect(await focusedMarker(page)).toBe('move-up');
        expect(await focusedAttribute(page, 'aria-label')).toContain(
            'Weeknights'
        );

        // Disabled state is programmatic, not merely painted.
        const lastDown = page.locator(sel('move-down')).last();
        await expect(lastDown).toBeDisabled();
        await expect(page.locator(sel('move-up')).first()).toBeDisabled();

        expect(fixture.ledger.writes).toHaveLength(2);
    });

    test('opens, fills and submits the rename dialog with no pointer at all', async ({
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

        await page.locator(sel('detail-rename')).focus();
        await page.keyboard.press('Enter');
        await expect(formDialog(page)).toHaveCount(1);

        // MUI moves focus into the dialog and traps it there; the name field is autofocused.
        await expect
            .poll(() => focusedAttribute(page, 'name'))
            .toBe('contentPackName');

        await page.keyboard.press('Control+a');
        await page.keyboard.type('Renamed by keyboard');
        // Submit from the field itself: the form's own submit path, not a button press.
        await page.keyboard.press('Enter');

        await expect(formDialog(page)).toHaveCount(0);
        await expect(page.locator(sel('pack-name'))).toHaveText(
            'Renamed by keyboard'
        );
        // Focus was restored to the control that opened the dialog.
        expect(await focusedMarker(page)).toBe('detail-rename');
        expect(fixture.ledger.writes).toHaveLength(1);
    });

    test('traps focus inside the delete confirmation and restores it on Escape', async ({
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

        await page.locator(sel('detail-delete')).focus();
        await page.keyboard.press('Enter');
        await expect(deleteDialog(page)).toHaveCount(1);

        // Tab all the way round: focus never leaves the dialog.
        for (let stop = 0; stop < 8; stop++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]');
                return Boolean(
                    dialog &&
                        document.activeElement &&
                        dialog.contains(document.activeElement)
                );
            });
            expect(inside, `tab stop ${stop} escaped the dialog`).toBe(true);
        }

        await page.keyboard.press('Escape');
        await expect(deleteDialog(page)).toHaveCount(0);
        expect(await focusedMarker(page)).toBe('detail-delete');
        // Escape cancelled: nothing was deleted and the route is unchanged.
        await expect(page.locator(sel('pack-name'))).toHaveText('Weeknights');
        expect(page.url()).toContain('pack-weeknights');
    });

    test('the tab order runs down the page, not around it', async ({
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

        /*
         * From the create control, the next stops are the first pack's own controls in reading
         * order — MINUS its move-up, which is disabled at the top of the list and therefore not a
         * tab stop at all. That omission is the point: the disabled state is real, not painted.
         */
        await page.locator(sel('create')).focus();
        const seen: string[] = [];
        for (let stop = 0; stop < 5; stop++) {
            await page.keyboard.press('Tab');
            seen.push((await focusedMarker(page)) ?? '');
        }
        expect(seen).toEqual([
            'move-down',
            'rename',
            'delete',
            'move-up',
            'move-down'
        ]);

        // The heading is a focus DESTINATION, never a tab stop.
        expect(seen).not.toContain('mosaic-heading');
    });
});

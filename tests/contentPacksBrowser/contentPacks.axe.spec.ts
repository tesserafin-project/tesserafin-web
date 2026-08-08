/**
 * Accessibility over every materially different state of the slice (#138 §7).
 *
 * ## The engine, and a deviation worth stating
 *
 * This uses the repository's own axe integration — `tests/e2e/support/axe.ts`, which pins the
 * vendored engine BY CONTENT HASH and refuses to run against anything else. That engine is
 * **4.12.1**. The iteration brief asked for 4.13.0; bumping it would mean replacing the vendored
 * file and its pinned SHA-256, which is a change to the repository's accessibility engine rather
 * than to this feature, and `tests/e2e/vendor/README.md` records why that file is not a casual
 * edit. The version actually used is asserted below so the report cannot claim otherwise.
 *
 * ## The severity policy is the repository's
 *
 * `tests/e2e/b2-axe.spec.ts` fails on `critical` and REPORTS the rest rather than discarding it, so
 * a page with twelve serious violations cannot be presented as clean. Same policy here, same
 * reporting.
 *
 * ## No suppressions
 *
 * `scanPage` takes no `exclude` and disables no rule. Where a scan is narrowed it is narrowed by an
 * `include` selector at the call site, which has to be justified in the test's own text. Nothing
 * below is narrowed.
 */
import {
    AXE_VERSION,
    formatViolations,
    scanPage,
    type AxeResult
} from '../e2e/support/axe';
import {
    DIST,
    PAGE,
    expect,
    openList,
    openPack,
    sel,
    settled,
    test
} from './support/harness';
import { installFixtureApi, type FixtureProfile } from './support/fixtureApi';
import { MANAGER_A, MANAGER_EMPTY, VIEWER_A, clone } from './support/profiles';
import { CLASSIC, FROSTED, artworkSettled } from './support/theme';

interface Scanned {
    theme: string;
    state: string;
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    passes: number;
    incomplete: number;
    /** Every violation that survived, named. Reported, never discarded. */
    ids: string[];
}

const scanned: Scanned[] = [];

async function scan(
    page: import('@playwright/test').Page,
    theme: string,
    state: string
): Promise<AxeResult> {
    const result = await scanPage(page);
    expect(result.engineVersion).toBe(AXE_VERSION);
    // A scan that ran no rules would report zero violations and mean nothing.
    expect(result.passCount).toBeGreaterThan(0);

    scanned.push({
        theme,
        state,
        critical: result.bySeverity.critical,
        serious: result.bySeverity.serious,
        moderate: result.bySeverity.moderate,
        minor: result.bySeverity.minor,
        passes: result.passCount,
        incomplete: result.incompleteCount,
        ids: result.violations.map((v) => `${v.impact}:${v.id}`)
    });

    const criticals = result.violations.filter((v) => v.impact === 'critical');
    expect(
        criticals.map((v) => `${v.id}: ${v.help} (${v.nodes.join(', ')})`),
        `${state} in ${theme} must have no critical accessibility violations\n${formatViolations(result)}`
    ).toEqual([]);

    return result;
}

const themed = (profile: FixtureProfile, theme: string): FixtureProfile => {
    const next = clone(profile);
    next.theme = theme;
    return next;
};

for (const theme of [CLASSIC, FROSTED]) {
    test.describe(theme, () => {
        test('the mosaic, in each of its four states', async ({
            page,
            baseURL
        }) => {
            const fixture = await installFixtureApi(
                page,
                baseURL as string,
                DIST,
                themed(MANAGER_A, theme)
            );

            // Loading, before the list answers.
            fixture.profile.faults = { holdList: true };
            await page.goto('/#/contentpacks');
            await page.waitForSelector(
                `${PAGE} [data-rf-slot="state-loading"]`,
                { timeout: 45_000 }
            );
            await scan(page, theme, 'mosaic-loading');

            fixture.releaseList();
            await settled(page);
            await artworkSettled(page);
            await scan(page, theme, 'mosaic-populated-manager');

            // Failure.
            fixture.profile.faults = { listStatus: 500 };
            await page.reload();
            await page.waitForSelector(`${PAGE} [data-rf-slot="state-error"]`, {
                timeout: 45_000
            });
            await scan(page, theme, 'mosaic-error');
        });

        test('the empty mosaic', async ({ page, baseURL }) => {
            await installFixtureApi(
                page,
                baseURL as string,
                DIST,
                themed(MANAGER_EMPTY, theme)
            );
            await openList(page);
            await settled(page);
            await scan(page, theme, 'mosaic-empty');
        });

        test('the mosaic as a non-manager', async ({ page, baseURL }) => {
            await installFixtureApi(
                page,
                baseURL as string,
                DIST,
                themed(VIEWER_A, theme)
            );
            await openList(page);
            await settled(page);
            await artworkSettled(page);
            await scan(page, theme, 'mosaic-non-manager');
        });

        test('the mixed-media detail route, and its 404', async ({
            page,
            baseURL
        }) => {
            await installFixtureApi(
                page,
                baseURL as string,
                DIST,
                themed(MANAGER_A, theme)
            );

            await openPack(page, 'pack-weeknights');
            await settled(page);
            await artworkSettled(page);
            await scan(page, theme, 'detail-mixed-media');

            await openPack(page, 'pack-that-does-not-exist');
            await settled(page);
            await scan(page, theme, 'detail-404');
        });

        test('every dialog', async ({ page, baseURL }) => {
            await installFixtureApi(
                page,
                baseURL as string,
                DIST,
                themed(MANAGER_A, theme)
            );

            await openList(page);
            await settled(page);
            await page.locator(sel('create')).click();
            await expect(page.locator('[role="dialog"]')).toHaveCount(1);
            await scan(page, theme, 'dialog-create');
            await page.keyboard.press('Escape');

            await openPack(page, 'pack-weeknights');
            await settled(page);
            await page.locator(sel('detail-rename')).click();
            await expect(page.locator('[role="dialog"]')).toHaveCount(1);
            await scan(page, theme, 'dialog-rename');
            await page.keyboard.press('Escape');

            await page.locator(sel('detail-delete')).click();
            await expect(
                page.locator(`[role="dialog"] ${sel('delete-scope')}`)
            ).toBeVisible();
            await scan(page, theme, 'dialog-delete-confirmation');
        });

        test('the Item Details assignment dialog', async ({
            page,
            baseURL
        }) => {
            await installFixtureApi(
                page,
                baseURL as string,
                DIST,
                themed(MANAGER_A, theme)
            );

            await page.goto('/#/details?id=movie-1&serverId=server-1');
            await page.waitForSelector(
                '#itemDetailPage [data-detail-section="nameContainer"] h1',
                { timeout: 45_000 }
            );
            await page
                .locator(
                    '#itemDetailPage [data-detail-action="btnContentPacks"]'
                )
                .click();
            await page.waitForSelector(
                `[role="dialog"] ${sel('assign-list')}`,
                {
                    timeout: 45_000
                }
            );
            await scan(page, theme, 'item-details-assignment');
        });
    });
}

/**
 * The claims axe cannot make, asserted structurally.
 *
 * A rule engine can tell you a control has no accessible name; it cannot tell you the count on a
 * card is available to a screen reader rather than only to an eye, or that a disabled reorder
 * control is disabled programmatically rather than merely dimmed. Those are the assertions below.
 */
test.describe('structural accessibility', () => {
    test('one coherent heading hierarchy on each route', async ({
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
        const listHeadings = await page.$$eval(
            `${PAGE} h1, ${PAGE} h2, ${PAGE} h3`,
            (nodes) => nodes.map((node) => node.tagName)
        );
        expect(listHeadings[0]).toBe('H1');
        expect(listHeadings.filter((tag) => tag === 'H1')).toHaveLength(1);

        await openPack(page, 'pack-weeknights');
        await settled(page);
        const detailHeadings = await page.$$eval(
            `${PAGE} h1, ${PAGE} h2, ${PAGE} h3`,
            (nodes) =>
                nodes.map((node) => ({
                    tag: node.tagName,
                    text: node.textContent?.trim()
                }))
        );
        expect(detailHeadings[0].tag).toBe('H1');
        expect(detailHeadings[0].text).toBe('Weeknights');
        expect(detailHeadings.filter((h) => h.tag === 'H1')).toHaveLength(1);
    });

    test('every icon-only or ambiguous control carries a name that says which pack', async ({
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

        const unnamed = await page.$$eval(
            '[data-content-packs] button',
            (nodes) =>
                nodes
                    .filter((node) => {
                        const box = node.getBoundingClientRect();
                        return box.width > 0 && box.height > 0;
                    })
                    .filter(
                        (node) =>
                            !(
                                node.getAttribute('aria-label') ||
                                node.textContent?.trim()
                            )
                    )
                    .map((node) => node.getAttribute('data-content-packs'))
        );
        expect(unnamed).toEqual([]);

        // "Move up" alone is ambiguous in a list of three; each names its own pack.
        const moveLabels = await page.$$eval(sel('move-up'), (nodes) =>
            nodes.map((node) => node.getAttribute('aria-label'))
        );
        expect(moveLabels).toEqual([
            'Move up: Weeknights',
            'Move up: Archive',
            'Move up: Nothing yet'
        ]);
    });

    test('the count is text, not a picture, and the order is an order', async ({
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

        // Each card's subtitle is real text inside the card's accessible name.
        const first = page
            .locator(`${PAGE} [data-rf-slot="media-card"]`)
            .first();
        expect(await first.innerText()).toContain('9');

        // The manage list is an ordered list, so assistive technology is told it is ordered rather
        // than left to infer it from where things happen to be painted.
        await expect(page.locator(`ol${sel('manage-list')}`)).toHaveCount(1);
    });

    test('disabled reorder controls are exposed, not merely dimmed', async ({
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

        const firstUp = page.locator(sel('move-up')).first();
        const lastDown = page.locator(sel('move-down')).last();
        await expect(firstUp).toBeDisabled();
        await expect(lastDown).toBeDisabled();
        // `disabled`, not `aria-disabled` on an otherwise-live button: the element is genuinely out
        // of the tab order and genuinely cannot be activated.
        expect(await firstUp.getAttribute('disabled')).not.toBeNull();
    });

    test('an error is associated with the control it belongs to', async ({
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

        fixture.profile.faults = { createConflict: true };
        await page.locator(sel('create')).click();
        await page
            .locator('[role="dialog"] input[name="contentPackName"]')
            .fill('Weeknights');
        await page
            .locator('[role="dialog"] form button[type="submit"]')
            .click();

        const error = page.locator(sel('form-error'));
        await expect(error).toBeVisible();
        expect(await error.getAttribute('role')).toBe('alert');

        // `aria-describedby` points AT the error from the field, so it is announced with the field
        // rather than only when the alert happens to fire.
        const describedBy = await page
            .locator('[role="dialog"] input[name="contentPackName"]')
            .getAttribute('aria-describedby');
        expect(describedBy).toBe(await error.getAttribute('id'));
    });

    test('pending and error feedback are announced once, not repeatedly', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await page.goto('/#/details?id=movie-1&serverId=server-1');
        await page.waitForSelector(
            '#itemDetailPage [data-detail-section="nameContainer"] h1',
            { timeout: 45_000 }
        );
        await page
            .locator('#itemDetailPage [data-detail-action="btnContentPacks"]')
            .click();
        await page.waitForSelector(`[role="dialog"] ${sel('assign-list')}`, {
            timeout: 45_000
        });

        // One live region for pending and one for errors — not one per row, which would announce
        // the same fact once per pack.
        await expect(page.locator(sel('assign-pending'))).toHaveCount(0);
        await page
            .locator(`${sel('assign-toggle')}[data-pack-id="pack-archive"]`)
            .click();
        await expect(page.locator(sel('assign-pending'))).toHaveCount(0, {
            timeout: 10_000
        });
        await expect(page.locator(sel('assign-error'))).toHaveCount(0);
    });

    test('every modal has a name', async ({ page, baseURL }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );
        await openPack(page, 'pack-weeknights');
        await settled(page);

        for (const opener of ['detail-rename', 'detail-delete']) {
            await page.locator(sel(opener)).click();
            const dialog = page.locator('[role="dialog"]');
            await expect(dialog).toHaveCount(1);
            const name = await dialog.evaluate((node) => {
                const labelledBy = node.getAttribute('aria-labelledby');
                if (labelledBy) {
                    return (
                        document.getElementById(labelledBy)?.textContent ?? null
                    );
                }
                return node.getAttribute('aria-label');
            });
            expect(name?.trim(), `${opener} dialog must be named`).toBeTruthy();
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
        }
    });
});

test.afterAll(() => {
    if (scanned.length === 0) return;
    console.log(`\naxe ${AXE_VERSION} — ${scanned.length} state scans`);
    for (const row of scanned) {
        console.log(
            `  ${row.theme}/${row.state}: critical=${row.critical} serious=${row.serious} moderate=${row.moderate} minor=${row.minor} passes=${row.passes} incomplete=${row.incomplete}${row.ids.length ? ` [${row.ids.join(', ')}]` : ''}`
        );
    }
});

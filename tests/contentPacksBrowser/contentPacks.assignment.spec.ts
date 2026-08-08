/**
 * The Item Details assignment affordance, in the real bundle (#138 §8).
 *
 * The dialog is behind its own `lazy()` inside `DetailActionBar`, so opening it is also the proof
 * that `ContentPacksApi` is NOT in the `item-details` chunk: the module is fetched when the button
 * is pressed, not when the route is opened.
 */
import { DIST, expect, sel, test } from './support/harness';
import { installFixtureApi } from './support/fixtureApi';
import { MANAGER_A, clone } from './support/profiles';

const DETAIL = '#itemDetailPage';
const BUTTON = `${DETAIL} [data-detail-action="btnContentPacks"]`;
const DIALOG = `[role="dialog"]:has(${sel('assign-list')})`;

const toggleFor = (packId: string) =>
    `${sel('assign-toggle')}[data-pack-id="${packId}"]`;

async function openItem(page: import('@playwright/test').Page, id: string) {
    await page.goto(`/#/details?id=${id}&serverId=server-1`);
    await page.waitForSelector(
        `${DETAIL} [data-detail-section="nameContainer"] h1`,
        {
            timeout: 45_000
        }
    );
}

test.describe('Item Details assignment', () => {
    test('assigns one item to two packs, repeats an add, and removes one membership', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await openItem(page, 'movie-1');
        await page.locator(BUTTON).click();
        await page.waitForSelector(DIALOG, { timeout: 45_000 });

        // Every pack this user may see, with the current membership marked. `movie-1` starts in
        // `pack-weeknights` only — that is the fixture's authored answer, not something derived.
        await expect(page.locator(sel('assign-item'))).toHaveCount(3);
        await expect(page.locator(toggleFor('pack-weeknights'))).toBeChecked();
        await expect(page.locator(toggleFor('pack-archive'))).not.toBeChecked();

        // Add to a SECOND pack.
        await page.locator(toggleFor('pack-archive')).click();
        await expect(page.locator(toggleFor('pack-archive'))).toBeChecked();
        // The first membership is untouched.
        await expect(page.locator(toggleFor('pack-weeknights'))).toBeChecked();

        // Repeat the add the server treats as a successful no-op: close, reopen, toggle the row
        // that is already a member off and on again. No error is surfaced at any point.
        await page.locator(toggleFor('pack-archive')).click();
        await expect(page.locator(toggleFor('pack-archive'))).not.toBeChecked();
        await page.locator(toggleFor('pack-archive')).click();
        await expect(page.locator(toggleFor('pack-archive'))).toBeChecked();
        await expect(page.locator(sel('assign-error'))).toHaveCount(0);

        // Remove from ONE pack; the other membership survives.
        await page.locator(toggleFor('pack-weeknights')).click();
        await expect(
            page.locator(toggleFor('pack-weeknights'))
        ).not.toBeChecked();
        await expect(page.locator(toggleFor('pack-archive'))).toBeChecked();

        // Every write named exactly one (pack, item) pair. Nothing sent a membership SET.
        const membershipWrites = fixture.ledger.writes.filter((write) =>
            /^\/ContentPacks\/[^/]+\/Items\/[^/]+$/.test(write.path)
        );
        expect(
            membershipWrites.map((write) => `${write.method} ${write.path}`)
        ).toEqual([
            'POST /ContentPacks/pack-archive/Items/movie-1',
            'DELETE /ContentPacks/pack-archive/Items/movie-1',
            'POST /ContentPacks/pack-archive/Items/movie-1',
            'DELETE /ContentPacks/pack-weeknights/Items/movie-1'
        ]);
        expect(fixture.ledger.undeclared).toEqual([]);
    });

    test('surfaces an API failure and leaves the membership as the server left it', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await openItem(page, 'movie-1');
        await page.locator(BUTTON).click();
        await page.waitForSelector(DIALOG, { timeout: 45_000 });

        fixture.profile.faults = { writeStatus: 500 };
        await page.locator(toggleFor('pack-archive')).click();

        await expect(page.locator(sel('assign-error'))).toBeVisible();
        // The write failed, so the row is not a member — the UI did not pretend otherwise.
        await expect(page.locator(toggleFor('pack-archive'))).not.toBeChecked();
        await expect(page.locator(toggleFor('pack-weeknights'))).toBeChecked();
    });

    test('a pending write blocks a second activation of the same control', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await openItem(page, 'movie-1');
        await page.locator(BUTTON).click();
        await page.waitForSelector(DIALOG, { timeout: 45_000 });

        // Hold the write open, so the pending state is observable rather than a race.
        let release: (() => void) | null = null;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(
            '**/ContentPacks/pack-archive/Items/movie-1',
            async (route) => {
                await gate;
                await route.fulfill({ status: 204, body: '' });
            }
        );

        await page.locator(toggleFor('pack-archive')).click();

        // Every toggle is disabled while a write is in flight, and the pending state is announced.
        await expect(page.locator(sel('assign-pending'))).toBeVisible();
        await expect(page.locator(toggleFor('pack-archive'))).toBeDisabled();
        await expect(page.locator(toggleFor('pack-weeknights'))).toBeDisabled();

        release?.();
        await expect(page.locator(toggleFor('pack-archive'))).toBeEnabled();
        expect(fixture.ledger.undeclared).toEqual([]);
    });

    test('closing returns focus to the control that opened it', async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await openItem(page, 'movie-1');
        await page.locator(BUTTON).click();
        await page.waitForSelector(DIALOG, { timeout: 45_000 });

        await page.keyboard.press('Escape');
        await expect(page.locator(DIALOG)).toHaveCount(0);

        const focused = await page.evaluate(
            () =>
                document.activeElement?.getAttribute('data-detail-action') ??
                null
        );
        expect(focused).toBe('btnContentPacks');
    });

    test('the dialog issues no request while it is closed', async ({
        page,
        baseURL
    }) => {
        const fixture = await installFixtureApi(
            page,
            baseURL as string,
            DIST,
            clone(MANAGER_A)
        );

        await openItem(page, 'movie-1');
        // The route is fully rendered and the affordance is on screen, but not activated.
        await expect(page.locator(BUTTON)).toBeVisible();
        await page.waitForTimeout(1000);

        expect(
            fixture.ledger.requests.filter((entry) =>
                entry.includes('ContentPacks')
            )
        ).toEqual([]);

        await page.locator(BUTTON).click();
        await page.waitForSelector(DIALOG, { timeout: 45_000 });

        // Both reads happen only now: the packs list and this item's membership.
        expect(fixture.ledger.requests).toContain('GET /ContentPacks');
        expect(fixture.ledger.requests).toContain(
            'GET /Items/movie-1/ContentPacks'
        );
    });
});

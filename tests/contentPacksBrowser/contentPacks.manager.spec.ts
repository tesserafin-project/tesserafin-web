/**
 * The manager's whole journey through the Content packs slice, in a real browser, against the real
 * production bundle (#138 §5–§7).
 *
 * The unit suites prove each control in isolation with the mutations stubbed. This proves the
 * journey: drawer to mosaic to detail to a rename that keeps the URL to a delete that leaves it,
 * with every response coming from the transport fixture and nothing about authorization,
 * membership, counts, ordering or artwork decided by the client.
 */
import {
    DIST,
    PAGE,
    cardHrefs,
    cardSubtitles,
    cardTitles,
    deleteCancel,
    deleteConfirm,
    deleteDialog,
    expect,
    focusedMarker,
    formCancel,
    formDialog,
    formName,
    formSubmit,
    openList,
    openPack,
    sel,
    settled,
    test
} from './support/harness';
import { installFixtureApi } from './support/fixtureApi';
import { MANAGER_A, clone } from './support/profiles';

const install = (
    page: Parameters<typeof installFixtureApi>[0],
    baseURL: string
) => installFixtureApi(page, baseURL, DIST, clone(MANAGER_A));

test.describe('desktop manager', () => {
    /*
     * Drawer navigation lives in `contentPacks.mobile.spec.ts`, not here. `AppLayout.tsx` computes
     * `isDrawerAvailable` as `isDrawerPath(...) && Boolean(user) && !isMediumScreen`: on a desktop
     * viewport there IS no drawer, and a "drawer destination is reachable" assertion at 1440px
     * would either be vacuous or be asserting against something that is not the drawer.
     */

    test('shows representative artwork, and the placeholder where the server named none', async ({
        page,
        baseURL
    }) => {
        await install(page, baseURL as string);
        await openList(page);
        await settled(page);

        const cards = page.locator(`${PAGE} [data-rf-slot="media-card"]`);

        // Pack 1: the server named `movie-1`, so the card asked for THAT item's image and no other.
        const src = await cards
            .nth(0)
            .locator('img')
            .first()
            .getAttribute('src');
        expect(src).toContain('/Items/movie-1/Images');

        // Pack 2: `RepresentativeItemId` is null. The card shows its placeholder and asks for
        // nothing — in particular it does not fall back to the pack's first member.
        await expect(cards.nth(1).locator('img')).toHaveCount(0);
        expect(
            await cards.nth(1).evaluate((node) => node.innerHTML)
        ).not.toContain('movie-2');
    });

    test('creates a pack, and refuses a duplicate name with the server 409', async ({
        page,
        baseURL
    }) => {
        const fixture = await install(page, baseURL as string);
        await openList(page);
        await settled(page);

        // The duplicate-name failure first, so the successful create afterwards proves the dialog
        // recovered rather than that it was never in an error state.
        fixture.profile.faults = { createConflict: true };
        await page.locator(sel('create')).click();
        await formName(page).fill('Weeknights');
        await formSubmit(page).click();

        await expect(formDialog(page).locator(sel('form-error'))).toHaveText(
            'A content pack with that name already exists.'
        );
        // Still open, still holding what was typed: the write failed, nothing was created.
        await expect(formName(page)).toHaveValue('Weeknights');
        expect(await cardTitles(page)).toHaveLength(3);

        fixture.profile.faults = {};
        await formName(page).fill('Sunday mornings');
        await formSubmit(page).click();

        await expect(formDialog(page)).toHaveCount(0);
        await expect
            .poll(() => cardTitles(page))
            .toEqual([
                'Weeknights',
                'Archive',
                'Nothing yet',
                'Sunday mornings'
            ]);

        // The create sent the trimmed name and the description, and nothing else.
        // The LAST create, not the first: the rejected duplicate was recorded too, and a `find`
        // here would assert against the request that failed.
        const creates = fixture.ledger.writes.filter(
            (write) => write.path === '/ContentPacks' && write.method === 'POST'
        );
        expect(creates).toHaveLength(2);
        const create = creates[1];
        expect(create?.body).toEqual({
            Name: 'Sunday mornings',
            Description: null
        });
    });

    test('renames from the list without touching order, counts or artwork', async ({
        page,
        baseURL
    }) => {
        const fixture = await install(page, baseURL as string);
        await openList(page);
        await settled(page);

        const subtitlesBefore = await cardSubtitles(page);
        const hrefsBefore = await cardHrefs(page);

        await page
            .locator(`${sel('manage-item')} ${sel('rename')}`)
            .first()
            .click();
        await expect(formName(page)).toHaveValue('Weeknights');
        await formName(page).fill('Weeknight picks');
        await formSubmit(page).click();

        await expect(formDialog(page)).toHaveCount(0);
        await expect
            .poll(() => cardTitles(page))
            .toEqual(['Weeknight picks', 'Archive', 'Nothing yet']);

        // Identity, ordering and every server projection are unchanged: the rename moved one field.
        expect(await cardHrefs(page)).toEqual(hrefsBefore);
        expect(await cardSubtitles(page)).toEqual(subtitlesBefore);

        const update = fixture.ledger.writes.find((write) =>
            write.path.startsWith('/ContentPacks/pack-weeknights')
        );
        expect(update?.method).toBe('POST');
        expect(update?.body).toMatchObject({ Name: 'Weeknight picks' });
    });

    test('reorders through explicit controls, sending every id exactly once', async ({
        page,
        baseURL
    }) => {
        const fixture = await install(page, baseURL as string);
        await openList(page);
        await settled(page);

        // First pack's move-up is disabled; last pack's move-down is disabled.
        const up = page.locator(sel('move-up'));
        const down = page.locator(sel('move-down'));
        await expect(up.nth(0)).toBeDisabled();
        await expect(down.nth(2)).toBeDisabled();

        await down.nth(0).click();

        await expect
            .poll(() => cardTitles(page))
            .toEqual(['Archive', 'Weeknights', 'Nothing yet']);

        const reorder = fixture.ledger.writes.find(
            (write) => write.path === '/ContentPacks/Order'
        );
        const ids = Array.isArray(reorder?.body)
            ? (reorder?.body as string[])
            : ((reorder?.body as { PackIds?: string[] })?.PackIds ?? []);
        expect(ids).toEqual(['pack-archive', 'pack-weeknights', 'pack-empty']);
        expect(new Set(ids).size).toBe(3);

        // Focus follows the pack that moved, not the position it moved into.
        expect(await focusedMarker(page)).toBe('move-down');
        const focusedLabel = await page.evaluate(() =>
            document.activeElement?.getAttribute('aria-label')
        );
        expect(focusedLabel).toContain('Weeknights');
    });

    test('opens a mixed-media pack and resolves each family correctly', async ({
        page,
        baseURL
    }) => {
        await install(page, baseURL as string);
        await openList(page);
        await settled(page);

        await page
            .locator(`${PAGE} [data-rf-slot="media-card"]`)
            .first()
            .click();
        await page.waitForSelector(`${PAGE} ${sel('pack-name')}`, {
            timeout: 45_000
        });
        await settled(page);

        await expect(page.locator(sel('pack-name'))).toHaveText('Weeknights');
        // The count is the server's `VisibleItemCount` (9), NOT the four items on this page.
        await expect(page.locator(sel('pack-count'))).toContainText('9');

        expect(await cardTitles(page)).toEqual([
            'Fixture Movie',
            'Fixture Episode',
            'Fixture Album',
            'Fixture Book'
        ]);

        /*
         * ONE aspect for the whole grid, from `presentation.mediaCard.imageAspect`. Artwork and
         * destination still differ per family, through Home's `mediaCardProps` adapter — which is
         * the accepted boundary: no third media-family classifier was added to vary the aspect.
         */
        const aspects = await page.$$eval(
            `${PAGE} [data-rf-slot="media-card"]`,
            (nodes) =>
                nodes.map(
                    (node) =>
                        [...node.classList].find((name) =>
                            name.startsWith('rf-media-card--')
                        ) ?? ''
                )
        );
        expect(new Set(aspects).size).toBe(1);
        expect(aspects[0]).not.toBe('');

        const hrefs = await cardHrefs(page);
        // Every family resolves to a details destination carrying its own id.
        expect(hrefs[0]).toContain('movie-1');
        expect(hrefs[1]).toContain('episode-1');
        expect(hrefs[2]).toContain('album-1');
        expect(hrefs[3]).toContain('book-1');

        // The episode has no Primary tag of its own, so the adapter inherits the series artwork.
        const episodeImage = await page
            .locator(`${PAGE} [data-rf-slot="media-card"]`)
            .nth(1)
            .locator('img')
            .getAttribute('src');
        expect(episodeImage).toContain('/Items/series-1/Images');
    });

    test('renames from the detail route while the URL and the id stay put', async ({
        page,
        baseURL
    }) => {
        const fixture = await install(page, baseURL as string);
        await openPack(page, 'pack-weeknights');
        await settled(page);

        const urlBefore = page.url();
        const itemsBefore = await cardTitles(page);

        await page.locator(sel('detail-rename')).click();
        await expect(formName(page)).toHaveValue('Weeknights');
        await formName(page).fill('Weeknight picks');
        await formSubmit(page).click();

        await expect(formDialog(page)).toHaveCount(0);
        await expect(page.locator(sel('pack-name'))).toHaveText(
            'Weeknight picks'
        );

        expect(page.url()).toBe(urlBefore);
        expect(page.url()).toContain('pack-weeknights');
        // Membership and ordering are untouched: the same items, in the same order.
        expect(await cardTitles(page)).toEqual(itemsBefore);
        // The count came from the response, not from a local edit.
        await expect(page.locator(sel('pack-count'))).toContainText('9');

        const update = fixture.ledger.writes.filter((write) =>
            write.path.startsWith('/ContentPacks/pack-weeknights')
        );
        expect(update).toHaveLength(1);
        expect(update[0].body).toMatchObject({ Name: 'Weeknight picks' });

        // And the LIST now shows the new name, from the same response.
        await page.goto('/#/contentpacks');
        await settled(page);
        expect(await cardTitles(page)).toEqual([
            'Weeknight picks',
            'Archive',
            'Nothing yet'
        ]);
    });

    test('deletes from the detail route: full warning, safe return, no stale cache', async ({
        page,
        baseURL
    }) => {
        const fixture = await install(page, baseURL as string);
        await openPack(page, 'pack-weeknights');
        await settled(page);

        await page.locator(sel('detail-delete')).click();

        // The whole seven-part scope sentence, naming the pack.
        await expect(
            deleteDialog(page).locator(sel('delete-target'))
        ).toHaveText('Weeknights');
        const scope = await deleteDialog(page)
            .locator(sel('delete-scope'))
            .textContent();
        for (const clause of [
            'the pack',
            'membership links',
            'No media',
            'no file',
            'no metadata',
            'no collection',
            'no library'
        ]) {
            expect(scope?.toLowerCase()).toContain(clause.toLowerCase());
        }

        // A failed delete leaves the viewer where they were, with the truth on screen.
        fixture.profile.faults = { writeStatus: 500 };
        await deleteConfirm(page).click();
        await expect(
            deleteDialog(page).locator(sel('delete-error'))
        ).toBeVisible();
        expect(page.url()).toContain('pack-weeknights');
        await expect(page.locator(sel('pack-name'))).toHaveText('Weeknights');

        // The successful one leaves the route, once.
        fixture.profile.faults = {};
        await deleteConfirm(page).click();

        await page.waitForFunction(
            () => window.location.hash === '#/contentpacks',
            undefined,
            { timeout: 45_000 }
        );
        await settled(page);

        // Focus landed on a meaningful destination, and the page said what happened.
        expect(await focusedMarker(page)).toBe('mosaic-heading');
        await expect(page.locator(sel('deleted-notice'))).toContainText(
            'Weeknights'
        );

        expect(await cardTitles(page)).toEqual(['Archive', 'Nothing yet']);

        // Revisiting the deleted URL shows the server's answer, never the copy that was on screen.
        const requestsBefore = fixture.ledger.requests.length;
        await openPack(page, 'pack-weeknights');
        await settled(page);
        await expect(page.locator(sel('pack-name'))).toHaveCount(0);
        await expect(
            page.locator('[data-rf-slot="state-empty"]')
        ).toBeVisible();
        expect(
            fixture.ledger.requests
                .slice(requestsBefore)
                .some((entry) => entry === 'GET /ContentPacks/pack-weeknights')
        ).toBe(true);
    });

    test('the former members are still reachable and still playable', async ({
        page,
        baseURL
    }) => {
        const fixture = await install(page, baseURL as string);
        await openPack(page, 'pack-weeknights');
        await settled(page);

        await page.locator(sel('detail-delete')).click();
        await deleteConfirm(page).click();
        await page.waitForFunction(
            () => window.location.hash === '#/contentpacks',
            undefined,
            { timeout: 45_000 }
        );

        // The item route the pack used to link to still resolves, and still offers Play.
        await page.goto('/#/details?id=movie-1&serverId=server-1');
        await page.waitForSelector(
            '#itemDetailPage [data-detail-section="nameContainer"] h1',
            { timeout: 45_000 }
        );
        await expect(
            page.locator('#itemDetailPage [data-detail-action="btnPlay"]')
        ).toBeVisible();
        expect(fixture.ledger.undeclared).toEqual([]);
    });

    test('a dismissed dialog returns focus to the control that opened it', async ({
        page,
        baseURL
    }) => {
        await install(page, baseURL as string);
        await openPack(page, 'pack-weeknights');
        await settled(page);

        await page.locator(sel('detail-rename')).click();
        await formCancel(page).click();
        await expect(formDialog(page)).toHaveCount(0);
        expect(await focusedMarker(page)).toBe('detail-rename');

        await page.locator(sel('detail-delete')).click();
        await deleteCancel(page).click();
        await expect(deleteDialog(page)).toHaveCount(0);
        expect(await focusedMarker(page)).toBe('detail-delete');
    });
});

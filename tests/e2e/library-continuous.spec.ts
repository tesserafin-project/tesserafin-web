import { signIn } from './support/b2';
import { expect, test } from './support/origin-inventory';

/**
 * Continuous Browse against a REAL server, in a REAL browser: the proof the fixture suite cannot
 * give. Needs a Movies library larger than one page of 100; the stock `ci/serve-e2e.sh` library is
 * not, so the test skips there rather than passing on nothing. Seed copies of a fixture film first.
 */
const CARD = '.rf-library-continuous a[data-rf-slot="media-card"]';

test('a large real library scrolls without pages and Back returns to the opened film', async ({
    page
}) => {
    const items: { start: number; count: number }[] = [];
    page.on('response', async (response) => {
        const url = new URL(response.url());
        if (url.pathname.toLowerCase() !== '/items') return;
        if (!url.searchParams.get('includeItemTypes')) return;
        const body = await response.json().catch(() => undefined);
        items.push({
            start: Number(url.searchParams.get('startIndex') ?? 0),
            count: body?.TotalRecordCount ?? 0
        });
    });
    await signIn(page);
    const libraryId = await page.evaluate(async () => {
        const stored = JSON.parse(
            localStorage.getItem('jellyfin_credentials') ?? '{}'
        );
        const server = stored.Servers[0];
        const response = await fetch(`/Users/${server.UserId}/Views`, {
            headers: {
                Authorization: `MediaBrowser Token="${server.AccessToken}"`
            }
        });
        const views = await response.json();
        return views.Items.find(
            (view: { CollectionType?: string }) =>
                view.CollectionType === 'movies'
        ).Id as string;
    });
    await page.goto(
        `/#/library/${libraryId}?sort=ProductionYear&order=Descending`
    );
    await expect(page.locator(CARD).first()).toBeVisible();
    const total = await page
        .locator('.rf-library-continuous')
        .getAttribute('data-rf-total');
    test.skip(Number(total) <= 100, `only ${total} films on this server`);
    await expect(
        page.getByRole('navigation', { name: 'Pagination' })
    ).toHaveCount(0);

    await page.evaluate(() =>
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'instant'
        })
    );
    await expect.poll(() => items.some((item) => item.start >= 100)).toBe(true);
    await expect(page.locator(CARD).last()).toBeVisible();
    expect(await page.locator(CARD).count()).toBeLessThan(Number(total));

    // Back up to a film that lies past the first page's mounted rows.
    const opened = page.locator(CARD).last();
    await opened.scrollIntoViewIfNeeded();
    const href = await opened.getAttribute('href');
    const before = await opened.evaluate(
        (node) => node.getBoundingClientRect().top
    );
    await opened.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    await page.goBack();
    const card = page.locator(`${CARD}[href="${href}"]`);
    await expect(card).toBeFocused();
    await expect
        .poll(() =>
            card.evaluate(
                (node, top) => Math.abs(node.getBoundingClientRect().top - top),
                before
            )
        )
        .toBeLessThan(3);
});

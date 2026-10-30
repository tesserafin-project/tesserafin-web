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

/**
 * Each presentation against the same real server: every item of the result set, in the server's
 * order, once, while scrolling the production bundle. Needs the library seeded by
 * scripts/library-browse-real-server.py, which also checks that order against the rows themselves.
 */
const PRESENTATIONS = [
    {
        title: 'Films grid',
        collection: 'movies',
        kind: 'Movie',
        suffix: 'sort=ProductionYear&order=Descending'
    },
    {
        title: 'Films list',
        collection: 'movies',
        kind: 'Movie',
        suffix: 'sort=ProductionYear&order=Descending&view=list'
    },
    {
        title: 'Series grid',
        collection: 'tvshows',
        kind: 'Series',
        suffix: 'sort=ProductionYear&order=Descending'
    },
    {
        title: 'Episodes grid',
        collection: 'tvshows',
        kind: 'Episode',
        suffix: 'sort=ProductionYear&order=Descending&granularity=episodes'
    }
];

for (const { title, collection, kind, suffix } of PRESENTATIONS) {
    test(`${title}: the real server's sequence, once each, then Back to the opened item`, async ({
        page
    }) => {
        test.setTimeout(240_000);
        await signIn(page);
        const expected = await page.evaluate(
            async ({ collectionType, itemKind }) => {
                const stored = JSON.parse(
                    localStorage.getItem('jellyfin_credentials') ?? '{}'
                );
                const server = stored.Servers[0];
                const headers = {
                    Authorization: `MediaBrowser Token="${server.AccessToken}"`
                };
                const views = await (
                    await fetch(`/Users/${server.UserId}/Views`, { headers })
                ).json();
                const parentId = views.Items.find(
                    (view: { CollectionType?: string }) =>
                        view.CollectionType === collectionType
                ).Id as string;
                const ids: string[] = [];
                for (;;) {
                    const query = new URLSearchParams({
                        userId: server.UserId,
                        parentId,
                        recursive: 'true',
                        includeItemTypes: itemKind,
                        sortBy: 'ProductionYear,SortName,DateCreated',
                        sortOrder: 'Descending,Ascending,Ascending',
                        startIndex: String(ids.length),
                        limit: '100'
                    });
                    const answer = await (
                        await fetch(`/Items?${query}`, { headers })
                    ).json();
                    ids.push(
                        ...answer.Items.map((item: { Id: string }) => item.Id)
                    );
                    if (
                        !answer.Items.length ||
                        ids.length >= answer.TotalRecordCount
                    ) {
                        return { parentId, ids };
                    }
                }
            },
            { collectionType: collection, itemKind: kind }
        );
        test.skip(expected.ids.length <= 100, 'library not seeded');

        await page.goto(`/#/library/${expected.parentId}?${suffix}`);
        const root = page.locator('.rf-library-continuous');
        await expect(root).toHaveAttribute(
            'data-rf-total',
            String(expected.ids.length)
        );
        await expect(
            page.getByRole('navigation', { name: 'Pagination' })
        ).toHaveCount(0);

        // Reads the grid as a viewer would: scrolling, and only ever what is mounted.
        const seen: string[] = [];
        let peak = 0;
        const height = () => page.evaluate(() => document.body.scrollHeight);
        for (
            let y = 0, end = await height();
            y < end;
            y += 400, end = await height()
        ) {
            await page.evaluate(
                (top) => window.scrollTo({ top, behavior: 'instant' }),
                y
            );
            await page.waitForTimeout(90);
            const mounted = await page
                .locator(CARD)
                .evaluateAll((cards) =>
                    cards.map(
                        (card) =>
                            /[?&]id=([^&]+)/.exec(
                                card.getAttribute('href') ?? ''
                            )?.[1] ?? ''
                    )
                );
            peak = Math.max(peak, mounted.length);
            for (const id of mounted) {
                if (!seen.includes(id)) seen.push(id);
            }
        }
        await expect
            .poll(async () => {
                const mounted = await page.locator(CARD).count();
                return mounted > 0;
            })
            .toBe(true);
        expect(seen).toEqual(expected.ids);
        expect(peak).toBeLessThan(expected.ids.length);
        await expect(root).toHaveAttribute('data-rf-repeated-rows', '0');
        await expect(root).toHaveAttribute('data-rf-short-pages', '0');

        const opened = page.locator(CARD).last();
        const href = await opened.getAttribute('href');
        await opened.focus();
        await opened.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        const before = await opened.evaluate(
            (node) => node.getBoundingClientRect().top
        );
        await page.keyboard.press('Enter');
        await expect(page.locator('#itemDetailPage')).toBeVisible();
        await page.goBack();
        const card = page.locator(`${CARD}[href="${href}"]`);
        await expect(card).toBeFocused();
        await expect
            .poll(() =>
                card.evaluate(
                    (node, top) =>
                        Math.abs(node.getBoundingClientRect().top - top),
                    before
                )
            )
            .toBeLessThan(3);
    });
}

import { signIn } from './support/b2';
import type { Page } from '@playwright/test';
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

const SHELF_RECIPE = JSON.stringify({
    page: {
        library: { layout: 'shelf', cardAspect: 'poster', filters: 'inline' }
    }
});

/**
 * The shelf against the same real server, on the same library: the server's sequence across several
 * pages, read by moving the scroller, then a fiche opened at depth and Back.
 */
const SHELVES = [
    {
        title: 'Films',
        collection: 'movies',
        kind: 'Movie',
        suffix: 'sort=ProductionYear&order=Descending'
    },
    {
        title: 'Series',
        collection: 'tvshows',
        kind: 'Series',
        suffix: 'sort=ProductionYear&order=Descending'
    },
    {
        title: 'Episodes',
        collection: 'tvshows',
        kind: 'Episode',
        suffix: 'sort=ProductionYear&order=Descending&granularity=episodes'
    }
];

const expectedSequence = (
    page: Page,
    collectionType: string,
    itemKind: string
) =>
    page.evaluate(
        async ({ type, kind }) => {
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
                    view.CollectionType === type
            ).Id as string;
            const ids: string[] = [];
            for (;;) {
                const query = new URLSearchParams({
                    userId: server.UserId,
                    parentId,
                    recursive: 'true',
                    includeItemTypes: kind,
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
        { type: collectionType, kind: itemKind }
    );

for (const { title, collection, kind, suffix } of SHELVES) {
    test(`${title} shelf: the real server's sequence, once each, then Back to the opened item`, async ({
        page
    }) => {
        test.setTimeout(300_000);
        await page.addInitScript((recipe) => {
            localStorage.setItem(
                'tesserafin.themeStudio.appliedPresentation',
                recipe
            );
        }, SHELF_RECIPE);
        await signIn(page);
        const expected = await expectedSequence(page, collection, kind);
        test.skip(expected.ids.length <= 100, 'library not seeded');

        const pages = new Set<number>();
        page.on('response', (response) => {
            const url = new URL(response.url());
            if (
                url.pathname.toLowerCase() === '/items' &&
                url.searchParams.get('includeItemTypes') === kind
            ) {
                pages.add(Number(url.searchParams.get('startIndex') ?? 0));
            }
        });
        await page.goto(`/#/library/${expected.parentId}?${suffix}`);
        const root = page.locator('.rf-library-continuous--shelf');
        await expect(root).toHaveAttribute(
            'data-rf-total',
            String(expected.ids.length)
        );
        const scroller = root.locator('.rf-media-shelf__scroller');
        const cards = root.locator('a[data-rf-slot="media-card"]');
        await expect(cards.first()).toBeVisible();

        // Reads the shelf as a viewer would: moving along it, and only ever what is mounted.
        const seen = new Map<number, string>();
        const read = async () => {
            const facts = await root
                .getByRole('listitem')
                .evaluateAll((nodes) =>
                    nodes.map((node) => ({
                        at: Number(node.getAttribute('aria-posinset')),
                        of: Number(node.getAttribute('aria-setsize')),
                        href:
                            node
                                .querySelector('a[data-rf-slot="media-card"]')
                                ?.getAttribute('href') ?? ''
                    }))
                );
            for (const fact of facts) {
                expect(fact.of).toBe(expected.ids.length);
                if (fact.href) seen.set(fact.at - 1, fact.href);
            }
        };
        const mountedMax = { value: 0 };
        const length = await scroller.evaluate((node) => node.scrollWidth);
        const per = length / expected.ids.length;
        const width = await scroller.evaluate((node) => node.clientWidth);
        for (let left = 0; left < length; left += Math.max(per, width * 0.9)) {
            await scroller.evaluate(
                (node, to) => node.scrollTo({ left: to, behavior: 'instant' }),
                left
            );
            await page.waitForTimeout(120);
            await expect
                .poll(async () => {
                    await read();
                    const index = Math.floor(left / per);
                    return seen.has(Math.min(index, expected.ids.length - 1));
                })
                .toBe(true);
            mountedMax.value = Math.max(mountedMax.value, await cards.count());
        }
        // Every item, in the server's order, each once. The boundaries of 100 lie inside this.
        expect(seen.size).toBe(expected.ids.length);
        const sequence = [...seen.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, href]) => /[?&]id=([^&]+)/.exec(href)?.[1]);
        expect(sequence).toEqual(expected.ids);
        expect(new Set(sequence).size).toBe(expected.ids.length);
        expect(mountedMax.value).toBeLessThan(30);
        expect(pages.size).toBeGreaterThan(1);
        expect(await root.getAttribute('data-rf-repeated-rows')).toBe('0');
        expect(await root.getAttribute('data-rf-short-pages')).toBe('0');

        // A fiche from past the first page, then Back.
        const target = Math.floor(expected.ids.length * 0.6);
        await scroller.evaluate(
            (node, to) => node.scrollTo({ left: to - 41, behavior: 'instant' }),
            target * per
        );
        const opened = page.locator(
            `.rf-library-continuous--shelf a[href*="id=${expected.ids[target]}"]`
        );
        await expect(opened).toHaveCount(1);
        await opened.focus({ preventScroll: true });
        await page.waitForTimeout(150);
        const before = await opened.evaluate(
            (node) => node.getBoundingClientRect().left
        );
        await page.keyboard.press('Enter');
        await expect(page.locator('#itemDetailPage')).toBeVisible();
        await page.goBack();
        await expect(opened).toBeFocused();
        await expect
            .poll(() =>
                opened.evaluate(
                    (node, was) =>
                        Math.abs(node.getBoundingClientRect().left - was),
                    before
                )
            )
            .toBeLessThan(3);

        console.log(
            `[shelf ${title}] items=${expected.ids.length} pages=${pages.size} maxMounted=${mountedMax.value}`
        );
    });
}

test('real sign-out, real sign-in: the restricted account gets nothing of the first', async ({
    page
}) => {
    test.setTimeout(180_000);
    await page.addInitScript((recipe) => {
        localStorage.setItem(
            'tesserafin.themeStudio.appliedPresentation',
            recipe
        );
    }, SHELF_RECIPE);
    await signIn(page);
    const { parentId, ids } = await expectedSequence(page, 'movies', 'Movie');
    test.skip(ids.length <= 100, 'library not seeded');
    // Held back from the restricted user by the rig: homevideos ("Codec Probes").
    const withheld = await page.evaluate(async () => {
        const server = JSON.parse(
            localStorage.getItem('jellyfin_credentials') ?? '{}'
        ).Servers[0];
        const views = await (
            await fetch(`/Users/${server.UserId}/Views`, {
                headers: {
                    Authorization: `MediaBrowser Token="${server.AccessToken}"`
                }
            })
        ).json();
        return views.Items.find(
            (view: { CollectionType?: string }) =>
                view.CollectionType === 'homevideos'
        )?.Id as string;
    });
    expect(withheld).toBeTruthy();

    await page.goto(
        `/#/library/${parentId}?sort=ProductionYear&order=Descending`
    );
    const root = page.locator('.rf-library-continuous--shelf');
    const scroller = root.locator('.rf-media-shelf__scroller');
    await expect(
        root.locator('a[data-rf-slot="media-card"]').first()
    ).toBeVisible();
    await scroller.evaluate(
        (node, fraction) =>
            node.scrollTo({
                left: node.scrollWidth * fraction,
                behavior: 'instant'
            }),
        0.6
    );
    const opened = root.locator(
        `a[href*="id=${ids[Math.floor(ids.length * 0.6)]}"]`
    );
    await expect(opened).toHaveCount(1);
    await opened.focus({ preventScroll: true });
    await page.keyboard.press('Enter');
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    await page.goBack();
    await expect(opened).toBeFocused();

    // A real page of the first account in flight as it leaves.
    let inFlight = 0;
    await page.route(
        '**/Items?*',
        async (route) => {
            inFlight += 1;
            await new Promise((done) => setTimeout(done, 1_500));
            await route.continue().catch(() => undefined);
        },
        { times: 3 }
    );
    await scroller.evaluate((node) =>
        node.scrollTo({ left: node.scrollWidth * 0.95, behavior: 'instant' })
    );
    await expect.poll(() => inFlight).toBeGreaterThan(0);
    await page.getByRole('button', { name: /user menu/i }).click();
    await page.getByRole('menuitem', { name: 'Sign Out' }).click();

    await expect(page.locator('.manualLoginForm')).toBeVisible({
        timeout: 20_000
    });
    await page
        .locator('#txtManualName')
        .fill(process.env.TESSERAFIN_E2E_RESTRICTED_USER ?? 'smokerestricted');
    await page
        .locator('#txtManualPassword')
        .fill(
            process.env.TESSERAFIN_E2E_RESTRICTED_PASSWORD ??
                'restrictedpass123'
        );
    await page.locator('.manualLoginForm button[type="submit"]').click();
    await expect(page.locator('.manualLoginForm')).toBeHidden({
        timeout: 20_000
    });

    await page.evaluate((id) => {
        window.location.hash = `#/library/${id}`;
    }, parentId);
    const fresh = page.locator(
        '.rf-library-continuous--shelf a[data-rf-slot="media-card"]'
    );
    await expect(fresh.first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2_000);
    // Same library, from its start: no position, no focus, nothing restored.
    expect(
        await page
            .locator('.rf-media-shelf__scroller')
            .evaluate((node) => node.scrollLeft)
    ).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(fresh.first()).not.toBeFocused();
    await expect(page.getByText('no longer here')).toHaveCount(0);

    // The library the rig withholds: the server's own answer, and none of the first account's data.
    await page.evaluate((id) => {
        window.location.hash = `#/library/${id}`;
    }, withheld);
    await expect(fresh).toHaveCount(0, { timeout: 20_000 });
    expect(
        await page
            .locator('[role="listitem"] a[data-rf-slot="media-card"]')
            .count()
    ).toBe(0);
});

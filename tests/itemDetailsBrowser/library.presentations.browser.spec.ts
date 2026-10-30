/**
 * Continuous Browse beyond Films in a grid: Series, Episodes and the Films list, plus what moving
 * around a mounted grid can do. Real production bundle and real routes over a same-origin fixture:
 * this proves client behaviour, and nothing about the real server's order.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import {
    EPISODE,
    MOVIE,
    SERIES,
    SERVER_ID,
    USER_ID,
    installFixtureApi
} from './support/fixtureApi';

const DIST = resolve(__dirname, '../../dist');
const ROOT = '.rf-library-continuous';
const CARD = `${ROOT} a[data-rf-slot="media-card"]`;
const MOVIES = 'view-movies';
const SHOWS = 'view-shows';

const KINDS = {
    Movie: { total: 12_000, opened: MOVIE, openedAt: 5_207 },
    Series: { total: 3_000, opened: SERIES, openedAt: 1_307 },
    Episode: { total: 9_000, opened: EPISODE, openedAt: 4_207 }
} as const;
type Kind = keyof typeof KINDS;

const name = (kind: Kind, index: number) =>
    `${kind} ${String(index).padStart(5, '0')}`;

interface Fixture {
    requests: { kind: Kind; startIndex: number; limit: number }[];
    failStart?: number;
    forbidAll?: boolean;
    hold?: (query: URLSearchParams) => Promise<void> | undefined;
    /** The opened item left the library, or stopped being this viewer's: everything after moves up. */
    removed?: Kind;
    totals: Partial<Record<Kind, number>>;
}

const synthetic = (kind: Kind, index: number, fixture: Fixture) => {
    const { opened, openedAt } = KINDS[kind];
    const shifted =
        fixture.removed === kind && index >= openedAt ? index + 1 : index;
    return {
        ...opened,
        Id: shifted === openedAt ? opened.Id : `${kind}-${shifted}`,
        Name: name(kind, shifted),
        Type: kind,
        ProductionYear: 2000,
        ImageTags: {},
        BackdropImageTags: [],
        UserData: { ...MOVIE.UserData, PlaybackPositionTicks: 0 }
    };
};

async function install(
    page: Page,
    origin: string,
    theme = 'official.classic',
    layout = 'desktop'
) {
    await page.setViewportSize(
        layout === 'mobile'
            ? { width: 390, height: 844 }
            : { width: 1440, height: 900 }
    );
    const ledger = await installFixtureApi(page, origin, DIST);
    await page.addInitScript(
        ([user, chosenTheme, chosenLayout]) => {
            localStorage.setItem(`${user}-appTheme`, chosenTheme);
            localStorage.setItem('layout', chosenLayout);
        },
        [USER_ID, theme, layout]
    );
    const fixture: Fixture = { requests: [], totals: {} };
    const views = [
        { Id: MOVIES, Name: 'Movies', CollectionType: 'movies' },
        { Id: SHOWS, Name: 'Shows', CollectionType: 'tvshows' }
    ].map((view) => ({
        ...view,
        Type: 'CollectionFolder',
        ServerId: SERVER_ID
    }));
    await page
        .route('**/*', async (route) => {
            const url = new URL(route.request().url());
            const path = url.pathname.toLowerCase();
            const json = (body: unknown, status = 200) =>
                route.fulfill({
                    status,
                    contentType: 'application/json',
                    body: JSON.stringify(body)
                });
            const list = (Items: unknown[]) =>
                json({ Items, TotalRecordCount: Items.length, StartIndex: 0 });
            if (
                path === '/websocket/tickets' &&
                route.request().method() === 'POST'
            ) {
                ledger.requests.push('POST /WebSocket/Tickets');
                return json({ error: 'no transport in this fixture' }, 503);
            }
            if (route.request().method() !== 'GET') return route.fallback();
            if (path === '/userviews') return list(views);
            const view = views.find(
                (candidate) =>
                    path === `/items/${candidate.Id}` ||
                    path === `/users/${USER_ID}/items/${candidate.Id}`
            );
            if (view) return json(view);
            if (path === '/items/filters')
                return json({ Genres: ['Drama'], Years: [2000] });
            if (path === '/studios') return list([]);
            const parent = url.searchParams.get('parentId');
            if (path === '/items' && (parent === MOVIES || parent === SHOWS)) {
                const query = url.searchParams;
                const kind = (query.get('includeItemTypes') ?? 'Movie') as Kind;
                const startIndex = Number(query.get('startIndex') ?? 0);
                const limit = Number(query.get('limit') ?? 0);
                fixture.requests.push({ kind, startIndex, limit });
                await fixture.hold?.(query);
                if (fixture.forbidAll)
                    return json({ error: 'fixture refusal' }, 403);
                if (fixture.failStart === startIndex)
                    return json({ error: 'fixture failure' }, 500);
                const total = fixture.totals[kind] ?? KINDS[kind].total;
                const Items = [];
                for (
                    let i = startIndex;
                    i < Math.min(total, startIndex + limit);
                    i++
                ) {
                    Items.push(synthetic(kind, i, fixture));
                }
                return json({
                    Items,
                    TotalRecordCount: total,
                    StartIndex: startIndex
                });
            }
            return route.fallback();
        })
        .catch(() => undefined);
    return { fixture, ledger };
}

const scrollToIndex = (page: Page, index: number, total: number) =>
    page.evaluate(
        ([target, count]) => {
            const root = document.querySelector<HTMLElement>(
                '.rf-library-continuous'
            )!;
            const top = root.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({
                top: top + (target / count) * root.offsetHeight,
                behavior: 'instant'
            });
        },
        [index, total]
    );

const cardNamed = (page: Page, text: string) =>
    page.locator(CARD).filter({ hasText: text });

const firstVisibleName = (page: Page) =>
    page.locator(CARD).evaluateAll((cards) => {
        const card = cards.find((c) => c.getBoundingClientRect().bottom > 80);
        return card?.textContent ?? '';
    });

const indexOf = (text: string) => Number(/\d{5}/.exec(text)?.[0] ?? -1);

const measurements: unknown[] = [];
test.afterAll(() => {
    const out = resolve(__dirname, '../../test-results/library-browse');
    mkdirSync(out, { recursive: true });
    writeFileSync(
        resolve(out, 'presentations.json'),
        JSON.stringify(measurements, null, 2)
    );
});

const PRESENTATIONS: {
    title: string;
    kind: Kind;
    url: string;
    limitMounted: { desktop: number; mobile: number };
}[] = [
    {
        title: 'Series grid',
        kind: 'Series',
        url: `/#/library/${SHOWS}`,
        limitMounted: { desktop: 110, mobile: 40 }
    },
    {
        title: 'Episodes grid',
        kind: 'Episode',
        url: `/#/library/${SHOWS}?granularity=episodes`,
        limitMounted: { desktop: 110, mobile: 40 }
    },
    {
        title: 'Films list',
        kind: 'Movie',
        url: `/#/library/${MOVIES}?view=list`,
        limitMounted: { desktop: 40, mobile: 40 }
    }
];

for (const presentation of PRESENTATIONS) {
    const { kind, title, url, limitMounted } = presentation;
    const { total, opened, openedAt } = KINDS[kind];
    for (const theme of ['official.classic', 'official.glass']) {
        for (const layout of ['desktop', 'mobile'] as const) {
            test(`${title}, ${theme} ${layout}: deep, bounded, Tab at a boundary, Back to the item`, async ({
                page,
                baseURL
            }) => {
                const { fixture, ledger } = await install(
                    page,
                    baseURL!,
                    theme,
                    layout
                );
                await page.goto(url);
                await expect(page.locator('html')).toHaveAttribute(
                    'data-rf-theme',
                    theme
                );
                await expect(page.locator(CARD).first()).toContainText(
                    name(kind, 0)
                );
                await expect(
                    page.getByRole('navigation', { name: 'Pagination' })
                ).toHaveCount(0);

                for (const depth of [
                    0,
                    Math.floor(total / 3),
                    openedAt,
                    total - 1
                ]) {
                    await scrollToIndex(page, depth, total);
                    await page.waitForTimeout(300);
                    const hrefs = await page
                        .locator(CARD)
                        .evaluateAll((cards) =>
                            cards.map((c) => c.getAttribute('href'))
                        );
                    expect(new Set(hrefs).size).toBe(hrefs.length);
                    expect(hrefs.length).toBeGreaterThan(0);
                    expect(hrefs.length).toBeLessThan(limitMounted[layout]);
                    const root = page.locator(ROOT);
                    const cachedPages = Number(
                        await root.getAttribute('data-rf-cached-pages')
                    );
                    measurements.push({
                        title,
                        theme,
                        layout,
                        depth,
                        mountedCards: hrefs.length,
                        requestsSoFar: fixture.requests.length,
                        cachedPages,
                        domNodes: await page.evaluate(
                            () => document.querySelectorAll('*').length
                        )
                    });
                    await expect(root).toHaveAttribute(
                        'data-rf-repeated-rows',
                        '0'
                    );
                    await expect(root).toHaveAttribute(
                        'data-rf-short-pages',
                        '0'
                    );
                }
                expect(fixture.requests.length).toBeLessThan(30);
                expect(
                    fixture.requests.every(
                        (r) => r.kind === kind && r.startIndex < total
                    )
                ).toBe(true);
                expect(
                    await page.evaluate(
                        () =>
                            document.documentElement.scrollWidth <=
                            window.innerWidth
                    )
                ).toBe(true);

                // Tab across a page boundary.
                await scrollToIndex(page, 98, total);
                const before = cardNamed(page, name(kind, 99));
                await expect(before).toHaveCount(1);
                await before.focus();
                await page.keyboard.press('Tab');
                await expect(page.locator(':focus')).toContainText(
                    name(kind, 100)
                );

                // Into the item from the keyboard, and back to it.
                await scrollToIndex(page, openedAt, total);
                const card = page.locator(`${CARD}[href*="id=${opened.Id}&"]`);
                await expect(card).toHaveCount(1);
                await card.focus();
                await card.scrollIntoViewIfNeeded();
                await page.waitForTimeout(100);
                const top = await card.evaluate(
                    (node) => node.getBoundingClientRect().top
                );
                const place = page.url();
                await page.keyboard.press('Enter');
                await expect(page.locator('#itemDetailPage')).toBeVisible();
                await page.goBack();
                await expect(card).toBeFocused();
                expect(page.url()).toBe(place);
                await expect
                    .poll(() =>
                        card.evaluate(
                            (node, y) =>
                                Math.abs(node.getBoundingClientRect().top - y),
                            top
                        )
                    )
                    .toBeLessThan(3);
                expect(ledger.undeclared).toEqual([]);
                await page.screenshot({
                    path: resolve(
                        __dirname,
                        `../../test-results/library-browse/${kind}-${theme}-${layout}.png`
                    )
                });
            });
        }
    }

    test(`${title}: an error keeps the results and the retry works from the keyboard`, async ({
        page,
        baseURL
    }) => {
        const { fixture } = await install(page, baseURL!);
        await page.goto(url);
        await expect(page.locator(CARD).first()).toContainText(name(kind, 0));
        fixture.failStart = 100;
        await scrollToIndex(page, 96, total);
        const action = page.getByRole('button', {
            name: 'Load more',
            exact: true
        });
        await expect(action).toBeVisible({ timeout: 15_000 });
        await expect(cardNamed(page, name(kind, 99))).toHaveCount(1);
        await expect(page.locator(`${ROOT} [role="alert"]`)).toHaveCount(1);
        fixture.failStart = undefined;
        await action.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator(':focus')).toContainText(name(kind, 100));
        await expect(action).toHaveCount(0);
    });
}

test('?page=N reached while the grid is mounted moves the view, then leaves the URL', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(`/#/library/${MOVIES}`);
    await expect(page.locator(CARD).first()).toContainText(name('Movie', 0));
    await page.evaluate(() => {
        window.location.hash = `#/library/${'view-movies'}?page=40`;
    });
    await expect(cardNamed(page, name('Movie', 3_900))).toBeInViewport();
    await expect.poll(() => page.url()).not.toContain('page=');
    await expect(cardNamed(page, name('Movie', 3_900))).toBeInViewport();

    // The same page again, from elsewhere: a new request, not one already handled.
    await scrollToIndex(page, 0, KINDS.Movie.total);
    await expect(cardNamed(page, name('Movie', 0))).toBeInViewport();
    await page.evaluate(() => {
        window.location.hash = `#/library/${'view-movies'}?page=40`;
    });
    await expect(cardNamed(page, name('Movie', 3_900))).toBeInViewport();
    await expect.poll(() => page.url()).not.toContain('page=');

    // Past the end: the nearest item, and no loading loop.
    await page.evaluate(() => {
        window.location.hash = `#/library/${'view-movies'}?page=99999`;
    });
    await expect(
        cardNamed(page, name('Movie', KINDS.Movie.total - 1))
    ).toBeInViewport();
    await expect.poll(() => page.url()).not.toContain('page=');
});

test('switching list and grid at depth keeps the same item in view', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(`/#/library/${MOVIES}`);
    await expect(page.locator(CARD).first()).toContainText(name('Movie', 0));
    await scrollToIndex(page, 6_000, KINDS.Movie.total);
    await expect.poll(() => firstVisibleName(page)).toContain('Movie 0');
    await page.waitForTimeout(300);
    const before = indexOf(await firstVisibleName(page));
    // In place, as a remote or a shortcut would: a pointer would first have to scroll up to it.
    await page
        .getByRole('button', { name: 'View mode' })
        .evaluate((button: HTMLElement) => button.click());
    await expect.poll(() => page.url()).toContain('view=list');
    await page.waitForTimeout(300);
    const inList = indexOf(await firstVisibleName(page));
    expect(Math.abs(inList - before)).toBeLessThan(12);
});

test('resizing between desktop and mobile at depth keeps the same item in view', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(`/#/library/${MOVIES}`);
    await expect(page.locator(CARD).first()).toContainText(name('Movie', 0));
    await scrollToIndex(page, 6_000, KINDS.Movie.total);
    await page.waitForTimeout(300);
    const before = indexOf(await firstVisibleName(page));
    expect(before).toBeGreaterThan(5_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const narrow = indexOf(await firstVisibleName(page));
    expect(Math.abs(narrow - before)).toBeLessThan(12);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    const wide = indexOf(await firstVisibleName(page));
    expect(Math.abs(wide - before)).toBeLessThan(24);
});

test('a changed page size still returns to the opened item', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(`/#/library/${MOVIES}`);
    await expect(page.locator(CARD).first()).toContainText(name('Movie', 0));
    await scrollToIndex(page, KINDS.Movie.openedAt, KINDS.Movie.total);
    const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.locator('#itemDetailPage')).toBeVisible();

    await page.evaluate((user) => {
        localStorage.setItem(`${user}-libraryPageSize`, '37');
    }, USER_ID);
    fixture.requests.length = 0;
    await page.goBack();
    await expect(card).toBeFocused();
    await expect(page.locator(ROOT)).toHaveAttribute(
        'data-rf-short-pages',
        '0'
    );
});

test('a page size set before the visit is what every page asks for, at any boundary', async ({
    page,
    baseURL
}) => {
    await page.addInitScript((user) => {
        localStorage.setItem(`${user}-libraryPageSize`, '37');
    }, USER_ID);
    const { fixture } = await install(page, baseURL!);
    await page.goto(`/#/library/${MOVIES}`);
    await expect(page.locator(CARD).first()).toContainText(name('Movie', 0));
    await scrollToIndex(page, 370, KINDS.Movie.total);
    const after = cardNamed(page, name('Movie', 370));
    await expect(after).toHaveCount(1);
    expect(fixture.requests.every((r) => r.limit === 37)).toBe(true);
    expect(fixture.requests.every((r) => r.startIndex % 37 === 0)).toBe(true);
    await expect(page.locator(ROOT)).toHaveAttribute(
        'data-rf-repeated-rows',
        '0'
    );
});

test('switching Series to Episodes during a request drops the late answer', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(`/#/library/${SHOWS}`);
    await expect(page.locator(CARD).first()).toContainText(name('Series', 0));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHold) => {
        release = resolveHold;
    });
    fixture.hold = (query) =>
        query.get('includeItemTypes') === 'Series' ? held : undefined;
    await scrollToIndex(page, 1_500, KINDS.Series.total);
    await expect
        .poll(() => fixture.requests.some((r) => r.startIndex >= 1_000))
        .toBe(true);
    await page.getByLabel('Show', { exact: true }).selectOption('episodes');
    await expect(page.locator(CARD).first()).toContainText(name('Episode', 0));
    release();
    await page.waitForTimeout(300);
    await expect(page.locator(CARD).first()).toContainText(name('Episode', 0));
    await expect(page.locator(CARD).filter({ hasText: 'Series ' })).toHaveCount(
        0
    );
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(800);
});

test('the opened item removed while away: nearest item focused and announced, no loop', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(`/#/library/${MOVIES}`);
    await expect(page.locator(CARD).first()).toContainText(name('Movie', 0));
    await scrollToIndex(page, KINDS.Movie.openedAt, KINDS.Movie.total);
    const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    await page.clock.install();
    await page.clock.fastForward('10:00');
    fixture.removed = 'Movie';
    fixture.totals.Movie = KINDS.Movie.total - 1;
    fixture.requests.length = 0;
    await page.goBack();
    await expect(page.locator(':focus')).toContainText(
        name('Movie', KINDS.Movie.openedAt + 1)
    );
    await expect(page.getByRole('status')).toContainText('no longer here');
    await expect(card).toHaveCount(0);
    const settled = fixture.requests.length;
    expect(settled).toBeLessThan(6);
    await page.waitForTimeout(500);
    expect(fixture.requests.length).toBe(settled);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('status')).toBeEmpty();
});

test('the library gone from the viewer while away: refusal shown, no loop, no old context', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(`/#/library/${MOVIES}`);
    await expect(page.locator(CARD).first()).toContainText(name('Movie', 0));
    await scrollToIndex(page, KINDS.Movie.openedAt, KINDS.Movie.total);
    const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    await page.clock.install();
    await page.clock.fastForward('10:00');
    fixture.forbidAll = true;
    fixture.requests.length = 0;
    await page.goBack();
    await expect(page.locator(CARD)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(ROOT)).toHaveCount(0);
    await expect(page.getByText('no longer here')).toHaveCount(0);
    const settled = fixture.requests.length;
    await page.waitForTimeout(800);
    expect(fixture.requests.length).toBe(settled);
});

test('a target past a shrunken end settles on the last item, no loop', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(`/#/library/${MOVIES}`);
    await expect(page.locator(CARD).first()).toContainText(name('Movie', 0));
    await scrollToIndex(page, KINDS.Movie.openedAt, KINDS.Movie.total);
    const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    await page.clock.install();
    await page.clock.fastForward('10:00');
    fixture.totals.Movie = 500;
    fixture.requests.length = 0;
    await page.goBack();
    await expect(page.locator(':focus')).toContainText(name('Movie', 499));
    await expect(page.getByRole('status')).toContainText('no longer here');
    const settled = fixture.requests.length;
    await page.waitForTimeout(500);
    expect(fixture.requests.length).toBe(settled);
});

test('a long scroll leaves a bounded number of pages in the query cache', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(`/#/library/${MOVIES}`);
    await expect(page.locator(CARD).first()).toContainText(name('Movie', 0));
    let peak = 0;
    for (let index = 0; index < KINDS.Movie.total; index += 400) {
        await scrollToIndex(page, index, KINDS.Movie.total);
        await page.waitForTimeout(120);
        peak = Math.max(
            peak,
            Number(
                await page.locator(ROOT).getAttribute('data-rf-cached-pages')
            )
        );
    }
    measurements.push({ title: 'cache after 30 jumps', peakCachedPages: peak });
    // 12 idle pages, plus what the viewport observes, plus the first request's page.
    expect(peak).toBeLessThanOrEqual(20);
});

/**
 * Continuous Browse on the real production Library route and real Item Details route. The transport
 * is a same-origin fixture: it proves client behaviour against a server honouring StartIndex/Limit,
 * and says nothing about the real server's ordering (see docs/ux/library-browsing.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import {
    MOVIE,
    SERVER_ID,
    USER_ID,
    installFixtureApi
} from './support/fixtureApi';

const DIST = resolve(__dirname, '../../dist');
const VIEW = 'view-movies';
const BASE = `/#/library/${VIEW}`;
const CARD = '.rf-library-continuous a[data-rf-slot="media-card"]';
const TOTAL = 12_000;
/** Where the only item with a real detail fixture sits: deep inside the sixth default page. */
const OPENED_INDEX = 5_207;
const FILTERED_TOTAL = 300;

const name = (index: number) => `Film ${String(index).padStart(5, '0')}`;
const synthetic = (index: number, prefix = 'film') => ({
    ...MOVIE,
    Id:
        index === OPENED_INDEX && prefix === 'film'
            ? MOVIE.Id
            : `${prefix}-${index}`,
    Name: prefix === 'film' ? name(index) : `${prefix} ${index}`,
    ProductionYear: 2000,
    ImageTags: {},
    BackdropImageTags: [],
    UserData: { ...MOVIE.UserData, PlaybackPositionTicks: 0 }
});

interface Fixture {
    requests: { startIndex: number; limit: number; genre?: string }[];
    aborted: string[];
    failStart?: number;
    /** Answers this index with the previous item again: a tied row recurring across a boundary. */
    repeatAt?: number;
    hold?: (query: URLSearchParams) => Promise<void> | undefined;
}

async function install(
    page: Page,
    origin: string,
    theme: string,
    layout: string
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
    const fixture: Fixture = { requests: [], aborted: [] };
    page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname.toLowerCase() === '/items')
            fixture.aborted.push(request.url());
    });
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
            if (path === '/userviews')
                return list([
                    {
                        Id: VIEW,
                        Name: 'Movies',
                        CollectionType: 'movies',
                        Type: 'CollectionFolder',
                        ServerId: SERVER_ID
                    }
                ]);
            if (
                path === `/items/${VIEW}` ||
                path === `/users/${USER_ID}/items/${VIEW}`
            )
                return json({
                    Id: VIEW,
                    Name: 'Movies',
                    CollectionType: 'movies',
                    Type: 'CollectionFolder',
                    ServerId: SERVER_ID
                });
            if (path === '/items/filters')
                return json({ Genres: ['Drama'], Years: [2000] });
            if (path === '/studios') return list([]);
            if (
                path === '/items' &&
                url.searchParams.get('parentId') === VIEW
            ) {
                const query = url.searchParams;
                const startIndex = Number(query.get('startIndex') ?? 0);
                const limit = Number(query.get('limit') ?? 0);
                const genre = query.get('genres') ?? undefined;
                fixture.requests.push({ startIndex, limit, genre });
                await fixture.hold?.(query);
                if (fixture.failStart === startIndex)
                    return json({ error: 'fixture failure' }, 500);
                const random = query.get('sortBy')?.startsWith('Random');
                let prefix = random ? `draw${Math.random()}` : 'film';
                if (genre) prefix = 'drama';
                const total = genre ? FILTERED_TOTAL : TOTAL;
                const Items = [];
                for (
                    let i = startIndex;
                    i < Math.min(total, startIndex + limit);
                    i++
                ) {
                    Items.push(synthetic(i, prefix));
                }
                if (fixture.repeatAt !== undefined) {
                    const at = fixture.repeatAt - startIndex;
                    if (Items[at]) Items[at] = synthetic(fixture.repeatAt - 1);
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

const scrollToIndex = (page: Page, index: number) =>
    page.evaluate(
        ([target, total]) => {
            const root = document.querySelector<HTMLElement>(
                '.rf-library-continuous'
            )!;
            const top = root.getBoundingClientRect().top + window.scrollY;
            const fraction = target / total;
            window.scrollTo({
                top: top + fraction * root.offsetHeight,
                behavior: 'instant'
            });
        },
        [index, TOTAL]
    );

const visibleNames = (page: Page) =>
    page.locator(CARD).evaluateAll((cards) =>
        cards
            .filter((card) => {
                const box = card.getBoundingClientRect();
                return box.bottom > 0 && box.top < window.innerHeight;
            })
            .map((card) => card.textContent ?? '')
    );

const measurements: unknown[] = [];
test.afterAll(() => {
    const out = resolve(__dirname, '../../test-results/library-browse');
    mkdirSync(out, { recursive: true });
    writeFileSync(
        resolve(out, 'measurements.json'),
        JSON.stringify(measurements, null, 2)
    );
});

for (const theme of ['official.classic', 'official.glass']) {
    for (const layout of ['desktop', 'mobile']) {
        test(`${theme} ${layout}: browse deep, open a film, Back to the same film`, async ({
            page,
            baseURL
        }) => {
            const { fixture, ledger } = await install(
                page,
                baseURL!,
                theme,
                layout
            );
            await page.goto(`${BASE}?sort=ProductionYear&order=Descending`);
            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-theme',
                theme
            );
            await expect(page.locator(CARD).first()).toContainText(name(0));
            await expect(
                page.getByRole('navigation', { name: 'Pagination' })
            ).toHaveCount(0);

            const depths = [0, 2_000, OPENED_INDEX, TOTAL - 1];
            for (const depth of depths) {
                await scrollToIndex(page, depth);
                await expect
                    .poll(async () => (await visibleNames(page)).length)
                    .toBeGreaterThan(0);
                await page.waitForTimeout(250);
                const seen = await page.locator(CARD).count();
                const allNames = await page
                    .locator(CARD)
                    .evaluateAll((cards) =>
                        cards.map((c) => c.getAttribute('href'))
                    );
                expect(new Set(allNames).size).toBe(allNames.length);
                measurements.push({
                    theme,
                    layout,
                    depth,
                    mountedCards: seen,
                    requestsSoFar: fixture.requests.length,
                    domNodes: await page.evaluate(
                        () => document.querySelectorAll('*').length
                    )
                });
                // A viewport's worth of rows plus overscan, at any depth.
                expect(seen).toBeLessThan(layout === 'mobile' ? 40 : 110);
            }
            // The full download would be 120 requests of 100.
            expect(fixture.requests.length).toBeLessThan(20);
            const last = await page.locator(CARD).last().textContent();
            expect(last).toContain(name(TOTAL - 1));
            expect(
                fixture.requests.every(
                    (r) => r.startIndex < TOTAL && r.limit === 100
                )
            ).toBe(true);
            const geometry = await page.evaluate(() => ({
                width: window.innerWidth,
                document: document.documentElement.scrollWidth
            }));
            expect(geometry.document).toBeLessThanOrEqual(geometry.width);

            // Into the film at a known place, from the keyboard.
            await scrollToIndex(page, OPENED_INDEX);
            const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
            await expect(card).toHaveCount(1);
            await card.focus();
            await card.scrollIntoViewIfNeeded();
            await page.waitForTimeout(100);
            const before = await card.evaluate((node) => ({
                y: window.scrollY,
                top: node.getBoundingClientRect().top
            }));
            const url = page.url();
            await page.keyboard.press('Enter');
            await expect(page.locator('#itemDetailPage')).toBeVisible();
            await page.goBack();
            await expect(card).toBeFocused();
            expect(page.url()).toBe(url);
            await expect
                .poll(() =>
                    card.evaluate(
                        (node, top) =>
                            Math.abs(node.getBoundingClientRect().top - top),
                        before.top
                    )
                )
                .toBeLessThan(3);
            expect(
                await page.evaluate(
                    (y) => Math.abs(window.scrollY - y),
                    before.y
                )
            ).toBeLessThan(3);
            expect(ledger.undeclared).toEqual([]);
            await page.screenshot({
                path: resolve(
                    __dirname,
                    `../../test-results/library-browse/${theme}-${layout}-returned.png`
                )
            });
        });
    }
}

test('Back from a cold cache requests only the pages at that depth', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(
        page,
        baseURL!,
        'official.classic',
        'desktop'
    );
    await page.goto(BASE);
    await expect(page.locator(CARD).first()).toContainText(name(0));
    await scrollToIndex(page, OPENED_INDEX);
    const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    // Past the pages' lifetime in the cache, as after a long stay on the fiche.
    await page.clock.install();
    await page.clock.fastForward('10:00');
    fixture.requests.length = 0;
    await page.goBack();
    await expect(card).toBeFocused();
    expect(fixture.requests.length).toBeGreaterThan(0);
    expect(fixture.requests.length).toBeLessThan(5);
    expect(fixture.requests.every((r) => r.startIndex >= 4_000)).toBe(true);
});

test('Tab crosses a page boundary and stays on the focused film after scrolling away', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!, 'official.classic', 'desktop');
    await page.goto(BASE);
    await expect(page.locator(CARD).first()).toContainText(name(0));
    await scrollToIndex(page, 96);
    const boundary = page.locator(CARD).filter({ hasText: name(99) });
    await expect(boundary).toHaveCount(1);
    await boundary.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toContainText(name(100));

    // Scrolled far away: the focused film stays mounted, and only it plus the window are.
    await scrollToIndex(page, 8_000);
    await expect
        .poll(async () => (await visibleNames(page)).join())
        .toContain('Film 08');
    await expect(page.locator(':focus')).toContainText(name(100));
    expect(await page.locator(CARD).count()).toBeLessThan(120);

    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toContainText(name(101));
    const box = await page.locator(':focus').boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(900);
});

test('a filter changed during a request drops the late answer and starts from the top', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(
        page,
        baseURL!,
        'official.classic',
        'desktop'
    );
    await page.goto(BASE);
    await expect(page.locator(CARD).first()).toContainText(name(0));
    await scrollToIndex(page, 6_000);
    await expect
        .poll(async () => (await visibleNames(page)).join())
        .toContain('Film 0');

    // The unfiltered answer for a new depth is held back past the filtered one.
    let release!: () => void;
    const held = new Promise<void>((done) => {
        release = done;
    });
    fixture.hold = (query) => (query.get('genres') ? undefined : held);
    fixture.aborted.length = 0;
    await scrollToIndex(page, 9_000);
    await expect
        .poll(
            () => fixture.requests.filter((r) => r.startIndex >= 8_800).length
        )
        .toBeGreaterThan(0);
    await page.goto(`${BASE}?genre=Drama`);
    await expect(page.locator(CARD).first()).toContainText('drama 0');
    release();
    await page.waitForTimeout(300);
    await expect(page.locator(CARD).first()).toContainText('drama 0');
    const names = (await page.locator(CARD).allTextContents()).join();
    expect(names).not.toContain('Film');
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(400);
});

test('scrolling away aborts a page nobody is waiting for', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(
        page,
        baseURL!,
        'official.classic',
        'desktop'
    );
    await page.goto(BASE);
    await expect(page.locator(CARD).first()).toContainText(name(0));
    let release!: () => void;
    const held = new Promise<void>((done) => {
        release = done;
    });
    fixture.hold = (query) =>
        Number(query.get('startIndex')) === 5_000 ? held : undefined;
    await scrollToIndex(page, 5_050);
    await expect
        .poll(() => fixture.requests.some((r) => r.startIndex === 5_000))
        .toBe(true);
    await scrollToIndex(page, 0);
    await expect.poll(() => fixture.aborted.length).toBeGreaterThan(0);
    release();
    expect(fixture.aborted.join()).toContain('startIndex=5000');
});

test('a failed page keeps the results visible and its action retries', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(
        page,
        baseURL!,
        'official.glass',
        'desktop'
    );
    await page.goto(BASE);
    await expect(page.locator(CARD).first()).toContainText(name(0));
    fixture.failStart = 400;
    await scrollToIndex(page, 398);
    const action = page.getByRole('button', { name: 'Load more', exact: true });
    await expect(action).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(CARD).filter({ hasText: name(399) })).toHaveCount(
        1
    );
    const tried = fixture.requests.filter((r) => r.startIndex === 400).length;
    await page.waitForTimeout(500);
    // No retry loop once the query has given up.
    expect(fixture.requests.filter((r) => r.startIndex === 400)).toHaveLength(
        tried
    );
    fixture.failStart = undefined;
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(':focus')).toContainText(name(400));
    await expect(action).toHaveCount(0);
});

test('a row recurring across a page boundary is shown once and moves nothing after it', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(
        page,
        baseURL!,
        'official.classic',
        'desktop'
    );
    fixture.repeatAt = 100;
    await page.goto(BASE);
    await expect(page.locator(CARD).first()).toContainText(name(0));
    await scrollToIndex(page, 100);
    const next = page.locator(CARD).filter({ hasText: name(101) });
    await expect(next).toHaveCount(1);
    await expect(page.locator(CARD).filter({ hasText: name(99) })).toHaveCount(
        1
    );
    expect(
        await page
            .locator(CARD)
            .filter({ hasText: name(100) })
            .count()
    ).toBe(0);
});

test('old ?page= links open at that page and the URL forgets it', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!, 'official.classic', 'desktop');
    await page.goto(`${BASE}?page=5&density=compact`);
    await expect(
        page.locator(CARD).filter({ hasText: name(400) })
    ).toBeInViewport();
    await expect.poll(() => page.url()).not.toContain('page=');
    expect(page.url()).toContain('density=compact');

    // A hash-only goto would not reload; a shared link is a fresh page.
    await page.goto('about:blank');
    await page.goto(`${BASE}?page=9999`);
    await expect(
        page.locator(CARD).filter({ hasText: name(TOTAL - 1) })
    ).toBeInViewport();
    await expect.poll(() => page.url()).not.toContain('page=');
});

test('Random is not presented as a stable order', async ({ page, baseURL }) => {
    await install(page, baseURL!, 'official.classic', 'desktop');
    await page.goto(`${BASE}?sort=Random`);
    await expect(
        page.getByRole('navigation', { name: 'Pagination' })
    ).toBeVisible();
    await expect(page.locator('.rf-library-continuous')).toHaveCount(0);
    await expect(page.locator('.rf-library-view__order-note')).toContainText(
        'Random order'
    );
});

/**
 * The continuous shelf a `layout: 'shelf'` recipe composes on Browse: Films, Series and Episodes.
 * Real production bundle and real routes over a same-origin fixture: this proves client behaviour,
 * and nothing about the real server's order (see docs/ux/library-browsing.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { AXE_VERSION, formatViolations, scanPage } from '../e2e/support/axe';
import {
    EPISODE,
    MOVIE,
    SERIES,
    SERVER_ID,
    USER_ID,
    installFixtureApi
} from './support/fixtureApi';

const DIST = resolve(__dirname, '../../dist');
const ROOT = '.rf-library-continuous--shelf';
const SCROLLER = `${ROOT} .rf-media-shelf__scroller`;
const CARD = `${ROOT} a[data-rf-slot="media-card"]`;
const MOVIES = 'view-movies';
const SHOWS = 'view-shows';

const KINDS = {
    Movie: {
        total: 12_000,
        opened: MOVIE,
        openedAt: 5_207,
        url: `/#/library/${MOVIES}`
    },
    Series: {
        total: 12_000,
        opened: SERIES,
        openedAt: 1_307,
        url: `/#/library/${SHOWS}`
    },
    Episode: {
        total: 12_000,
        opened: EPISODE,
        openedAt: 4_207,
        url: `/#/library/${SHOWS}?granularity=episodes`
    }
} as const;
type Kind = keyof typeof KINDS;

const name = (kind: Kind, index: number) =>
    `${kind} ${String(index).padStart(5, '0')}`;

interface Fixture {
    requests: { kind: Kind; startIndex: number; limit: number }[];
    failStart?: number;
    forbidAll?: boolean;
    removed?: Kind;
}

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
            localStorage.setItem(
                'tesserafin.themeStudio.appliedPresentation',
                JSON.stringify({
                    page: {
                        library: {
                            layout: 'shelf',
                            cardAspect: 'poster',
                            filters: 'inline'
                        }
                    }
                })
            );
        },
        [USER_ID, theme, layout]
    );
    const fixture: Fixture = { requests: [] };
    const views = [
        { Id: MOVIES, Name: 'Movies', CollectionType: 'movies' },
        { Id: SHOWS, Name: 'Shows', CollectionType: 'tvshows' }
    ].map((view) => ({
        ...view,
        Type: 'CollectionFolder',
        ServerId: SERVER_ID
    }));
    await page.route('**/*', async (route) => {
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
            if (fixture.forbidAll)
                return json({ error: 'fixture refusal' }, 403);
            if (fixture.failStart === startIndex)
                return json({ error: 'fixture failure' }, 500);
            const { total, opened, openedAt } = KINDS[kind];
            const Items = [];
            for (
                let i = startIndex;
                i < Math.min(total, startIndex + limit);
                i++
            ) {
                const shifted =
                    fixture.removed === kind && i >= openedAt ? i + 1 : i;
                Items.push({
                    ...opened,
                    Id: shifted === openedAt ? opened.Id : `${kind}-${shifted}`,
                    Name: name(kind, shifted),
                    Type: kind,
                    ProductionYear: 2000,
                    ImageTags: {},
                    BackdropImageTags: [],
                    UserData: { ...MOVIE.UserData, PlaybackPositionTicks: 0 }
                });
            }
            return json({
                Items,
                TotalRecordCount: total,
                StartIndex: startIndex
            });
        }
        return route.fallback();
    });
    return { fixture, ledger };
}

const cardNamed = (page: Page, text: string) =>
    page.locator(CARD).filter({ hasText: text });

/** Moves the scroller so that this index sits at its left edge. */
const scrollToIndex = (page: Page, index: number, total: number) =>
    page.locator(SCROLLER).evaluate(
        (node, [target, count]) => {
            const pitch = (node.scrollWidth + geometryGap(node)) / count;
            node.scrollTo({ left: target * pitch, behavior: 'instant' });
            function geometryGap(element: Element) {
                return (
                    Number.parseFloat(getComputedStyle(element).columnGap) || 0
                );
            }
        },
        [index, total]
    );

const leftmost = (page: Page) =>
    page.locator(SCROLLER).evaluate((scroller) => {
        const edge = scroller.getBoundingClientRect().left;
        const card = [
            ...scroller.querySelectorAll('a[data-rf-slot="media-card"]')
        ].find((node) => node.getBoundingClientRect().right > edge + 1);
        return {
            text: card?.textContent ?? '',
            left: (card?.getBoundingClientRect().left ?? 0) - edge
        };
    });

const indexOf = (text: string) => Number(/\d{5}/.exec(text)?.[0] ?? -1);

const measurements: unknown[] = [];
test.afterAll(() => {
    const out = resolve(__dirname, '../../test-results/library-browse');
    mkdirSync(out, { recursive: true });
    writeFileSync(
        resolve(out, 'shelf.json'),
        JSON.stringify(measurements, null, 2)
    );
});

for (const kind of Object.keys(KINDS) as Kind[]) {
    const { total, opened, openedAt, url } = KINDS[kind];
    for (const theme of ['official.classic', 'official.glass']) {
        for (const layout of ['desktop', 'mobile']) {
            test(`${kind} ${theme} ${layout}: bounded at depth, and Back returns to the opened card`, async ({
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
                await expect(page.locator(CARD).first()).toContainText(
                    name(kind, 0)
                );
                await expect(
                    page.getByRole('navigation', { name: 'Pagination' })
                ).toHaveCount(0);

                // The virtual width stands for every card, exactly.
                const size = await page.locator(SCROLLER).evaluate((node) => {
                    const card = node.querySelector<HTMLElement>(
                        'a[data-rf-slot="media-card"]'
                    )!;
                    return {
                        scrollWidth: node.scrollWidth,
                        card: card.getBoundingClientRect().width,
                        gap:
                            Number.parseFloat(
                                getComputedStyle(node).columnGap
                            ) || 0
                    };
                });
                expect(size.card).toBeGreaterThan(0);
                expect(
                    Math.abs(
                        size.scrollWidth -
                            (total * (size.card + size.gap) - size.gap)
                    )
                ).toBeLessThan(2);

                for (const depth of [
                    0,
                    Math.floor(total / 6),
                    openedAt,
                    total - 1
                ]) {
                    await scrollToIndex(page, depth, total);
                    await expect
                        .poll(async () => {
                            const { text } = await leftmost(page);
                            return Math.abs(indexOf(text) - depth);
                        })
                        .toBeLessThan(layout === 'mobile' ? 3 : 7);
                    await page.waitForTimeout(150);
                    const mounted = await page.locator(CARD).count();
                    measurements.push({
                        kind,
                        theme,
                        layout,
                        depth,
                        mountedCards: mounted,
                        requestsSoFar: fixture.requests.length,
                        cachedPages: Number(
                            await page
                                .locator(ROOT)
                                .getAttribute('data-rf-cached-pages')
                        )
                    });
                    expect(mounted).toBeLessThan(layout === 'mobile' ? 14 : 24);
                    // Nothing outside the visible neighbourhood fetched pages it did not touch.
                    expect(fixture.requests.length).toBeLessThan(14);
                }
                expect(await page.locator(CARD).last().textContent()).toContain(
                    name(kind, total - 1)
                );
                expect(
                    await page.evaluate(
                        () =>
                            document.documentElement.scrollWidth <=
                            window.innerWidth
                    )
                ).toBe(true);

                // Open from the keyboard, at a depth and a horizontal offset that are not round.
                await scrollToIndex(page, openedAt, total);
                const card = page.locator(`${CARD}[href*="id=${opened.Id}&"]`);
                await expect(card).toHaveCount(1);
                await page
                    .locator(SCROLLER)
                    .evaluate((node) =>
                        node.scrollBy({ left: -37, behavior: 'instant' })
                    );
                await card.focus({ preventScroll: true });
                // Short enough that the page itself scrolls, or a vertical restore would prove nothing.
                await page.setViewportSize({
                    width: layout === 'mobile' ? 390 : 1440,
                    height: 500
                });
                await page.evaluate(() =>
                    window.scrollTo({ top: 40, behavior: 'instant' })
                );
                await page.waitForTimeout(100);
                const before = await card.evaluate((node) => {
                    const scroller = node.closest('.rf-media-shelf__scroller')!;
                    return {
                        scrollLeft: scroller.scrollLeft,
                        left: node.getBoundingClientRect().left,
                        y: window.scrollY
                    };
                });
                expect(before.y).toBeGreaterThan(0);
                const opener = page.url();
                await page.keyboard.press('Enter');
                await expect(page.locator('#itemDetailPage')).toBeVisible();
                await page.goBack();
                await expect(card).toBeFocused();
                expect(page.url()).toBe(opener);
                await expect
                    .poll(() =>
                        card.evaluate((node, was) => {
                            const scroller = node.closest(
                                '.rf-media-shelf__scroller'
                            )!;
                            return Math.max(
                                Math.abs(scroller.scrollLeft - was.scrollLeft),
                                Math.abs(
                                    node.getBoundingClientRect().left - was.left
                                ),
                                Math.abs(window.scrollY - was.y)
                            );
                        }, before)
                    )
                    .toBeLessThan(3);
                expect(ledger.undeclared).toEqual([]);
                await page.screenshot({
                    path: resolve(
                        __dirname,
                        `../../test-results/library-browse/shelf-${kind}-${theme}-${layout}.png`
                    )
                });
            });
        }
    }
}

test('Tab and Shift+Tab cross page boundaries without a trap', async ({
    page,
    baseURL
}) => {
    const { ledger } = await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    await scrollToIndex(page, 96, 12_000);
    const last = cardNamed(page, name('Movie', 99));
    await expect(last).toHaveCount(1);
    await last.focus();
    for (const index of [100, 101, 102]) {
        await page.keyboard.press('Tab');
        await expect(page.locator(':focus')).toContainText(
            name('Movie', index)
        );
    }
    for (const index of [101, 100, 99, 98]) {
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator(':focus')).toContainText(
            name('Movie', index)
        );
    }

    // After scrolling away, the next key brings the focused card back, then acts on its neighbour.
    await scrollToIndex(page, 6_000, 12_000);
    await page.waitForTimeout(200);
    // A modifier alone does nothing to focus, so it does not move the view either.
    await page.keyboard.press('Shift');
    await page.waitForTimeout(100);
    expect(indexOf((await leftmost(page)).text)).toBeGreaterThan(5_900);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toContainText(name('Movie', 99));

    // The keyboard can leave the shelf: focus reaches something outside the list.
    await scrollToIndex(page, 0, 12_000);
    const first = cardNamed(page, name('Movie', 0));
    await expect(first).toHaveCount(1);
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    expect(
        await page.evaluate(
            (scroller) => !document.activeElement?.closest(scroller),
            SCROLLER
        )
    ).toBe(true);
    expect(ledger.undeclared).toEqual([]);
});

test("arrow keys stay the browser's: the shelf scrolls and focus stays on its card", async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    const first = cardNamed(page, name('Movie', 0));
    await expect(first).toBeVisible();
    await first.focus();
    const before = await page
        .locator(SCROLLER)
        .evaluate((node) => node.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await expect
        .poll(() => page.locator(SCROLLER).evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(before);
    await expect(first).toBeFocused();
});

test('a failed page keeps the results, is announced once, and its retry works from the keyboard', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    fixture.failStart = 100;
    await scrollToIndex(page, 96, 12_000);
    const action = page.getByRole('button', {
        name: 'Load more',
        exact: true
    });
    await expect(action).toBeVisible({ timeout: 15_000 });
    await expect(cardNamed(page, name('Movie', 99))).toHaveCount(1);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText(/\S/);

    // Tab from the last card reaches the action; a scroll deep into the failed page keeps one too.
    await cardNamed(page, name('Movie', 99)).focus();
    await page.keyboard.press('Tab');
    await expect(action).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator(':focus')).toContainText(name('Movie', 99));
    await scrollToIndex(page, 150, 12_000);
    await expect(action.first()).toBeVisible({ timeout: 15_000 });

    fixture.failStart = undefined;
    await action.first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(':focus')).toContainText(/Movie 001\d\d/);
    await expect(page.getByRole('status')).toHaveText('');
});

test('the opened item gone: the item now in its place takes the focus, and the message says so', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    await scrollToIndex(page, 5_207, 12_000);
    const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
    await expect(card).toHaveCount(1);
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    await page.clock.install();
    await page.clock.fastForward('10:00');
    fixture.removed = 'Movie';
    await page.goBack();
    await expect(page.locator(':focus')).toContainText(name('Movie', 5_208));
    await expect(page.getByRole('status')).toContainText(/\S/);
});

test('refused on return: the refusal replaces everything and the return ends', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    await scrollToIndex(page, 5_207, 12_000);
    const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
    await expect(card).toHaveCount(1);
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    await page.clock.install();
    await page.clock.fastForward('10:00');
    fixture.forbidAll = true;
    await page.goBack();
    await expect(page.getByText('Access denied')).toBeVisible({
        timeout: 15_000
    });
    await expect(page.locator(CARD)).toHaveCount(0);
});

test('a resize and a density change keep the same card in view', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    await scrollToIndex(page, 5_000, 12_000);
    await expect
        .poll(async () => indexOf((await leftmost(page)).text))
        .toBe(5_000);

    await page.setViewportSize({ width: 800, height: 700 });
    await expect
        .poll(async () => indexOf((await leftmost(page)).text))
        .toBe(5_000);

    const wide = await page
        .locator(CARD)
        .first()
        .evaluate((n) => n.offsetWidth);
    await page
        .getByRole('button', { name: /compact|comfortable|density/i })
        .first()
        .click();
    await expect
        .poll(() =>
            page
                .locator(CARD)
                .first()
                .evaluate((n) => n.offsetWidth)
        )
        .not.toBe(wide);
    await expect
        .poll(async () => indexOf((await leftmost(page)).text))
        .toBe(5_000);
    const gap = await page.locator(SCROLLER).evaluate((node) => {
        const card = node.querySelector<HTMLElement>(
            'a[data-rf-slot="media-card"]'
        )!;
        const pitch =
            card.offsetWidth +
            (Number.parseFloat(getComputedStyle(node).columnGap) || 0);
        return Math.abs(
            node.scrollWidth - (12_000 * pitch - (pitch - card.offsetWidth))
        );
    });
    expect(gap).toBeLessThan(2);
});

test('a resize keeps focus on its card, and a new filter starts the shelf at its beginning', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    await scrollToIndex(page, 4_000, 12_000);
    const card = cardNamed(page, name('Movie', 4_001));
    await expect(card).toHaveCount(1);
    await card.focus();
    await page.setViewportSize({ width: 620, height: 800 });
    await page.waitForTimeout(200);
    await expect(card).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(card).toBeFocused();

    await page.getByRole('button', { name: 'Favorites' }).click();
    await expect(page.locator(SCROLLER)).toHaveJSProperty('scrollLeft', 0);
});

test('a Series library whose stored view is the list still gets the continuous shelf', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(`${KINDS.Series.url}?view=list`);
    await expect(page.locator(CARD).first()).toContainText(name('Series', 0));
    await expect(
        page.getByRole('navigation', { name: 'Pagination' })
    ).toHaveCount(0);
});

test('right to left: same card, same offset, on a scroller that runs negative', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    await page.addStyleTag({
        content: '.rf-library-view__results { direction: rtl; }'
    });
    await page.locator(SCROLLER).evaluate((node) => {
        node.scrollTo({
            left: -(node.scrollWidth * 5_207) / 12_000,
            behavior: 'instant'
        });
    });
    const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
    await expect(card).toHaveCount(1);
    await card.focus();
    await page.waitForTimeout(100);
    const before = await card.evaluate(
        (node) => node.getBoundingClientRect().left
    );
    expect(
        await page.locator(SCROLLER).evaluate((node) => node.scrollLeft)
    ).toBeLessThan(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    await page.goBack();
    await expect(card).toBeFocused();
    await expect
        .poll(() =>
            card.evaluate(
                (node, was) =>
                    Math.abs(node.getBoundingClientRect().left - was),
                before
            )
        )
        .toBeLessThan(3);
});

test("an old ?page=N link opens at that page's first card, then leaves the URL", async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(`${KINDS.Movie.url}?page=4`);
    await expect
        .poll(async () => indexOf((await leftmost(page)).text))
        .toBe(300);
    await expect.poll(() => page.url()).not.toContain('page=');
    expect(fixture.requests.every((r) => r.startIndex >= 100)).toBe(true);
});

test('Random stays paged under a shelf', async ({ page, baseURL }) => {
    await install(page, baseURL!);
    await page.goto(`${KINDS.Movie.url}?sort=Random`);
    await expect(
        page.getByRole('navigation', { name: 'Pagination' })
    ).toBeVisible();
    await expect(page.locator(ROOT)).toHaveCount(0);
    await expect(page.locator('[data-rf-slot="media-shelf"]')).toHaveCount(1);
});

test('the shelf is a list that states each position and the total, and its spacers are not in the tree', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    await scrollToIndex(page, 5_000, 12_000);
    await expect
        .poll(async () => indexOf((await leftmost(page)).text))
        .toBe(5_000);

    const list = page.getByRole('list', { name: 'Movies' });
    await expect(list).toHaveCount(1);
    const items = list.getByRole('listitem');
    const facts = await items.evaluateAll((nodes) =>
        nodes.map((node) => ({
            at: Number(node.getAttribute('aria-posinset')),
            of: Number(node.getAttribute('aria-setsize')),
            text: node.textContent ?? ''
        }))
    );
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
        expect(fact.of).toBe(12_000);
        expect(fact.text).toContain(name('Movie', fact.at - 1));
    }
    expect(
        await page
            .locator(`${SCROLLER} > :not([role="listitem"])`)
            .evaluateAll((nodes) =>
                nodes.every(
                    (node) => node.getAttribute('aria-hidden') === 'true'
                )
            )
    ).toBe(true);

    const result = await scanPage(page, [ROOT]);
    expect(
        result.violations.filter(
            (v) => v.impact === 'critical' || v.impact === 'serious'
        ),
        formatViolations(result)
    ).toEqual([]);
    measurements.push({
        axe: AXE_VERSION,
        scope: ROOT,
        passes: result.passCount,
        incomplete: result.incompleteCount,
        bySeverity: result.bySeverity
    });
});

test.describe('touch, emulated', () => {
    test.use({ hasTouch: true, isMobile: true });

    /** Raw touch points: `Input.synthesizeScrollGesture` moved not even a plain scroller here. */
    const swipe = async (page: Page, by: number) => {
        const session = await page.context().newCDPSession(page);
        const box = (await page.locator(SCROLLER).boundingBox())!;
        const y = box.y + box.height / 2;
        const from = box.x + box.width - 20;
        const point = (x: number) => ({ touchPoints: [{ x, y }] });
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            ...point(from)
        });
        for (let moved = 15; moved <= by; moved += 15) {
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                ...point(from - moved)
            });
            await page.waitForTimeout(16);
        }
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: []
        });
        await session.detach();
    };

    test('a swipe moves the shelf, mounts its neighbours and leaves the card where the finger did', async ({
        page,
        baseURL
    }) => {
        const { fixture } = await install(
            page,
            baseURL!,
            'official.glass',
            'mobile'
        );
        await page.goto(KINDS.Movie.url);
        await expect(page.locator(CARD).first()).toBeVisible();
        const position = () =>
            page.locator(SCROLLER).evaluate((node) => node.scrollLeft);

        // Past a page boundary, by repeated swipes, as a thumb does.
        await scrollToIndex(page, 95, 12_000);
        for (let swipes = 0; swipes < 5; swipes++) await swipe(page, 300);
        await expect.poll(position).toBeGreaterThan(26_500);
        await expect
            .poll(() => fixture.requests.some((r) => r.startIndex >= 100))
            .toBe(true);
        await expect
            .poll(async () => indexOf((await leftmost(page)).text))
            .toBeGreaterThan(95);
        expect(await page.locator(CARD).count()).toBeLessThan(14);

        // Without snapping, it stays exactly where the gesture ended.
        // The fling decays first; then nothing pulls it onto a card's edge.
        let rest = -1;
        await expect
            .poll(async () => {
                const was = rest;
                rest = await position();
                return rest === was;
            })
            .toBe(true);
        await page.waitForTimeout(600);
        expect(await position()).toBe(rest);
        const { left } = await leftmost(page);
        measurements.push({ touch: 'emulated', restingCardOffsetPx: left });

        // A tap opens the card, and Back returns to it and that offset.
        const card = page.locator(CARD).filter({ hasText: /Movie/ }).nth(3);
        const href = await card.getAttribute('href');
        await page.locator(`${CARD}[href="${href}"]`).scrollIntoViewIfNeeded();
        const settled = await position();
        await page.locator(`${CARD}[href="${href}"]`).tap();
        await expect(page.locator('#itemDetailPage')).toBeVisible();
        await page.goBack();
        const returned = page.locator(`${CARD}[href="${href}"]`);
        await expect(returned).toHaveCount(1);
        await expect
            .poll(async () => Math.abs((await position()) - settled))
            .toBeLessThan(3);
    });

    test('a swipe during a return hands the shelf back to the finger', async ({
        page,
        baseURL
    }) => {
        await install(page, baseURL!, 'official.classic', 'mobile');
        await page.goto(KINDS.Movie.url);
        await expect(page.locator(CARD).first()).toBeVisible();
        await scrollToIndex(page, 5_207, 12_000);
        const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
        await expect(card).toHaveCount(1);
        await card.tap();
        await expect(page.locator('#itemDetailPage')).toBeVisible();
        await page.goBack();
        await expect(card).toHaveCount(1);
        const before = await page
            .locator(SCROLLER)
            .evaluate((n) => n.scrollLeft);
        await swipe(page, 300);
        await expect
            .poll(() => page.locator(SCROLLER).evaluate((n) => n.scrollLeft))
            .toBeGreaterThan(before + 200);
    });
});

test('Back from a cold cache requests only the pages at that depth', async ({
    page,
    baseURL
}) => {
    const { fixture } = await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    await scrollToIndex(page, 5_207, 12_000);
    const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
    await expect(card).toHaveCount(1);
    await card.click();
    await expect(page.locator('#itemDetailPage')).toBeVisible();
    await page.clock.install();
    await page.clock.fastForward('10:00');
    fixture.requests.length = 0;
    await page.goBack();
    await expect(card).toBeFocused();
    expect(fixture.requests.length).toBeGreaterThan(0);
    expect(fixture.requests.length).toBeLessThan(5);
    expect(fixture.requests.every((r) => r.startIndex >= 5_000)).toBe(true);
});

test('a long walk along the shelf leaves a bounded number of pages in the cache', async ({
    page,
    baseURL
}) => {
    await install(page, baseURL!);
    await page.goto(KINDS.Movie.url);
    await expect(page.locator(CARD).first()).toBeVisible();
    let peak = 0;
    for (let index = 0; index < 12_000; index += 400) {
        await scrollToIndex(page, index, 12_000);
        await page.waitForTimeout(120);
        peak = Math.max(
            peak,
            Number(
                await page.locator(ROOT).getAttribute('data-rf-cached-pages')
            )
        );
    }
    measurements.push({ title: 'shelf, 30 jumps', peakCachedPages: peak });
    // 12 idle pages, plus what the window observes, plus the first request's page.
    expect(peak).toBeLessThanOrEqual(20);
});

for (const change of ['narrower', 'denser'] as const) {
    test(`Back after a ${change} shelf: same card, in view, focused`, async ({
        page,
        baseURL
    }) => {
        await install(page, baseURL!);
        await page.goto(KINDS.Movie.url);
        await expect(page.locator(CARD).first()).toBeVisible();
        await scrollToIndex(page, 5_203, 12_000);
        const card = page.locator(`${CARD}[href*="id=${MOVIE.Id}&"]`);
        await expect(card).toHaveCount(1);
        await page.waitForTimeout(150);
        // Far from the start edge, so that the saved offset cannot fit a phone.
        expect(
            await card.evaluate((node) => node.getBoundingClientRect().left)
        ).toBeGreaterThan(900);
        await card.focus({ preventScroll: true });
        await page.keyboard.press('Enter');
        await expect(page.locator('#itemDetailPage')).toBeVisible();
        if (change === 'narrower') {
            await page.setViewportSize({ width: 390, height: 844 });
        } else {
            await page.evaluate(
                (key) => localStorage.setItem(key, JSON.stringify('compact')),
                `library-density-${MOVIES}`
            );
        }
        await page.goBack();
        await expect(card).toBeFocused();
        await expect
            .poll(() =>
                card.evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    return box.left >= 0 && box.right <= window.innerWidth;
                })
            )
            .toBe(true);
    });
}

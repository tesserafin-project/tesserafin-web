/** Home → real Item Details → browser Back, against the production build. */
import { resolve } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import {
    MOVIE,
    SERVER_ID,
    USER_ID,
    installFixtureApi
} from './support/fixtureApi';

const DIST = resolve(__dirname, '../../dist');
const SHELF = '[data-rf-slot="media-shelf"]';
const SCROLLER = '.rf-media-shelf__scroller';
const CARD = '[data-rf-slot="media-card"]';
const latestShelf = (page: Page) =>
    page.locator(SHELF).filter({
        has: page.getByRole('heading', { name: 'Recently Added in Movies' })
    });
const list = (Items: unknown[]) => ({
    Items,
    TotalRecordCount: Items.length,
    StartIndex: 0
});

async function install(
    page: Page,
    origin: string,
    theme: string,
    layout: string
) {
    const ledger = await installFixtureApi(page, origin, DIST);
    await page.addInitScript(
        ([user, chosenTheme, chosenLayout]) => {
            localStorage.setItem(`${user}-appTheme`, chosenTheme);
            localStorage.setItem('layout', chosenLayout);
        },
        [USER_ID, theme, layout]
    );
    let items = Array.from({ length: 16 }, (_, index) => ({
        ...MOVIE,
        Id: index === 10 ? MOVIE.Id : `home-${index}`,
        Name: `Home movie ${index}`,
        ImageTags: {},
        BackdropImageTags: [],
        UserData: { ...MOVIE.UserData, PlaybackPositionTicks: 0 }
    }));
    await page.route('**/*', async (route) => {
        const path = new URL(route.request().url()).pathname.toLowerCase();
        // This server-free fixture has no WebSocket transport. Declare its unavailable ticket
        // endpoint explicitly; do not hide unexpected requests by filtering the ledger.
        if (
            path === '/websocket/tickets' &&
            route.request().method() === 'POST'
        ) {
            ledger.requests.push('POST /WebSocket/Tickets');
            return route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: 'WebSocket transport unavailable in this fixture'
                })
            });
        }

        const json = (body: unknown) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(body)
            });
        if (path === '/userviews')
            return json(
                list([
                    {
                        Id: 'home-library',
                        Name: 'Movies',
                        CollectionType: 'movies',
                        Type: 'CollectionFolder',
                        ServerId: SERVER_ID
                    }
                ])
            );
        if (path === '/items/latest') return json(items);
        if (path === '/useritems/resume' || path === '/items/resume')
            return json(list(items.slice(0, 12)));
        if (path === '/shows/nextup') return json(list(items.slice(0, 12)));
        return route.fallback();
    });
    return {
        ledger,
        removeOpened: () => {
            items = items.filter((item) => item.Id !== MOVIE.Id);
        }
    };
}

for (const theme of ['official.classic', 'official.glass']) {
    for (const layout of ['desktop', 'mobile']) {
        test(`${theme} ${layout}: Back restores the opened card and both scroll axes`, async ({
            page,
            baseURL
        }) => {
            await page.setViewportSize(
                layout === 'mobile'
                    ? { width: 412, height: 839 }
                    : { width: 1440, height: 900 }
            );
            const fixture = await install(page, baseURL!, theme, layout);
            await page.goto('/#/home');
            const shelf = latestShelf(page);
            await expect(shelf.locator(CARD)).toHaveCount(16);
            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-theme',
                theme
            );
            const card = shelf.locator(`${CARD}[href*="id=movie-1&"]`);
            await card.focus();
            await card.scrollIntoViewIfNeeded();
            // Wait for the real shelf's native scroll-snap to settle before measuring.
            await page.waitForTimeout(350);
            const before = await shelf
                .locator(SCROLLER)
                .evaluate((el) => ({ x: el.scrollLeft, y: window.scrollY }));
            expect(before.x).toBeGreaterThan(300);
            expect(before.y).toBeGreaterThan(100);
            await page.keyboard.press('Enter');
            await expect(page.locator('#itemDetailPage')).toBeVisible();
            // The browser toolbar owns Back on the Web. The in-app Back button is only
            // rendered by the native wrapper and is not part of this browser fixture.
            await page.goBack();
            await expect(shelf.locator(CARD)).toHaveCount(16);
            await expect(card).toBeFocused();
            await expect
                .poll(() =>
                    shelf
                        .locator(SCROLLER)
                        .evaluate(
                            (el, expected) =>
                                Math.abs(el.scrollLeft - expected),
                            before.x
                        )
                )
                .toBeLessThan(3);
            await expect
                .poll(() =>
                    page.evaluate((y) => Math.abs(window.scrollY - y), before.y)
                )
                .toBeLessThan(3);
            expect(fixture.ledger.undeclared).toEqual([]);
        });
    }
}

for (const theme of ['official.classic', 'official.glass']) {
    test(`${theme}: a removed card falls back in the same shelf after fresh data arrives`, async ({
        page,
        baseURL
    }) => {
        await page.setViewportSize({ width: 412, height: 839 });
        const fixture = await install(page, baseURL!, theme, 'mobile');
        await page.goto('/#/home');
        const shelf = latestShelf(page);
        await expect(shelf.locator(CARD)).toHaveCount(16);
        await expect(page.locator('html')).toHaveAttribute(
            'data-rf-theme',
            theme
        );
        const card = shelf.locator(`${CARD}[href*="id=movie-1&"]`);
        await card.focus();
        await card.scrollIntoViewIfNeeded();
        await page.keyboard.press('Enter');
        await expect(page.locator('#itemDetailPage')).toBeVisible();
        // Home queries remain fresh for a minute. Advance browser time while AWAY so the
        // real query client refetches on Back; no production query/client is replaced.
        await page.clock.install();
        fixture.removeOpened();
        await page.clock.fastForward(61_000);
        await page.goBack();
        await expect(shelf.locator(CARD)).toHaveCount(15);
        const replacement = shelf.locator(`${CARD}[href*="id=home-11&"]`);
        await expect(replacement).toBeFocused();
        await expect(replacement).toBeInViewport();
        await expect(card).toHaveCount(0);
        expect(fixture.ledger.undeclared).toEqual([]);
    });
}

test.describe('mobile touch activation', () => {
    test.use({
        hasTouch: true,
        isMobile: true,
        viewport: { width: 412, height: 839 }
    });
    for (const theme of ['official.classic', 'official.glass']) {
        test(`${theme}: tapping a card also restores it on Back`, async ({
            page,
            baseURL
        }) => {
            const fixture = await install(page, baseURL!, theme, 'mobile');
            await page.goto('/#/home');
            const shelf = latestShelf(page);
            await expect(shelf.locator(CARD)).toHaveCount(16);
            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-theme',
                theme
            );
            const card = shelf.locator(`${CARD}[href*="id=movie-1&"]`);
            await card.scrollIntoViewIfNeeded();
            await card.tap();
            await expect(page.locator('#itemDetailPage')).toBeVisible();
            await page.goBack();
            await expect(card).toBeFocused();
            await expect(card).toBeInViewport();
            expect(fixture.ledger.undeclared).toEqual([]);
        });
    }
});

/** Real production Library route; only the same-origin transport is a fixture. */
import { resolve } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import {
    administrator,
    installFixtureApi,
    MOVIES_VIEW_ID,
    USER_A
} from '../m3Browser/support/fixtureApi';

const DIST = resolve(__dirname, '../../dist');
const BASE = `/#/library/${MOVIES_VIEW_ID}`;
const SUMMARY = '.rf-active-library-filters';
const CHIP = 'button[data-filter-key]';
const STATE = '[data-rf-slot="state-empty"]';
const params =
    'genre=Drama&year=2024&studio=s1,s2&favorite=1&letter=A&sort=DateCreated&order=Descending&density=compact&view=list';
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
    const fixture = await installFixtureApi(page, origin, DIST, {
        signedIn: true,
        wizardCompleted: true,
        users: [administrator()],
        currentUserId: USER_A,
        packs: [],
        theme,
        layout: layout as 'desktop' | 'mobile'
    });
    const requests: Record<string, string>[] = [];
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname.toLowerCase();
        if (
            path === '/websocket/tickets' &&
            route.request().method() === 'POST'
        )
            return route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: 'WebSocket transport unavailable in this fixture'
                })
            });
        if (route.request().method() !== 'GET') return route.fallback();
        const json = (data: unknown) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(data)
            });
        if (path === '/items/filters')
            return json({ Genres: ['Drama', 'Comedy'], Years: [2024, 2026] });
        if (path === '/studios')
            return json(
                list([
                    { Id: 's1', Name: 'A24' },
                    { Id: 's2', Name: 'Studio Two' }
                ])
            );
        if (
            path === '/items' &&
            url.searchParams.get('parentId') === MOVIES_VIEW_ID
        ) {
            // The grid sends tie-breakers after the chosen sort; the first is the viewer's.
            const query = {
                ...Object.fromEntries(url.searchParams),
                sortBy: url.searchParams.get('sortBy') ?? ''
            };
            requests.push(query);
            // An intentionally empty filtered result, and a populated unfiltered result. The
            // fixture does not evaluate authorization, sorting or the server's filter engine.
            const filtered = [
                'genres',
                'years',
                'studioIds',
                'isFavorite',
                'nameStartsWith',
                'nameLessThan'
            ].some((key) => url.searchParams.has(key));
            return json(
                list(
                    filtered
                        ? []
                        : [
                              {
                                  Id: 'visible-movie',
                                  Name: 'A visible movie',
                                  Type: 'Movie',
                                  ServerId: 'server-1',
                                  ProductionYear: 2026
                              }
                          ]
                )
            );
        }
        return route.fallback();
    });
    return { fixture, requests };
}

for (const theme of ['official.classic', 'official.glass']) {
    for (const layout of ['desktop', 'mobile']) {
        test(`${theme} ${layout}: inspect, remove and reset filters without losing display choices`, async ({
            page,
            baseURL
        }) => {
            await page.setViewportSize(
                layout === 'mobile'
                    ? { width: 390, height: 844 }
                    : { width: 1440, height: 900 }
            );
            const { fixture, requests } = await install(
                page,
                baseURL!,
                theme,
                layout
            );
            await page.goto(`${BASE}?${params}`);
            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-theme',
                theme
            );
            await expect(page.locator(`${SUMMARY} ${CHIP}`)).toHaveCount(6);
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(page.locator(STATE)).toContainText(
                'No items match these filters.'
            );
            await expect(page.locator(SUMMARY)).toContainText('A24');
            // Keyboard activation of a real removable chip, with focus retained on its neighbour.
            const studio = page.locator(
                `${SUMMARY} button[data-filter-key="studio:s1"]`
            );
            await studio.focus();
            await page.keyboard.press('Enter');
            await expect(page.locator(`${SUMMARY} ${CHIP}`)).toHaveCount(5);
            await expect(
                page.locator(`${SUMMARY} button[data-filter-key="studio:s2"]`)
            ).toBeFocused();
            await expect
                .poll(() => new URL(page.url()).hash)
                .toContain('studio=s2');
            await expect.poll(() => requests.at(-1)?.studioIds).toBe('s2');
            // Reset through the empty-state action, not by manipulating the URL.
            await page
                .locator(STATE)
                .getByRole('button', { name: 'Reset filters', exact: true })
                .click();
            await expect(page.locator(SUMMARY)).toHaveCount(0);
            await expect(
                page.locator('[data-rf-slot="media-card"]')
            ).toHaveCount(1);
            const query = new URLSearchParams(
                new URL(page.url()).hash.split('?')[1]
            );
            expect(Object.fromEntries(query)).toEqual({
                sort: 'DateCreated',
                order: 'Descending',
                density: 'compact',
                view: 'list'
            });
            await expect
                .poll(() => requests.at(-1)?.sortBy)
                .toBe('DateCreated');
            for (const key of [
                'genres',
                'years',
                'studioIds',
                'isFavorite',
                'nameStartsWith',
                'nameLessThan'
            ])
                expect(requests.at(-1)).not.toHaveProperty(key);
            const fallback = page
                .locator(
                    theme === 'official.glass'
                        ? '.rf-filter-drawer__trigger'
                        : '.rf-library-view__controls select'
                )
                .first();
            await expect(fallback).toBeFocused();
            if (theme === 'official.glass') {
                await fallback.click();
                await expect(page.getByRole('dialog')).toBeVisible();
                await page.keyboard.press('Escape');
                await expect(fallback).toBeFocused();
            }
            // Shared URL/reload restores visible predicates; they are derived, not separately cached.
            await page.goto(`${BASE}?genre=Drama&studio=s2`);
            await page.reload();
            await expect(page.locator(`${SUMMARY} ${CHIP}`)).toHaveCount(2);
            await expect(page.locator(SUMMARY)).toContainText('Studio Two');
            await page
                .locator(SUMMARY)
                .getByRole('button', { name: 'Reset filters', exact: true })
                .click();
            await expect(
                page.locator('[data-rf-slot="media-card"]')
            ).toHaveCount(1);
            expect(fixture.ledger.undeclared).toEqual([]);
            const geometry = await page.evaluate(() => ({
                width: window.innerWidth,
                document: document.documentElement.scrollWidth
            }));
            expect(geometry.document).toBeLessThanOrEqual(geometry.width);
        });
    }
}

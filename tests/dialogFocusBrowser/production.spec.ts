/** Unmodified production application, real router/input/history; only API transport is a fixture. */
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
    installFixtureApi,
    SERVER_ID,
    USER_ID
} from '../itemDetailsBrowser/support/fixtureApi';
const DIST = resolve(__dirname, '../../dist');
const MORE = '[data-detail-action="btnMoreCommands"]';
const MENU = '.dialog.actionSheet.opened';
test.beforeAll(async ({ browser, browserName }) => {
    console.log(
        `[dialog-focus production] ${browserName} ${browser.version()}`
    );
});
async function install(
    page: Page,
    origin: string,
    theme: string,
    layout: string
) {
    const ledger = await installFixtureApi(page, origin, DIST);
    await page.addInitScript(
        ([user, selectedTheme, selectedLayout]) => {
            localStorage.setItem(`${user}-appTheme`, selectedTheme);
            localStorage.setItem('layout', selectedLayout);
        },
        [USER_ID, theme, layout]
    );
    await page.route('**/WebSocket/Tickets', (route) =>
        route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"error":"Fixture has no WebSocket transport"}'
        })
    );
    return ledger;
}
for (const theme of ['official.classic', 'official.glass']) {
    for (const layout of ['desktop', 'mobile', 'tv']) {
        test(`${theme} ${layout}: Escape and browser Back restore the real More button`, async ({
            page,
            baseURL
        }) => {
            await page.setViewportSize(
                layout === 'mobile'
                    ? { width: 390, height: 844 }
                    : { width: 1440, height: 900 }
            );
            const ledger = await install(page, baseURL!, theme, layout);
            await page.goto(`/#/details?id=movie-1&serverId=${SERVER_ID}`);
            await expect(page.locator('html')).toHaveAttribute(
                'data-rf-theme',
                theme
            );
            const more = page.locator(MORE);
            await expect(more).toBeVisible();
            for (const closeWith of ['Escape', 'browserBack']) {
                await more.focus();
                await page.keyboard.press('Enter');
                const menu = page.locator(MENU);
                await expect(menu).toBeVisible();
                // Desktop sheets intentionally do not autofocus. Focus an actual menu row
                // before dismissal to prove removal would otherwise leave body focused.
                const row = menu.locator('.actionSheetMenuItem').first();
                await row.focus();
                await expect(row).toBeFocused();
                if (closeWith === 'Escape') await page.keyboard.press('Escape');
                else await page.goBack();
                await expect(menu).toHaveCount(0);
                await expect(more).toBeFocused();
                await expect(page.locator('#itemDetailPage')).toBeVisible();
            }
            expect(ledger.undeclared).toEqual([]);
        });
    }
}

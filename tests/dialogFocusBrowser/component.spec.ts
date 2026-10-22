import { expect, test } from '@playwright/test';

test.beforeAll(async ({ browser, browserName }) => {
    console.log(`[dialog-focus component] ${browserName} ${browser.version()}`);
});

declare global {
    interface Window {
        dialogFixture: {
            removeOpener: () => void;
            disableOpener: () => void;
            inertOpener: () => void;
            hideOpener: () => void;
        };
    }
}
for (const theme of ['classic', 'glass']) {
    for (const layout of ['desktop', 'tv', 'mobile']) {
        test.describe(`${theme} ${layout}: real dialog/input/focus modules`, () => {
            test.beforeEach(async ({ page }) => {
                await page.setViewportSize(
                    layout === 'mobile'
                        ? { width: 390, height: 844 }
                        : { width: 1440, height: 900 }
                );
                await page.goto(`/?theme=${theme}&layout=${layout}`);
                await page.locator('#opener').focus();
                await page.keyboard.press('Enter');
                await expect(page.locator('#nested-1')).toBeFocused();
            });
            test('Escape unwinds nested scopes to each opener', async ({
                page
            }) => {
                await page.keyboard.press('Enter');
                await expect(page.locator('#nested-2')).toBeFocused();
                await page.keyboard.press('Escape');
                await expect(page.locator('#dialog-2')).toHaveCount(0);
                await expect(page.locator('#nested-1')).toBeFocused();
                await page.keyboard.press('Escape');
                await expect(page.getByRole('dialog')).toHaveCount(0);
                await expect(page.locator('#opener')).toBeFocused();
            });
            test('a closing action preserves a deliberate new destination', async ({
                page
            }) => {
                await page.locator('#handoff-1').focus();
                await page.keyboard.press('Enter');
                await expect(page.getByRole('dialog')).toHaveCount(0);
                await expect(page.locator('#destination')).toBeFocused();
            });
            for (const state of [
                'removeOpener',
                'disableOpener',
                'inertOpener',
                'hideOpener'
            ] as const) {
                test(`${state}: dismissal never focuses an unavailable opener`, async ({
                    page
                }) => {
                    await page.evaluate(
                        (name) => window.dialogFixture[name](),
                        state
                    );
                    await page.keyboard.press('Escape');
                    await expect(page.getByRole('dialog')).toHaveCount(0);
                    await expect
                        .poll(() =>
                            page.evaluate(() => document.activeElement?.tagName)
                        )
                        .toBe('BODY');
                    await page.keyboard.press('Tab');
                    await expect(page.locator('#destination')).toBeFocused();
                });
            }
        });
    }
}

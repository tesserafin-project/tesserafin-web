import { expect, test, type Page } from '@playwright/test';

type Fixture = {
    removeTrigger: (kind: 'audio' | 'subtitles', remaining?: number) => void;
    stopPlayback: () => void;
    detachHost: () => void;
    commands: string[];
    globalKeys: string[];
};
declare global {
    interface Window {
        menuFixture: Fixture;
    }
}

const menu = (page: Page) => page.getByRole('menu');
const button = (page: Page, kind: string) =>
    page.locator(`[data-track-menu="${kind}"]`);

for (const theme of ['classic', 'glass']) {
    for (const layout of ['desktop', 'tv']) {
        test.describe(`${theme} ${layout}`, () => {
            test.beforeEach(async ({ page }) => {
                await page.goto(`/?theme=${theme}&layout=${layout}`);
                await expect(button(page, 'settings')).toBeVisible();
            });

            for (const kind of ['audio', 'subtitles', 'settings']) {
                test(`${kind}: Escape restores the trigger; keys stay in the menu`, async ({
                    page
                }) => {
                    const trigger = button(page, kind);
                    await trigger.focus();
                    await page.keyboard.press('Enter');
                    await expect(menu(page)).toBeVisible();
                    await expect(menu(page).locator(':focus')).toHaveCount(1);
                    await page.keyboard.press('ArrowDown');
                    // Arrow/Escape stay in the menu instead of reaching the app's
                    // key-to-command layer.
                    await page.keyboard.press('Escape');
                    await expect(menu(page)).toHaveCount(0);
                    await expect(trigger).toBeFocused();
                    await expect
                        .poll(() =>
                            page.evaluate(() => window.menuFixture.globalKeys)
                        )
                        .toEqual([]);
                });
            }

            test('submenu Escape returns to its settings row, then the trigger', async ({
                page
            }) => {
                const trigger = button(page, 'settings');
                await trigger.focus();
                await page.keyboard.press('Enter');
                const aspect = menu(page).locator('[data-track="aspectratio"]');
                await aspect.focus();
                await page.keyboard.press('Enter');
                await expect(
                    menu(page).locator('[role="menuitemradio"]')
                ).toHaveCount(2);
                await page.keyboard.press('Escape');
                await expect(
                    menu(page).locator('[data-track="aspectratio"]')
                ).toBeFocused();
                await page.keyboard.press('Escape');
                await expect(trigger).toBeFocused();
            });

            for (const [kind, remaining] of [
                ['audio', 1],
                ['audio', 0],
                ['subtitles', 0]
            ] as const) {
                test(`${kind} (${remaining} remaining): a stream update removes the trigger; Escape focuses settings`, async ({
                    page
                }) => {
                    await button(page, kind).focus();
                    await page.keyboard.press('Enter');
                    await expect(menu(page)).toBeVisible();
                    await page.evaluate(
                        ([name, count]) =>
                            window.menuFixture.removeTrigger(name, count),
                        [kind, remaining] as const
                    );
                    await expect(button(page, kind)).toHaveCount(0);
                    await page.keyboard.press('Escape');
                    await expect(menu(page)).toHaveCount(0);
                    await expect(button(page, 'settings')).toBeFocused();
                });
            }

            test('playback teardown closes without stealing focus from another destination', async ({
                page
            }) => {
                await button(page, 'audio').click();
                await expect(menu(page)).toBeVisible();
                await page.evaluate(() => {
                    const destination = document.createElement('button');
                    destination.id = 'destination';
                    destination.textContent = 'New destination';
                    document.body.append(destination);
                    destination.focus();
                    window.menuFixture.stopPlayback();
                });
                await expect(menu(page)).toHaveCount(0);
                await expect(page.locator('#destination')).toBeFocused();
            });
        });
    }
}

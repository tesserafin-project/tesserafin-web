import { expect, test } from '@playwright/test';

/**
 * First E2E journey of the repo (design-reefin-shell-and-routing.md §5):
 * sign in through the real login form, land on the rewritten React /home,
 * check its sections and the keyboard accessibility of the tab strip.
 */

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';

test.describe('home', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        if (page.url().includes('/login')) {
            await page.locator('#txtManualName:visible').fill(USER);
            await page.locator('#txtManualPassword:visible').fill(PASSWORD);
            await page.locator('button[type="submit"]:visible').first().click();
            await page.waitForURL('**/#/home**', { timeout: 20_000 });
        }
        await page.waitForLoadState('networkidle');
    });

    test('shows the home sections after sign-in', async ({ page }) => {
        await expect(
            page.getByRole('tab', { name: /accueil|home/i })
        ).toBeVisible();
        await expect(
            page.getByRole('tab', { name: /favoris|favorites/i })
        ).toBeVisible();

        const homePanel = page.getByRole('tabpanel');
        await expect(homePanel.getByText(/mes médias|my media/i)).toBeVisible({
            timeout: 15_000
        });
    });

    test('switches to favorites and syncs the ?tab= url param', async ({
        page
    }) => {
        await page.getByRole('tab', { name: /favoris|favorites/i }).click();
        await expect(page).toHaveURL(/tab=1/);

        await page.getByRole('tab', { name: /accueil|home/i }).click();
        await expect(page).toHaveURL(/tab=0/);
    });

    test('tab strip is keyboard operable (arrow keys, roving tabindex)', async ({
        page
    }) => {
        const homeTab = page.getByRole('tab', { name: /accueil|home/i });
        const favoritesTab = page.getByRole('tab', {
            name: /favoris|favorites/i
        });

        await homeTab.focus();
        await expect(homeTab).toBeFocused();

        await page.keyboard.press('ArrowRight');
        await expect(favoritesTab).toBeFocused();

        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/tab=1/);
    });
});

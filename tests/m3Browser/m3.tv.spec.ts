/**
 * The first-run step driven by a remote (#139 gate 9, TV half).
 *
 * `tabIndex` proves nothing about a remote. `scripts/keyboardNavigation.js` DISCARDS every
 * navigation key unless the application is in TV layout —
 * `if (!layoutManager.tv && isNavigationKey(key)) return;` — so a spec that pressed arrows at a
 * 1920x1080 viewport without turning that layout on would be pressing keys the application never
 * receives, and every assertion after it would be vacuous.
 *
 * The fixture writes `layout=tv` into the same un-namespaced `localStorage` key `layoutManager`
 * reads before the app boots, and the spec asserts that it took before driving anything.
 */
import { administrator, installFixtureApi, USER_A } from './support/fixtureApi';
import {
    DIST,
    expect,
    openPacksStep,
    openUserStep,
    PACKS_PAGE,
    shot,
    test,
    USER_PAGE
} from './support/harness';

const focusedId = (page: Parameters<typeof installFixtureApi>[0]) =>
    page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.id ?? null
    );

const install = (
    page: Parameters<typeof installFixtureApi>[0],
    baseURL: string
) =>
    installFixtureApi(page, baseURL, DIST, {
        signedIn: false,
        wizardCompleted: false,
        users: [administrator()],
        currentUserId: USER_A,
        packs: [],
        layout: 'tv'
    });

async function signIn(page: Parameters<typeof installFixtureApi>[0]) {
    await openUserStep(page);
    await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
    await page.fill(`${USER_PAGE} #txtManualPassword`, 'tv-password');
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, 'tv-password');
    await page.click(`${USER_PAGE} button[type="submit"]`);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });
}

test('the application really is in TV layout', async ({ page, baseURL }) => {
    await install(page, baseURL!);
    await signIn(page);
    await openPacksStep(page);

    // The application's own signal, not the viewport size.
    const isTv = await page.evaluate(() =>
        document.documentElement.classList.contains('layout-tv')
    );
    const savedLayout = await page.evaluate(() =>
        localStorage.getItem('layout')
    );
    expect(savedLayout).toBe('tv');
    expect(isTv).toBe(true);
});

test('the step is navigable and operable with a remote', async ({
    page,
    baseURL
}) => {
    const fixture = await install(page, baseURL!);
    await signIn(page);
    await openPacksStep(page);

    // Start from the first suggestion, as a remote lands there.
    await page.locator('#suggestedPack0Selected').focus();
    expect(await focusedId(page)).toBe('suggestedPack0Selected');

    // Focus is visible — a remote user who cannot see where they are cannot use the step at all.
    const outline = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        const label = element.closest('label');
        const labelStyle = label ? getComputedStyle(label) : null;
        return {
            outlineWidth: style.outlineWidth,
            boxShadow: style.boxShadow,
            labelBackground: labelStyle?.backgroundColor ?? null,
            labelOutline: labelStyle?.outlineWidth ?? null
        };
    });
    expect(
        JSON.stringify(outline),
        `no visible focus indication on the focused control: ${JSON.stringify(outline)}`
    ).not.toBe('{}');

    // Arrow keys move between rows; Enter activates. Both go through `inputManager`, exactly as a
    // remote's directional pad and OK button do.
    await page.keyboard.press('Enter');
    await expect(page.locator('#suggestedPack0Selected')).toBeChecked();

    await page.locator('#suggestedPack2Selected').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#suggestedPack2Selected')).toBeChecked();

    await page.locator('#radioContentPackFirst').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#radioContentPackFirst')).toBeChecked();

    await shot(page, 'tv-packs-populated');

    await page.locator(`${PACKS_PAGE} button[type="submit"]`).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/#\/wizard\/remoteaccess/, { timeout: 30_000 });

    expect(fixture.createdPackNames().sort()).toEqual([
        'Movies and series',
        'Photos and home video'
    ]);
    expect(fixture.lastConfigurationWrite()).toMatchObject({
        ContentPackBrowsingPreference: 'ContentPackFirst'
    });
});

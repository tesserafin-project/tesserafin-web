import { administrator, installFixtureApi, USER_A } from './support/fixtureApi';
import {
    DIST,
    expect,
    openPacksStep,
    openUserStep,
    PACKS_PAGE,
    test,
    USER_PAGE
} from './support/harness';

/** What has focus, described well enough to name the control in a failure message. */
const focused = (page: Parameters<typeof installFixtureApi>[0]) =>
    page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return null;
        return (
            element.id ||
            element.getAttribute('data-pack') ||
            element.className ||
            element.tagName.toLowerCase()
        );
    });

async function tabUntil(
    page: Parameters<typeof installFixtureApi>[0],
    predicate: (marker: string) => boolean,
    limit = 60
) {
    const seen: string[] = [];
    for (let i = 0; i < limit; i += 1) {
        await page.keyboard.press('Tab');
        const marker = (await focused(page)) ?? '';
        seen.push(marker);
        if (predicate(marker)) return seen;
    }
    throw new Error(
        `never reached the control. Focus order was: ${seen.join(' → ')}`
    );
}

const fresh = (
    page: Parameters<typeof installFixtureApi>[0],
    baseURL: string
) =>
    installFixtureApi(page, baseURL, DIST, {
        signedIn: false,
        wizardCompleted: false,
        users: [administrator()],
        currentUserId: USER_A,
        packs: []
    });

test('the whole seeding step is reachable and operable by keyboard alone', async ({
    page,
    baseURL
}) => {
    const fixture = await fresh(page, baseURL!);

    await openUserStep(page);
    await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
    await page.fill(`${USER_PAGE} #txtManualPassword`, 'keyboard-password');
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, 'keyboard-password');
    await page.click(`${USER_PAGE} button[type="submit"]`);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });

    await openPacksStep(page);
    await page.locator(`${PACKS_PAGE}`).focus();

    // Tab to a suggestion's checkbox and toggle it with the keyboard, not the mouse.
    await tabUntil(page, (marker) => marker === 'suggestedPack1Selected');
    await page.keyboard.press('Space');
    await expect(page.locator('#suggestedPack1Selected')).toBeChecked();

    // The name field of the same row is the very next stop, so renaming needs no pointer either.
    await page.keyboard.press('Tab');
    expect(await focused(page)).toBe('suggestedPack1Name');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Weeknight music');

    /*
     * The arrangement is a radio GROUP, so only the checked radio is a tab stop and the other is
     * reached with an arrow key — that is the platform behaviour, and a test that tabbed to both
     * would be asserting a broken group. Tab to the group, arrow to the other option.
     */
    await tabUntil(page, (marker) => marker === 'radioMediaFamilyFirst');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#radioContentPackFirst')).toBeChecked();
    await expect(page.locator('#radioMediaFamilyFirst')).not.toBeChecked();

    // And so is submit.
    await tabUntil(page, (marker) => marker.includes('button-submit'));
    await page.keyboard.press('Enter');
    await page.waitForURL(/#\/wizard\/remoteaccess/, { timeout: 30_000 });

    expect(fixture.createdPackNames()).toEqual(['Weeknight music']);
    expect(fixture.lastConfigurationWrite()).toMatchObject({
        ContentPackBrowsingPreference: 'ContentPackFirst'
    });
});

test('a failure moves focus to the message rather than leaving it stranded', async ({
    page,
    baseURL
}) => {
    await installFixtureApi(page, baseURL!, DIST, {
        signedIn: false,
        wizardCompleted: false,
        users: [administrator()],
        currentUserId: USER_A,
        packs: [],
        faults: { createPackStatus: 500 }
    });

    await openUserStep(page);
    await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
    await page.fill(`${USER_PAGE} #txtManualPassword`, 'keyboard-password');
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, 'keyboard-password');
    await page.click(`${USER_PAGE} button[type="submit"]`);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });

    await openPacksStep(page);
    await page.check('#suggestedPack1Selected', { force: true });
    await page.click(`${PACKS_PAGE} button[type="submit"]`);

    await expect(page.locator(`${PACKS_PAGE} .wizardPacksError`)).toBeVisible();
    // A keyboard user who cannot see the alert has to be taken to it, not told about it visually.
    expect(await focused(page)).toContain('wizardPacksError');
});

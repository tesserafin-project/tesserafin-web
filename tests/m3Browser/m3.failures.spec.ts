import { administrator, installFixtureApi } from './support/fixtureApi';
import {
    DIST,
    expect,
    openPacksStep,
    openUserStep,
    selectPack,
    shot,
    submitPacks,
    test,
    USER_PAGE
} from './support/harness';

const PASSWORD = 'wizard-test-password';

const install = (
    page: Parameters<typeof installFixtureApi>[0],
    baseURL: string,
    faults: Parameters<typeof installFixtureApi>[3]['faults']
) =>
    installFixtureApi(page, baseURL, DIST, {
        signedIn: false,
        wizardCompleted: false,
        users: [administrator()],
        currentUserId: 'user-a',
        packs: [],
        faults
    });

async function submitUser(
    page: Parameters<typeof installFixtureApi>[0],
    password = PASSWORD
) {
    await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
    await page.fill(`${USER_PAGE} #txtManualPassword`, password);
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, password);
    await page.click(`${USER_PAGE} button[type="submit"]`);
}

const lower = (fixture: { ledger: { requests: string[] } }) =>
    fixture.ledger.requests.map((r) => r.toLowerCase());

test('a failed account creation is never followed by a login attempt', async ({
    page,
    baseURL
}) => {
    // The server answers 400 to an empty password ("Password must not be empty"). Whatever the
    // reason, there is no account to authenticate against, and a login attempt here would only
    // produce a second, misleading error.
    const fixture = await install(page, baseURL!, { startupUserStatus: 400 });

    await openUserStep(page);
    await submitUser(page);

    const error = page.locator(`${USER_PAGE} .wizardUserError`);
    await expect(error).toBeVisible();
    await expect(error).not.toBeEmpty();

    expect(lower(fixture)).toContain('post /startup/user');
    expect(lower(fixture)).not.toContain('post /users/authenticatebyname');

    // Still on the user step. The wizard did not advance and did not fall into the ordinary app.
    expect(page.url()).toContain('/wizard/user');
    await shot(page, 'failure-startup-user');
});

test('a failed sign-in keeps the operator on the step, and retry creates no second user', async ({
    page,
    baseURL
}) => {
    const fixture = await install(page, baseURL!, { authenticateStatus: 401 });

    await openUserStep(page);
    await submitUser(page);

    const error = page.locator(`${USER_PAGE} .wizardUserError`);
    await expect(error).toBeVisible();
    // Focus is on the error, not left on a control the operator has already dealt with.
    expect(
        await page.evaluate(() =>
            document.activeElement?.className.includes('wizardUserError')
        )
    ).toBe(true);

    // The username survives; the password fields do not.
    await expect(page.locator(`${USER_PAGE} #txtUsername`)).toHaveValue(
        'household-admin'
    );
    await expect(page.locator(`${USER_PAGE} #txtManualPassword`)).toHaveValue(
        ''
    );
    await expect(page.locator(`${USER_PAGE} #txtPasswordConfirm`)).toHaveValue(
        ''
    );
    expect(page.url()).toContain('/wizard/user');
    await shot(page, 'failure-authentication');

    // Retry, this time with a server that accepts the sign-in.
    fixture.profile.faults = {};
    await submitUser(page);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });

    // `Startup/User` renames and re-passwords the SAME first user, so two submits are two updates,
    // never two accounts.
    expect(
        lower(fixture).filter((r) => r === 'post /startup/user')
    ).toHaveLength(2);
    expect(fixture.profile.users).toHaveLength(1);
});

test('a partial seeding failure does not advance, and retry does not duplicate', async ({
    page,
    baseURL
}) => {
    const fixture = await install(page, baseURL!, {
        createPackFailsOnceFor: ['Sport']
    });

    await openUserStep(page);
    await submitUser(page);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });

    await openPacksStep(page);
    await selectPack(page, 'Music');
    await selectPack(page, 'Sport');
    await selectPack(page, 'Podcasts');
    await submitPacks(page);

    const error = page.locator('#wizardPacksPage .wizardPacksError');
    await expect(error).toBeVisible();
    expect(page.url()).toContain('/wizard/packs');

    // Two of the three landed. Nothing was rolled back — the server made them, and pretending
    // otherwise would be a lie the client is in no position to tell.
    expect(fixture.createdPackNames().sort()).toEqual([
        'Music',
        'Podcasts',
        'Sport'
    ]);
    expect(fixture.profile.packs.map((p) => p.Name).sort()).toEqual([
        'Music',
        'Podcasts'
    ]);
    await shot(page, 'failure-partial-seeding');

    // Retry finishes the job instead of doubling it: one more write, for the one that failed.
    await submitPacks(page);
    await page.waitForURL(/#\/wizard\/remoteaccess/, { timeout: 30_000 });

    expect(fixture.createdPackNames()).toEqual([
        'Music',
        'Sport',
        'Podcasts',
        'Sport'
    ]);
    expect(fixture.profile.packs.map((p) => p.Name).sort()).toEqual([
        'Music',
        'Podcasts',
        'Sport'
    ]);
});

test('a failed arrangement write does not advance', async ({
    page,
    baseURL
}) => {
    const fixture = await install(page, baseURL!, { configurationStatus: 500 });

    await openUserStep(page);
    await submitUser(page);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });

    await openPacksStep(page);
    await submitPacks(page);

    await expect(
        page.locator('#wizardPacksPage .wizardPacksError')
    ).toBeVisible();
    expect(page.url()).toContain('/wizard/packs');

    // The server never stored it, so the user's configuration is untouched.
    expect(
        fixture.profile.users[0].configuration.ContentPackBrowsingPreference
    ).toBeUndefined();
});

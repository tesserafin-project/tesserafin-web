import {
    ACCESS_TOKEN,
    administrator,
    installFixtureApi,
    type InstalledFixture
} from './support/fixtureApi';
import {
    addCustomPack,
    DIST,
    expect,
    openPacksStep,
    openUserStep,
    packRows,
    persistedState,
    renamePack,
    selectPack,
    shot,
    submitPacks,
    test,
    USER_PAGE
} from './support/harness';

const PASSWORD = 'wizard-test-Pässwörd-✓';

const freshInstall = (page: Parameters<typeof installFixtureApi>[0], baseURL: string) =>
    installFixtureApi(page, baseURL, DIST, {
        signedIn: false,
        wizardCompleted: false,
        users: [administrator()],
        currentUserId: 'user-a',
        packs: []
    });

/** Drive the user step exactly as an operator would, and wait for the step it lands on. */
async function submitFirstUser(
    page: Parameters<typeof installFixtureApi>[0],
    name: string,
    password: string
) {
    await page.fill(`${USER_PAGE} #txtUsername`, name);
    await page.fill(`${USER_PAGE} #txtManualPassword`, password);
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, password);
    await page.click(`${USER_PAGE} button[type="submit"]`);
}

test('the first administrator is created, signed in, and can seed packs', async ({
    page,
    baseURL
}) => {
    const fixture = await freshInstall(page, baseURL!);

    await openUserStep(page);
    await submitFirstUser(page, 'household-admin', PASSWORD);

    // Advancing at all is the assertion: `nextWizardPage()` runs only after authentication resolved.
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });

    // Lower-cased because `jellyfin-apiclient` normalises the paths it builds; the ledger keeps
    // whatever was actually sent.
    const requests = fixture.ledger.requests.map((r) => r.toLowerCase());
    const startupUser = requests.indexOf('post /startup/user');
    const authenticate = requests.indexOf('post /users/authenticatebyname');
    expect(startupUser).toBeGreaterThanOrEqual(0);
    expect(authenticate).toBeGreaterThan(startupUser);

    // The credentials that were submitted are the ones that were used. Nothing invented a token.
    const authBody = fixture.ledger.writes.find(
        (w) => w.path.toLowerCase() === '/users/authenticatebyname'
    )?.body as { Username?: string; Pw?: string };
    expect(authBody.Username).toBe('household-admin');
    expect(authBody.Pw).toBe(PASSWORD);

    // The measured server shape: administrator, capability false. The UI must not read this to
    // decide whether to offer seeding — it is asserted here only to prove the scenario is the one
    // #220 describes.
    await openPacksStep(page);
    const me = await page.evaluate(async () => {
        const response = await fetch('/Users/Me', {
            headers: {
                Authorization: `MediaBrowser Client="t", Device="t", DeviceId="t", Version="1", Token="fixture-token"`
            }
        });
        return response.json();
    });
    expect(me.Policy.IsAdministrator).toBe(true);
    expect(me.Policy.EnableContentPackManagement).toBe(false);

    // …and the seeding UI is present anyway.
    expect((await packRows(page)).length).toBe(9);

    await selectPack(page, 'Music');
    // Renamed, then selected — addressed by the name it started with, which is what makes the
    // rename observable rather than a different row.
    await renamePack(page, 'Movies and series', 'Film night');
    await selectPack(page, 'Movies and series');
    await addCustomPack(page, 'Grandad’s tapes');
    await shot(page, 'onboarding-packs-populated');

    await submitPacks(page);
    await page.waitForURL(/#\/wizard\/settings/, { timeout: 30_000 });

    // Exactly the three chosen names, through the same call, with nothing but a name.
    expect(fixture.createdPackNames().sort()).toEqual(
        ['Film night', 'Grandad’s tapes', 'Music'].sort()
    );
    for (const write of fixture.ledger.writes.filter(
        (w) => w.path.toLowerCase() === '/contentpacks'
    )) {
        expect(Object.keys(write.body as object)).toEqual(['Name']);
    }

    // The arrangement was written, and nothing else on the configuration was lost.
    const configuration = fixture.lastConfigurationWrite();
    expect(configuration).toMatchObject({
        PlayDefaultAudioTrack: true,
        ContentPackBrowsingPreference: 'MediaFamilyFirst'
    });

    // Nothing scanned, migrated or classified, and no membership was touched.
    for (const request of fixture.ledger.requests) {
        expect(request.toLowerCase()).not.toMatch(
            /refresh|scheduledtasks|library\/media|items\/[^/]+\/contentpacks|contentpacks\/[^/]+\/items/
        );
    }
    expect(fixture.ledger.undeclared).toEqual([]);
});

test('the submitted password is never persisted, and no token reaches the DOM', async ({
    page,
    baseURL
}) => {
    await freshInstall(page, baseURL!);

    await openUserStep(page);
    await submitFirstUser(page, 'household-admin', PASSWORD);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });

    const persisted = await persistedState(page);
    expect(persisted).not.toContain(PASSWORD);
    // The session itself is expected in storage — that is what signing in means. The password is
    // the thing that must not be.
    expect(persisted).toContain(ACCESS_TOKEN);

    expect(page.url()).not.toContain(PASSWORD);
    expect(page.url()).not.toContain(ACCESS_TOKEN);

    const html = await page.content();
    expect(html).not.toContain(PASSWORD);
    expect(html).not.toContain(ACCESS_TOKEN);
});

test('selecting nothing issues no pack writes at all', async ({
    page,
    baseURL
}) => {
    const fixture = await freshInstall(page, baseURL!);

    await openUserStep(page);
    await submitFirstUser(page, 'household-admin', PASSWORD);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });

    await openPacksStep(page);
    // Nothing is selected by default: "select none" is the resting state, not an extra action.
    expect((await packRows(page)).every((row) => !row.selected)).toBe(true);
    await expect(
        page.locator(`#wizardPacksPage .wizardPacksNoneSelected`)
    ).toBeVisible();
    await shot(page, 'onboarding-packs-none-selected');

    await submitPacks(page);
    await page.waitForURL(/#\/wizard\/settings/, { timeout: 30_000 });

    expect(fixture.createdPackNames()).toEqual([]);
    expect(
        fixture.ledger.requests.filter(
            (r) => r.toLowerCase() === 'post /contentpacks'
        )
    ).toEqual([]);
    // The wizard still completed its own write and moved on.
    expect(fixture.lastConfigurationWrite()).not.toBeNull();
});

test('a tokenless content-pack write is refused', async ({ page, baseURL }) => {
    const fixture = await freshInstall(page, baseURL!);

    await openUserStep(page);

    const status = await page.evaluate(async () => {
        const response = await fetch('/ContentPacks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Name: 'Anonymous' })
        });
        return response.status;
    });

    expect(status).toBe(401);
    expect(
        fixture.ledger.tokenless.map((r) => r.toLowerCase())
    ).toContain('post /contentpacks');
});

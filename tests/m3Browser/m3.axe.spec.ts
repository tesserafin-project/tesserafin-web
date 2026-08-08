/**
 * Accessibility over every materially different M3 state (#139 gate 9).
 *
 * The engine is the repository's own — `tests/e2e/support/axe.ts` pins the vendored build BY
 * CONTENT HASH and refuses to run against anything else. The severity policy is the repository's
 * too: `critical` fails, everything else is REPORTED rather than discarded, so a step with a dozen
 * serious violations cannot be presented as clean.
 *
 * Nothing here is suppressed. `scanPage` is called with no `exclude` and disables no rule; the two
 * `include`d scans are narrowed to the step's own form, and the reason is written at the call site.
 */
import {
    AXE_VERSION,
    formatViolations,
    scanPage,
    type AxeResult
} from '../e2e/support/axe';
import { administrator, installFixtureApi, USER_A } from './support/fixtureApi';
import {
    addCustomPack,
    DIST,
    expect,
    openPacksStep,
    openUserStep,
    PACKS_PAGE,
    selectPack,
    test,
    USER_PAGE
} from './support/harness';

interface Scanned {
    state: string;
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    passes: number;
    incomplete: number;
    ids: string[];
}

const scanned: Scanned[] = [];

function record(state: string, result: AxeResult) {
    scanned.push({
        state,
        critical: result.bySeverity.critical,
        serious: result.bySeverity.serious,
        moderate: result.bySeverity.moderate,
        minor: result.bySeverity.minor,
        passes: result.passCount,
        incomplete: result.incompleteCount,
        // Named WITH their targets: "one serious violation" is not actionable, "color-contrast on
        // .wizardPacksNoneSelected" is.
        ids: result.violations.map(
            (v) => `${v.id}[${v.impact}] ${v.nodes.join(' | ')}`
        )
    });

    const critical = result.violations.filter((v) => v.impact === 'critical');
    expect(
        critical,
        `critical violations in ${state}:\n${formatViolations({
            ...result,
            violations: critical
        })}`
    ).toEqual([]);
}

test.afterAll(() => {
    // Printed, not asserted away: a reader of the run sees exactly what each state scored.
    console.log(
        `[m3 axe] engine ${AXE_VERSION}\n${scanned
            .map(
                (s) =>
                    `  ${s.state}: critical ${s.critical}, serious ${s.serious}, moderate ${s.moderate}, minor ${s.minor}, passes ${s.passes}, incomplete ${s.incomplete}${
                        s.ids.length ? ` — ${s.ids.join(', ')}` : ''
                    }`
            )
            .join('\n')}`
    );
});

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

async function signIn(page: Parameters<typeof installFixtureApi>[0]) {
    await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
    await page.fill(`${USER_PAGE} #txtManualPassword`, 'axe-test-password');
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, 'axe-test-password');
    await page.click(`${USER_PAGE} button[type="submit"]`);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });
}

test('the engine is the pinned one', () => {
    expect(AXE_VERSION).toBe('4.12.1');
});

test('the user step is clean, including its failure state', async ({
    page,
    baseURL
}) => {
    const fixture = await fresh(page, baseURL!);
    await openUserStep(page);
    record('wizard/user — resting', await scanPage(page));

    // The failure state is a different page: an alert appears and takes focus. Scanning only the
    // resting state would leave the one screen a person meets when something went wrong unscanned.
    fixture.profile.faults = { authenticateStatus: 401 };
    await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
    await page.fill(`${USER_PAGE} #txtManualPassword`, 'axe-test-password');
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, 'axe-test-password');
    await page.click(`${USER_PAGE} button[type="submit"]`);
    await expect(page.locator(`${USER_PAGE} .wizardUserError`)).toBeVisible();
    record('wizard/user — authentication failed', await scanPage(page));
});

test('the seeding step is clean, empty and populated', async ({
    page,
    baseURL
}) => {
    await fresh(page, baseURL!);
    await openUserStep(page);
    await signIn(page);

    await openPacksStep(page);
    record('wizard/packs — nothing selected', await scanPage(page));

    await selectPack(page, 'Music');
    await selectPack(page, 'Sport');
    await addCustomPack(page, 'Grandad’s tapes');
    record('wizard/packs — populated', await scanPage(page));
});

test('the settings control is clean', async ({ page, baseURL }) => {
    await installFixtureApi(page, baseURL!, DIST, {
        signedIn: true,
        wizardCompleted: true,
        users: [
            administrator({ configuration: { PlayDefaultAudioTrack: true } })
        ],
        currentUserId: USER_A,
        packs: []
    });

    await page.goto(`/#/mypreferencesdisplay?userId=${USER_A}`);
    await page.waitForSelector('#displayPreferencesPage', { timeout: 45_000 });
    await page.waitForSelector('input[name="contentPackBrowsingPreference"]', {
        state: 'attached',
        timeout: 45_000
    });

    /*
     * Narrowed to the preferences form, and here is why: this page is a long-standing surface with
     * its own pre-existing findings, and a full-page scan would mix them into M3's evidence in both
     * directions — hiding a new violation among old ones, or blaming M3 for something it did not
     * introduce. The control under test and everything around it inside the form is scanned in full.
     */
    record(
        'settings — browsing arrangement',
        await scanPage(page, ['#displayPreferencesPage form'])
    );
});

test('the seeding step is clean at a mobile viewport', async ({
    page,
    baseURL
}) => {
    // Target size and reflow rules only fire at a small viewport, so the same DOM has to be scanned
    // again there rather than assumed to carry over from desktop.
    await page.setViewportSize({ width: 412, height: 915 });
    await fresh(page, baseURL!);
    await openUserStep(page);
    await signIn(page);
    await openPacksStep(page);
    await selectPack(page, 'Music');

    record(
        'wizard/packs — mobile viewport',
        await scanPage(page, [PACKS_PAGE])
    );
});

/**
 * The first-run step on a phone (#139 gate 9, mobile half).
 *
 * Runs in the `mobile` project, which uses a real device descriptor — `Pixel 7`, `hasTouch: true` —
 * rather than a desktop browser with a narrow window. Touch targets and reflow are the two things a
 * resized desktop cannot honestly report.
 */
import { administrator, installFixtureApi, USER_A } from './support/fixtureApi';
import {
    addCustomPack,
    DIST,
    expect,
    openPacksStep,
    openUserStep,
    PACKS_PAGE,
    shot,
    submitPacks,
    test,
    USER_PAGE
} from './support/harness';

/** WCAG 2.5.8 target size, in CSS pixels. */
const MIN_TARGET = 24;
/** What the repository's own mobile work treats as comfortable. */
const COMFORTABLE_TARGET = 44;

async function signIn(page: Parameters<typeof installFixtureApi>[0]) {
    await openUserStep(page);
    await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
    await page.fill(`${USER_PAGE} #txtManualPassword`, 'mobile-password');
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, 'mobile-password');
    await page.tap(`${USER_PAGE} button[type="submit"]`);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });
}

test('the step is reachable and operable by touch, and nothing is clipped', async ({
    page,
    baseURL
}) => {
    const fixture = await installFixtureApi(page, baseURL!, DIST, {
        signedIn: false,
        wizardCompleted: false,
        users: [administrator()],
        currentUserId: USER_A,
        packs: [],
        layout: 'mobile'
    });

    await signIn(page);
    await openPacksStep(page);

    // Nothing overflows sideways: a horizontally scrolling first-run step is a broken one.
    const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    /*
     * Measured on the LABELS, not on the `input` elements.
     *
     * `emby-checkbox` and `emby-radio` collapse the native input to 1x1 and paint the control on the
     * surrounding label — which is also what a finger actually lands on. Measuring the input would
     * report an 11-control failure that describes nothing a person can experience, and would keep
     * reporting it however large the real target became.
     */
    const targets = await page.$$eval(
        `${PACKS_PAGE} .wizardPackToggle, ${PACKS_PAGE} .checkboxContainer label, ${PACKS_PAGE} input[type="text"], ${PACKS_PAGE} button`,
        (nodes) =>
            nodes.map((node) => {
                const box = node.getBoundingClientRect();
                const label = (node as HTMLElement).id || node.className;
                return {
                    label,
                    width: box.width,
                    height: box.height,
                    right: box.right
                };
            })
    );

    const viewportWidth = overflow.clientWidth;
    const tooSmall = targets.filter(
        (t) => t.height > 0 && t.height < MIN_TARGET
    );
    const clipped = targets.filter((t) => t.right > viewportWidth + 1);

    expect(
        tooSmall,
        `controls below the ${MIN_TARGET}px target size: ${tooSmall
            .map(
                (t) =>
                    `${t.label} ${Math.round(t.width)}x${Math.round(t.height)}`
            )
            .join(', ')}`
    ).toEqual([]);
    expect(
        clipped,
        `controls clipped past the viewport: ${clipped.map((t) => t.label).join(', ')}`
    ).toEqual([]);

    // The primary action is comfortably sized, not merely legal.
    const submit = await page
        .locator(`${PACKS_PAGE} button[type="submit"]`)
        .boundingBox();
    expect(submit!.height).toBeGreaterThanOrEqual(COMFORTABLE_TARGET);

    // And the whole flow works by tapping — on the labels, which is where the control is painted
    // and where a finger actually lands.
    await page.tap(
        `${PACKS_PAGE} .wizardPackRow[data-pack="Music"] .wizardPackToggle`
    );
    await expect(page.locator('#suggestedPack1Selected')).toBeChecked();
    await addCustomPack(page, 'Kids');
    await page.tap(
        `${PACKS_PAGE} .checkboxContainer:has(#radioContentPackFirst) label`
    );
    await expect(page.locator('#radioContentPackFirst')).toBeChecked();
    await shot(page, 'mobile-packs-populated');

    await submitPacks(page);
    await page.waitForURL(/#\/wizard\/settings/, { timeout: 30_000 });

    expect(fixture.createdPackNames().sort()).toEqual(['Kids', 'Music']);
    expect(fixture.lastConfigurationWrite()).toMatchObject({
        ContentPackBrowsingPreference: 'ContentPackFirst'
    });
});

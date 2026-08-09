import {
    administrator,
    installFixtureApi,
    USER_A,
    USER_B
} from './support/fixtureApi';
import { DIST, expect, shot, test } from './support/harness';

/**
 * The primary navigation is the MUI toolbar `AppToolbar` renders. One selector, not an alternation:
 * a comma here would compose into `header nav, header .MuiToolbar-root a` and silently wait on the
 * wrong half.
 */
const NAV = '.MuiToolbar-root';

/**
 * The visible labels of the browsing entries, in document order.
 *
 * The server-name button that opens the toolbar is dropped: it is the product's identity, not a
 * browsing destination, and "content packs lead" is a claim about where you can go, not about the
 * logo. Everything after it is what the household actually navigates with.
 */
const navLabels = async (page: Parameters<typeof installFixtureApi>[0]) => {
    const labels = await page.$$eval(`${NAV} a`, (nodes) =>
        nodes
            .map((node) => {
                // `material-icons` renders its glyph as a LIGATURE, so `textContent` on the button
                // reads "widgetsContent packs". The icon is stripped from a clone rather than
                // matched away with a regex, which would only work until an icon name happened to
                // be a word in a label.
                const clone = node.cloneNode(true) as HTMLElement;
                for (const icon of clone.querySelectorAll('.MuiButton-icon'))
                    icon.remove();
                return clone.textContent?.trim() ?? '';
            })
            .filter(Boolean)
    );
    return labels.slice(1);
};

const signedIn = (
    page: Parameters<typeof installFixtureApi>[0],
    baseURL: string,
    configuration: Record<string, unknown>,
    extraUsers: Parameters<typeof administrator>[0][] = []
) =>
    installFixtureApi(page, baseURL, DIST, {
        signedIn: true,
        wizardCompleted: true,
        users: [
            administrator({ configuration }),
            ...extraUsers.map((over) => administrator(over))
        ],
        currentUserId: USER_A,
        packs: [{ Id: 'pack-1', Name: 'Sport' }]
    });

/**
 * Wait for `UserViewNav` itself, not merely for "an anchor in a toolbar".
 *
 * The generic wait resolved on a skeleton anchor about six seconds before the navigation actually
 * rendered, so every assertion ran against an empty list — and the two tests that assert an ABSENCE
 * passed for exactly the wrong reason. The Favorites link is the one element `UserViewNav` always
 * renders once it has resolved, so waiting on it means the list under test exists.
 */
const FAVOURITES = `${NAV} a[href="#/home?tab=1"]`;

/**
 * Drive the arrangement `Select` the way a person does: open the listbox, click the option.
 *
 * MUI keeps the real value in a hidden input, so `check()`/`fill()` would bypass the control the
 * household actually uses and prove nothing about it. Options are addressed by their visible copy.
 */
const ARRANGEMENT_LABELS: Record<string, string> = {
    OptionBrowseByMediaFamily: 'By media type',
    OptionBrowseByContentPack: 'By content pack'
};

async function chooseArrangement(
    page: Parameters<typeof installFixtureApi>[0],
    key: keyof typeof ARRANGEMENT_LABELS
) {
    await page.click('#display-settings-browsing-arrangement-label + div');
    await page.click(
        `li[role="option"]:has-text("${ARRANGEMENT_LABELS[key]}")`
    );
}

async function openHome(page: Parameters<typeof installFixtureApi>[0]) {
    await page.goto('/#/home');
    await page.waitForSelector(FAVOURITES, { timeout: 45_000 });
}

test('an absent arrangement renders exactly today’s navigation', async ({
    page,
    baseURL
}) => {
    // The field is simply not there — which is every existing installation. Nothing prompts, and the
    // navigation is the one that shipped before M3.
    await signedIn(page, baseURL!, { PlayDefaultAudioTrack: true });
    await openHome(page);

    const labels = await navLabels(page);
    expect(labels).toContain('Movies');
    expect(labels).toContain('Music');
    expect(labels).not.toContain('Content packs');
    await shot(page, 'nav-media-family-first');
});

test('an unrecognised arrangement is treated as media-family-first', async ({
    page,
    baseURL
}) => {
    await signedIn(page, baseURL!, {
        ContentPackBrowsingPreference: 'SomethingThisBuildHasNeverHeardOf'
    });
    await openHome(page);

    expect(await navLabels(page)).not.toContain('Content packs');
});

test('content-pack-first leads with packs and hides no media family', async ({
    page,
    baseURL
}) => {
    await signedIn(page, baseURL!, {
        PlayDefaultAudioTrack: true,
        ContentPackBrowsingPreference: 'ContentPackFirst'
    });
    await openHome(page);

    const labels = await navLabels(page);
    // Leads every browsing destination, including Favourites.
    expect(labels[0]).toBe('Content packs');
    // Hides nothing: the same destinations, in the same order, still there.
    expect(labels).toContain('Movies');
    expect(labels).toContain('Music');
    expect(labels.indexOf('Movies')).toBeLessThan(labels.indexOf('Music'));

    const href = await page
        .locator(`${NAV} a`, { hasText: 'Content packs' })
        .first()
        .getAttribute('href');
    expect(href).toContain('contentpacks');
    await shot(page, 'nav-content-pack-first');
});

test('the arrangement survives a reload, from the server and not from a cache', async ({
    page,
    baseURL
}) => {
    const fixture = await signedIn(page, baseURL!, {
        ContentPackBrowsingPreference: 'ContentPackFirst'
    });
    await openHome(page);
    expect((await navLabels(page))[0]).toBe('Content packs');

    // The init script drops `keyval-store` on every boot, so this reload cannot be answered from
    // React Query's persisted cache: whatever renders came from a request made after the reload.
    fixture.ledger.requests.length = 0;
    await page.reload();
    await page.waitForSelector(FAVOURITES, { timeout: 45_000 });

    expect((await navLabels(page))[0]).toBe('Content packs');
    expect(fixture.ledger.requests.some((r) => /^GET \/Users\//i.test(r))).toBe(
        true
    );
});

test('one household member’s arrangement never leaks into another’s', async ({
    page,
    baseURL
}) => {
    const fixture = await signedIn(
        page,
        baseURL!,
        {
            ContentPackBrowsingPreference: 'ContentPackFirst'
        },
        [
            {
                id: USER_B,
                name: 'household-member',
                isAdministrator: false,
                canManage: false,
                configuration: { PlayDefaultAudioTrack: true }
            }
        ]
    );

    await openHome(page);
    expect((await navLabels(page))[0]).toBe('Content packs');

    // Switch the session to the second account and boot again from scratch, exactly as signing out
    // and back in would.
    await fixture.signInAs(USER_B);
    await page.reload();
    await page.waitForSelector(FAVOURITES, { timeout: 45_000 });

    const labels = await navLabels(page);
    expect(labels).not.toContain('Content packs');
    expect(labels).toContain('Movies');
});

test('the settings control moves the arrangement in both directions', async ({
    page,
    baseURL
}) => {
    const fixture = await signedIn(page, baseURL!, {
        PlayDefaultAudioTrack: true,
        SubtitleMode: 'Smart',
        AudioLanguagePreference: 'fra'
    });

    // The route reads its subject from `?userId=`; without it `useDisplaySettings` returns early
    // and the page stays on its loading state forever. That is the existing contract, not something
    // M3 introduced — every link into this page carries the parameter.
    await page.goto(`/#/mypreferencesdisplay?userId=${USER_A}`);
    await page.waitForSelector('#displayPreferencesPage', { timeout: 45_000 });
    const arrangement = page.locator(
        'input[name="contentPackBrowsingPreference"]'
    );
    await arrangement.waitFor({ state: 'attached', timeout: 45_000 });
    await shot(page, 'settings-browsing-arrangement');

    // It starts on the resolved default, not on an empty control.
    await expect(arrangement).toHaveValue('MediaFamilyFirst');

    await chooseArrangement(page, 'OptionBrowseByContentPack');
    await page.click('#displayPreferencesPage button[type="submit"]');
    await expect
        .poll(() => fixture.lastConfigurationWrite(), { timeout: 30_000 })
        .toMatchObject({
            ContentPackBrowsingPreference: 'ContentPackFirst',
            // Everything else on the document survived the write.
            SubtitleMode: 'Smart',
            AudioLanguagePreference: 'fra',
            PlayDefaultAudioTrack: true
        });

    // Navigation follows without a reload.
    await openHome(page);
    expect((await navLabels(page))[0]).toBe('Content packs');

    // And back again.
    await page.goto(`/#/mypreferencesdisplay?userId=${USER_A}`);
    await arrangement.waitFor({ state: 'attached', timeout: 45_000 });
    await expect(arrangement).toHaveValue('ContentPackFirst');
    await chooseArrangement(page, 'OptionBrowseByMediaFamily');
    await page.click('#displayPreferencesPage button[type="submit"]');
    await expect
        .poll(() => fixture.lastConfigurationWrite(), { timeout: 30_000 })
        .toMatchObject({
            ContentPackBrowsingPreference: 'MediaFamilyFirst'
        });

    await openHome(page);
    expect(await navLabels(page)).not.toContain('Content packs');

    // Nothing about the packs themselves was touched by any of it.
    expect(fixture.profile.packs.map((p) => p.Name)).toEqual(['Sport']);
    for (const request of fixture.ledger.requests) {
        expect(request.toLowerCase()).not.toMatch(
            /post \/contentpacks|refresh|scheduledtasks/
        );
    }
});

/**
 * The layout reach matrix for the browsing arrangement (#139 gates 4 and 5).
 *
 * The first version of this branch proved the arrangement on the modern desktop toolbar and nowhere
 * else. That is one of the three shells the application actually ships: `layoutManager` boots
 * `apps/legacy` for `mobile-legacy`, `desktop-legacy` and `tv`, and in those the modern MUI toolbar
 * is never rendered at all. A household on a legacy phone or on a television would have been asked
 * a question in the wizard that it could not afterwards change, and would have seen no effect from
 * having answered it.
 *
 * So the same three claims are made executable per layout, against whatever surface that layout
 * really has:
 *
 * | claim | modern | legacy |
 * | --- | --- | --- |
 * | ordinary setting reachable | the MUI `Select` on Display preferences | the `emby-select` on the same route, rendered by `components/displaySettings` |
 * | preference persists server-side | `POST /Users/{id}/Configuration` | the same endpoint, from the same page |
 * | primary navigation changes | `AppToolbar`'s `UserViewNav` | the nav drawer `libraryMenu` builds |
 *
 * The legacy half deliberately does NOT import the modern toolbar, and no layout is forced into
 * modern to make an assertion pass: each case sets the layout the shell it names actually uses, and
 * asserts that the application agrees it is in that layout before asserting anything else.
 */
import type { Page } from '@playwright/test';

import {
    administrator,
    type FixtureProfile,
    type FixtureUser,
    installFixtureApi,
    type InstalledFixture,
    USER_A
} from './fixtureApi';
import { DIST, expect } from './harness';

export type Shell = 'modern' | 'legacy';

/**
 * Which surface IS the primary navigation in this layout. Three, not two.
 *
 * `AppToolbar` renders `UserViewNav` only when `isDrawerAvailable` is false, and
 * `apps/modern/AppLayout` makes the drawer available on anything narrower than `md`. So a modern
 * phone has no toolbar navigation at all: its primary navigation is `MainDrawerContent`. Treating
 * "modern" as one surface is what let the first version of this branch believe a single toolbar
 * proof covered every modern device.
 */
export type NavSurface = 'modern-toolbar' | 'modern-drawer' | 'legacy-drawer';

export interface LayoutCase {
    /** How the row is named, in test titles and in the emitted matrix. */
    label: string;
    /** What goes into the un-namespaced `layout` key before the application boots. */
    layout: NonNullable<FixtureProfile['layout']>;
    shell: Shell;
    nav: NavSurface;
    /** The `layout-*` class `layoutManager` puts on `<html>` for this case. */
    documentClass: string;
}

export const MODERN_DESKTOP: LayoutCase = {
    label: 'modern desktop',
    layout: 'desktop',
    shell: 'modern',
    nav: 'modern-toolbar',
    documentClass: 'layout-desktop'
};

export const MODERN_MOBILE: LayoutCase = {
    label: 'modern mobile',
    layout: 'mobile',
    shell: 'modern',
    nav: 'modern-drawer',
    documentClass: 'layout-mobile'
};

export const LEGACY_PHONE: LayoutCase = {
    label: 'legacy phone shell',
    layout: 'mobile-legacy',
    shell: 'legacy',
    nav: 'legacy-drawer',
    documentClass: 'layout-mobile'
};

export const LEGACY_TV: LayoutCase = {
    label: 'legacy TV shell',
    layout: 'tv',
    shell: 'legacy',
    nav: 'legacy-drawer',
    documentClass: 'layout-tv'
};

export const MEDIA_FAMILY_FIRST = 'MediaFamilyFirst';
export const CONTENT_PACK_FIRST = 'ContentPackFirst';

/** The visible copy of the two options, which is what a person actually picks. */
const OPTION_LABEL: Record<string, string> = {
    [MEDIA_FAMILY_FIRST]: 'By media type',
    [CONTENT_PACK_FIRST]: 'By content pack'
};

const MODERN_NAV = '.MuiToolbar-root';
/** The modern phone drawer, which `ResponsiveDrawer` keeps mounted even while it is closed. */
const MODERN_DRAWER = '.MuiDrawer-root .MuiListItemText-primary';
/** `libraryMenu` fills exactly this container with the browsing destinations. */
const LEGACY_NAV = '.libraryMenuOptions';

export const signedIn = (
    page: Page,
    baseURL: string,
    layoutCase: LayoutCase,
    configuration: Record<string, unknown>,
    extraUsers: Array<Partial<FixtureUser>> = []
): Promise<InstalledFixture> =>
    installFixtureApi(page, baseURL, DIST, {
        signedIn: true,
        wizardCompleted: true,
        users: [
            administrator({ configuration }),
            ...extraUsers.map((over) => administrator(over))
        ],
        currentUserId: USER_A,
        packs: [{ Id: 'pack-1', Name: 'Sport' }],
        layout: layoutCase.layout
    });

/**
 * The application's own signal that it is in the layout the case names, read before anything else.
 *
 * Without this a legacy assertion could pass while the application had quietly booted modern, and
 * the row would be a claim about the wrong shell.
 */
export async function expectLayout(page: Page, layoutCase: LayoutCase) {
    const observed = await page.evaluate(() => ({
        classes: Array.from(document.documentElement.classList),
        saved: localStorage.getItem('layout')
    }));
    expect(observed.saved, `${layoutCase.label}: stored layout`).toBe(
        layoutCase.layout
    );
    expect(
        observed.classes,
        `${layoutCase.label}: document layout classes are ${observed.classes.join(' ')}`
    ).toContain(layoutCase.documentClass);
}

/** The browsing destinations of this shell's primary navigation, in document order. */
export async function navLabels(
    page: Page,
    layoutCase: LayoutCase
): Promise<string[]> {
    if (layoutCase.nav === 'modern-toolbar') {
        const labels = await page.$$eval(`${MODERN_NAV} a`, (nodes) =>
            nodes
                .map((node) => {
                    // `material-icons` renders its glyph as a LIGATURE, so the icon has to be
                    // removed from a clone rather than matched away.
                    const clone = node.cloneNode(true) as HTMLElement;
                    for (const icon of clone.querySelectorAll(
                        '.MuiButton-icon'
                    ))
                        icon.remove();
                    return clone.textContent?.trim() ?? '';
                })
                .filter(Boolean)
        );
        // The first entry opens the toolbar and carries the server's name: identity, not a
        // browsing destination.
        return labels.slice(1);
    }

    if (layoutCase.nav === 'modern-drawer') {
        const labels = await page.$$eval(MODERN_DRAWER, (nodes) =>
            nodes.map((node) => node.textContent?.trim() ?? '').filter(Boolean)
        );
        /*
         * The first row is `DrawerHeaderLink`, which carries the server's name and version: the
         * product's identity, not a browsing destination, exactly as the toolbar's first entry is.
         * Dropped for the same reason — "packs lead" is a claim about where you can go.
         */
        return labels.slice(1);
    }

    return page.$$eval(`${LEGACY_NAV} a.navMenuOption`, (nodes) =>
        nodes
            .map(
                (node) =>
                    node
                        .querySelector('.navMenuOptionText')
                        ?.textContent?.trim() ?? ''
            )
            .filter(Boolean)
    );
}

/** Whatever this shell renders once its primary navigation has actually resolved. */
const navReady = (layoutCase: LayoutCase) => {
    if (layoutCase.nav === 'modern-toolbar')
        return `${MODERN_NAV} a[href="#/home?tab=1"]`;
    if (layoutCase.nav === 'modern-drawer')
        return '.MuiDrawer-root a[href="#/home?tab=1"]';
    return `${LEGACY_NAV} a.navMenuOption`;
};

export async function openHome(page: Page, layoutCase: LayoutCase) {
    await page.goto('/#/home');
    /*
     * `attached`, not `visible`. The legacy primary navigation is a drawer: it is built, populated
     * and kept in the document, and it is off-screen until the menu button opens it. Waiting for
     * visibility would time out on a drawer that is entirely correct, and opening the drawer to
     * satisfy the wait would test the animation rather than the arrangement.
     */
    await page.waitForSelector(navReady(layoutCase), {
        state: 'attached',
        timeout: 45_000
    });
}

/** The arrangement control on this shell's ordinary display-preferences page. */
export async function openArrangementSetting(
    page: Page,
    layoutCase: LayoutCase
) {
    /*
     * The route reads its subject from `?userId=`. That is the existing contract in both shells —
     * every link into this page carries it — not something M3 introduced.
     */
    await page.goto(`/#/mypreferencesdisplay?userId=${USER_A}`);
    await page.waitForSelector('#displayPreferencesPage', { timeout: 45_000 });
    await page.waitForSelector(arrangementSelector(layoutCase), {
        state: 'attached',
        timeout: 45_000
    });
}

const arrangementSelector = (layoutCase: LayoutCase) =>
    layoutCase.shell === 'modern'
        ? 'input[name="contentPackBrowsingPreference"]'
        : '#selectBrowsingArrangement';

export const readArrangement = (page: Page, layoutCase: LayoutCase) =>
    page.inputValue(arrangementSelector(layoutCase));

/**
 * Pick an arrangement the way a person does.
 *
 * Modern keeps the real value in a hidden input behind a MUI listbox, so the listbox has to be
 * opened and the option clicked; filling the input would bypass the control under test. Legacy
 * renders a real `<select>`, which `selectOption` drives natively — and which is what an
 * `emby-select` is.
 */
export async function chooseArrangement(
    page: Page,
    layoutCase: LayoutCase,
    value: string
) {
    if (layoutCase.shell === 'modern') {
        await page.click('#display-settings-browsing-arrangement-label + div');
        await page.click(
            `li[role="option"]:has-text("${OPTION_LABEL[value]}")`
        );
        return;
    }

    await page.selectOption('#selectBrowsingArrangement', value);
    // `emby-select` does not re-dispatch, so the description binding is driven by the same `change`
    // the native control fires. Nothing here waits on it; this is only the interaction.
}

export const saveSettings = (page: Page) =>
    page.click('#displayPreferencesPage button[type="submit"]');

export interface MatrixRow {
    layout: string;
    settingReachable: boolean;
    persistsServerSide: boolean;
    navigationChanges: boolean;
    /** The navigation labels observed under each arrangement, for the evidence table. */
    mediaFamilyFirst: string[];
    contentPackFirst: string[];
}

/**
 * The three claims, in one pass, against the surfaces this layout really has.
 *
 * Written as one function so a row cannot be half-proved: a layout that reaches the setting but
 * whose navigation never moves fails here rather than quietly reporting two green cells.
 */
export async function proveArrangementReach(
    page: Page,
    baseURL: string,
    layoutCase: LayoutCase
): Promise<MatrixRow> {
    const fixture = await signedIn(page, baseURL, layoutCase, {
        PlayDefaultAudioTrack: true,
        SubtitleMode: 'Smart',
        AudioLanguagePreference: 'fra'
    });

    await openHome(page, layoutCase);
    await expectLayout(page, layoutCase);

    // --- media-family-first is what an installation that was never asked already has ------------
    const mediaFamilyFirst = await navLabels(page, layoutCase);
    expect(
        mediaFamilyFirst,
        `${layoutCase.label}: media families are missing from the resting arrangement`
    ).toContain('Movies');
    expect(mediaFamilyFirst).toContain('Music');
    /*
     * Not "packs are absent" — "packs do not lead".
     *
     * The modern drawer has carried a content-pack destination since M2 (#138), deliberately,
     * alongside the existing structure. M3 does not remove it; it decides where it sits. So the
     * claim that distinguishes the two arrangements is about position, and it is the same claim on
     * every surface: the legacy drawer and the modern toolbar have no packs entry at all under
     * media-family-first, which also is not leading.
     */
    expect(
        mediaFamilyFirst[0],
        `${layoutCase.label}: packs already lead before anything was chosen`
    ).not.toBe('Content packs');

    // --- claim 1: the ordinary setting is reachable, and starts on the resolved value -----------
    await openArrangementSetting(page, layoutCase);
    expect(
        await readArrangement(page, layoutCase),
        `${layoutCase.label}: the control did not start on the resolved default`
    ).toBe(MEDIA_FAMILY_FIRST);

    // --- claim 2: choosing writes it to the server, and loses nothing else ---------------------
    await chooseArrangement(page, layoutCase, CONTENT_PACK_FIRST);
    await saveSettings(page);
    await expect
        .poll(() => fixture.lastConfigurationWrite(), { timeout: 30_000 })
        .toMatchObject({
            ContentPackBrowsingPreference: CONTENT_PACK_FIRST,
            SubtitleMode: 'Smart',
            AudioLanguagePreference: 'fra',
            PlayDefaultAudioTrack: true
        });

    /*
     * And nowhere else. The arrangement is server-owned: a browser-local copy would follow the
     * device rather than the person, and two people sharing a television would overwrite each
     * other. This reads both storages in full rather than probing a key name, so a copy under any
     * name is caught.
     */
    const stored = await page.evaluate(() => {
        const dump = (storage: Storage) =>
            Object.keys(storage)
                .map((key) => `${key}=${storage.getItem(key) ?? ''}`)
                .join('\n');
        return `${dump(localStorage)}\n${dump(sessionStorage)}`;
    });
    expect(
        stored.includes(CONTENT_PACK_FIRST),
        `${layoutCase.label}: the arrangement was copied into browser storage`
    ).toBe(false);

    // --- claim 3: the primary navigation of THIS shell changes ---------------------------------
    await openHome(page, layoutCase);
    const contentPackFirst = await navLabels(page, layoutCase);
    expect(
        contentPackFirst[0],
        `${layoutCase.label}: packs do not lead — ${contentPackFirst.join(' | ')}`
    ).toBe('Content packs');
    // Nothing is hidden, and the media families keep their existing relative order.
    expect(contentPackFirst).toContain('Movies');
    expect(contentPackFirst).toContain('Music');
    expect(contentPackFirst.indexOf('Movies')).toBeLessThan(
        contentPackFirst.indexOf('Music')
    );
    expect(contentPackFirst).not.toEqual(mediaFamilyFirst);

    // --- and back again, which is the direction a one-way binding gets wrong -------------------
    await openArrangementSetting(page, layoutCase);
    expect(await readArrangement(page, layoutCase)).toBe(CONTENT_PACK_FIRST);
    await chooseArrangement(page, layoutCase, MEDIA_FAMILY_FIRST);
    await saveSettings(page);
    await expect
        .poll(() => fixture.lastConfigurationWrite(), { timeout: 30_000 })
        .toMatchObject({ ContentPackBrowsingPreference: MEDIA_FAMILY_FIRST });

    await openHome(page, layoutCase);
    const backAgain = await navLabels(page, layoutCase);
    expect(
        backAgain[0],
        `${layoutCase.label}: packs still lead after choosing media families — ${backAgain.join(' | ')}`
    ).not.toBe('Content packs');
    // Exactly what it was before anything was chosen — the round trip loses nothing.
    expect(backAgain).toEqual(mediaFamilyFirst);

    /*
     * Switching the arrangement is a presentation choice and nothing else: no scan, no migration,
     * no classification, no membership write, and the pack the household already had is untouched.
     */
    expect(fixture.profile.packs.map((p) => p.Name)).toEqual(['Sport']);
    expect(fixture.createdPackNames()).toEqual([]);
    for (const request of fixture.ledger.requests) {
        expect(
            request.toLowerCase(),
            `${layoutCase.label}: an unexpected write was issued`
        ).not.toMatch(
            /post \/contentpacks|\/refresh|scheduledtasks|\/library\/(refresh|virtualfolders)|providers|memberships/
        );
    }

    return {
        layout: layoutCase.label,
        settingReachable: true,
        persistsServerSide: true,
        navigationChanges: true,
        mediaFamilyFirst,
        contentPackFirst
    };
}

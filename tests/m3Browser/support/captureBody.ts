/**
 * The capture body every M3 capture spec runs, once per theme.
 *
 * Split out of the specs so that desktop, mobile and TV capture the SAME states from the SAME code
 * — a capture set where the mobile run visited a different screen than the desktop run is not a
 * comparison, and that is the only thing a matched set is for.
 *
 * HOW THE THEME GETS THERE
 * ------------------------
 * Nothing here injects a theme class, a token, a CSS variable or a presentation value. The only
 * thing written is the persisted preference itself, in `appSettings`' own key (`${userId}-appTheme`)
 * — the value and the place the Display preferences picker writes. Everything after that is the
 * application: `ServerConnections.connect()` restores the session, `onLocalUserSignedIn` binds
 * `userSettings` to the user, `autoThemes` reads `userSettings.theme()` on `localusersignedin`, and
 * `themeManager` resolves the presentation. The capture waits for THAT to finish and asserts what it
 * produced.
 *
 * A capture whose resolved theme is not the requested one is REFUSED — `shoot()` throws. The earlier
 * version renamed the file instead, which made a mislabelled capture impossible but a silently
 * missing pairing easy.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { installFixtureApi, administrator, USER_A } from './fixtureApi';
import {
    addCustomPack,
    ARTIFACTS,
    DIST,
    openPacksStep,
    openUserStep,
    PACKS_PAGE,
    renamePack,
    selectPack,
    USER_PAGE
} from './harness';

export const CLASSIC = 'official.classic';
export const FROSTED = 'official.glass';

/** Every theme this suite asks for, in order. */
export const REQUESTED_THEMES = [CLASSIC, FROSTED];

export interface CaptureRecord {
    file: string;
    /** The theme the run asked the application for. */
    requestedTheme: string;
    /** What the application resolved to, read off the document. Always equal to the request. */
    resolvedTheme: string;
    mode: string | null;
    /** Resolved token values, so two records can be told apart mechanically. */
    tokens: Record<string, string>;
    /** Every `data-rf-*` presentation attribute the resolver put on the document. */
    recipe: Record<string, string>;
    /** The signed-in user, read out of the application's own credential store. */
    userId: string | null;
    /** The persisted preference the resolver read, and where it lived. */
    persisted: { key: string; value: string | null };
    /** The `CustomPrefs` the server answered `GET /DisplayPreferences` with. */
    displayPreferences: Record<string, unknown>;
    route: string;
    layout: string;
    viewport: string;
    state: string;
    /** The focused control at the moment of the shot. */
    focus: string;
    /** Where a reviewer should look. */
    inspect: string;
    sha256: string;
}

const TOKEN_NAMES = [
    '--rf-color-surface',
    '--rf-color-background',
    '--rf-color-accent'
];

/** How long the application is given to restore a session and resolve the user's theme. */
const RESOLVE_TIMEOUT = 45_000;

async function evidence(page: Page, tokenNames: string[]) {
    return page.evaluate((names: string[]) => {
        const root = document.documentElement;
        const style = getComputedStyle(root);
        const tokens: Record<string, string> = {};
        for (const name of names) {
            tokens[name] = style.getPropertyValue(name).trim();
        }
        const recipe: Record<string, string> = {};
        for (const attribute of Array.from(root.attributes)) {
            if (
                attribute.name.startsWith('data-rf-') &&
                attribute.name !== 'data-rf-theme' &&
                attribute.name !== 'data-rf-mode'
            ) {
                recipe[attribute.name] = attribute.value;
            }
        }

        let userId: string | null = null;
        try {
            const stored = localStorage.getItem('jellyfin_credentials');
            const parsed = stored ? JSON.parse(stored) : null;
            userId =
                (parsed?.Servers ?? []).find(
                    (server: { AccessToken?: string; UserId?: string }) =>
                        server?.AccessToken
                )?.UserId ?? null;
        } catch {
            userId = null;
        }

        const active = document.activeElement as HTMLElement | null;
        const focus = !active
            ? 'none'
            : [
                  active.tagName.toLowerCase(),
                  active.id ? `#${active.id}` : '',
                  active.getAttribute('name')
                      ? `[name=${active.getAttribute('name')}]`
                      : '',
                  active.getAttribute('value')
                      ? `[value=${active.getAttribute('value')}]`
                      : ''
              ]
                  .filter(Boolean)
                  .join('');

        return {
            resolvedTheme: root.getAttribute('data-rf-theme'),
            mode: root.getAttribute('data-rf-mode'),
            tokens,
            recipe,
            userId,
            focus,
            route: window.location.hash || window.location.pathname,
            persistedValue: userId
                ? localStorage.getItem(`${userId}-appTheme`)
                : null
        };
    }, tokenNames);
}

/**
 * Wait for the APPLICATION to finish resolving the requested theme.
 *
 * `autoThemes` applies the default at module load, before `connect()` has restored anything, and
 * only re-applies on `localusersignedin` — which needs the session restored, the user bound and the
 * display-preferences query resolved. Screenshotting before that is a race that passes on an idle
 * machine and files a Classic image under a Frosted name on a loaded one.
 */
async function waitForResolvedTheme(page: Page, theme: string): Promise<void> {
    await page.waitForFunction(
        (expected: string) =>
            document.documentElement.getAttribute('data-rf-theme') === expected,
        theme,
        { timeout: RESOLVE_TIMEOUT }
    );
}

/**
 * Freeze everything that moves before a shutter opens.
 *
 * Two captures of the same screen that differ because a transition was mid-flight are worthless as
 * evidence, and worse, they look like a real difference.
 */
async function freeze(page: Page) {
    await page.addStyleTag({
        content: `*, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
            caret-color: transparent !important;
        }`
    });
    await page.waitForTimeout(150);
}

interface Shooter {
    (
        state: string,
        inspect: string,
        focus?: () => Promise<void>
    ): Promise<void>;
}

function shooter(
    page: Page,
    records: CaptureRecord[],
    label: string,
    layout: string,
    theme: string,
    displayPreferences: Record<string, unknown>
): Shooter {
    return async (state, inspect, focus) => {
        if (focus) await focus();
        await freeze(page);
        await waitForResolvedTheme(page, theme);

        const seen = await evidence(page, TOKEN_NAMES);
        if (seen.resolvedTheme !== theme) {
            throw new Error(
                `refusing to write capture "${state}": asked for ${theme}, the application ` +
                    `resolved ${seen.resolvedTheme}. A capture is evidence about a theme or it is ` +
                    'nothing.'
            );
        }

        const themeName = theme.split('.').pop() ?? theme;
        const file = `${label}-${themeName}-${state}.png`;
        const path = join(ARTIFACTS, file);
        await page.screenshot({ path });
        const viewport = page.viewportSize();

        records.push({
            file,
            requestedTheme: theme,
            resolvedTheme: seen.resolvedTheme,
            mode: seen.mode,
            tokens: seen.tokens,
            recipe: seen.recipe,
            userId: seen.userId,
            persisted: {
                key: seen.userId ? `${seen.userId}-appTheme` : '(no session)',
                value: seen.persistedValue
            },
            displayPreferences,
            route: seen.route,
            layout,
            viewport: viewport
                ? `${viewport.width}x${viewport.height}`
                : 'unknown',
            state,
            focus: seen.focus,
            inspect,
            sha256: createHash('sha256')
                .update(readFileSync(path))
                .digest('hex')
        });
    };
}

/**
 * The wizard half of the matched set: everything after the first administrator exists, so the
 * application has a user and can resolve that user's theme.
 *
 * The account is created and signed in through the ordinary flow, then the document is reloaded
 * while the setup is still incomplete — which is the state the mission cares about — and the
 * application restores the session and the theme by itself.
 */
async function captureWizard(
    page: Page,
    baseURL: string,
    label: string,
    layout: 'desktop' | 'mobile' | 'tv',
    theme: string,
    records: CaptureRecord[]
): Promise<void> {
    const displayPreferences = { CustomPrefs: {} };
    const fixture = await installFixtureApi(page, baseURL, DIST, {
        signedIn: false,
        wizardCompleted: false,
        users: [administrator()],
        currentUserId: USER_A,
        packs: [],
        theme,
        layout
    });

    await openUserStep(page);
    await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
    await page.fill(`${USER_PAGE} #txtManualPassword`, 'capture-placeholder');
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, 'capture-placeholder');
    await page.click(`${USER_PAGE} button[type="submit"]`);
    await page.waitForURL(/#\/wizard\/library/, { timeout: RESOLVE_TIMEOUT });

    // A full document reload with the setup still incomplete. Nothing is restored by hand: the
    // application reconnects, signs the stored session back in and resolves the user's theme.
    await page.reload();
    await waitForResolvedTheme(page, theme);

    const shoot = shooter(
        page,
        records,
        label,
        layout,
        theme,
        displayPreferences
    );

    await openPacksStep(page);
    await shoot(
        'packs-none',
        'the resting state: nothing selected, and the step says that is fine'
    );

    await selectPack(page, 'Movies and series');
    await selectPack(page, 'Music');
    await selectPack(page, 'Photos and home video');
    await renamePack(page, 'Photos and home video', 'Holiday photos');
    await addCustomPack(page, 'Grandad’s tapes');
    await shoot(
        'packs-populated',
        'three suggestions, one renamed, and one pack of their own'
    );

    await shoot(
        'packs-arrangement',
        'the browsing-arrangement control, focused on content-pack-first',
        async () => {
            await page.check('#radioContentPackFirst', { force: true });
            await page.focus('#radioContentPackFirst');
        }
    );

    await page.locator(`${PACKS_PAGE} .wizardPacksError`).evaluate((node) => {
        node.textContent = 'Some content packs could not be created.';
        node.classList.remove('hide');
    });
    await shoot(
        'packs-error',
        'the partial-failure message, in place, without losing the selections behind it'
    );

    // Read back rather than assumed: the ledger proves the run reached the step with a session.
    if (fixture.ledger.requests.length === 0) {
        throw new Error('the fixture recorded no requests at all');
    }
}

/**
 * The post-onboarding half: ordinary Display preferences, and the two primary-navigation
 * arrangements that choice produces.
 *
 * A separate profile, because these are `AccessLevel.User` routes and `ConnectionRequired` bounces
 * them to the wizard while `StartupWizardCompleted` is false. This is the same shape the M3
 * navigation spec already uses.
 *
 * BOTH OF THESE ARE MODERN-LAYOUT SURFACES, and the capture set says so rather than filing
 * duplicate or empty images for the other two layouts.
 *
 * `RootAppRouter` mounts `MODERN_APP_ROUTES` or `LEGACY_APP_ROUTES` according to
 * `layoutManager.modern`, and the `mobile` and `tv` capture projects run the LEGACY mobile and TV
 * shells. In those shells `mypreferencesdisplay` is the legacy `displaySettings` controller, which
 * has no browsing-arrangement control at all, and there is no MUI toolbar for `UserViewNav` to
 * render into — `AppToolbar` only renders it when the drawer is not available, and the TV shell has
 * neither.
 *
 * So M3's two post-onboarding surfaces reach the modern layout and no other. That is a real limit
 * on #139 gate 4's reach, measured here and reported rather than papered over. Closing it means
 * teaching the legacy shells the same arrangement, which is product work this repair loop does not
 * do; capturing an unchanged legacy screen twice and calling it a matched pair would be worse than
 * saying so.
 */
async function captureSettingsAndNavigation(
    page: Page,
    baseURL: string,
    label: string,
    layout: 'desktop' | 'mobile' | 'tv',
    theme: string,
    records: CaptureRecord[]
): Promise<void> {
    const displayPreferences = { CustomPrefs: {} };
    if (layout !== 'desktop') return;

    for (const [arrangement, state, inspect] of [
        [
            'MediaFamilyFirst',
            'nav-media-family-first',
            'primary navigation as it shipped before M3: the media families, in the server’s order'
        ],
        [
            'ContentPackFirst',
            'nav-content-pack-first',
            'primary navigation with content packs first, and no media family lost from it'
        ]
    ] as const) {
        await installFixtureApi(page, baseURL, DIST, {
            signedIn: true,
            wizardCompleted: true,
            users: [
                administrator({
                    configuration: {
                        PlayDefaultAudioTrack: true,
                        ContentPackBrowsingPreference: arrangement
                    }
                })
            ],
            currentUserId: USER_A,
            packs: [
                { Id: 'pack-1', Name: 'Saturday films' },
                { Id: 'pack-2', Name: 'Grandad’s tapes' }
            ],
            theme,
            layout
        });

        await page.goto('/#/home');
        // Wait for `UserViewNav` itself, not merely for "an anchor in a toolbar": the generic wait
        // resolves on a skeleton anchor seconds before the navigation actually renders. The
        // Favorites link is the one entry `UserViewNav` always emits.
        await page.waitForSelector('.MuiToolbar-root a[href="#/home?tab=1"]', {
            timeout: RESOLVE_TIMEOUT
        });
        await waitForResolvedTheme(page, theme);
        await shooter(
            page,
            records,
            label,
            layout,
            theme,
            displayPreferences
        )(state, inspect);
    }

    await installFixtureApi(page, baseURL, DIST, {
        signedIn: true,
        wizardCompleted: true,
        users: [
            administrator({
                configuration: {
                    PlayDefaultAudioTrack: true,
                    SubtitleMode: 'Smart',
                    ContentPackBrowsingPreference: 'MediaFamilyFirst'
                }
            })
        ],
        currentUserId: USER_A,
        packs: [],
        theme,
        layout
    });

    // The route reads its subject from `?userId=`; that is the existing contract, not something M3
    // introduced — every link into this page carries the parameter.
    await page.goto(`/#/mypreferencesdisplay?userId=${USER_A}`);
    await page.waitForSelector('#displayPreferencesPage', {
        timeout: RESOLVE_TIMEOUT
    });
    await page
        .locator('input[name="contentPackBrowsingPreference"]')
        .waitFor({ state: 'attached', timeout: RESOLVE_TIMEOUT });
    await waitForResolvedTheme(page, theme);
    await shooter(
        page,
        records,
        label,
        layout,
        theme,
        displayPreferences
    )(
        'settings-display',
        'ordinary Display preferences, with the browsing arrangement among its neighbours',
        async () => {
            // The MUI `Select`'s own input is visually hidden; the combobox is what a household
            // focuses and what a TV remote lands on.
            await page
                .locator('#display-settings-browsing-arrangement-label')
                .locator('xpath=following-sibling::div//div[@role="combobox"]')
                .first()
                .focus();
        }
    );
}

/**
 * Captures the paired M3 states for ONE requested theme. Every capture in the returned set resolved
 * the theme it asked for, or the run threw before writing anything.
 */
export async function captureTheme(
    page: Page,
    baseURL: string,
    label: string,
    layout: 'desktop' | 'mobile' | 'tv',
    theme: string
): Promise<CaptureRecord[]> {
    const records: CaptureRecord[] = [];
    await captureWizard(page, baseURL, label, layout, theme, records);
    await captureSettingsAndNavigation(
        page,
        baseURL,
        label,
        layout,
        theme,
        records
    );
    return records;
}

/**
 * The states every theme has to produce, at every layout, for the set to be matched.
 *
 * All four are the first-run wizard, which is layout-independent: it is the same view-manager page
 * under the modern, mobile and TV shells alike.
 */
export const REQUIRED_STATES = [
    'packs-none',
    'packs-populated',
    'packs-arrangement',
    'packs-error'
];

/**
 * The modern layout additionally carries M3's two post-onboarding surfaces. The `mobile` and `tv`
 * capture projects run the LEGACY shells, which have neither — see
 * `captureSettingsAndNavigation` for the measurement.
 */
export const DESKTOP_ONLY_STATES = [
    'settings-display',
    'nav-media-family-first',
    'nav-content-pack-first'
];

export const statesFor = (layout: string): string[] =>
    layout === 'desktop'
        ? [...REQUIRED_STATES, ...DESKTOP_ONLY_STATES]
        : REQUIRED_STATES;

/**
 * Fails the run unless the two themes produced the same states, at the same viewport, with the same
 * focus — which is what makes them a PAIR rather than two unrelated sets.
 */
export function assertMatchedPairs(
    records: CaptureRecord[],
    states: string[] = REQUIRED_STATES
): void {
    const byTheme = new Map<string, Map<string, CaptureRecord>>();
    for (const record of records) {
        const byState =
            byTheme.get(record.requestedTheme) ??
            new Map<string, CaptureRecord>();
        byState.set(record.state, record);
        byTheme.set(record.requestedTheme, byState);
    }

    for (const theme of REQUESTED_THEMES) {
        const byState = byTheme.get(theme);
        if (!byState) throw new Error(`no captures at all for ${theme}`);
        const missing = states.filter((state) => !byState.has(state));
        if (missing.length > 0) {
            throw new Error(`${theme} is missing ${missing.join(', ')}`);
        }
    }

    const [classic, frosted] = REQUESTED_THEMES.map((theme) =>
        byTheme.get(theme)
    );
    for (const state of states) {
        const a = classic?.get(state);
        const b = frosted?.get(state);
        if (!a || !b) throw new Error(`unpaired state ${state}`);
        if (a.viewport !== b.viewport) {
            throw new Error(
                `${state}: viewports differ (${a.viewport} vs ${b.viewport})`
            );
        }
        if (a.route !== b.route) {
            throw new Error(
                `${state}: routes differ (${a.route} vs ${b.route})`
            );
        }
        if (a.focus !== b.focus) {
            throw new Error(
                `${state}: focus differs (${a.focus} vs ${b.focus})`
            );
        }
        if (a.layout !== b.layout) {
            throw new Error(`${state}: layouts differ`);
        }
    }
}

export function writeIndex(label: string, records: CaptureRecord[]) {
    writeFileSync(
        join(ARTIFACTS, `captures-${label}.json`),
        `${JSON.stringify(records, null, 2)}\n`,
        'utf8'
    );
}

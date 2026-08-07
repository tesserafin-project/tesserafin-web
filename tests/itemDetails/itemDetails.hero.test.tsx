/**
 * #129 Step 2, Phase 6: the artwork treatment is a LAYOUT choice and nothing else.
 *
 * `hero` is the only scalar in the Item Details recipe, and it is the one a theme could most
 * easily abuse — an artwork treatment that decided which images to fetch would be a theme
 * controlling requests, and one that overruled the reader's own backdrop setting would be a theme
 * overruling a person.
 *
 * So the precedence chain is asserted end to end, against real artwork states rather than against
 * the fixtures' empty `ImageTags`:
 *
 *   1. the ITEM decides eligibility — `Person` and `Book` never get a backdrop, under any value;
 *   2. the READER decides next — `detailsBanner()` off means no backdrop, under any value;
 *   3. the THEME chooses among what is left.
 *
 * And under all three values, for every artwork state: the poster is rendered, the same image URLs
 * are built, and no API member is touched that the platform default did not touch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ITEM_DETAILS_HEROES } from '../../src/themes/platform/contract';
import { unmountAll } from './support/modernHarness';

vi.setConfig({ testTimeout: 120_000 });
vi.stubGlobal('__WEBPACK_SERVE__', false);
vi.mock('webcomponents.js/webcomponents-lite', () => ({}));

vi.mock('../../src/lib/globalize', () => {
    const translate = (key: string, ...args: unknown[]) =>
        args.length ? [key, ...args].join(' ') : key;
    const api = {
        translate,
        translateHtml: (html: string) => html,
        loadStrings: () => Promise.resolve(),
        defaultModule: () => 'core',
        getCurrentLocale: () => 'en-us',
        getCurrentDateTimeLocale: () => 'en-us',
        getDefaultLanguage: () => 'en-us',
        register: () => undefined,
        updateCurrentCulture: () => undefined,
        getIsRTL: () => false,
        getIsElementRTL: () => false,
        normalizeLocaleName: (culture: string) => culture
    };
    return { ...api, FALLBACK_CULTURE: 'en-us', default: api };
});

/** The reader's own artwork preference, made switchable. Defaults ON, exactly as the real one. */
const banner = { enabled: true };
vi.mock('../../src/scripts/settings/userSettings', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('../../src/scripts/settings/userSettings')
        >();
    return { ...actual, detailsBanner: () => banner.enabled };
});

vi.mock('../../src/lib/jellyfin-apiclient', async () => {
    const { serverConnections } = await import('./support/ledgerHarness');
    return {
        ServerConnections: serverConnections,
        ConnectionState: { SignedIn: 'SignedIn' },
        ConnectionMode: { Local: 0, Remote: 1, Manual: 2 }
    };
});
vi.mock('../../src/lib/jellyfin-apiclient/ServerConnections', async () => {
    const { serverConnections } = await import('./support/ledgerHarness');
    return { default: serverConnections };
});
vi.mock('@jellyfin/sdk/lib/utils/api/library-api', async () => {
    const { libraryApiRef } = await import('./support/ledgerHarness');
    return { getLibraryApi: () => libraryApiRef.current };
});
vi.mock('@jellyfin/sdk/lib/utils/api/user-data-api', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { getUserDataApi: () => services.userDataApi };
});
vi.mock('../../src/hooks/useApi', () => ({
    useApi: () => ({ api: { axiosInstance: {} }, user: { Id: 'user-1' } })
}));
vi.mock('../../src/components/playback/playbackmanager', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { playbackManager: services.playbackManager };
});
vi.mock('../../src/components/itemContextMenu', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.itemContextMenu };
});
vi.mock('../../src/components/confirm/confirm', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.confirm };
});
vi.mock('../../src/scripts/fileDownloader', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { download: services.download };
});
vi.mock('../../src/utils/dashboard', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.dashboard };
});
vi.mock('../../src/components/recordingcreator/recordinghelper', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.recordingHelper };
});
vi.mock('../../src/components/router/appRouter', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { appRouter: services.appRouter };
});
vi.mock('../../src/utils/events', async () => {
    const { services } = await import('./support/ledgerHarness');
    return { default: services.events };
});
vi.mock('../../src/scripts/libraryMenu', () => ({
    default: { setTitle: vi.fn(), setTransparentMenu: vi.fn() }
}));
vi.mock('../../src/components/loading/loading', () => ({
    default: { show: vi.fn(), hide: vi.fn() }
}));
vi.mock('../../src/components/backdrop/backdrop', () => ({
    setBackdrops: vi.fn(),
    clearBackdrop: vi.fn(),
    setBackdropTransparency: vi.fn()
}));

const { mountForLedger, observationsOf, resetServiceLedger } = await import(
    './support/ledgerHarness'
);

/** The artwork states Phase 6 requires, as DTO overrides on an existing class. */
const ARTWORK_STATES = [
    {
        id: 'poster, logo and backdrop',
        override: {
            ImageTags: { Primary: 'p1', Logo: 'l1' },
            BackdropImageTags: ['b1']
        },
        poster: true,
        logo: true
    },
    {
        id: 'poster only',
        override: { ImageTags: { Primary: 'p1' }, BackdropImageTags: [] },
        poster: true,
        logo: false
    },
    {
        id: 'no backdrop',
        override: {
            ImageTags: { Primary: 'p1', Logo: 'l1' },
            BackdropImageTags: []
        },
        poster: true,
        logo: true
    },
    {
        id: 'no logo',
        override: { ImageTags: { Primary: 'p1' }, BackdropImageTags: ['b1'] },
        poster: true,
        logo: false
    },
    {
        id: 'no artwork at all',
        override: { ImageTags: {}, BackdropImageTags: [] },
        poster: false,
        logo: false
    }
];

const recipe = (hero: string) => ({
    page: { itemDetails: { hero: hero as 'backdrop' } }
});

const backdropOf = (root: HTMLElement) =>
    root.querySelector('[data-detail-backdrop]');
const posterOf = (root: HTMLElement) =>
    root.querySelector('[data-detail-image="poster"]');
const logoOf = (root: HTMLElement) =>
    root.querySelector('[data-detail-image="logo"]');

const imageCallsOf = (api: { calls: { method: string; args: unknown[] }[] }) =>
    api.calls
        .filter((call) => call.method === 'getScaledImageUrl')
        .map((call) => JSON.stringify(call.args))
        .sort();

afterEach(() => {
    unmountAll();
    banner.enabled = true;
});
beforeEach(() => {
    document.body.innerHTML = '';
    banner.enabled = true;
    resetServiceLedger();
    vi.clearAllMocks();
});

describe('the poster is rendered under every treatment and every artwork state', () => {
    for (const state of ARTWORK_STATES) {
        for (const hero of ITEM_DETAILS_HEROES) {
            it(`${state.id} / hero=${hero}`, async () => {
                const mounted = await mountForLedger('movie', {
                    itemOverride: state.override,
                    presentation: recipe(hero)
                });

                // `MUST PRESERVE` #9: the ELEMENT, always. An item with no primary image gets the
                // frame and a placeholder, which is what keeps the layout stable.
                const poster = posterOf(mounted.container);
                expect(poster).not.toBeNull();
                expect(
                    Boolean(
                        poster?.querySelector('.rf-item-details__poster-image')
                    )
                ).toBe(state.poster);
                expect(
                    Boolean(
                        poster?.querySelector(
                            '.rf-item-details__poster-placeholder'
                        )
                    )
                ).toBe(!state.poster);
            });
        }
    }
});

describe('the treatment changes layout, never which images are built', () => {
    for (const state of ARTWORK_STATES) {
        it(`${state.id} builds the same image URLs under all three treatments`, async () => {
            const built: Record<string, string[]> = {};

            for (const hero of ITEM_DETAILS_HEROES) {
                const mounted = await mountForLedger('movie', {
                    itemOverride: state.override,
                    presentation: recipe(hero)
                });
                built[hero] = imageCallsOf(mounted.api);
                unmountAll();
            }

            expect(built.poster).toEqual(built.backdrop);
            expect(built.minimal).toEqual(built.backdrop);
        });
    }

    it('and no treatment touches an API member the default did not', async () => {
        const members: Record<string, string[]> = {};

        for (const hero of ITEM_DETAILS_HEROES) {
            const mounted = await mountForLedger('movie', {
                itemOverride: ARTWORK_STATES[0].override,
                presentation: recipe(hero)
            });
            members[hero] = [
                ...new Set(
                    observationsOf(mounted.api).map(
                        (observation) =>
                            `${observation.surface}.${observation.member}`
                    )
                )
            ].sort();
            unmountAll();
        }

        expect(members.poster).toEqual(members.backdrop);
        expect(members.minimal).toEqual(members.backdrop);
    });
});

describe('the backdrop layer follows the precedence chain', () => {
    it('renders only under the backdrop treatment', async () => {
        for (const hero of ITEM_DETAILS_HEROES) {
            const mounted = await mountForLedger('movie', {
                itemOverride: ARTWORK_STATES[0].override,
                presentation: recipe(hero)
            });
            expect(Boolean(backdropOf(mounted.container)), hero).toBe(
                hero === 'backdrop'
            );
            unmountAll();
        }
    });

    it.each(['person', 'book'])(
        'never appears for a %s, whatever the theme asks for',
        async (classId) => {
            for (const hero of ITEM_DETAILS_HEROES) {
                const mounted = await mountForLedger(classId, {
                    /*
                     * Backdrop tags only. Adding a `Primary` tag would make the poster build a
                     * URL, and neither class DECLARES `getScaledImageUrl` in the P5 read
                     * inventory — the fail-closed proxy would refuse it, which is the inventory
                     * doing its job rather than a hero defect. What matters here is that the item
                     * offers a backdrop and still never gets one.
                     */
                    itemOverride: { BackdropImageTags: ['b1'] },
                    presentation: recipe(hero)
                });
                expect(
                    backdropOf(mounted.container),
                    `${classId} / ${hero}`
                ).toBeNull();
                // And the poster is still there — degrading the decoration never costs the item.
                expect(posterOf(mounted.container)).not.toBeNull();
                unmountAll();
            }
        }
    );

    it('the reader outranks the theme', async () => {
        banner.enabled = false;
        const mounted = await mountForLedger('movie', {
            itemOverride: ARTWORK_STATES[0].override,
            // The theme asks for a backdrop as loudly as it can.
            presentation: recipe('backdrop')
        });
        expect(backdropOf(mounted.container)).toBeNull();
        expect(posterOf(mounted.container)).not.toBeNull();
    });

    it('and turning the reader setting back on restores it', async () => {
        banner.enabled = true;
        const mounted = await mountForLedger('movie', {
            itemOverride: ARTWORK_STATES[0].override,
            presentation: recipe('backdrop')
        });
        expect(backdropOf(mounted.container)).not.toBeNull();
    });

    it('degrades to nothing drawn when the item declares no backdrop image', async () => {
        const mounted = await mountForLedger('movie', {
            itemOverride: ARTWORK_STATES[2].override,
            presentation: recipe('backdrop')
        });

        /*
         * The layer is PRESENT and EMPTY, which is the pre-binding behaviour and is deliberately
         * left alone: every one of the 24 fixture items carries `ImageTags: {}`, so
         * `pre-binding-composition.json` records `backdropElement: 1, backdropImage: false` for
         * all of them, and `itemDetails.characterization.test.tsx` asserts a backdrop element for
         * the types that may have one. Removing it here would be a composition change smuggled in
         * under a theming binding.
         *
         * "Degrades safely" is therefore about what is DRAWN: no `background-image`, so the band
         * is fully transparent, it is masked to nothing, and it is `aria-hidden`. There is no
         * empty grey shelf and nothing reaches the accessibility tree.
         */
        const backdrop = backdropOf(mounted.container) as HTMLElement;
        expect(backdrop).not.toBeNull();
        expect(backdrop.style.backgroundImage).toBe('');
        expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    });
});

describe('the logotype', () => {
    it('is rendered under backdrop and poster, and dropped under minimal', async () => {
        for (const hero of ITEM_DETAILS_HEROES) {
            const mounted = await mountForLedger('movie', {
                itemOverride: ARTWORK_STATES[0].override,
                presentation: recipe(hero)
            });
            expect(Boolean(logoOf(mounted.container)), hero).toBe(
                hero !== 'minimal'
            );
            unmountAll();
        }
    });

    it('is absent when the item declares none, under every treatment', async () => {
        for (const hero of ITEM_DETAILS_HEROES) {
            const mounted = await mountForLedger('movie', {
                itemOverride: ARTWORK_STATES[1].override,
                presentation: recipe(hero)
            });
            expect(logoOf(mounted.container), hero).toBeNull();
            unmountAll();
        }
    });
});

describe('the treatment does not touch composition, actions or naming', () => {
    it('renders the same sections and the same actions under all three', async () => {
        const seen: Record<string, { sections: string[]; actions: string[] }> =
            {};

        for (const hero of ITEM_DETAILS_HEROES) {
            const mounted = await mountForLedger('movie', {
                itemOverride: ARTWORK_STATES[0].override,
                presentation: recipe(hero)
            });
            seen[hero] = {
                sections: [
                    ...mounted.container.querySelectorAll(
                        '[data-detail-section]'
                    )
                ].map(
                    (element) =>
                        element.getAttribute('data-detail-section') ?? ''
                ),
                actions: [
                    ...mounted.container.querySelectorAll(
                        '[data-detail-action]'
                    )
                ].map(
                    (element) =>
                        element.getAttribute('data-detail-action') ?? ''
                )
            };
            unmountAll();
        }

        expect(seen.poster).toEqual(seen.backdrop);
        expect(seen.minimal).toEqual(seen.backdrop);
    });

    it('keeps the decorative artwork out of the accessibility tree', async () => {
        const mounted = await mountForLedger('movie', {
            itemOverride: ARTWORK_STATES[0].override,
            presentation: recipe('backdrop')
        });

        // A backdrop and a logotype are decoration; the item's name is the accessible name.
        expect(backdropOf(mounted.container)?.getAttribute('aria-hidden')).toBe(
            'true'
        );
        expect(logoOf(mounted.container)?.getAttribute('alt')).toBe('');
        expect(
            mounted.container
                .querySelector('[data-detail-image="poster"] img')
                ?.getAttribute('alt')
        ).toBe('');
        expect(
            mounted.container.querySelector(
                '[data-detail-section="nameContainer"] h1'
            )?.textContent
        ).toBeTruthy();
    });

    it('keeps the focusable order identical under all three treatments', async () => {
        const orders: Record<string, string[]> = {};

        for (const hero of ITEM_DETAILS_HEROES) {
            const mounted = await mountForLedger('movie', {
                itemOverride: ARTWORK_STATES[0].override,
                presentation: recipe(hero)
            });
            orders[hero] = [
                ...mounted.container.querySelectorAll(
                    'a[href], button, select, [tabindex]:not([tabindex="-1"])'
                )
            ].map(
                (element) =>
                    element.getAttribute('data-detail-action') ??
                    element.getAttribute('data-detail-select') ??
                    element.tagName.toLowerCase()
            );
            unmountAll();
        }

        // The logotype is not focusable, so dropping it under `minimal` cannot change this.
        expect(orders.poster).toEqual(orders.backdrop);
        expect(orders.minimal).toEqual(orders.backdrop);
    });
});

/**
 * #129 Step 2: the recipe binding, judged against the two records it must not disturb.
 *
 *   tests/fixtures/item-details/pre-binding-composition.json        — what the page LOOKED like
 *   tests/fixtures/item-details/migrated-request-action-ledger.json — what the page DID
 *
 * The first is captured from the commit before this change and guarded by a checksum in test
 * source; the second is the P7 ledger, unchanged. Between them they say the whole thing a
 * presentation recipe is allowed to be: it may reorder and omit what is SHOWN, and it may change
 * nothing about what is REQUESTED.
 *
 * Nine recipes, twenty-four equivalence classes. For every pair:
 *
 *   - the rendered composition equals the pre-binding composition, re-ordered and filtered by the
 *     recipe and by nothing else;
 *   - the fixed header is present, complete and in its own order, whatever the recipe says;
 *   - every request row the ledger declares for the render phases is exercised exactly as often as
 *     the ledger says, with the same arguments and identities, and nothing else is issued.
 *
 * The last point is the one that matters most and the easiest to fake. It is not asserted by
 * counting: `compareLedgerRuns` matches each observation against the frozen rows in both
 * directions, so an omitted fetch shows up as an unexercised row and an extra one as an unknown
 * observation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ITEM_DETAILS_SECTIONS,
    type ItemDetailsSection,
    type ThemePresentation
} from '../../src/themes/platform/contract';
import { PLATFORM_DEFAULT_PRESENTATION } from '../../src/themes/platform/resolvePresentation';
import {
    SECTION_CLASSIFICATION,
    isFixedRegion
} from '../../src/apps/modern/features/details/utils/itemDetailsRecipe';
import classicManifest from '../../tesserafin-design/themes/classic/theme.json';
import glassManifest from '../../tesserafin-design/themes/glass/theme.json';
import {
    compareLedgerRuns,
    describeBreach,
    ledgerClass,
    LEDGER
} from './support/ledger';
import { unmountAll } from './support/modernHarness';
import { PRE_BINDING, preBindingClass } from './support/preBinding';

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

const RENDER_PHASES = [
    'primary',
    'subscription',
    'section',
    'delegated',
    'render'
];

const APPLIED_KEY = 'tesserafin.themeStudio.appliedPresentation';

const DEFAULT_SECTIONS =
    PLATFORM_DEFAULT_PRESENTATION.page.itemDetails.sections;

const CLASSIC = (classicManifest as { presentation: ThemePresentation })
    .presentation;
const GLASS = (glassManifest as { presentation: ThemePresentation })
    .presentation;

/** A recipe under test, and how it reaches the route. */
interface RecipeCase {
    id: string;
    /** The families the resolved recipe will select, in order. Used to derive the expectation. */
    expected: readonly ItemDetailsSection[];
    presentation?: ThemePresentation;
    /** Written to `localStorage` before the mount; the provider reads it itself. */
    persisted?: string;
}

const RECIPES: RecipeCase[] = [
    {
        id: 'platform default (no provider)',
        expected: DEFAULT_SECTIONS
    },
    {
        id: 'Tesserafin Classic',
        expected: CLASSIC.page?.itemDetails
            ?.sections as readonly ItemDetailsSection[],
        presentation: CLASSIC
    },
    {
        id: 'Frosted Glass',
        expected: GLASS.page?.itemDetails
            ?.sections as readonly ItemDetailsSection[],
        presentation: GLASS
    },
    {
        // Reordered, nothing omitted: the whole vocabulary, backwards.
        id: 'custom — reversed order',
        expected: [...ITEM_DETAILS_SECTIONS].reverse(),
        presentation: {
            page: {
                itemDetails: {
                    hero: 'minimal',
                    sections: [...ITEM_DETAILS_SECTIONS].reverse()
                }
            }
        }
    },
    {
        // Omits `cast` and `related` — both applicable to several classes. RFC-0007 permits a
        // community recipe to omit a published section; the fetch must still happen.
        id: 'custom — omits cast and related',
        expected: ITEM_DETAILS_SECTIONS.filter(
            (family) => family !== 'cast' && family !== 'related'
        ),
        presentation: {
            page: {
                itemDetails: {
                    sections: ITEM_DETAILS_SECTIONS.filter(
                        (family) => family !== 'cast' && family !== 'related'
                    )
                }
            }
        }
    },
    {
        // Partial: `hero` only. `sections` must fall back to the platform default, not to nothing.
        id: 'partial — hero only',
        expected: DEFAULT_SECTIONS,
        presentation: { page: { itemDetails: { hero: 'poster' } } }
    },
    {
        // A theme that declares a presentation with no page recipes at all.
        id: 'missing — theme declares no itemDetails recipe',
        expected: DEFAULT_SECTIONS,
        presentation: { surface: { variant: 'glass' } }
    },
    {
        // Hand-edited storage: `sections` is a string, `hero` is not a published value. Both are
        // ignored INDEPENDENTLY, and the route still renders.
        id: 'malformed persisted record',
        expected: DEFAULT_SECTIONS,
        persisted: JSON.stringify({
            page: { itemDetails: { hero: 'cinematic', sections: 'cast' } }
        })
    },
    {
        // The one that matters: one invalid field must not discard its valid siblings. `hero` is
        // nonsense and falls back; `sections` is valid apart from two unknown names, which are
        // dropped while the rest of the order survives.
        id: 'mixed valid and invalid persisted fields',
        expected: ['cast', 'overview', 'mediaInfo'],
        persisted: JSON.stringify({
            page: {
                itemDetails: {
                    hero: 42,
                    sections: [
                        'cast',
                        'notASection',
                        'overview',
                        'mainDetailButtons',
                        'mediaInfo',
                        'cast'
                    ]
                }
            }
        })
    }
];

/** The concrete surfaces of one family, as the pre-binding record rendered them for a class. */
const membersOf = (classId: string, family: ItemDetailsSection) =>
    preBindingClass(classId).sections.filter(
        (name) =>
            SECTION_CLASSIFICATION[
                name as keyof typeof SECTION_CLASSIFICATION
            ] === family
    );

/** The fixed header, as the pre-binding record rendered it for a class. */
const fixedOf = (classId: string) =>
    preBindingClass(classId).sections.filter((name) =>
        isFixedRegion(
            SECTION_CLASSIFICATION[name as keyof typeof SECTION_CLASSIFICATION]
        )
    );

/**
 * What the page must render for one class under one recipe.
 *
 * Derived from the PRE-BINDING record and the recipe alone. It never consults the running route,
 * which is what makes it an expectation rather than a snapshot.
 */
function expectedSections(
    classId: string,
    families: readonly ItemDetailsSection[]
): string[] {
    return [
        ...fixedOf(classId),
        ...families.flatMap((family) => membersOf(classId, family))
    ];
}

/**
 * The one ledger row whose presence legitimately follows the composition.
 *
 * `artwork.scaledImageUrl` is `kind: "URL_BUILDER"` — `apiClient.getScaledImageUrl` builds a
 * string and performs no I/O; the image itself is fetched by the browser from an `<img>`. The
 * ledger records its guard as "the item, or **a rendered chapter**, declares the image tag" and its
 * cardinality as "render-derived — the distinct option sets are frozen, the call count is not".
 *
 * The four movie classes reach it only through `SceneGrid`, because the fixture items carry
 * `ImageTags: {}` and so have no poster, backdrop or logo tag to build. A recipe that omits
 * `chapters` therefore renders no chapter, the row's own guard is unsatisfiable, and the row is
 * inapplicable rather than suppressed.
 *
 * This is NOT a licence for a recipe to change the request set, and it is not asserted on trust:
 * "no recipe changes the reads that reach a server" below compares the NETWORK-REACHING member set
 * across all nine recipes for all 24 classes, and that set is exactly equal every time.
 */
const URL_BUILDER_ROW = 'artwork.scaledImageUrl';

function expectedUnexercised(
    classId: string,
    families: readonly ItemDetailsSection[]
): string[] {
    const row = ledgerClass(classId).requests.find(
        (entry) => entry.id === URL_BUILDER_ROW
    );
    if (!row) return [];
    // Which composed surfaces could build a URL for this class at all.
    const builders = preBindingClass(classId).sections.filter(
        (name) => name === 'scenesCollapsible'
    );
    if (builders.length === 0) return [];
    const chaptersComposed = families.includes('chapters');
    return chaptersComposed ? [] : [URL_BUILDER_ROW];
}

const renderedSectionsOf = (root: HTMLElement) =>
    [...root.querySelectorAll('[data-detail-section]')].map(
        (element) => element.getAttribute('data-detail-section') ?? ''
    );

/*
 * Scoped to SECTIONS. `data-rf-slot` is the published design system's slot attribute and the `ui`
 * primitives inside a section carry their own (`state-empty`, card slots); the recipe's slots are
 * the ones on the section elements themselves.
 */
const renderedSlotsOf = (root: HTMLElement) =>
    [...root.querySelectorAll('[data-detail-section][data-rf-slot]')].map(
        (element) => element.getAttribute('data-rf-slot') ?? ''
    );

afterEach(() => {
    unmountAll();
    window.localStorage.clear();
});
beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    resetServiceLedger();
    vi.clearAllMocks();
});

async function mount(classId: string, recipe: RecipeCase) {
    if (recipe.persisted) {
        window.localStorage.setItem(APPLIED_KEY, recipe.persisted);
        return mountForLedger(classId, { fromAppliedRecord: true });
    }
    return mountForLedger(classId, { presentation: recipe.presentation });
}

for (const recipe of RECIPES) {
    describe(`Item Details under "${recipe.id}"`, () => {
        for (const cls of LEDGER.classes) {
            it(`${cls.id} renders the pre-binding composition, re-ordered only`, async () => {
                const mounted = await mount(cls.id, recipe);
                expect(renderedSectionsOf(mounted.container)).toEqual(
                    expectedSections(cls.id, recipe.expected)
                );
            });

            it(`${cls.id} issues exactly the frozen request ledger`, async () => {
                const mounted = await mount(cls.id, recipe);
                const ledger = ledgerClass(cls.id);
                const result = compareLedgerRuns(
                    ledger,
                    observationsOf(mounted.api),
                    RENDER_PHASES
                );

                expect(mounted.api.refused).toEqual([]);
                expect(
                    result.unknown,
                    describeBreach(ledger, `recipe "${recipe.id}"`, result)
                ).toEqual([]);
                expect(
                    result.unexercised,
                    describeBreach(ledger, `recipe "${recipe.id}"`, result)
                ).toEqual(expectedUnexercised(cls.id, recipe.expected));
                expect(
                    result.multiplicity,
                    describeBreach(ledger, `recipe "${recipe.id}"`, result)
                ).toEqual([]);
                expect(result.ambiguous).toEqual([]);
            });

            it(`${cls.id} keeps every fixed surface, in its own order`, async () => {
                const mounted = await mount(cls.id, recipe);
                const rendered = renderedSectionsOf(mounted.container);
                const fixed = fixedOf(cls.id);

                // Present, complete, and ahead of everything the recipe orders — the fixed header
                // is anchored, so no recipe can move a play button below the cast list.
                expect(rendered.slice(0, fixed.length)).toEqual(fixed);
                // And no fixed surface carries a recipe slot.
                const slotted = [
                    ...mounted.container.querySelectorAll(
                        '[data-detail-section][data-rf-slot]'
                    )
                ].map((element) => element.getAttribute('data-detail-section'));
                for (const surface of fixed) {
                    expect(
                        slotted,
                        `"${surface}" is fixed and must carry no recipe slot`
                    ).not.toContain(surface);
                }
            });

            it(`${cls.id} renders each selected family at most once`, async () => {
                const mounted = await mount(cls.id, recipe);
                const slots = renderedSlotsOf(mounted.container);
                // Slots must appear as contiguous runs, one run per family.
                const runs: string[] = [];
                for (const slot of slots) {
                    if (runs[runs.length - 1] !== slot) runs.push(slot);
                }
                expect(runs).toEqual([...new Set(runs)]);
            });

            it(`${cls.id} always renders a poster`, async () => {
                const mounted = await mount(cls.id, recipe);
                expect(
                    mounted.container.querySelectorAll(
                        '[data-detail-image="poster"]'
                    )
                ).toHaveLength(1);
            });
        }
    });
}

describe('a hidden family is still fetched', () => {
    /**
     * The single most important claim in this file, isolated so it cannot pass by accident.
     *
     * `movie` renders `castCollapsible`, `collectionsCollapsible` and `similarCollapsible`. Under
     * the omitting recipe none of them appears — and `getSimilarItems` and `getItemCollections`
     * must still be issued, because the recipe is not allowed to decide what the route requests.
     */
    it('omitting cast and related hides the surfaces and changes no request', async () => {
        const omitting = RECIPES.find((entry) =>
            entry.id.startsWith('custom — omits')
        ) as RecipeCase;

        const withThem = await mount('movie', RECIPES[0]);
        const before = observationsOf(withThem.api).map(
            (observation) => `${observation.surface}.${observation.member}`
        );
        expect(renderedSectionsOf(withThem.container)).toContain(
            'similarCollapsible'
        );
        unmountAll();

        const without = await mount('movie', omitting);
        const after = observationsOf(without.api).map(
            (observation) => `${observation.surface}.${observation.member}`
        );

        expect(renderedSectionsOf(without.container)).not.toContain(
            'similarCollapsible'
        );
        expect(renderedSectionsOf(without.container)).not.toContain(
            'castCollapsible'
        );
        expect(renderedSectionsOf(without.container)).not.toContain(
            'collectionsCollapsible'
        );
        expect([...after].sort()).toEqual([...before].sort());
    });

    it('an action does not disappear because an adjacent family is hidden', async () => {
        const omitting = RECIPES.find((entry) =>
            entry.id.startsWith('custom — omits')
        ) as RecipeCase;

        for (const recipe of [RECIPES[0], omitting]) {
            const mounted = await mount('movie', recipe);
            const actions = [
                ...mounted.container.querySelectorAll('[data-detail-action]')
            ].map((element) => element.getAttribute('data-detail-action'));
            expect(actions, recipe.id).toEqual(
                preBindingClass('movie').actions
            );
            unmountAll();
        }
    });
});

describe('no recipe changes the reads that reach a server', () => {
    /**
     * The compensating proof for the URL_BUILDER carve-out above, and the strongest single
     * statement in this file.
     *
     * For every class, the set of API members actually called — both surfaces, with their
     * arguments — must be identical under all nine recipes. `getScaledImageUrl` is excluded
     * because it reaches nothing: it concatenates a string. Every member that does reach a server
     * is compared, so a recipe that skipped one fetch, or added one, fails here regardless of what
     * the composition assertions say.
     */
    it.each(LEDGER.classes.map((cls) => cls.id))(
        '%s issues the same server reads under every recipe',
        async (classId) => {
            const signatures: Record<string, string[]> = {};

            for (const recipe of RECIPES) {
                const mounted = await mount(classId, recipe);
                signatures[recipe.id] = observationsOf(mounted.api)
                    .filter(
                        (observation) =>
                            observation.member !== 'getScaledImageUrl'
                    )
                    .map(
                        (observation) =>
                            `${observation.surface}.${observation.member}#` +
                            JSON.stringify(observation.args)
                    )
                    .sort();
                unmountAll();
                window.localStorage.clear();
            }

            const baseline = signatures[RECIPES[0].id];
            expect(baseline.length).toBeGreaterThan(0);
            for (const recipe of RECIPES.slice(1)) {
                expect(
                    signatures[recipe.id],
                    `"${recipe.id}" changed the server reads for ${classId}`
                ).toEqual(baseline);
            }
        }
    );

    it('and the URL builder is exercised again as soon as its family is composed', async () => {
        // The other side of the carve-out: `chapters` selected means the row IS exercised, so the
        // exemption cannot quietly become permanent.
        const mounted = await mount('movie', RECIPES[0]);
        const built = observationsOf(mounted.api).filter(
            (observation) => observation.member === 'getScaledImageUrl'
        );
        expect(built.length).toBeGreaterThan(0);
    });
});

describe('the official themes expose the same complete content set', () => {
    it.each(LEDGER.classes.map((cls) => cls.id))(
        '%s shows the same surfaces under Classic and Frosted Glass',
        async (classId) => {
            const classic = await mount(classId, RECIPES[1]);
            const classicSections = renderedSectionsOf(classic.container);
            unmountAll();

            const glass = await mount(classId, RECIPES[2]);
            const glassSections = renderedSectionsOf(glass.container);

            expect([...glassSections].sort()).toEqual(
                [...classicSections].sort()
            );
        }
    );

    it('and Classic reproduces the platform default exactly', () => {
        expect(
            (CLASSIC.page?.itemDetails?.sections as readonly string[]) ?? []
        ).toEqual([...DEFAULT_SECTIONS]);
        expect(CLASSIC.page?.itemDetails?.hero).toBe(
            PLATFORM_DEFAULT_PRESENTATION.page.itemDetails.hero
        );
    });

    it('and Frosted Glass is materially different, not merely differently written', () => {
        const glass = GLASS.page?.itemDetails?.sections as readonly string[];
        expect(glass).not.toEqual([...DEFAULT_SECTIONS]);
        // Every family, so nothing is suppressed — but in a different order.
        expect([...glass].sort()).toEqual([...ITEM_DETAILS_SECTIONS].sort());
        expect(GLASS.page?.itemDetails?.hero).not.toBe(
            CLASSIC.page?.itemDetails?.hero
        );
    });
});

describe('the pre-binding record is the thing being reproduced', () => {
    it('the platform default reproduces it byte for byte, for all 24 classes', () => {
        // The composition assertions above already prove this at runtime. This states it once as
        // a property of the DERIVATION, so a reader can see that the expectation for the default
        // recipe is literally the captured record and not a re-listing of it.
        for (const entry of PRE_BINDING.classes) {
            expect(
                expectedSections(entry.id, DEFAULT_SECTIONS),
                entry.id
            ).toEqual(entry.sections);
        }
    });
});

describe('permission gates hold under every recipe', () => {
    /**
     * The gap this closes.
     *
     * `recordingFields` is a FIXED surface gated on `canManageLiveTv(user)`, and the 24
     * equivalence classes only ever show a `Program` to an administrator — so deleting that gate
     * changed no class, and nothing failed. A fixed surface whose permission gate no test can
     * observe is a fixed surface that can quietly stop being gated.
     *
     * `userOverride` reaches the combination the classes do not carry. The recipe is varied on top
     * of it, because "a recipe bypassing a permission gate" is the shape of the risk: a theme must
     * not be able to compose its way past authorization.
     */
    it.each(RECIPES.map((entry) => entry.id))(
        'a non-administrator sees no recording controls under "%s"',
        async (recipeId) => {
            const recipe = RECIPES.find(
                (entry) => entry.id === recipeId
            ) as RecipeCase;

            if (recipe.persisted) {
                window.localStorage.setItem(APPLIED_KEY, recipe.persisted);
            }
            const mounted = await mountForLedger('program', {
                userOverride: { Policy: { EnableLiveTvManagement: false } },
                ...(recipe.persisted
                    ? { fromAppliedRecord: true }
                    : { presentation: recipe.presentation })
            });

            expect(renderedSectionsOf(mounted.container)).not.toContain(
                'recordingFields'
            );
        }
    );

    it('and an administrator still sees them under every recipe', async () => {
        for (const recipe of RECIPES) {
            if (recipe.persisted) {
                window.localStorage.setItem(APPLIED_KEY, recipe.persisted);
            }
            const mounted = await mountForLedger('program', {
                ...(recipe.persisted
                    ? { fromAppliedRecord: true }
                    : { presentation: recipe.presentation })
            });
            expect(renderedSectionsOf(mounted.container), recipe.id).toContain(
                'recordingFields'
            );
            unmountAll();
            window.localStorage.clear();
        }
    });
});

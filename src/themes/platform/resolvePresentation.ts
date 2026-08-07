/**
 * Capability resolution and graceful fallback (RFC-0007 §5.3).
 *
 * A theme declares what it uses; a renderer declares what it implements. This module is the one
 * place those two lists meet, and it answers two questions:
 *
 *   1. May this theme activate at all? — only if every capability in `capabilities.required` is
 *      implemented by the renderer. A theme that *requires* something the renderer cannot do must
 *      be refused with a reason, not rendered half-right and left to look broken.
 *   2. What does the renderer actually apply? — the theme's presentation choices for supported
 *      capabilities, and the PLATFORM DEFAULT for every capability it does not support. Each such
 *      substitution is reported in `fallbacks`, so "it fell back" is observable rather than
 *      invisible.
 *
 * Fallback is per-capability, never per-key: a renderer either speaks `presentation.mediaCard` or
 * it does not. Partially honouring a capability would produce a presentation neither the theme
 * author nor the platform designed.
 */

import {
    HOME_SECTIONS,
    HOME_SHELF_DENSITIES,
    type HomeRecipe,
    type HomeSection,
    type HomeShelfDensity,
    ITEM_DETAILS_HEROES,
    ITEM_DETAILS_SECTIONS,
    type ItemDetailsHero,
    type ItemDetailsRecipe,
    type ItemDetailsSection,
    LIBRARY_CARD_ASPECTS,
    LIBRARY_FILTER_PRESENTATIONS,
    LIBRARY_LAYOUTS,
    type LibraryCardAspect,
    type LibraryFilterPresentation,
    type LibraryLayout,
    type LibraryRecipe,
    type MediaCardPresentation,
    type NavigationPresentation,
    type SurfacePresentation,
    type ThemeCapability,
    type ThemeManifest,
    type ThemePresentation,
    WEB_RENDERER_CAPABILITIES
} from './contract';

/**
 * A fully-resolved presentation: every key present, nothing optional. This is what a renderer
 * reads, so it never has to ask "and if the theme did not say?".
 */
export interface ResolvedPresentation {
    surface: Required<SurfacePresentation>;
    mediaCard: Required<MediaCardPresentation>;
    navigation: Required<NavigationPresentation>;
    page: {
        home: {
            sections: readonly HomeSection[];
            shelfDensity: HomeShelfDensity;
        };
        library: Required<LibraryRecipe>;
        itemDetails: {
            hero: ItemDetailsHero;
            sections: readonly ItemDetailsSection[];
        };
    };
}

/**
 * The presentation a renderer produces when a theme says nothing — and the value it falls back to
 * when a theme *does* say something the renderer cannot honour.
 *
 * These are Tesserafin Classic's shape because Classic is the default experience; they are not
 * "Classic's settings" in any binding sense — `tesserafin-design/themes/classic/theme.json`
 * declares its own, identical values, and changing one does not change the other. Keeping them
 * separate is what lets a fallback be a *neutral* result rather than "whatever Classic happens to
 * be this week".
 */
export const PLATFORM_DEFAULT_PRESENTATION: ResolvedPresentation = {
    surface: {
        variant: 'opaque',
        border: 'none',
        elevation: 'level1'
    },
    mediaCard: {
        imageAspect: 'poster',
        titlePlacement: 'below',
        hoverEffect: 'lift',
        progressStyle: 'bar'
    },
    navigation: {
        shell: 'sidebar',
        labels: 'always',
        position: 'start'
    },
    page: {
        home: {
            /*
             * The order the modern Home route rendered BEFORE `presentation.page.home` was bound
             * (`apps/modern/features/home/components/HomeTab.tsx`): My media, Continue watching,
             * Next up, then one "Latest from <library>" shelf per eligible view.
             *
             * It was `continueWatching, nextUp, latestMedia, libraries` while nothing read it,
             * which was harmless only for as long as it was unread. Binding the capability without
             * correcting it would have silently reordered Home for every user who has never
             * touched a theme — a default must reproduce current behaviour, not impose a new one.
             */
            sections: [
                'libraries',
                'continueWatching',
                'nextUp',
                'latestMedia'
            ],
            shelfDensity: 'comfortable'
        },
        /*
         * Checked against the route before `presentation.page.library` was bound, the way Home's
         * order should have been. `/library/:libraryId` rendered its items through `MediaGrid`
         * (`LibraryItemsGrid.tsx`), built every media-item card with a hard-coded
         * `imageAspect: 'poster'` (`library/utils/mediaCardProps.ts`), and laid its sort/genre/
         * year/studio controls out in the always-visible `rf-library-view__controls` bar
         * (`BrowseDestination.tsx`). `grid` / `poster` / `inline` therefore already WAS the product
         * behaviour, and `LibraryView.recipe.test.tsx` pins that equality so the two cannot drift.
         *
         * Unlike Home, no correction was needed here — which is why the check mattered: the answer
         * was not known in advance either time.
         */
        library: {
            layout: 'grid',
            cardAspect: 'poster',
            filters: 'inline'
        },
        /*
         * Corrected at binding time, the way Home's was, and for the same reason.
         *
         * While nothing read it this declared `overview, cast, episodes, related, mediaInfo` —
         * an order NO equivalence class rendered. `legacy-contract.json` recorded the comparison
         * honestly at the time: 13 MISMATCH, 11 NOT APPLICABLE, 0 MATCH. Binding the capability
         * without correcting the declaration would have silently recomposed Item Details for every
         * user who has never touched a theme, which is precisely what a platform default exists to
         * prevent.
         *
         * The order below is the one the MIGRATED route already rendered, expressed in the
         * published vocabulary. `tests/fixtures/item-details/pre-binding-composition.json` — 24
         * classes captured before this line changed, checksum-guarded in test source — is what says
         * so, and `itemDetails.recipe.test.tsx` replays every class against it.
         *
         * `hero: 'backdrop'` is unchanged, because it was already right: the pre-binding route
         * rendered the backdrop layer for every class that may have one.
         */
        itemDetails: {
            hero: 'backdrop',
            sections: [...ITEM_DETAILS_SECTIONS]
        }
    }
};

export interface CapabilityFallback {
    capability: ThemeCapability;
    /** Why the platform default was used instead of the theme's value. */
    reason: 'unsupported-by-renderer';
}

export interface PresentationResolution {
    /** `false` when a REQUIRED capability is unsupported: the theme must not be activated. */
    activatable: boolean;
    /** Required capabilities the renderer does not implement. Empty when `activatable`. */
    missingRequired: readonly ThemeCapability[];
    /** Optional capabilities that were declared, used, and silently replaced by the default. */
    fallbacks: readonly CapabilityFallback[];
    /** What the renderer should actually apply. Always complete, even when the theme said nothing. */
    presentation: ResolvedPresentation;
}

/** Which capability governs which `presentation` key. */
const CAPABILITY_FOR_PRESENTATION_KEY = {
    surface: 'presentation.surface',
    mediaCard: 'presentation.mediaCard',
    navigation: 'presentation.navigation'
} as const satisfies Record<
    'surface' | 'mediaCard' | 'navigation',
    ThemeCapability
>;

const CAPABILITY_FOR_PAGE_KEY = {
    home: 'presentation.page.home',
    library: 'presentation.page.library',
    itemDetails: 'presentation.page.itemDetails'
} as const satisfies Record<
    'home' | 'library' | 'itemDetails',
    ThemeCapability
>;

const HOME_SECTION_NAMES: ReadonlySet<string> = new Set(HOME_SECTIONS);
const HOME_SHELF_DENSITY_NAMES: ReadonlySet<string> = new Set(
    HOME_SHELF_DENSITIES
);

/**
 * The Home recipe is the first presentation value that is an ARRAY, and the first that reaches the
 * resolver from a hand-editable place: `localPresentation.ts` reads a `localStorage` record whose
 * *values* were schema-validated when the draft was applied, but which a user can edit afterwards.
 * The existing shape check there rejects a non-object record; it cannot reject
 * `{"page":{"home":{"sections":"latestMedia"}}}`, and `sections.map` on a string would throw
 * during render — from a provider that sits above the whole app.
 *
 * The rule is deterministic and stated once here so both callers get it:
 *
 *   - a `sections` that is not an array is ignored entirely;
 *   - unknown section names are dropped (an older theme naming a section this build has retired
 *     should lose that section, not the whole recipe);
 *   - duplicates are dropped, keeping the first occurrence, because a section rendered twice is
 *     never what a recipe meant;
 *   - if nothing survives, `sections` is ignored and the platform default order applies — an empty
 *     Home is not a composition anyone chose;
 *   - an unknown `shelfDensity` is ignored independently, so one bad key cannot cost the other.
 *
 * Note this is sanitisation, not validation: it never throws and never reports. A theme author
 * gets a real error from `validateManifest`; this path exists so that a corrupted browser record
 * degrades to the default instead of preventing boot.
 */
function sanitizeHomeRecipe(override: HomeRecipe | undefined): HomeRecipe {
    if (!override || typeof override !== 'object') return {};

    const clean: HomeRecipe = {};

    if (Array.isArray(override.sections)) {
        const seen = new Set<string>();
        const sections = override.sections.filter(
            (section): section is HomeSection => {
                if (typeof section !== 'string') return false;
                if (!HOME_SECTION_NAMES.has(section)) return false;
                if (seen.has(section)) return false;
                seen.add(section);
                return true;
            }
        );
        if (sections.length > 0) clean.sections = sections;
    }

    if (
        typeof override.shelfDensity === 'string' &&
        HOME_SHELF_DENSITY_NAMES.has(override.shelfDensity)
    ) {
        clean.shelfDensity = override.shelfDensity;
    }

    return clean;
}

const LIBRARY_LAYOUT_NAMES: ReadonlySet<string> = new Set(LIBRARY_LAYOUTS);
const LIBRARY_CARD_ASPECT_NAMES: ReadonlySet<string> = new Set(
    LIBRARY_CARD_ASPECTS
);
const LIBRARY_FILTER_PRESENTATION_NAMES: ReadonlySet<string> = new Set(
    LIBRARY_FILTER_PRESENTATIONS
);

/**
 * The Library recipe's three keys are scalar enums, which is exactly why they need this: `object`
 * spread in {@link mergeGroup} would merge `{"layout":"enormous"}` straight into the resolved
 * presentation, and the route would then branch on a value no renderer defines.
 *
 * Same rule as {@link sanitizeHomeRecipe}, and same reason — a hand-edited `localStorage` record
 * must degrade, never throw, and never prevent boot:
 *
 *   - each key is validated INDEPENDENTLY, so one bad value cannot cost the other two;
 *   - an unknown value is dropped, leaving the platform default for that key alone;
 *   - nothing is reported. A theme author gets a real error from `validateManifest`.
 */
function sanitizeLibraryRecipe(
    override: LibraryRecipe | undefined
): LibraryRecipe {
    if (!override || typeof override !== 'object') return {};

    const clean: LibraryRecipe = {};

    if (
        typeof override.layout === 'string' &&
        LIBRARY_LAYOUT_NAMES.has(override.layout)
    ) {
        clean.layout = override.layout as LibraryLayout;
    }

    if (
        typeof override.cardAspect === 'string' &&
        LIBRARY_CARD_ASPECT_NAMES.has(override.cardAspect)
    ) {
        clean.cardAspect = override.cardAspect as LibraryCardAspect;
    }

    if (
        typeof override.filters === 'string' &&
        LIBRARY_FILTER_PRESENTATION_NAMES.has(override.filters)
    ) {
        clean.filters = override.filters as LibraryFilterPresentation;
    }

    return clean;
}

const ITEM_DETAILS_SECTION_NAMES: ReadonlySet<string> = new Set(
    ITEM_DETAILS_SECTIONS
);
const ITEM_DETAILS_HERO_NAMES: ReadonlySet<string> = new Set(
    ITEM_DETAILS_HEROES
);

/**
 * The Item Details recipe has one of each shape the other two recipes have separately — an ordered
 * array and a scalar enum — so it needs both rules, applied INDEPENDENTLY:
 *
 *   - a `sections` that is not an array is ignored entirely, and `hero` survives it;
 *   - unknown section names are dropped, so a recipe naming a family this build has retired loses
 *     that family rather than the whole composition;
 *   - duplicates are dropped keeping the first occurrence, because a content family rendered twice
 *     is never what a recipe meant, and the schema's `uniqueItems` cannot reach a hand-edited
 *     `localStorage` record;
 *   - if nothing survives, `sections` is ignored and the platform default order applies — an Item
 *     Details page with no content is not a composition anyone chose;
 *   - an unknown `hero` is ignored on its own, so one bad key never costs the other.
 *
 * The last point is the one Step 2 is asked to prove: `{"hero":"cinematic","sections":["cast"]}`
 * must keep `cast` and fall back to the default hero, not discard both.
 */
function sanitizeItemDetailsRecipe(
    override: ItemDetailsRecipe | undefined
): ItemDetailsRecipe {
    if (!override || typeof override !== 'object') return {};

    const clean: ItemDetailsRecipe = {};

    if (Array.isArray(override.sections)) {
        const seen = new Set<string>();
        const sections = override.sections.filter(
            (section): section is ItemDetailsSection => {
                if (typeof section !== 'string') return false;
                if (!ITEM_DETAILS_SECTION_NAMES.has(section)) return false;
                if (seen.has(section)) return false;
                seen.add(section);
                return true;
            }
        );
        if (sections.length > 0) clean.sections = sections;
    }

    if (
        typeof override.hero === 'string'
        && ITEM_DETAILS_HERO_NAMES.has(override.hero)
    ) {
        clean.hero = override.hero;
    }

    return clean;
}

function mergeGroup<T extends object>(
    defaults: T,
    override: Partial<T> | undefined,
    supported: boolean,
    capability: ThemeCapability,
    fallbacks: CapabilityFallback[]
): T {
    if (!override || Object.keys(override).length === 0) return defaults;
    if (!supported) {
        // The theme asked for something this renderer cannot express. Record it and use the
        // default — an unsupported capability is a documented downgrade, not an error.
        fallbacks.push({ capability, reason: 'unsupported-by-renderer' });
        return defaults;
    }
    return { ...defaults, ...override };
}

/**
 * @param manifest The theme's v2 manifest.
 * @param rendererCapabilities What the *active* renderer implements. Defaults to the Web renderer.
 */
export function resolvePresentation(
    manifest: Pick<ThemeManifest, 'presentation' | 'capabilities'>,
    rendererCapabilities: readonly ThemeCapability[] = WEB_RENDERER_CAPABILITIES
): PresentationResolution {
    const supportedSet = new Set(rendererCapabilities);
    const supports = (capability: ThemeCapability) =>
        supportedSet.has(capability);

    const missingRequired = (manifest.capabilities?.required ?? []).filter(
        (capability) => !supports(capability)
    );

    const fallbacks: CapabilityFallback[] = [];
    const themePresentation: ThemePresentation = manifest.presentation ?? {};
    const defaults = PLATFORM_DEFAULT_PRESENTATION;

    const presentation: ResolvedPresentation = {
        surface: mergeGroup(
            defaults.surface,
            themePresentation.surface,
            supports(CAPABILITY_FOR_PRESENTATION_KEY.surface),
            CAPABILITY_FOR_PRESENTATION_KEY.surface,
            fallbacks
        ),
        mediaCard: mergeGroup(
            defaults.mediaCard,
            themePresentation.mediaCard,
            supports(CAPABILITY_FOR_PRESENTATION_KEY.mediaCard),
            CAPABILITY_FOR_PRESENTATION_KEY.mediaCard,
            fallbacks
        ),
        navigation: mergeGroup(
            defaults.navigation,
            themePresentation.navigation,
            supports(CAPABILITY_FOR_PRESENTATION_KEY.navigation),
            CAPABILITY_FOR_PRESENTATION_KEY.navigation,
            fallbacks
        ),
        page: {
            home: mergeGroup(
                defaults.page.home,
                sanitizeHomeRecipe(themePresentation.page?.home),
                supports(CAPABILITY_FOR_PAGE_KEY.home),
                CAPABILITY_FOR_PAGE_KEY.home,
                fallbacks
            ),
            library: mergeGroup(
                defaults.page.library,
                sanitizeLibraryRecipe(themePresentation.page?.library),
                supports(CAPABILITY_FOR_PAGE_KEY.library),
                CAPABILITY_FOR_PAGE_KEY.library,
                fallbacks
            ),
            itemDetails: mergeGroup(
                defaults.page.itemDetails,
                sanitizeItemDetailsRecipe(themePresentation.page?.itemDetails),
                supports(CAPABILITY_FOR_PAGE_KEY.itemDetails),
                CAPABILITY_FOR_PAGE_KEY.itemDetails,
                fallbacks
            )
        }
    };

    return {
        activatable: missingRequired.length === 0,
        missingRequired,
        fallbacks,
        presentation
    };
}

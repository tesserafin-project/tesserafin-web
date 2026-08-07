/**
 * The one place the universal Item Details recipe meets what the Web renderer draws
 * (RFC-0007 §4.7), and the one place the PUBLIC section vocabulary meets the PRIVATE
 * characterization hooks.
 *
 * `presentation.page.itemDetails.sections` names durable user-facing CONTENT FAMILIES. The
 * migrated route emits 33 `data-detail-section` identifiers, which are the names the frozen P5
 * fixture is written in — private implementation evidence, not theme vocabulary. This module maps
 * every one of those 33 onto exactly one of:
 *
 *   - a PUBLISHED family in {@link ITEM_DETAILS_SECTIONS}, which a recipe may order and omit; or
 *   - a FIXED REGION, which no recipe may select, hide, reorder or move.
 *
 * `itemDetailsRecipe.test.ts` proves the mapping is total and single-valued, and that no fixed
 * surface leaked into the public enum.
 *
 * ## What a recipe may and may not do
 *
 * A recipe SELECTS AND ORDERS. It never changes what a family contains, and it never changes
 * whether that family's data is requested: `ItemDetailsView` calls every `use*` hook
 * unconditionally, above the recipe read, so the query set is identical under every recipe
 * (`itemDetails.recipe.test.tsx` replays the whole P7 ledger to say so). Omitting a family hides
 * it; it does not stop the fetch, does not reorder results inside it, and is therefore not a
 * content-ranking mechanism (RFC-0007 §6.1).
 *
 * ## Why several concrete surfaces share one family
 *
 * Because they are the same thing to a viewer. `castCollapsible` and `guestCastCollapsible` are
 * both "the people in this" and sit next to each other. `seriesTimerScheduleSection`,
 * `programGuideSection` and `seriesScheduleSection` are all "what is going to air", and no item
 * type can produce two of them — a series timer is not a TV channel is not a series. That mutual
 * exclusivity is what lets one family cover surfaces the JSX emits far apart: within any single
 * class, a family's members are always contiguous. `itemDetailsRecipe.test.ts` checks that
 * mechanically, over every ordered pair of families, rather than by inspection.
 */

import {
    ITEM_DETAILS_SECTIONS,
    type ItemDetailsHero,
    type ItemDetailsRecipe,
    type ItemDetailsSection
} from 'themes/platform/contract';
import { PLATFORM_DEFAULT_PRESENTATION } from 'themes/platform/resolvePresentation';

import { DETAIL_SECTIONS, type DetailSectionName } from '../constants/sections';

/**
 * Why a concrete surface is outside theme authority (RFC-0007 §6.1, and the owner ruling for
 * #129 Step 2). Recorded per surface so the classification argues its own case.
 */
export type FixedRegion =
    | 'identity'
    | 'primaryInformation'
    | 'playbackControls'
    | 'trackSelectors'
    | 'recordingControls';

export const FIXED_REGIONS: readonly FixedRegion[] = [
    'identity',
    'primaryInformation',
    'playbackControls',
    'trackSelectors',
    'recordingControls'
] as const;

const FIXED: ReadonlySet<string> = new Set(FIXED_REGIONS);

export type SectionClassification = ItemDetailsSection | FixedRegion;

/**
 * Every concrete surface the route can render, classified exactly once.
 *
 * The order of the keys is the order `ItemDetailsView` emits them in, which is what makes the
 * contiguity proof readable. A new `data-detail-section` that is not added here fails to compile.
 */
export const SECTION_CLASSIFICATION: Readonly<
    Record<DetailSectionName, SectionClassification>
> = {
    // ── Fixed regions ────────────────────────────────────────────────────────────────────────
    /** The item's name, and the parent/index line that identifies which item this is. */
    nameContainer: 'identity',
    /** Year, runtime, official rating, item counts — the information the page is required to state. */
    'itemMiscInfo-primary': 'primaryInformation',
    /** Programme time, start date, channel — the same guarantee for live and recorded content. */
    'itemMiscInfo-secondary': 'primaryInformation',
    /** Play, resume, replay, shuffle, trailer, download, played, favourite, rating, context menu. */
    mainDetailButtons: 'playbackControls',
    /** Media source, video, audio and subtitle selectors. */
    trackSelections: 'trackSelectors',
    /** The record/series-record controls, shown only to a user who may manage live TV. */
    recordingFields: 'recordingControls',

    // ── Published content families ───────────────────────────────────────────────────────────
    /** Descriptive prose about the item. */
    tagline: 'overview',
    overview: 'overview',
    /** The item's factual panel. */
    itemBirthday: 'mediaInfo',
    itemBirthLocation: 'mediaInfo',
    itemDeathDate: 'mediaInfo',
    seriesAirTime: 'mediaInfo',
    itemTags: 'mediaInfo',
    itemExternalLinks: 'mediaInfo',
    itemDetailsGroup: 'mediaInfo',
    /** What is scheduled to air. Never two of these at once — the item types are disjoint. */
    seriesTimerScheduleSection: 'schedule',
    programGuideSection: 'schedule',
    seriesScheduleSection: 'schedule',
    /** What the item contains: collection members, children, and the further parts of one video. */
    collectionItems: 'episodes',
    listChildrenCollapsible: 'episodes',
    childrenCollapsible: 'episodes',
    additionalPartsCollapsible: 'episodes',
    /** The next thing to play. */
    nextUpSection: 'nextUp',
    /** Song lyrics. */
    lyricsSection: 'lyrics',
    /** Other items from the same season or the same artist. */
    moreFromSeasonSection: 'moreFrom',
    moreFromArtistSection: 'moreFrom',
    /** The people in it. */
    castCollapsible: 'cast',
    guestCastCollapsible: 'cast',
    /** Bonus material that ships with the item. */
    specialsCollapsible: 'extras',
    musicVideosCollapsible: 'extras',
    /** An index into the item's own timeline. */
    scenesCollapsible: 'chapters',
    /** Other items connected to this one. */
    collectionsCollapsible: 'related',
    similarCollapsible: 'related'
};

export const isFixedRegion = (
    classification: SectionClassification
): classification is FixedRegion => FIXED.has(classification);

/** The concrete surfaces of one family, in the order `ItemDetailsView` emits them. */
export const familyMembers = (
    family: ItemDetailsSection
): readonly DetailSectionName[] =>
    DETAIL_SECTIONS.filter((name) => SECTION_CLASSIFICATION[name] === family);

/**
 * The families that render BESIDE the poster rather than below it, when they come first.
 *
 * This is the layout split the legacy template made with `detailPagePrimaryContent`
 * (`MAY CHANGE` #2). It replaces the positional `DETAIL_SECTIONS.slice(0, …)` the migration used:
 * a slice is only correct while the order is fixed, and under a recipe it would mark a section as
 * "beside the poster" while it sat below three full-width blocks.
 *
 * NOTE the name. This is the layout COLUMN, and it has nothing to do with
 * `presentation.page.itemDetails.hero`, which is the artwork TREATMENT. Two different things were
 * both called "hero" in this slice; only one of them is theme vocabulary.
 */
const PRIMARY_COLUMN_FAMILIES: ReadonlySet<string> =
    new Set<ItemDetailsSection>(['overview', 'mediaInfo']);

export type SectionColumn = 'hero' | 'full';

export interface ComposedFamily {
    family: ItemDetailsSection;
    /** `data-detail-slot`: the grid column this family's surfaces occupy. */
    column: SectionColumn;
}

export interface ComposedItemDetails {
    hero: ItemDetailsHero;
    families: readonly ComposedFamily[];
}

/**
 * The ordered composition for a resolved recipe. Pure, total, and the only thing the view reads.
 *
 * Two rules beyond "take the recipe's order":
 *
 *  1. A recipe that selects nothing renderable falls back to the platform default order. A recipe
 *     of `[]` is already rejected by the schema (`minItems: 1`) and by the resolver's sanitiser,
 *     but a future family retired from this build could empty a valid recipe, and an Item Details
 *     page with no content is not a composition anyone chose. Same rule as `toRenderedHomeSections`.
 *  2. The primary column is a CONTIGUOUS PREFIX. A family that would sit beside the poster renders
 *     there only while nothing full-width has been emitted before it, so reordering produces a
 *     coherent layout instead of a column-2 island below a full-width block.
 */
export function composeItemDetails(recipe: {
    hero: ItemDetailsHero;
    sections: readonly ItemDetailsSection[];
}): ComposedItemDetails {
    const seen = new Set<ItemDetailsSection>();
    const selected = recipe.sections.filter((family) => {
        if (seen.has(family)) return false;
        seen.add(family);
        return true;
    });

    const ordered =
        selected.length > 0
            ? selected
            : PLATFORM_DEFAULT_PRESENTATION.page.itemDetails.sections;

    let stillPrimary = true;
    const families = ordered.map((family) => {
        const primary = stillPrimary && PRIMARY_COLUMN_FAMILIES.has(family);
        if (!primary) stillPrimary = false;
        return { family, column: primary ? 'hero' : 'full' } as ComposedFamily;
    });

    return { hero: recipe.hero, families };
}

/**
 * How the artwork is laid out, after everything that outranks the theme has had its say.
 *
 * The precedence chain, highest first:
 *
 *  1. the ITEM. `Person` and `Book` never get a backdrop — `MUST PRESERVE` #9, unconditional;
 *  2. the USER. Their details-banner setting is a preference about their own client, and a theme
 *     does not get to overrule it. `detailsBanner()` defaults to ON, so the platform default is
 *     byte-identical to the pre-binding route for anyone who has never opened the setting;
 *  3. the THEME. `hero` chooses among what is left.
 *
 * The poster is not in this chain: it renders under every treatment, for every class.
 */
export interface HeroLayout {
    treatment: ItemDetailsHero;
    /** Whether the decorative backdrop layer is rendered. Never a request decision. */
    backdrop: boolean;
    /** Whether the item's logo is rendered when it has one. */
    logo: boolean;
}

export function resolveHeroLayout(options: {
    treatment: ItemDetailsHero;
    itemSupportsBackdrop: boolean;
    userWantsBackdrop: boolean;
}): HeroLayout {
    const { treatment, itemSupportsBackdrop, userWantsBackdrop } = options;
    return {
        treatment,
        backdrop:
            treatment === 'backdrop' &&
            itemSupportsBackdrop &&
            userWantsBackdrop,
        // `minimal` is minimal decoration: the title carries the item, not its logotype. The poster
        // stays either way, and the logo URL is still built, so no treatment changes the request set.
        logo: treatment !== 'minimal'
    };
}

/** Every published family, for the Studio's control and for the totality proof. */
export const PUBLISHED_FAMILIES: readonly ItemDetailsSection[] =
    ITEM_DETAILS_SECTIONS;

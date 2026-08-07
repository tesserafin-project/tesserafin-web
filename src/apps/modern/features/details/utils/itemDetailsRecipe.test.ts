/**
 * The semantic composition model, proven mechanically rather than by inspection.
 *
 * #129 Step 2 derives a PUBLIC vocabulary of content families from a PRIVATE set of 33
 * characterization hooks. Four things have to be true for that derivation to be sound, and none of
 * them is obvious by reading the table:
 *
 *   1. every concrete surface is classified exactly once — no gaps, no duplicates;
 *   2. no private identifier and no fixed region leaked into the published enum;
 *   3. within any single page, a family's surfaces are CONTIGUOUS, so a family renders as one
 *      block and never interleaves with another;
 *   4. the family order the platform default declares agrees with the order the view emits, for
 *      every pair of families that can appear together.
 *
 * (3) and (4) are the ones that would otherwise be checked by eye. They are checked here over
 * every ordered pair, using the co-occurrence rules the route's own query gates encode.
 */
import { describe, expect, it } from 'vitest';

import {
    ITEM_DETAILS_HEROES,
    ITEM_DETAILS_SECTIONS,
    THEME_CAPABILITIES,
    type ItemDetailsSection
} from 'themes/platform/contract';
import { PLATFORM_DEFAULT_PRESENTATION } from 'themes/platform/resolvePresentation';

import { DETAIL_SECTIONS } from '../constants/sections';
import {
    DETAIL_ITEM_TYPES,
    FIXED_REGIONS,
    SECTION_CLASSIFICATION,
    SURFACE_ITEM_TYPES,
    composeItemDetails,
    familyMembers,
    isFixedRegion,
    resolveHeroLayout
} from './itemDetailsRecipe';

const PUBLIC: readonly string[] = ITEM_DETAILS_SECTIONS;
const FIXED: readonly string[] = FIXED_REGIONS;

describe('the concrete-to-semantic mapping is total and single-valued', () => {
    it('classifies every concrete surface exactly once', () => {
        const keys = Object.keys(SECTION_CLASSIFICATION).sort();
        expect(keys).toEqual([...DETAIL_SECTIONS].sort());
        expect(keys).toHaveLength(33);
    });

    it('leaves no surface unclassified', () => {
        for (const name of DETAIL_SECTIONS) {
            const classification = SECTION_CLASSIFICATION[name];
            expect(
                [...PUBLIC, ...FIXED],
                `"${name}" has no classification`
            ).toContain(classification);
        }
    });

    it('classifies six surfaces as fixed and twenty-seven as theme-controllable', () => {
        const fixed = DETAIL_SECTIONS.filter((name) =>
            isFixedRegion(SECTION_CLASSIFICATION[name])
        );
        expect(fixed).toEqual([
            'nameContainer',
            'itemMiscInfo-primary',
            'itemMiscInfo-secondary',
            'mainDetailButtons',
            'trackSelections',
            'recordingFields'
        ]);
        expect(DETAIL_SECTIONS.length - fixed.length).toBe(27);
    });

    it('gives every published family at least one concrete surface', () => {
        for (const family of ITEM_DETAILS_SECTIONS) {
            expect(familyMembers(family).length, family).toBeGreaterThan(0);
        }
    });
});

describe('the private vocabulary stayed private', () => {
    it('publishes no data-detail-section identifier as a theme section', () => {
        for (const name of DETAIL_SECTIONS) {
            if ((PUBLIC as readonly string[]).includes(name)) {
                /*
                 * `overview` is the one collision, and it is not a leak: the family was named for
                 * the user-facing idea of an overview and was published before this route was
                 * migrated. Every OTHER concrete name must be absent.
                 */
                expect(name).toBe('overview');
            }
        }
    });

    it('publishes no fixed region as a theme section', () => {
        for (const region of FIXED_REGIONS) {
            expect(PUBLIC, `"${region}" is fixed`).not.toContain(region);
        }
    });

    it('publishes no fixed surface as a theme section', () => {
        const fixedSurfaces = DETAIL_SECTIONS.filter((name) =>
            isFixedRegion(SECTION_CLASSIFICATION[name])
        );
        for (const name of fixedSurfaces) {
            expect(PUBLIC, `"${name}" is a fixed surface`).not.toContain(name);
        }
    });

    /**
     * The naming rule, applied to the six names #129 Step 2 was free to choose.
     *
     * The five retained names are exempt, and the exemption is the point rather than a loophole:
     * `episodes` and `mediaInfo` were published before this route was migrated, both are wider
     * than they sound, and RENAMING a member of a closed enum would invalidate manifests that are
     * valid today. That cost is paid once, recorded in `contract.ts`, and not extended — a seventh
     * name that encoded an item type would fail here.
     */
    it('names no item type and no component in the six names Step 2 chose', () => {
        const retained = ['overview', 'cast', 'episodes', 'related', 'mediaInfo'];
        const added = ITEM_DETAILS_SECTIONS.filter(
            (family) => !retained.includes(family)
        );
        expect(added).toEqual([
            'nextUp',
            'lyrics',
            'moreFrom',
            'schedule',
            'extras',
            'chapters'
        ]);

        for (const family of added) {
            for (const type of DETAIL_ITEM_TYPES) {
                expect(
                    family.toLowerCase(),
                    `"${family}" encodes the item type "${type}"`
                ).not.toContain(type.toLowerCase());
            }
            expect(family).not.toMatch(/Collapsible|Section|Container|Grid|List/);
        }
    });

    it('is a capability the contract defines', () => {
        expect(THEME_CAPABILITIES).toContain('presentation.page.itemDetails');
    });
});

/**
 * The order proof, run per ITEM TYPE rather than per fixture.
 *
 * For one item type, the surfaces that can render are known from the gates
 * ({@link SURFACE_ITEM_TYPES}), and the order the view emits them in is their order in
 * {@link DETAIL_SECTIONS}. The published family order reproduces that order if and only if, for
 * every type, mapping each eligible surface to its family yields a sequence that is a
 * subsequence-preserving grouping of the default order. Which is to say two things must hold:
 *
 *   - CONTIGUITY: a family's eligible surfaces form one uninterrupted run;
 *   - ORDER: the runs appear in the same relative order as the published families.
 *
 * This is fixture-independent, so it covers `itemDeathDate`, `childrenCollapsible`,
 * `seriesScheduleSection` and `itemMiscInfo-primary` — the four surfaces no equivalence class
 * exercises — and it is what catches the trap the `schedule` family sets: its three surfaces sit
 * at positions 15, 18 and 27, so any placement of that family is wrong for some type unless the
 * three are mutually exclusive, which they are.
 */
describe('the platform-default order agrees with the order the view emits', () => {
    const themeControllable = DETAIL_SECTIONS.filter(
        (name) => !isFixedRegion(SECTION_CLASSIFICATION[name])
    );

    const eligibleFor = (type: string) =>
        themeControllable.filter((name) =>
            (SURFACE_ITEM_TYPES[name] as readonly string[]).includes(type)
        );

    it.each(DETAIL_ITEM_TYPES)(
        'a %s renders each family as one uninterrupted run',
        (type) => {
            const families = eligibleFor(type).map(
                (name) => SECTION_CLASSIFICATION[name] as ItemDetailsSection
            );
            const runs: ItemDetailsSection[] = [];
            for (const family of families) {
                if (runs[runs.length - 1] !== family) runs.push(family);
            }
            expect(
                runs,
                `a ${type} interleaves two families: ${families.join(' ')}`
            ).toEqual([...new Set(runs)]);
        }
    );

    it.each(DETAIL_ITEM_TYPES)(
        'a %s renders its families in the published order',
        (type) => {
            const families = eligibleFor(type).map(
                (name) => SECTION_CLASSIFICATION[name] as ItemDetailsSection
            );
            const runs = [...new Set(families)];
            const published = ITEM_DETAILS_SECTIONS.filter((family) =>
                runs.includes(family)
            );
            expect(
                runs,
                `a ${type} emits ${runs.join(' → ')} but the default declares `
                    + `${published.join(' → ')}`
            ).toEqual([...published]);
        }
    );

    it('every theme-controllable surface is eligible for at least one type', () => {
        for (const name of themeControllable) {
            expect(SURFACE_ITEM_TYPES[name].length, name).toBeGreaterThan(0);
        }
    });

    it('the default order IS the published enum order', () => {
        expect(PLATFORM_DEFAULT_PRESENTATION.page.itemDetails.sections).toEqual(
            [...ITEM_DETAILS_SECTIONS]
        );
    });
});

describe('composeItemDetails', () => {
    const defaults = PLATFORM_DEFAULT_PRESENTATION.page.itemDetails;

    it('renders each selected family at most once', () => {
        const composed = composeItemDetails({
            hero: 'backdrop',
            sections: ['cast', 'cast', 'overview', 'cast']
        });
        expect(composed.families.map((entry) => entry.family)).toEqual([
            'cast',
            'overview'
        ]);
    });

    it('honours the recipe order exactly', () => {
        const composed = composeItemDetails({
            hero: 'poster',
            sections: ['related', 'cast', 'overview']
        });
        expect(composed.families.map((entry) => entry.family)).toEqual([
            'related',
            'cast',
            'overview'
        ]);
        expect(composed.hero).toBe('poster');
    });

    it('falls back to the platform default when nothing is selected', () => {
        const composed = composeItemDetails({ hero: 'backdrop', sections: [] });
        expect(composed.families.map((entry) => entry.family)).toEqual([
            ...defaults.sections
        ]);
    });

    it('keeps the primary column a contiguous prefix', () => {
        // Default: overview and mediaInfo lead, so both sit beside the poster.
        const byDefault = composeItemDetails(defaults);
        expect(byDefault.families.slice(0, 2)).toEqual([
            { family: 'overview', column: 'hero' },
            { family: 'mediaInfo', column: 'hero' }
        ]);
        expect(
            byDefault.families.slice(2).every((e) => e.column === 'full')
        ).toBe(true);

        // Reordered: a full-width family first demotes everything after it, so the layout never
        // produces a column-2 island below a full-width block.
        const reordered = composeItemDetails({
            hero: 'backdrop',
            sections: ['cast', 'overview', 'mediaInfo']
        });
        expect(reordered.families).toEqual([
            { family: 'cast', column: 'full' },
            { family: 'overview', column: 'full' },
            { family: 'mediaInfo', column: 'full' }
        ]);
    });
});

describe('resolveHeroLayout — precedence', () => {
    it('renders the backdrop only under the backdrop treatment', () => {
        for (const treatment of ITEM_DETAILS_HEROES) {
            const layout = resolveHeroLayout({
                treatment,
                itemSupportsBackdrop: true,
                userWantsBackdrop: true
            });
            expect(layout.backdrop, treatment).toBe(treatment === 'backdrop');
        }
    });

    it('lets the item outrank the theme', () => {
        // Person and Book. No treatment can give them one.
        for (const treatment of ITEM_DETAILS_HEROES) {
            expect(
                resolveHeroLayout({
                    treatment,
                    itemSupportsBackdrop: false,
                    userWantsBackdrop: true
                }).backdrop,
                treatment
            ).toBe(false);
        }
    });

    it('lets the user outrank the theme', () => {
        expect(
            resolveHeroLayout({
                treatment: 'backdrop',
                itemSupportsBackdrop: true,
                userWantsBackdrop: false
            }).backdrop
        ).toBe(false);
    });

    it('drops the logotype only under the minimal treatment', () => {
        expect(
            resolveHeroLayout({
                treatment: 'minimal',
                itemSupportsBackdrop: true,
                userWantsBackdrop: true
            }).logo
        ).toBe(false);
        for (const treatment of ['backdrop', 'poster'] as const) {
            expect(
                resolveHeroLayout({
                    treatment,
                    itemSupportsBackdrop: true,
                    userWantsBackdrop: true
                }).logo,
                treatment
            ).toBe(true);
        }
    });
});

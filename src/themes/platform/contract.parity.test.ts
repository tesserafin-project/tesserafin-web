/**
 * Keeps `contract.ts` and `theme.schema.json` from drifting.
 *
 * `contract.ts` is hand-written, so nothing forces it to match the schema. The parts where a
 * mismatch would actually break something are the closed vocabularies: a capability name or a
 * presentation value that exists in one and not the other would either be accepted by the app and
 * rejected by the generator, or offered in the Theme Studio and refused on import. Both are worse
 * than a compile error, because both only show up with a real theme in hand.
 */
import { describe, expect, it } from 'vitest';

import themeSchema from '../../../tesserafin-design/schema/theme.schema.json';
import {
    HOME_SECTIONS,
    HOME_SHELF_DENSITIES,
    ITEM_DETAILS_HEROES,
    ITEM_DETAILS_SECTIONS,
    LIBRARY_CARD_ASPECTS,
    LIBRARY_FILTER_PRESENTATIONS,
    LIBRARY_LAYOUTS,
    THEME_CAPABILITIES,
    WEB_RENDERER_CAPABILITIES
} from './contract';

const defs = themeSchema.$defs as Record<string, Record<string, unknown>>;

describe('contract.ts <-> theme.schema.json', () => {
    it('declares exactly the schema capability vocabulary', () => {
        expect([...THEME_CAPABILITIES].sort()).toEqual(
            [...(defs.capabilityName.enum as string[])].sort()
        );
    });

    it('never claims a Web renderer capability the vocabulary does not define', () => {
        for (const capability of WEB_RENDERER_CAPABILITIES) {
            expect(THEME_CAPABILITIES).toContain(capability);
        }
    });

    it.each([
        'source.web.css',
        // Removed once it was checked: a theme's `assets` block names a package-relative path, and
        // there is no theme package, so nothing could have resolved one. Binding it needs the
        // package format (#117), not a loader.
        'assets.roles'
        // `presentation.page.home` was on this list until the modern Home route actually read a
        // resolved recipe, `presentation.page.library` until `apps/modern/features/library` did,
        // and `presentation.page.itemDetails` until `apps/modern/features/details` did (#129
        // Step 2). All three are off it because there is code reading them, which is the only
        // thing that ever justified moving a name from one list to the other.
    ])(
        'leaves the not-yet-bound capability %s out of the Web renderer list',
        (capability) => {
            // The point of the capability mechanism is that "defined" and "implemented" are
            // different statements. If one of these appears here, the renderer must really
            // implement it — and there must be code reading it, not just a name in a list.
            expect(WEB_RENDERER_CAPABILITIES).not.toContain(capability);
        }
    );

    it('names every capability as either implemented or not-yet-bound, with none unaccounted for', () => {
        // A new capability added to the vocabulary and to neither list would be invisible: no
        // renderer support, no record that it is pending. This forces the choice to be made.
        const notYetBound = ['source.web.css', 'assets.roles'];
        expect([...WEB_RENDERER_CAPABILITIES, ...notYetBound].sort()).toEqual(
            [...THEME_CAPABILITIES].sort()
        );
    });

    it.each([
        ['surfaceVariant', 'variant', ['glass', 'opaque']],
        ['surfaceVariant', 'border', ['none', 'hairline']],
        ['mediaCardVariant', 'imageAspect', ['poster', 'backdrop', 'square']],
        ['mediaCardVariant', 'titlePlacement', ['below', 'overlay']],
        ['mediaCardVariant', 'hoverEffect', ['none', 'lift', 'zoom']],
        ['navigationVariant', 'shell', ['sidebar', 'rail', 'topbar']],
        ['navigationVariant', 'labels', ['always', 'active', 'never']],
        ['navigationVariant', 'position', ['start', 'end']]
    ])('publishes %s.%s as %j', (defName, key, expected) => {
        const group = defs[defName].properties as Record<
            string,
            { enum: string[] }
        >;
        expect(group[key].enum).toEqual(expected);
    });

    it('publishes the Home recipe vocabulary as runtime lists identical to the schema', () => {
        /*
         * `HOME_SECTIONS` and `HOME_SHELF_DENSITIES` are not decoration: `resolvePresentation`
         * uses them to REJECT values at runtime, because the applied-presentation record in
         * `localStorage` is hand-editable and a union type cannot filter it. A name in the schema
         * and not in the list would therefore be silently stripped from a perfectly valid theme —
         * the failure would look like "my recipe does nothing", with nothing red anywhere.
         */
        const home = (
            defs.pageRecipes.properties as Record<
                string,
                {
                    properties: {
                        sections: { items: { enum: string[] } };
                        shelfDensity: { enum: string[] };
                    };
                }
            >
        ).home;
        expect([...HOME_SECTIONS]).toEqual(home.properties.sections.items.enum);
        expect([...HOME_SHELF_DENSITIES]).toEqual(
            home.properties.shelfDensity.enum
        );
    });

    it('publishes the Library recipe vocabulary as runtime lists identical to the schema', () => {
        // Same reason as the Home lists above: `resolvePresentation.sanitizeLibraryRecipe` REJECTS
        // values with these at runtime, so a name in the schema and not in the list would be
        // silently stripped from a valid theme — "my recipe does nothing", with nothing red.
        const library = (
            defs.pageRecipes.properties as Record<
                string,
                {
                    properties: {
                        layout: { enum: string[] };
                        cardAspect: { enum: string[] };
                        filters: { enum: string[] };
                    };
                }
            >
        ).library;
        expect([...LIBRARY_LAYOUTS]).toEqual(library.properties.layout.enum);
        expect([...LIBRARY_CARD_ASPECTS]).toEqual(
            library.properties.cardAspect.enum
        );
        expect([...LIBRARY_FILTER_PRESENTATIONS]).toEqual(
            library.properties.filters.enum
        );
    });

    it('publishes the Item Details recipe vocabulary as runtime lists identical to the schema', () => {
        /*
         * Order matters here, not just membership. `PLATFORM_DEFAULT_PRESENTATION.page.itemDetails`
         * IS `ITEM_DETAILS_SECTIONS`, so the declaration order in `contract.ts` is the platform
         * default composition — and `itemDetails.recipe.test.tsx` proves that order reproduces the
         * pre-binding page for all 24 equivalence classes. A schema that listed the same names in
         * a different order would make the two documents disagree about what "the default" is.
         */
        const itemDetails = (
            defs.pageRecipes.properties as Record<
                string,
                {
                    properties: {
                        hero: { enum: string[] };
                        sections: { items: { enum: string[] } };
                    };
                }
            >
        ).itemDetails;
        expect([...ITEM_DETAILS_SECTIONS]).toEqual(
            itemDetails.properties.sections.items.enum
        );
        expect([...ITEM_DETAILS_HEROES]).toEqual(
            itemDetails.properties.hero.enum
        );
    });

    it('retains every Item Details section name that was published before the binding', () => {
        /*
         * The enum widened from five names to eleven in #129 Step 2. Widening a closed enum is
         * backward-compatible only if nothing was removed or renamed: a manifest that was valid
         * against the five must still be valid against the eleven, and `validateManifest.test.ts`
         * checks that end-to-end with a real manifest. This is the vocabulary half of the claim.
         */
        for (const published of [
            'overview',
            'cast',
            'episodes',
            'related',
            'mediaInfo'
        ]) {
            expect(ITEM_DETAILS_SECTIONS as readonly string[]).toContain(
                published
            );
        }
    });

    it('keeps the advanced-source extension point reserved but shaped', () => {
        const web = defs.webRenderer.properties as Record<string, never>;
        const source = web.source as unknown as {
            properties: { kind: { enum: string[] } };
        };
        // Present, so the package format already has the slot; narrowed to "none", so the contract
        // does not promise a compiler that has not been built.
        expect(source.properties.kind.enum).toEqual(['none']);
    });

    it('keeps every renderer optional, so the universal layer is never Web-only', () => {
        expect(themeSchema.required).not.toContain('renderers');
        expect(Object.keys(defs.reservedRenderer.properties as object)).toEqual(
            ['supports']
        );
    });
});

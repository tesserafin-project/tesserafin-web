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
import { THEME_CAPABILITIES, WEB_RENDERER_CAPABILITIES } from './contract';

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
        'presentation.page.home',
        'presentation.page.library',
        'presentation.page.itemDetails',
        // Removed once it was checked: a theme's `assets` block names a package-relative path, and
        // there is no theme package, so nothing could have resolved one. Binding it needs the
        // package format (#117), not a loader.
        'assets.roles'
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
        const notYetBound = [
            'source.web.css',
            'presentation.page.home',
            'presentation.page.library',
            'presentation.page.itemDetails',
            'assets.roles'
        ];
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

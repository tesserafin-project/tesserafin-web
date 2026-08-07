import { describe, expect, it } from 'vitest';

import type { ThemeCapability, ThemeManifest } from './contract';
import { WEB_RENDERER_CAPABILITIES } from './contract';
import {
    PLATFORM_DEFAULT_PRESENTATION,
    resolvePresentation
} from './resolvePresentation';

type PresentationInput = Pick<ThemeManifest, 'presentation' | 'capabilities'>;

describe('resolvePresentation — defaults', () => {
    it('returns a complete presentation for a theme that declares none', () => {
        const { presentation, fallbacks, activatable } = resolvePresentation(
            {}
        );
        expect(activatable).toBe(true);
        expect(fallbacks).toEqual([]);
        expect(presentation.surface).toEqual(
            PLATFORM_DEFAULT_PRESENTATION.surface
        );
        expect(presentation.page.itemDetails.hero).toBe('backdrop');
    });

    it('merges only the keys a theme actually declares', () => {
        const theme: PresentationInput = {
            presentation: { surface: { variant: 'glass' } }
        };
        const { presentation } = resolvePresentation(theme);
        expect(presentation.surface.variant).toBe('glass');
        // Untouched keys keep the platform default rather than becoming undefined.
        expect(presentation.surface.border).toBe(
            PLATFORM_DEFAULT_PRESENTATION.surface.border
        );
    });
});

describe('resolvePresentation — capability fallback', () => {
    /*
     * These two cases need a renderer that does NOT implement the capability under test.
     *
     * The subject was `presentation.page.home` until the Home binding landed, then
     * `.itemDetails` until #129 Step 2 bound that one too. Web now implements every
     * `presentation.*` capability the contract defines, so there is no longer a real Web gap to
     * point at — and relaxing these assertions instead would delete the only coverage of the
     * fallback path.
     *
     * The renderer list is therefore given EXPLICITLY. `resolvePresentation` takes it as a
     * parameter precisely so a renderer other than this build's Web can be resolved against, which
     * is what the Android and Apple renderers will do; a capability Web has bound is still one
     * another renderer may not have. The assertions are unchanged in strength.
     */
    const pageTheme: PresentationInput = {
        presentation: {
            page: { itemDetails: { hero: 'minimal', sections: ['overview'] } }
        }
    };

    /** A renderer that speaks everything this build's Web does, except the recipe under test. */
    const withoutItemDetails: readonly ThemeCapability[] =
        WEB_RENDERER_CAPABILITIES.filter(
            (capability) => capability !== 'presentation.page.itemDetails'
        );

    it('falls back to the default when the renderer does not support the capability', () => {
        const { presentation, fallbacks } = resolvePresentation(
            pageTheme,
            withoutItemDetails
        );
        expect(presentation.page.itemDetails).toEqual(
            PLATFORM_DEFAULT_PRESENTATION.page.itemDetails
        );
        expect(fallbacks).toEqual([
            {
                capability: 'presentation.page.itemDetails',
                reason: 'unsupported-by-renderer'
            }
        ]);
    });

    it('applies the theme value once a renderer declares the capability', () => {
        const { presentation, fallbacks } = resolvePresentation(
            pageTheme,
            WEB_RENDERER_CAPABILITIES
        );
        expect(presentation.page.itemDetails.hero).toBe('minimal');
        expect(presentation.page.itemDetails.sections).toEqual(['overview']);
        expect(fallbacks).toEqual([]);
    });

    it('this build of Web declares the capability, so the theme value is what renders', () => {
        // The other half of the binding: a Web renderer that resolved the recipe but did not
        // DECLARE it would leave `resolvePresentation` unable to report a fallback for it.
        expect(WEB_RENDERER_CAPABILITIES).toContain(
            'presentation.page.itemDetails'
        );
    });

    it('honours a Home recipe, because the Web renderer now implements it', () => {
        const { presentation, fallbacks } = resolvePresentation(
            {
                presentation: {
                    page: {
                        home: {
                            sections: ['hero', 'continueWatching'],
                            shelfDensity: 'spacious'
                        }
                    }
                }
            },
            WEB_RENDERER_CAPABILITIES
        );
        expect(presentation.page.home.sections).toEqual([
            'hero',
            'continueWatching'
        ]);
        expect(presentation.page.home.shelfDensity).toBe('spacious');
        expect(fallbacks).toEqual([]);
    });

    it('records no fallback for a capability the theme never used', () => {
        const { fallbacks } = resolvePresentation({}, []);
        expect(fallbacks).toEqual([]);
    });

    it('records one fallback per unsupported capability, not one per key', () => {
        const theme: PresentationInput = {
            presentation: {
                surface: { variant: 'glass', border: 'hairline' },
                mediaCard: { hoverEffect: 'zoom' }
            }
        };
        const { fallbacks } = resolvePresentation(theme, ['tokens.core']);
        expect(fallbacks.map((f) => f.capability)).toEqual([
            'presentation.surface',
            'presentation.mediaCard'
        ]);
    });
});

describe('resolvePresentation — required capabilities', () => {
    it('refuses to activate a theme requiring an unimplemented capability', () => {
        const theme: PresentationInput = {
            capabilities: { required: ['source.web.css'] }
        };
        const { activatable, missingRequired } = resolvePresentation(
            theme,
            WEB_RENDERER_CAPABILITIES
        );
        expect(activatable).toBe(false);
        expect(missingRequired).toEqual(['source.web.css']);
    });

    it('activates a theme whose required capabilities are all implemented', () => {
        const theme: PresentationInput = {
            capabilities: {
                required: ['tokens.core', 'presentation.surface'],
                optional: ['presentation.page.library']
            }
        };
        const { activatable, missingRequired } = resolvePresentation(
            theme,
            WEB_RENDERER_CAPABILITIES
        );
        expect(activatable).toBe(true);
        expect(missingRequired).toEqual([]);
    });

    it('an optional capability the renderer lacks never blocks activation', () => {
        const theme: PresentationInput = {
            capabilities: { optional: ['source.web.css'] },
            presentation: { page: { library: { layout: 'shelf' } } }
        };
        const { activatable } = resolvePresentation(
            theme,
            WEB_RENDERER_CAPABILITIES
        );
        expect(activatable).toBe(true);
    });
});

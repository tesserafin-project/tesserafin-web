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
    const pageTheme: PresentationInput = {
        presentation: {
            page: { home: { sections: ['hero', 'continueWatching'] } }
        }
    };

    it('falls back to the default when the renderer does not support the capability', () => {
        const { presentation, fallbacks } = resolvePresentation(
            pageTheme,
            WEB_RENDERER_CAPABILITIES
        );
        // presentation.page.home is DEFINED by the contract and NOT YET BOUND by the Web renderer.
        expect(presentation.page.home.sections).toEqual(
            PLATFORM_DEFAULT_PRESENTATION.page.home.sections
        );
        expect(fallbacks).toEqual([
            {
                capability: 'presentation.page.home',
                reason: 'unsupported-by-renderer'
            }
        ]);
    });

    it('applies the theme value once a renderer declares the capability', () => {
        const future: readonly ThemeCapability[] = [
            ...WEB_RENDERER_CAPABILITIES,
            'presentation.page.home'
        ];
        const { presentation, fallbacks } = resolvePresentation(
            pageTheme,
            future
        );
        expect(presentation.page.home.sections).toEqual([
            'hero',
            'continueWatching'
        ]);
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

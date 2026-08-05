// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_DEFAULT_PRESENTATION } from 'themes/platform';
import { PresentationProvider } from '../../presentation/PresentationContext';

import { Surface } from './Surface';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
        root = createRoot(container);
    });
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

describe('Surface', () => {
    it('renders its children and the slot attribute', () => {
        act(() => {
            root.render(<Surface>Frosted content</Surface>);
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface).not.toBeNull();
        expect(surface?.textContent).toContain('Frosted content');
    });

    /**
     * The no-prop, no-provider variant is now the PLATFORM DEFAULT rather than a literal baked into
     * the component (RFC-0007 §4.6). Asserted against `PLATFORM_DEFAULT_PRESENTATION` rather than
     * against `'opaque'`, so this test states the rule — "the default comes from the platform
     * default" — instead of restating today's value and having to be edited when it changes.
     *
     * It flipped glass → opaque with that change. Nothing regressed: the only `<Surface>` call sites
     * in the app pass an explicit variant, and under Tesserafin Classic the two classes are
     * pixel-identical anyway (`--rf-backdrop-filter-md: none`, opaque `--rf-color-surface`). What
     * changed is that the class now says what the theme asked for.
     */
    it('takes its variant from the platform default when nothing else says', () => {
        act(() => {
            root.render(<Surface>content</Surface>);
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface?.className).toContain(
            `rf-surface--${PLATFORM_DEFAULT_PRESENTATION.surface.variant}`
        );
    });

    it('takes its variant from the active theme when inside a provider', () => {
        act(() => {
            root.render(
                <PresentationProvider themeId='official.glass'>
                    <Surface>content</Surface>
                </PresentationProvider>
            );
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        // Tesserafin Glass declares `presentation.surface.variant: "glass"`; Classic declares
        // "opaque". Reading them from the shipped manifests is the point — this is the assertion
        // that would fail if the manifest → component join were removed.
        expect(surface?.className).toContain('rf-surface--glass');
        expect(surface?.className).not.toContain('rf-surface--opaque');
    });

    it('lets an explicit prop win over the theme', () => {
        act(() => {
            root.render(
                <PresentationProvider themeId='official.glass'>
                    <Surface variant='opaque'>content</Surface>
                </PresentationProvider>
            );
        });

        // A call site that genuinely needs one treatment must be able to say so; a theme
        // overriding that would be a theme deciding layout semantics rather than presentation.
        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface?.className).toContain('rf-surface--opaque');
    });

    it('projects the theme border and elevation choices as attributes', () => {
        act(() => {
            root.render(
                <PresentationProvider themeId='official.glass'>
                    <Surface>content</Surface>
                </PresentationProvider>
            );
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface?.getAttribute('data-rf-surface-border')).toBe(
            'hairline'
        );
        expect(surface?.getAttribute('data-rf-surface-elevation')).toBe(
            'level2'
        );
    });

    it('applies the opaque modifier when variant="opaque"', () => {
        act(() => {
            root.render(<Surface variant='opaque'>content</Surface>);
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface?.className).toContain('rf-surface--opaque');
        expect(surface?.className).not.toContain('rf-surface--glass');
    });

    it('forwards className and standard div props', () => {
        act(() => {
            root.render(
                <Surface className='custom' id='panel'>
                    content
                </Surface>
            );
        });

        const surface = container.querySelector('[data-rf-slot="surface"]');
        expect(surface?.className).toContain('custom');
        expect(surface?.id).toBe('panel');
    });
});

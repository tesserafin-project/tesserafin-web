import { beforeEach, describe, expect, it } from 'vitest';

import { loadAppliedPresentation } from 'themes/platform/localPresentation';

import { createDraft } from './draftState';
import {
    applyLocalThemeOverlay,
    buildOverlayCss,
    clearLocalThemeOverlay,
    getAppliedLocalThemeId
} from './localThemeOverlay';
import { getOfficialSource } from './officialSources';

/** Narrowed at the boundary, so every use below is typed rather than repeatedly guarded. */
function requireSource(id: string) {
    const source = getOfficialSource(id);
    if (!source) throw new Error(`${id} must be a startable source`);
    return source;
}

const glass = requireSource('official.glass');

const draft = createDraft(glass, 'Overlay test', 'Local author');

describe('buildOverlayCss', () => {
    it('scopes to the draft id, so nothing applies until the attribute is set', () => {
        expect(buildOverlayCss(draft, 'dark')).toContain(
            ':root[data-rf-local-theme="local.overlay-test"]'
        );
    });

    it('projects the active mode only', () => {
        const dark = buildOverlayCss(draft, 'dark');
        const light = buildOverlayCss(draft, 'light');
        expect(dark).toContain(
            `--rf-color-background: ${glass.tokens.color.dark.background};`
        );
        expect(light).toContain(
            `--rf-color-background: ${glass.tokens.color.light?.background};`
        );
        expect(dark).not.toContain(
            `--rf-color-background: ${glass.tokens.color.light?.background};`
        );
    });

    it('emits the derived backdrop-filter companions the generator emits', () => {
        // Glass has non-zero blur, so this is the case where getting it wrong is visible.
        expect(buildOverlayCss(draft, 'dark')).toContain(
            '--rf-backdrop-filter-md:'
        );
    });

    it('kebab-cases compound token names the same way the generator does', () => {
        expect(buildOverlayCss(draft, 'dark')).toContain(
            '--rf-color-surface-variant:'
        );
        expect(buildOverlayCss(draft, 'dark')).toContain(
            '--rf-typography-font-family-base:'
        );
    });
});

describe('apply and clear', () => {
    beforeEach(() => {
        clearLocalThemeOverlay(document);
    });

    it('does nothing to the document until applied', () => {
        expect(getAppliedLocalThemeId(document)).toBeNull();
        expect(
            document.getElementById('tesserafin-local-theme-overlay')
        ).toBeNull();
    });

    it('applies exactly one style element and marks the root', () => {
        applyLocalThemeOverlay(draft, 'dark', document);
        applyLocalThemeOverlay(draft, 'light', document);

        expect(
            document.querySelectorAll('#tesserafin-local-theme-overlay')
        ).toHaveLength(1);
        expect(getAppliedLocalThemeId(document)).toBe('local.overlay-test');
    });

    it('appends the overlay last, so it wins over the generated stylesheet', () => {
        const earlier = document.createElement('style');
        document.head.appendChild(earlier);
        applyLocalThemeOverlay(draft, 'dark', document);
        expect(document.head.lastElementChild?.id).toBe(
            'tesserafin-local-theme-overlay'
        );
        earlier.remove();
    });

    it('clears completely, leaving no attribute and no stylesheet', () => {
        applyLocalThemeOverlay(draft, 'dark', document);
        clearLocalThemeOverlay(document);
        expect(getAppliedLocalThemeId(document)).toBeNull();
        expect(
            document.getElementById('tesserafin-local-theme-overlay')
        ).toBeNull();
    });

    it('uses a stylesheet, not inline root styles — so accessibility profiles still win', () => {
        applyLocalThemeOverlay(draft, 'dark', document);
        // Interaction profiles write INLINE `--rf-*` on <html>; inline beats any stylesheet. If the
        // overlay ever wrote inline styles too, a draft could defeat reduced-motion and
        // reduced-transparency, which RFC-0007 §6.1 forbids.
        expect(
            document.documentElement.style.getPropertyValue(
                '--rf-color-background'
            )
        ).toBe('');
    });
});

describe('applying a draft records its presentation, not just its tokens', () => {
    beforeEach(() => {
        clearLocalThemeOverlay(document);
    });

    it('writes the draft presentation on apply', () => {
        applyLocalThemeOverlay(draft, 'dark', document);
        // Without this, an applied draft would change colour and type but not surfaces, cards or
        // navigation — the Studio's presentation controls would be preview-only.
        expect(loadAppliedPresentation()).toEqual(draft.manifest.presentation);
    });

    it('clears it together with the stylesheet', () => {
        applyLocalThemeOverlay(draft, 'dark', document);
        clearLocalThemeOverlay(document);
        // Cleared together, so the tokens and the presentation can never describe different themes.
        expect(loadAppliedPresentation()).toBeNull();
    });
});

import { describe, expect, it } from 'vitest';

import {
    THEME_REGISTRY,
    getDefaultThemeEntry,
    getSelectableThemeEntries,
    getThemeEntry
} from './registry';

describe('THEME_REGISTRY', () => {
    it('has a non-empty list of entries', () => {
        expect(THEME_REGISTRY.length).toBeGreaterThan(0);
    });

    it('includes the official.classic entry as the default builtin theme', () => {
        const classic = getThemeEntry('official.classic');
        expect(classic).toBeDefined();
        expect(classic?.builtin).toBe(true);
        expect(classic?.default).toBe(true);
    });

    it('includes the official.glass entry as a non-default builtin theme', () => {
        const glass = getThemeEntry('official.glass');
        expect(glass).toBeDefined();
        expect(glass?.builtin).toBe(true);
        expect(glass?.defaultMode).toBe('dark');
        expect(glass?.legacyPreset).toBeUndefined();
        expect(glass?.default).toBeUndefined();
    });

    it('marks official.glass as experimental (badged in pickers, issue #18 G18b-1)', () => {
        expect(getThemeEntry('official.glass')?.experimental).toBe(true);
    });

    it('does not make official.glass the default (Glass is opt-in, never auto-activated)', () => {
        expect(getThemeEntry('official.glass')?.default).toBeUndefined();
        expect(getDefaultThemeEntry().id).toBe('official.classic');
    });

    it('does not mark any other entry as experimental', () => {
        for (const theme of THEME_REGISTRY) {
            if (theme.id === 'official.glass') continue;
            expect(theme.experimental).toBeUndefined();
        }
    });

    it('includes the six legacy themes, marked as legacy presets', () => {
        const legacyIds = [
            'dark',
            'light',
            'appletv',
            'blueradiance',
            'purplehaze',
            'wmc'
        ];

        for (const id of legacyIds) {
            const entry = getThemeEntry(id);
            expect(
                entry,
                `expected a registry entry for "${id}"`
            ).toBeDefined();
            expect(entry?.legacyPreset).toBe(true);
            expect(entry?.builtin).toBe(true);
        }
    });

    it('has unique ids', () => {
        const ids = THEME_REGISTRY.map((theme) => theme.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('has exactly one default entry', () => {
        const defaults = THEME_REGISTRY.filter((theme) => theme.default);
        expect(defaults).toHaveLength(1);
    });

    it('has every entry populated with the required fields', () => {
        for (const theme of THEME_REGISTRY) {
            expect(theme.id).toEqual(expect.any(String));
            expect(theme.id.length).toBeGreaterThan(0);
            expect(theme.name).toEqual(expect.any(String));
            expect(theme.name.length).toBeGreaterThan(0);
            expect(theme.color).toMatch(/^#[0-9a-f]{6}$/i);
            expect(['dark', 'light']).toContain(theme.defaultMode);
            expect(theme.builtin).toBe(true);
            expect(typeof theme.loadColorScheme).toBe('function');
        }
    });

    it.each(THEME_REGISTRY.map((theme) => theme.id))(
        'loadColorScheme() resolves a color scheme for "%s"',
        async (id) => {
            const entry = getThemeEntry(id);
            const colorScheme = await entry?.loadColorScheme();

            expect(colorScheme).toBeDefined();
            expect(colorScheme?.palette).toBeDefined();
            expect(['dark', 'light']).toContain(colorScheme?.palette?.mode);
        }
    );

    it('resolves each color scheme to a palette mode matching its defaultMode', async () => {
        for (const theme of THEME_REGISTRY) {
            const colorScheme = await theme.loadColorScheme();
            expect(colorScheme.palette?.mode).toBe(theme.defaultMode);
        }
    });
});

describe('getThemeEntry()', () => {
    it('returns undefined for an unknown id', () => {
        expect(getThemeEntry('does-not-exist')).toBeUndefined();
    });

    it('returns the matching entry for a known id', () => {
        expect(getThemeEntry('wmc')?.name).toBe('WMC');
    });
});

describe('getDefaultThemeEntry()', () => {
    it('returns the official.classic entry', () => {
        expect(getDefaultThemeEntry().id).toBe('official.classic');
    });
});

describe('getSelectableThemeEntries()', () => {
    // Inverts the pre-G18b-1 invariant: Glass used to be filtered out of every picker. Issue #18's
    // G18b-1 slice makes it selectable (opt-in, badged) — so the assertion that it is *reachable*
    // is now the one worth pinning, since regressing it would silently hide the theme again.
    it('offers experimental entries (official.glass) rather than hiding them', () => {
        const selectable = getSelectableThemeEntries();
        expect(selectable.some((theme) => theme.id === 'official.glass')).toBe(
            true
        );
    });

    it('offers every registry entry', () => {
        expect(getSelectableThemeEntries().map((theme) => theme.id)).toEqual(
            THEME_REGISTRY.map((theme) => theme.id)
        );
    });

    it('offers exactly one default, still official.classic', () => {
        const defaults = getSelectableThemeEntries().filter(
            (theme) => theme.default
        );
        expect(defaults.map((theme) => theme.id)).toEqual(['official.classic']);
    });
});

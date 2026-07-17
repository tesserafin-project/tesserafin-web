import { describe, expect, it } from 'vitest';

import {
    THEME_REGISTRY,
    getDefaultThemeEntry,
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

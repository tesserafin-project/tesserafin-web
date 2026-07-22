import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '../scripts/validate-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESSERAFIN_DESIGN_DIR = join(__dirname, '..');

function readJson(path: string) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

const themeSchema = readJson(
    join(TESSERAFIN_DESIGN_DIR, 'schema', 'theme.schema.json')
);
const tokensSchema = readJson(
    join(TESSERAFIN_DESIGN_DIR, 'schema', 'tokens.schema.json')
);
const classicTheme = readJson(
    join(TESSERAFIN_DESIGN_DIR, 'themes', 'classic', 'theme.json')
);
const classicTokens = readJson(
    join(TESSERAFIN_DESIGN_DIR, 'themes', 'classic', 'tokens.json')
);

describe('tesserafin-design/themes/classic', () => {
    it('theme.json validates against theme.schema.json', () => {
        expect(validate(themeSchema, classicTheme)).toEqual([]);
    });

    it('tokens.json validates against tokens.schema.json', () => {
        expect(validate(tokensSchema, classicTokens)).toEqual([]);
    });

    it('declares the RFC-0005 §8.1 identity (official.classic, web-only compatibility, both modes)', () => {
        expect(classicTheme.id).toBe('official.classic');
        expect(classicTheme.license).toBe('GPL-2.0-or-later');
        expect(classicTheme.compatibility).toEqual({ web: '>=13.0' });
        expect(classicTheme.modes.sort()).toEqual(['dark', 'light']);
    });

    it('provides both light and dark color groups', () => {
        expect(Object.keys(classicTokens.color).sort()).toEqual([
            'dark',
            'light'
        ]);
    });
});

describe('tesserafin-design/schema/theme.schema.json (validator sanity)', () => {
    it('rejects a manifest missing required fields', () => {
        const errors = validate(themeSchema, { id: 'official.classic' });
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some((error: string) => error.includes('license'))).toBe(
            true
        );
    });

    it('rejects a manifest with an id that does not match the namespace.name pattern', () => {
        const errors = validate(themeSchema, {
            ...classicTheme,
            id: 'NotNamespaced'
        });
        expect(errors.some((error: string) => error.includes('$.id'))).toBe(
            true
        );
    });

    it('rejects a compatibility object with zero platforms', () => {
        const errors = validate(themeSchema, {
            ...classicTheme,
            compatibility: {}
        });
        expect(
            errors.some((error: string) => error.includes('minProperties'))
        ).toBe(true);
    });
});

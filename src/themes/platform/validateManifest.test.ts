import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    assertNoExecutableSurface,
    satisfiesLooseRange,
    validateManifest,
    validateThemePackage
} from './validateManifest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const THEMES_DIR = join(REPO_ROOT, 'tesserafin-design', 'themes');

function readShippedManifest(slug: string): string {
    return readFileSync(join(THEMES_DIR, slug, 'theme.json'), 'utf8');
}

describe('validateThemePackage — official themes', () => {
    it.each(['classic', 'glass'])('accepts the shipped %s manifest', (slug) => {
        const result = validateThemePackage(readShippedManifest(slug));
        expect(result.issues).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('reads contract v2 off the shipped manifests', () => {
        for (const slug of ['classic', 'glass']) {
            const result = validateThemePackage(readShippedManifest(slug));
            expect(result.valid && result.manifest.contractVersion).toBe(2);
        }
    });

    it('carries the Tesserafin display name, never the inherited one', () => {
        const names = ['classic', 'glass'].map((slug) => {
            const result = validateThemePackage(readShippedManifest(slug));
            return result.valid ? result.manifest.name : null;
        });
        expect(names).toEqual(['Tesserafin Classic', 'Tesserafin Glass']);
    });
});

describe('validateThemePackage — malformed input', () => {
    it('rejects malformed JSON without throwing', () => {
        const result = validateThemePackage('{ "id": "official.classic", ');
        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('malformed-json');
    });

    it('rejects a JSON document that is not an object', () => {
        expect(validateThemePackage('[1, 2, 3]').issues[0].code).toBe(
            'not-an-object'
        );
        expect(validateThemePackage('"a string"').issues[0].code).toBe(
            'not-an-object'
        );
        expect(validateThemePackage('null').issues[0].code).toBe(
            'not-an-object'
        );
    });

    it('rejects an empty file', () => {
        expect(validateThemePackage('').issues[0].code).toBe('malformed-json');
    });
});

describe('validateThemePackage — contract version', () => {
    const V1_MANIFEST = JSON.stringify({
        id: 'official.classic',
        version: '0.1.0',
        name: 'Classic',
        author: 'Someone',
        license: 'MIT',
        compatibility: { web: '>=13.0' },
        modes: ['dark']
    });

    it('rejects a v1 manifest and says so specifically', () => {
        const result = validateThemePackage(V1_MANIFEST);
        expect(result.valid).toBe(false);
        expect(result.issues[0].code).toBe('unsupported-contract-version');
        expect(result.issues[0].message).toContain('v1 contract');
    });

    it('rejects a future contract version', () => {
        const result = validateManifest({ contractVersion: 99 });
        expect(result.issues[0].code).toBe('unsupported-contract-version');
    });
});

describe('validateThemePackage — closed vocabulary', () => {
    const base = {
        contractVersion: 2,
        id: 'community.test',
        version: '1.0.0',
        name: 'Test',
        author: 'Test',
        license: 'MIT',
        compatibility: { web: '>=13.0' },
        modes: ['dark']
    };

    it('rejects an unknown top-level key', () => {
        const result = validateManifest({ ...base, script: 'doSomething()' });
        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'schema-violation')).toBe(
            true
        );
    });

    it('rejects an unknown key inside a profile override', () => {
        // v1 typed profileOverride as additionalProperties:true, so this passed there.
        const result = validateManifest({
            ...base,
            profiles: { remote: { somethingArbitrary: 'value' } }
        });
        expect(result.valid).toBe(false);
    });

    it('rejects an undefined capability name', () => {
        const result = validateManifest({
            ...base,
            capabilities: { required: ['presentation.everything'] }
        });
        expect(result.valid).toBe(false);
    });

    it('rejects a presentation value outside the published vocabulary', () => {
        const result = validateManifest({
            ...base,
            presentation: { surface: { variant: 'neumorphic' } }
        });
        expect(result.valid).toBe(false);
    });

    it('rejects an advanced source kind before the compiler boundary exists', () => {
        const result = validateManifest({
            ...base,
            renderers: { web: { source: { kind: 'scss' } } }
        });
        expect(result.valid).toBe(false);
    });

    it('accepts the reserved source extension point at kind "none"', () => {
        const result = validateManifest({
            ...base,
            renderers: { web: { source: { kind: 'none' } } }
        });
        expect(result.issues).toEqual([]);
    });
});

describe('assertNoExecutableSurface', () => {
    it.each([
        ['<script>alert(1)</script>', 'a <script> element'],
        ['{"assets":{"logo":"javascript:alert(1)"}}', 'a javascript: URL'],
        [
            '{"assets":{"logo":"https://example.invalid/x.png"}}',
            'a network URL'
        ],
        ['{"x":"data:text/html,<b>"}', 'a data: HTML URL'],
        ['{"x":"<img onerror=alert(1)>"}', 'an inline event handler'],
        ['{"x":"eval(atob(y))"}', 'an eval() call'],
        ['{"x":"new Function(z)"}', 'a Function constructor'],
        ['{"x":"import(\'./evil.js\')"}', 'a dynamic import()']
    ])('flags %s', (raw, what) => {
        const issues = assertNoExecutableSurface(raw);
        expect(issues.length).toBeGreaterThan(0);
        expect(issues.some((i) => i.message.includes(what))).toBe(true);
    });

    it('passes the shipped manifests', () => {
        for (const slug of ['classic', 'glass']) {
            expect(
                assertNoExecutableSurface(readShippedManifest(slug))
            ).toEqual([]);
        }
    });

    it('short-circuits before JSON parsing, so an executable surface in malformed JSON is still reported', () => {
        const result = validateThemePackage('{ <script>alert(1)</script>');
        expect(result.issues[0].code).toBe('executable-surface');
    });
});

describe('satisfiesLooseRange', () => {
    it.each([
        ['13.0.0', '>=13.0', true],
        ['12.9.0', '>=13.0', false],
        ['1.4.0', '^1.0.0', true],
        ['2.0.0', '^1.0.0', false],
        ['1.2.9', '~1.2.0', true],
        ['1.3.0', '~1.2.0', false],
        ['13.0.0', '13.0.0', true]
    ])('%s against %s is %s', (version, range, expected) => {
        expect(satisfiesLooseRange(version, range)).toBe(expected);
    });

    it('reports an incompatible web version as its own issue code', () => {
        const result = validateManifest(
            JSON.parse(readShippedManifest('classic')),
            '12.0.0'
        );
        expect(result.issues[0].code).toBe('incompatible-web-version');
    });

    it('accepts a compatible web version', () => {
        const result = validateManifest(
            JSON.parse(readShippedManifest('classic')),
            '13.4.0'
        );
        expect(result.valid).toBe(true);
    });
});

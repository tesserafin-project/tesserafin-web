import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { normaliseColor } from '../scripts/generate-web-tokens.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const GENERATOR_PATH = join(
    REPO_ROOT,
    'tesserafin-design',
    'scripts',
    'generate-web-tokens.mjs'
);
const OUTPUT_CSS = join(
    REPO_ROOT,
    'src',
    'ui',
    'tokens',
    'official.classic.css'
);
const OUTPUT_TS = join(REPO_ROOT, 'src', 'ui', 'tokens', 'official.classic.ts');

function runGenerator() {
    execFileSync('node', [GENERATOR_PATH], { cwd: REPO_ROOT });
}

describe('generate-web-tokens.mjs', () => {
    it('emits the expected --rf-* custom properties for Tesserafin Classic', () => {
        runGenerator();
        const css = readFileSync(OUTPUT_CSS, 'utf8');

        expect(css).toContain('[data-rf-theme="official.classic"]');
        expect(css).toContain(
            '[data-rf-theme="official.classic"][data-rf-mode="light"]'
        );
        // Read from the source tokens rather than restated as literals. What this test is for is
        // that the generator emits THE SOURCE VALUE under the right custom-property name — not
        // that Classic happens to be a particular colour. Hard-coding the palette made a theme
        // refresh look like a generator regression, and made this assertion something to update
        // rather than something to satisfy.
        const tokens = JSON.parse(
            readFileSync(
                join(
                    REPO_ROOT,
                    'tesserafin-design',
                    'themes',
                    'classic',
                    'tokens.json'
                ),
                'utf8'
            )
        );

        expect(css).toContain(
            `--rf-color-background: ${tokens.color.dark.background};`
        );
        expect(css).toContain(
            `--rf-color-primary: ${tokens.color.dark.primary};`
        );
        expect(css).toContain(
            `--rf-shape-radius-md: ${tokens.shape.radius.md};`
        );
        expect(css).toContain(
            `--rf-motion-duration-fast: ${tokens.motion.duration.fast};`
        );
        expect(css).toContain(`--rf-density: ${tokens.density};`);
        // Light-mode override block only redeclares the color group, not shared tokens.
        expect(css).toContain(
            `--rf-color-background: ${tokens.color.light.background};`
        );
        // ...and the two modes really are different values, so the assertions above cannot both
        // be satisfied by a generator that ignored the mode tiers entirely.
        expect(tokens.color.light.background).not.toBe(
            tokens.color.dark.background
        );
    });

    it('derives --rf-backdrop-filter-* as "none" (not "blur(0)") for Tesserafin Classic', () => {
        runGenerator();
        const css = readFileSync(OUTPUT_CSS, 'utf8');

        // blur(0) still allocates a GPU compositing layer; `none` does not — Classic's zero blur
        // tokens must resolve to the latter.
        expect(css).toContain('--rf-blur-sm: 0;');
        expect(css).toContain('--rf-backdrop-filter-sm: none;');
        expect(css).toContain('--rf-blur-md: 0;');
        expect(css).toContain('--rf-backdrop-filter-md: none;');
        expect(css).toContain('--rf-blur-lg: 0;');
        expect(css).toContain('--rf-backdrop-filter-lg: none;');
        expect(css).not.toContain('blur(0)');
    });

    it('emits a typed TesserafinTokens object', () => {
        runGenerator();
        const ts = readFileSync(OUTPUT_TS, 'utf8');

        expect(ts).toContain(
            "import type { TesserafinTokens } from './types';"
        );
        expect(ts).toContain(
            'export const officialClassicTokens: TesserafinTokens = {'
        );
        expect(ts).toContain('export default officialClassicTokens;');
    });

    it('produces byte-identical output across repeated runs (deterministic generator)', () => {
        runGenerator();
        const firstCss = readFileSync(OUTPUT_CSS, 'utf8');
        const firstTs = readFileSync(OUTPUT_TS, 'utf8');

        runGenerator();
        const secondCss = readFileSync(OUTPUT_CSS, 'utf8');
        const secondTs = readFileSync(OUTPUT_TS, 'utf8');

        expect(secondCss).toBe(firstCss);
        expect(secondTs).toBe(firstTs);
    });
});

describe('normaliseColor', () => {
    it.each([
        // The case that actually happened: schema-valid source, stylelint-red generated file.
        ['#ffffff', '#fff'],
        ['#FFFFFF', '#fff'],
        ['#000000', '#000'],
        ['#ffffffff', '#ffff'],
        ['#AABBCC', '#abc']
    ])('collapses and lowercases %s to %s', (input, expected) => {
        expect(normaliseColor(input)).toBe(expected);
    });

    it.each(['#101010', '#202020', '#00a4dc', '#f2f2f2', '#0b0e14'])(
        'leaves %s alone — its pairs do not repeat',
        (input) => {
            expect(normaliseColor(input)).toBe(input);
        }
    );

    it.each([
        'rgba(255, 255, 255, 0.7)',
        'rgb(1, 2, 3)',
        'hsl(0, 0%, 100%)',
        'hsla(0, 0%, 100%, 0.5)'
    ])('passes %s through unchanged', (input) => {
        // Their canonical spelling is taste, not a lint rule this repo enforces, and rewriting them
        // would change a value a theme author wrote deliberately.
        expect(normaliseColor(input)).toBe(input);
    });

    it('lowercases a 3-digit hex without touching its length', () => {
        expect(normaliseColor('#ABC')).toBe('#abc');
    });

    it('is idempotent', () => {
        for (const input of ['#ffffff', '#101010', '#ABC', 'rgb(1, 2, 3)']) {
            expect(normaliseColor(normaliseColor(input))).toBe(
                normaliseColor(input)
            );
        }
    });
});

describe('the generated CSS is spelled the way stylelint requires', () => {
    it('emits normalised colours even when the source is not normalised', () => {
        runGenerator();
        const css = readFileSync(OUTPUT_CSS, 'utf8');
        // Every hex in the generated stylesheet is already in its shortest lowercase form, so
        // `npm run stylelint` cannot go red on a file nobody can usefully edit.
        const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
        expect(hexes.length).toBeGreaterThan(0);
        for (const hex of hexes) {
            expect(hex).toBe(normaliseColor(hex));
        }
    });

    it('leaves the generated TypeScript mirroring the source verbatim', () => {
        runGenerator();
        const ts = readFileSync(OUTPUT_TS, 'utf8');
        const tokens = JSON.parse(
            readFileSync(
                join(
                    REPO_ROOT,
                    'tesserafin-design',
                    'themes',
                    'classic',
                    'tokens.json'
                ),
                'utf8'
            )
        );
        // Normalisation is a CSS-spelling concern. `TesserafinTokens` consumers compare against the
        // source token set, so the .ts must keep the source's exact strings — otherwise a theme's
        // declared value and the value the app reads back would differ by spelling.
        expect(ts).toContain(`primary: '${tokens.color.dark.primary}'`);
    });
});

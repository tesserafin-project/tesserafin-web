import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const GENERATOR_PATH = join(
    REPO_ROOT,
    'reefin-design',
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
    it('emits the expected --rf-* custom properties for Reefin Classic', () => {
        runGenerator();
        const css = readFileSync(OUTPUT_CSS, 'utf8');

        expect(css).toContain('[data-rf-theme="official.classic"]');
        expect(css).toContain(
            '[data-rf-theme="official.classic"][data-rf-mode="light"]'
        );
        expect(css).toContain('--rf-color-background: #101010;');
        expect(css).toContain('--rf-color-primary: #00a4dc;');
        expect(css).toContain('--rf-shape-radius-md: 0.2em;');
        expect(css).toContain('--rf-motion-duration-fast: 150ms;');
        expect(css).toContain('--rf-density: comfortable;');
        // Light-mode override block only redeclares the color group, not shared tokens.
        expect(css).toContain('--rf-color-background: #f2f2f2;');
    });

    it('emits a typed ReefinTokens object', () => {
        runGenerator();
        const ts = readFileSync(OUTPUT_TS, 'utf8');

        expect(ts).toContain("import type { ReefinTokens } from './types';");
        expect(ts).toContain(
            'export const officialClassicTokens: ReefinTokens = {'
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

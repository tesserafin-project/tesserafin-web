/// <reference types="vitest" />
/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';

import { type Plugin, defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Load `.html` as a default-exported string, the way webpack's `html-loader` does in
 * `webpack.common.js`.
 *
 * Legacy view templates and dialog templates are imported as modules by production code
 * (`import template from './foo.template.html'`). Without this, vite hands the file to its JS
 * import analysis and every test that transitively reaches one of them dies with "content contains
 * invalid JS syntax" — a bundler-parity gap, not a defect in the code under test. Matching the
 * bundler here is what lets a legacy controller be exercised as-is.
 */
function htmlAsString(): Plugin {
    return {
        name: 'tesserafin:html-as-string',
        enforce: 'pre',
        load(id) {
            const path = id.split('?')[0];
            if (!path.endsWith('.html')) return null;
            return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`;
        }
    };
}

export default defineConfig({
    plugins: [tsconfigPaths(), htmlAsString()],
    test: {
        coverage: {
            include: ['src']
        },
        environment: 'jsdom',
        // Playwright specs live under tests/e2e (`npm run test:e2e`, needs a
        // Reefin server), tests/reader (`npm run test:readers`, server-free
        // but still Playwright) and tests/captures (`npm run captures`, also
        // server-free Playwright), not vitest. Agent worktrees under .claude/
        // carry their own copies of the tree and must never be collected here.
        // scripts/ holds standalone Node control suites — dependency-audit
        // spawns the evaluator as a real process and asserts its exit status,
        // which is the whole point of it, so it runs via `npm run
        // test:dependency-audit` rather than inside vitest.
        exclude: [
            ...configDefaults.exclude,
            'tests/e2e/**',
            'tests/reader/**',
            // Server-free delivery-ledger suite (`npm run test:delivery-ledger`): Playwright,
            // like the others here, and it reads dist/ + delivery-stats/ rather than src.
            'tests/delivery/**',
            // Server-free capture suite (`npm run captures`): Playwright, like the two
            // above. Collected by vitest it fails at import with "did not expect
            // test.beforeAll() to be called here", because it is a Playwright spec.
            'tests/captures/**',
            // Server-free Item Details browser suite (`npm run test:item-details-browser`):
            // Playwright, like the three above, and it drives the built `dist/` rather than src.
            'tests/itemDetailsBrowser/**',
            '**/.claude/**',
            'scripts/**'
        ],
        restoreMocks: true
    }
});

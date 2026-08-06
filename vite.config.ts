/// <reference types="vitest" />
/// <reference types="vite/client" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [tsconfigPaths()],
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
            '**/.claude/**',
            'scripts/**'
        ],
        restoreMocks: true
    }
});

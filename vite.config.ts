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
        // Playwright E2E specs live under tests/e2e and run via `npm run
        // test:e2e`, not vitest. Agent worktrees under .claude/ carry their
        // own copies of the tree and must never be collected from here.
        exclude: [...configDefaults.exclude, 'tests/e2e/**', '**/.claude/**'],
        restoreMocks: true
    }
});

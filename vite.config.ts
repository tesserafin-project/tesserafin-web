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
        // test:e2e`, not vitest.
        exclude: [...configDefaults.exclude, 'tests/e2e/**'],
        restoreMocks: true
    }
});

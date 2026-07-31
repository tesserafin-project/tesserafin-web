import { defineConfig, devices } from '@playwright/test';

/**
 * Server-free reader suite.
 *
 * Unlike playwright.config.ts, this one needs NO Reefin server: it starts a
 * static file server over the production build in `dist/` plus project-owned
 * fixtures, and drives pdf.js / epub.js in a real Chromium against them. Run
 * `npm run build:production` first -- the whole point is that the worker under
 * test is the artifact the build copied, not a file read out of node_modules.
 *
 *     npm run build:production && npm run test:readers
 */
const PORT = Number(process.env.READER_SUITE_PORT || 4319);

export default defineConfig({
    testDir: './tests/reader',
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node tests/reader/serve.mjs',
        url: `http://127.0.0.1:${PORT}/__harness__/pdf.html`,
        reuseExistingServer: false,
        timeout: 30_000,
        env: { READER_SUITE_PORT: String(PORT) }
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ]
});

import { defineConfig, devices } from '@playwright/test';

/**
 * Server-free browser characterization of the LEGACY Item Details route (tesserafin-web#129
 * Step 1a).
 *
 * Like `playwright.reader.config.ts`, `playwright.captures.config.ts` and
 * `playwright.delivery.config.ts`, and unlike `playwright.config.ts`, this needs **no Reefin
 * server**. It reuses `tests/reader/serve.mjs` to serve the production build at the origin root,
 * and the suite installs a same-origin fixture API on top — see
 * `tests/itemDetailsBrowser/support/fixtureApi.ts` for why the API cannot live on another port.
 *
 *     npm run build:production && npm run test:item-details-browser
 *
 * One worker on purpose: the fixture API is per-page, but the screenshots written to
 * `test-results/item-details-browser/` are evidence, and two workers capturing the same route at
 * different moments would produce artifacts that differ for reasons unrelated to the route.
 */
const PORT = Number(process.env.ITEM_DETAILS_SUITE_PORT || 4324);

export default defineConfig({
    testDir: './tests/itemDetailsBrowser',
    timeout: 90_000,
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
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: false,
        timeout: 30_000,
        env: { READER_SUITE_PORT: String(PORT) }
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});

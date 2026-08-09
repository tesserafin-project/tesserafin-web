import { defineConfig, devices } from '@playwright/test';

/**
 * Server-free browser suite for the M3 first-run slice (#139).
 *
 * Same shape and same reasons as `playwright.contentPacks.config.ts`: no Reefin server,
 * `tests/reader/serve.mjs` serves the production build at the origin root, and each spec installs a
 * same-origin fixture API on top — see `tests/m3Browser/support/fixtureApi.ts` for why the API
 * cannot live on another port.
 *
 *     npm run build:production && npm run test:m3-browser
 *
 * `TESSERAFIN_E2E_BASE_URL` is set here rather than left to default so that
 * `tests/e2e/support/origin-inventory.ts` classifies this origin as `candidate-server`. Left at its
 * `http://localhost:8096` default the gate would still pass, while printing an inventory claiming
 * the application reached the candidate server zero times.
 *
 * Three viewports, one project each, so a failure names the viewport it failed at and the TV project
 * can carry `hasTouch: false` honestly. One worker: the screenshots under
 * `test-results/m3-browser/` are evidence.
 */
const PORT = Number(process.env.M3_SUITE_PORT || 4327);
const BASE_URL = `http://127.0.0.1:${PORT}`;

process.env.TESSERAFIN_E2E_BASE_URL = BASE_URL;

export default defineConfig({
    testDir: './tests/m3Browser',
    timeout: 120_000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: BASE_URL,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        locale: 'en-GB',
        timezoneId: 'UTC'
    },
    webServer: {
        command: 'node tests/reader/serve.mjs',
        url: `${BASE_URL}/index.html`,
        reuseExistingServer: false,
        timeout: 30_000,
        env: { READER_SUITE_PORT: String(PORT) }
    },
    projects: [
        {
            name: 'desktop',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 }
            },
            testIgnore: /\.(mobile|tv)\.spec\.ts$/
        },
        {
            name: 'mobile',
            use: { ...devices['Pixel 7'] },
            testMatch: /\.mobile\.spec\.ts$/
        },
        {
            name: 'tv',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1920, height: 1080 },
                deviceScaleFactor: 1,
                hasTouch: false,
                isMobile: false
            },
            testMatch: /\.tv\.spec\.ts$/
        }
    ]
});

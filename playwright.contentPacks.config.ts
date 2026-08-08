import { defineConfig, devices } from '@playwright/test';

/**
 * Server-free browser suite for the Content packs slice (#138).
 *
 * Like `playwright.itemDetails.config.ts`, `playwright.delivery.config.ts` and
 * `playwright.captures.config.ts`, and unlike `playwright.config.ts`, this needs **no Reefin
 * server**. It reuses `tests/reader/serve.mjs` to serve the production build at the origin root, and
 * each spec installs a same-origin fixture API on top — see `tests/contentPacksBrowser/support/
 * fixtureApi.ts` for why the API cannot live on another port.
 *
 *     npm run build:production && npm run test:content-packs-browser
 *
 * ## TESSERAFIN_E2E_BASE_URL
 *
 * Set here, not left to default. `tests/e2e/support/origin-inventory.ts` classifies the origin of
 * that variable as `candidate-server` and everything else local as `local-infra`. Left at its
 * `http://localhost:8096` default, every request this suite makes would be filed as
 * `local-infra` — the gate would still pass, but the inventory it printed would claim the
 * application under test reached the candidate server zero times, which is not what happened.
 *
 * ## Three viewports, one project each
 *
 * §6 asks for the SAME bundle at desktop, mobile and a TV-sized viewport. They are separate
 * projects rather than one project resizing itself so that a failure names the viewport it failed
 * at, and so the TV project can carry `hasTouch: false` honestly.
 *
 * One worker throughout: the screenshots written under `test-results/content-packs-browser/` are
 * evidence, and two workers capturing the same route at different moments would produce artifacts
 * that differ for reasons unrelated to the route.
 */
const PORT = Number(process.env.CONTENT_PACKS_SUITE_PORT || 4325);
const BASE_URL = `http://127.0.0.1:${PORT}`;

process.env.TESSERAFIN_E2E_BASE_URL = BASE_URL;

export default defineConfig({
    testDir: './tests/contentPacksBrowser',
    timeout: 120_000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: BASE_URL,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        // Deterministic rendering, for the same reason the capture suite pins them: an artifact
        // that moved between runs would be worthless as evidence.
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

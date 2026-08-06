import { defineConfig, devices } from '@playwright/test';

/**
 * Server-free delivery-ledger suite.
 *
 * Browser-side evidence for the aggregate delivery budget: what a real Chromium actually requests
 * when it opens the production build cold. It needs NO Tesserafin server - it reuses
 * `tests/reader/serve.mjs`, which already serves `dist/` at the origin root, rather than adding a
 * second static server to keep correct.
 *
 *     npm run build:production && npm run verify:delivery-budget && npm run test:delivery-ledger
 *
 * What this suite asserts is resource IDENTITY and MEMBERSHIP - which files were requested, and
 * which were not. It deliberately asserts NOTHING about durations. Wall-clock timings on a shared
 * CI runner are environment noise, and a flaky performance gate teaches people to re-run CI rather
 * than to read it. The normative gate is the deterministic webpack graph
 * (scripts/verify-delivery-budget.mjs); this suite is corroboration that the graph describes the
 * same thing a browser sees.
 */
const PORT = Number(process.env.DELIVERY_SUITE_PORT || 4322);

export default defineConfig({
    testDir: './tests/delivery',
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
        url: `http://127.0.0.1:${PORT}/index.html`,
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

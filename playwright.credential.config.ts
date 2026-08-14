import { defineConfig, devices } from '@playwright/test';

/**
 * S4 — production-bundle playback credential probe.
 *
 * Real server, real media, real production bundle. The rig is `ci/serve-e2e.sh` in the server
 * repository, which exports `TESSERAFIN_E2E_BASE_URL`, `TESSERAFIN_E2E_USER` and
 * `TESSERAFIN_E2E_PASSWORD`; there is deliberately no `webServer` block here.
 *
 *     ci/serve-e2e.sh --no-build --webdir <web>/dist \
 *       --exec 'cd <web> && npx playwright test --config playwright.credential.config.ts'
 *
 * One worker: both cases read the server's `/Sessions` state as evidence, and two concurrent
 * players would make "which session is this" unanswerable.
 */
export default defineConfig({
    testDir: './tests/playbackCredential',
    testMatch: /\.spec\.ts$/,
    timeout: 120_000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://127.0.0.1:8096',
        screenshot: 'only-on-failure',
        trace: 'off',
        locale: 'en-GB',
        timezoneId: 'UTC'
    },
    projects: [
        {
            name: 'desktop',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 }
            }
        }
    ]
});

import { defineConfig, devices } from '@playwright/test';

/**
 * #153-A1 — the long-playback acceptance harness.
 *
 * Separate from `playwright.credential.config.ts` because it takes ~18 minutes of wall clock: the
 * server's capability lifetime is 15 minutes and this proof deliberately does not shorten it. It is
 * preserved and reproducible, but it is not part of `validate`.
 *
 *     ci/serve-e2e.sh --no-build --webdir <web>/dist \
 *       --exec 'cd <web> && npx playwright test --config playwright.longPlayback.config.ts'
 */
export default defineConfig({
    testDir: './tests/playbackCredential',
    testMatch: /longPlayback\.spec\.ts$/,
    timeout: 25 * 60 * 1000,
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

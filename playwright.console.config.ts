import { defineConfig, devices } from '@playwright/test';

/** Real release-image instance with this exact production dist/; no dev server or mocks. */
export default defineConfig({
    testDir: './tests/console',
    testMatch: /\.spec\.ts$/,
    timeout: 120_000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096',
        // A trace/HAR may record credentials. Counts-only attachments are enough here.
        trace: 'off',
        screenshot: 'off',
        locale: 'en-GB',
        timezoneId: 'UTC'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});

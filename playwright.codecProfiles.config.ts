import { defineConfig, devices } from '@playwright/test';

// Browser-owned decoder-confidence observations only. No server or credentials.
export default defineConfig({
    testDir: './tests/e2e',
    testMatch: 'video-codec-profiles-browser.spec.ts',
    timeout: 30_000,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
    ]
});

import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against a real Reefin server serving a production build of this
 * repo (`npm run build:production` + server `--webdir <repo>/dist`) - see
 * docs/reefin/design-reefin-shell-and-routing.md §2.6/§5. There is deliberately
 * no `webServer` block: starting a Reefin server (dotnet + ffmpeg + media
 * library) is out of scope for the test runner. Point REEFIN_E2E_BASE_URL at a
 * running instance; credentials come from REEFIN_E2E_USER / REEFIN_E2E_PASSWORD.
 */
export default defineConfig({
    testDir: './tests/e2e',
    timeout: 60_000,
    fullyParallel: false,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ]
});

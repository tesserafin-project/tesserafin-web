import { defineConfig, devices } from '@playwright/test';

/**
 * #153-A1 phase 0 — the OPT-IN historical characterization probe (#153-A1-R2 phase 1).
 *
 * `tests/playbackCredentialBaseline/baselineTrace.spec.ts` measured the credential transport
 * BEFORE the migration. It is expected to be red against the migrated candidate, so it must never
 * be aggregated into candidate acceptance — and the way it is kept out is that it lives in its own
 * directory with its own config, not behind a filter in the acceptance config.
 *
 * Same rig as `playwright.credential.config.ts` (`ci/serve-e2e.sh` in the server repository,
 * exporting TESSERAFIN_E2E_BASE_URL / TESSERAFIN_E2E_USER / TESSERAFIN_E2E_PASSWORD), one worker,
 * for the same reason: the spec reads the server's `/Sessions` state as evidence.
 *
 *     npm run test:a1-baseline-characterization
 */
export default defineConfig({
    testDir: './tests/playbackCredentialBaseline',
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

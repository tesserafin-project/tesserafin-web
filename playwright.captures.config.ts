import { defineConfig, devices } from '@playwright/test';

/**
 * Server-free capture suite.
 *
 * Like `playwright.reader.config.ts` and unlike `playwright.config.ts`, this needs **no Tesserafin
 * server**: it serves `tests/captures/dist/` statically and drives real Chromium against the real
 * `src/ui` primitives rendered through the real token pipeline.
 *
 *     npm run captures
 *
 * `fullyParallel: false` and one worker on purpose. Captures are evidence, and two workers
 * screenshotting at different moments of the same animation would produce images that differ for a
 * reason that has nothing to do with the theme.
 */
const PORT = Number(process.env.CAPTURE_SUITE_PORT || 4321);

export default defineConfig({
    testDir: './tests/captures',
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        // Deterministic rendering: no OS animation state, no locale-dependent formatting, a fixed
        // device pixel ratio. A capture that moved between runs would be worthless as evidence.
        deviceScaleFactor: 2,
        locale: 'en-GB',
        timezoneId: 'UTC',
        colorScheme: 'dark'
    },
    webServer: {
        command: 'node tests/captures/serve.mjs',
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: false,
        timeout: 30_000,
        env: { CAPTURE_SUITE_PORT: String(PORT) }
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});

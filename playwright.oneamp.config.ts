import { defineConfig, devices } from '@playwright/test';

/**
 * Server-free OneAmp browser suite (contract §9.3 step 5): `npm run test:oneamp-browser`.
 * Builds `webpack.oneamp.js`, serves `tests/oneampBrowser/dist/` with WAV fixtures, and runs
 * the real player, graph, host, worklet and wasm in Chromium and Firefox. Media autoplay is
 * allowed so an `AudioContext` runs without a user gesture.
 */
const PORT = Number(process.env.ONEAMP_SUITE_PORT || 4341);

export default defineConfig({
    testDir: './tests/oneampBrowser',
    testMatch: /\.spec\.ts$/,
    timeout: 60_000,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: { baseURL: `http://127.0.0.1:${PORT}` },
    webServer: {
        command: 'node tests/oneampBrowser/serve.mjs',
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: false,
        env: { ONEAMP_SUITE_PORT: String(PORT) }
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                launchOptions: {
                    args: ['--autoplay-policy=no-user-gesture-required']
                }
            }
        },
        {
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox'],
                launchOptions: {
                    firefoxUserPrefs: {
                        'media.autoplay.default': 0,
                        'media.autoplay.blocking_policy': 0
                    }
                }
            }
        }
    ]
});

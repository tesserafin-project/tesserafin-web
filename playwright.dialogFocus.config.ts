import { defineConfig, devices } from '@playwright/test';
const APP_PORT = 4336;
const COMPONENT_PORT = 4337;
export default defineConfig({
    testDir: './tests/dialogFocusBrowser',
    timeout: 45_000,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        launchOptions: { executablePath: process.env.DIALOG_FOCUS_CHROMIUM }
    },
    webServer: [
        {
            command: 'node tests/reader/serve.mjs',
            url: `http://127.0.0.1:${APP_PORT}/index.html`,
            reuseExistingServer: false,
            env: { READER_SUITE_PORT: String(APP_PORT) }
        },
        {
            command: 'node tests/captures/serve.mjs',
            url: `http://127.0.0.1:${COMPONENT_PORT}/index.html`,
            reuseExistingServer: false,
            env: {
                CAPTURE_SUITE_PORT: String(COMPONENT_PORT),
                CAPTURE_SUITE_ROOT: 'tests/dialogFocusBrowser/dist'
            }
        }
    ],
    projects: [
        {
            name: 'production-app',
            testMatch: /production\.spec\.ts$/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: `http://127.0.0.1:${APP_PORT}`
            }
        },
        {
            name: 'production-mode-component',
            testMatch: /component\.spec\.ts$/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: `http://127.0.0.1:${COMPONENT_PORT}`
            }
        }
    ]
});

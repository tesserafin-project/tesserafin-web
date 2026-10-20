import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYER_MENU_SUITE_PORT || 4332);

export default defineConfig({
    testDir: './tests/playerMenusBrowser',
    testMatch: /\.spec\.ts$/,
    timeout: 30_000,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        launchOptions: { executablePath: process.env.PLAYER_MENU_CHROMIUM }
    },
    webServer: {
        command: 'node tests/captures/serve.mjs',
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: false,
        env: {
            CAPTURE_SUITE_PORT: String(PORT),
            CAPTURE_SUITE_ROOT: 'tests/playerMenusBrowser/dist'
        }
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});

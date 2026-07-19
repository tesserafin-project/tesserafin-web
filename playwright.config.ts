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
    /**
     * ONE worker, and it must stay that way.
     *
     * `fullyParallel: false` only serializes tests WITHIN a file — Playwright still runs separate
     * FILES concurrently, one per worker. That is unsafe here, because every spec in this directory
     * drives the SAME single Reefin server, and the v2 engine switch
     * (`PlaybackShadow.Mode`, set through `POST /System/Configuration`) is PERSISTENT, GLOBAL server
     * state, not per-test state. Run in parallel, `playback-v2-client.spec.ts` sets `Mode: 'Legacy'`
     * for its kill-switch case at the same moment the attempt-id, capabilities and server-contract
     * specs require `Mode: 'V2'`, and whichever write lands last silently decides what the others
     * observe.
     *
     * Measured on a real rig: at the default 6 workers the suite fails
     * ("no media leg after the aborted one — the retry ladder did not run"), while the identical
     * suite at `--workers=1` passes repeatedly. The failure is a harness artifact, not a product
     * defect, which is the most expensive kind of red to debug.
     *
     * Making the engine mode per-test would require either a per-test server or a server-side
     * override scoped to a request, neither of which exists today.
     */
    workers: 1,
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

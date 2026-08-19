/**
 * #153-A1 — signing out and back in on the SAME server keeps the credential runtime working.
 *
 * WHY THIS IS A BROWSER TEST AND NOT A UNIT ONE. The defect it pins is a property of how
 * `ConnectionManager` reuses connections, not of any one module: `_getOrAddApiClient` returns the
 * SAME `ApiClient` for a server it has already seen, and `apiclientcreated` fires only when one is
 * BUILT. So a sign-out followed by a sign-in to the same server never re-enters the install path,
 * and every field teardown forgets to clear is inherited by the second session. `boot.test.ts`
 * proves the teardown in isolation with mutation controls; only a real sign-out through the real
 * shell proves the wiring around it.
 *
 * The two failures it would have caught, both measured in source before the repair:
 *
 *   * `_credentialRuntime` survived teardown, so `createCredentialRuntime` handed the second
 *     session the FIRST session's disposed broker - every mint throws and playback is refused;
 *   * `_sdk.webSocket` was left unset, so the next `Api.subscribe()` built the stock service, which
 *     carries no ticket and is refused at the upgrade.
 *
 * OUTPUT SAFETY. Urls are reduced to path plus sorted query KEY names before anything is recorded.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, signIn, USER } from '../e2e/support/b2';
import { mediaItemIdByName, seedAudioLibrary } from './support/fixtures';
import { admin, playControl } from './support/rig';

interface SocketRecord {
    phase: 'before' | 'after';
    carriesTicket: boolean;
    carriesApiKeyParam: boolean;
}

interface MediaRecord {
    phase: 'before' | 'after';
    redactedUrl: string;
    carriesPlaybackCapability: boolean;
    status: number | null;
}

function redact(url: string): string {
    try {
        const parsed = new URL(url);
        const keys = [...parsed.searchParams.keys()].sort();
        return `${parsed.pathname}${keys.length ? `?{${keys.join(',')}}` : ''}`;
    } catch {
        return '<unparseable>';
    }
}

/**
 * Sign out through the shell's own control.
 *
 * Deliberately the UI path rather than calling `ServerConnections.logout()` from the page: the
 * production bundle exposes no such global, and reaching for one would test a seam no person can
 * use. `ServerConnections.logout()` is what the control ultimately calls, and it is what fires
 * `localusersignedout` and therefore `disposePlaybackCredentials`.
 */
async function signOut(page: Page): Promise<void> {
    await page.goto('/#/home');
    // The modern shell's user menu. The legacy `.mainDrawerButton` is present in the DOM but CSS
    // hides it here - it resolved sixty times and never became visible - so matching it is how a
    // sign-out test times out with a message about a drawer instead of about credentials.
    const userMenu = page.getByRole('button', { name: /user menu/i }).first();
    await expect(userMenu, 'the shell must offer a user menu').toBeVisible({
        timeout: 30_000
    });
    await userMenu.click();
    const logout = page
        .getByRole('menuitem', { name: /sign out|log ?out/i })
        .or(page.locator('.btnLogout:visible'))
        .first();
    await expect(logout, 'the user menu must offer sign out').toBeVisible({
        timeout: 15_000
    });
    await logout.click();
    await page.waitForURL(/#\/(login|selectserver)/, { timeout: 30_000 });
}

/**
 * Sign in again WITHOUT loading a new document.
 *
 * `b2.signIn` opens with `page.goto('/')`, and that is a full document load: a new `ApiClient`, a
 * new runtime, an empty seam - the entire defect this file exists for, hidden. Measured: with the
 * pre-repair teardown restored in `boot.ts`, the version of this file that called `signIn` twice
 * PASSED. After a sign-out the shell has already routed to `#/login` on its own, so the form is
 * right there in the document that just tore its credentials down.
 */
async function signInAgainInPlace(page: Page): Promise<void> {
    const loginName = page.locator('#txtManualName:visible');
    await expect(
        loginName,
        'signing out must leave the login form in the SAME document'
    ).toBeVisible({ timeout: 30_000 });
    const accepted = page.waitForResponse(
        (res) =>
            /\/users\/authenticatebyname/i.test(res.url()) &&
            res.status() < 400,
        { timeout: 20_000 }
    );
    await loginName.fill(USER);
    await page.locator('#txtManualPassword:visible').fill(PASSWORD);
    await page.locator('button[type="submit"]:visible').first().click();
    await accepted;
    await page.waitForURL('**/#/home**', { timeout: 20_000 });
}

test.describe('#153-A1 sign out and back in', () => {
    test('the second session gets a working broker and a ticketed socket', async ({
        page
    }) => {
        test.setTimeout(300_000);

        const a = await admin();
        const audio = await seedAudioLibrary(a, 'A1 Relogin Audio');

        const sockets: SocketRecord[] = [];
        const media: MediaRecord[] = [];
        let phase: 'before' | 'after' = 'before';

        page.on('websocket', (ws) => {
            let keys: string[] = [];
            try {
                keys = [...new URL(ws.url()).searchParams.keys()];
            } catch {
                keys = [];
            }
            sockets.push({
                phase,
                carriesTicket: keys.includes('webSocketTicket'),
                carriesApiKeyParam: keys.some(
                    (k) => k.toLowerCase() === 'apikey' || k === 'api_key'
                )
            });
        });

        page.on('response', (response) => {
            const url = response.url();
            if (!/\/audio\/[^/]+\/universal/i.test(url)) return;
            let keys: string[] = [];
            try {
                keys = [...new URL(url).searchParams.keys()];
            } catch {
                keys = [];
            }
            media.push({
                phase,
                redactedUrl: redact(url),
                carriesPlaybackCapability: keys.includes('playbackCapability'),
                status: response.status()
            });
        });

        const play = async (audioId: string) => {
            await page.goto(`/#/details?id=${audioId}`);
            await expect(playControl(page)).toBeVisible({ timeout: 60_000 });
            await playControl(page).click();
        };

        const writeReport = () => {
            const out = join(process.cwd(), 'test-results', 'a1-relogin.json');
            if (!existsSync(dirname(out))) {
                mkdirSync(dirname(out), { recursive: true });
            }
            const report = { sockets, media };
            writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(report, null, 2));
        };

        try {
            await signIn(page);
            const audioId = await mediaItemIdByName(
                a,
                'A1 Relogin Audio Probe',
                'Audio'
            );
            await play(audioId);
            await expect
                .poll(() => media.length, { timeout: 60_000 })
                .toBeGreaterThan(0);

            await signOut(page);

            // NO DOCUMENT LOAD between the two sessions - see signInAgainInPlace. The point is that
            // the SAME `ApiClient` is reused, exactly as it is for a person who signs out and signs
            // back in without touching the browser. `play()` moves by hash only, which stays in the
            // same document too.
            phase = 'after';
            await signInAgainInPlace(page);
            await play(audioId);
            await expect
                .poll(() => media.filter((m) => m.phase === 'after').length, {
                    timeout: 60_000,
                    message:
                        'the second session must request the audio route at all'
                })
                .toBeGreaterThan(0);
            await page.waitForTimeout(4_000);
        } finally {
            audio.dispose();
            await a.dispose();
            writeReport();
        }

        // Playback in the SECOND session: a live broker minted a capability and the server took it.
        const after = media.filter((m) => m.phase === 'after');
        expect(after.length, 'the second session played').toBeGreaterThan(0);
        for (const observed of after) {
            expect(
                observed.carriesPlaybackCapability,
                `${observed.redactedUrl} must carry a playbackCapability`
            ).toBe(true);
            expect(
                (observed.status ?? 0) < 400,
                `${observed.redactedUrl} must succeed (got ${observed.status})`
            ).toBe(true);
        }

        // The socket in the SECOND session: our ticketed service still owns the seam. Left empty,
        // `Api.subscribe()` builds the stock service, which upgrades with no ticket at all.
        const afterSockets = sockets.filter((s) => s.phase === 'after');
        expect(
            afterSockets.length,
            'the second session opened a websocket'
        ).toBeGreaterThan(0);
        expect(
            afterSockets.every((s) => s.carriesTicket),
            'every upgrade after re-login carries a webSocketTicket'
        ).toBe(true);
        expect(
            afterSockets.some((s) => s.carriesApiKeyParam),
            'no upgrade may carry api_key'
        ).toBe(false);
    });
});

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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { PASSWORD, signIn, USER } from '../e2e/support/b2';
import { mediaItemIdByName, seedAudioLibrary } from './support/fixtures';
import { admin, playControl, sessionToken } from './support/rig';

interface SocketRecord {
    phase: 'before' | 'after';
    carriesTicket: boolean;
    carriesApiKeyParam: boolean;
    /**
     * A DIGEST of the ticket, never the ticket. Two upgrades that reused one single-use ticket
     * are indistinguishable from two that minted fresh ones unless the values are compared, and
     * the values themselves may not be recorded.
     */
    ticketDigest: string | null;
    closed: boolean;
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
 * Move inside the SAME document, by hash only.
 *
 * `page.goto('/#/home')` is not a hash change here and never was: the shell is served under
 * `/web/`, so that url changes the PATH from `/web/` to `/` and the browser performs a full
 * navigation. Measured directly — a marker written onto `window` before signing out was gone
 * afterwards, which is a reconstructed document, not a reused one.
 *
 * That mattered more than it looks. This whole file exists to prove that the runtime survives a
 * sign-out and a sign-in WITHOUT being rebuilt; driving it through a navigation that rebuilds the
 * document handed every assertion a fresh runtime and proved the opposite of what the header
 * claimed. Assigning `location.hash` keeps the document, and the router picks the change up the
 * same way it does when a person clicks a link.
 */
async function hashNavigate(page: Page, hash: string): Promise<void> {
    await page.evaluate((target) => {
        window.location.hash = target;
    }, hash);
    await page.waitForTimeout(500);
}

async function goHomeInDocument(page: Page): Promise<void> {
    await hashNavigate(page, '#/home');
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
    // Close the player FIRST. The previous version of this helper navigated with
    // `page.goto`, which reloaded the document and tore the player down as a side effect; once
    // the navigation became a real hash change the OSD stayed up and covered the shell, and the
    // user-menu click timed out after five minutes with a message about a button.
    await page.keyboard.press('Escape');
    for (let attempt = 0; attempt < 6; attempt++) {
        if (!/#\/video/.test(page.url())) break;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
        const dialog = page.locator('.dialogContainer:visible').first();
        if ((await dialog.count()) === 0) break;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }
    await goHomeInDocument(page);
    // The modern shell's user menu. The legacy `.mainDrawerButton` is present in the DOM but CSS
    // hides it here - it resolved sixty times and never became visible - so matching it is how a
    // sign-out test times out with a message about a drawer instead of about credentials.
    const userMenu = page.getByRole('button', { name: /user menu/i }).first();
    await expect(userMenu, 'the shell must offer a user menu').toBeVisible({
        timeout: 30_000
    });
    // `dispatchEvent`, not `click()`. The player view the previous step closed leaves a container
    // behind that intercepts pointer events without appearing in the accessibility tree, so
    // Playwright's actionability check never settles and the click hangs for the full timeout —
    // measured twice, five minutes each, with the button plainly present in the snapshot. The
    // only other way out is a document reload, which is exactly what this file may not do.
    // Dispatching on the control still runs the shell's own handler.
    await userMenu.dispatchEvent('click');
    const logout = page
        .getByRole('menuitem', { name: /sign out|log ?out/i })
        .or(page.locator('.btnLogout:visible'))
        .first();
    await expect(logout, 'the user menu must offer sign out').toBeVisible({
        timeout: 15_000
    });
    await logout.dispatchEvent('click');
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
        /** Requests carrying the FIRST session's token, seen after that session ended. */
        const staleAuthorizationUses: string[] = [];
        let firstToken = '';
        let signedOut = false;
        let apiClientMark: string | null = null;
        let apiClientMarkAfter: string | null = null;
        let apiClientPresentAfter = false;
        let documentMark: string | null = null;
        let documentMarkAfter: string | null = null;
        let socketsClosedAtLogout: number | null = null;

        page.on('request', (request) => {
            if (!signedOut || firstToken.length === 0) return;
            const header = request.headers().authorization ?? '';
            if (
                header.includes(firstToken) ||
                request.url().includes(firstToken)
            ) {
                let path = '<unparseable>';
                try {
                    path = new URL(request.url()).pathname;
                } catch {
                    path = '<unparseable>';
                }
                staleAuthorizationUses.push(`${request.method()} ${path}`);
            }
        });

        page.on('websocket', (ws) => {
            let keys: string[] = [];
            let ticketDigest: string | null = null;
            try {
                const parsed = new URL(ws.url());
                keys = [...parsed.searchParams.keys()];
                const ticket = parsed.searchParams.get('webSocketTicket');
                if (ticket) {
                    ticketDigest = createHash('sha256')
                        .update(ticket)
                        .digest('hex')
                        .slice(0, 16);
                }
            } catch {
                keys = [];
            }
            const record: SocketRecord = {
                phase,
                carriesTicket: keys.includes('webSocketTicket'),
                carriesApiKeyParam: keys.some(
                    (k) => k.toLowerCase() === 'apikey' || k === 'api_key'
                ),
                ticketDigest,
                closed: false
            };
            ws.on('close', () => {
                record.closed = true;
            });
            sockets.push(record);
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
            await hashNavigate(page, `#/details?id=${audioId}`);
            await expect(playControl(page)).toBeVisible({ timeout: 60_000 });
            await playControl(page).click();
        };

        const writeReport = () => {
            const out = join(process.cwd(), 'test-results', 'a1-relogin.json');
            if (!existsSync(dirname(out))) {
                mkdirSync(dirname(out), { recursive: true });
            }
            const report = {
                sockets,
                media,
                apiClientMark,
                apiClientMarkAfter,
                apiClientPresentAfter,
                documentMark,
                documentMarkAfter,
                socketsClosedAtLogout,
                staleAuthorizationUses
            };
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

            // Mark the ApiClient OBJECT before anything tears down. A property survives only on
            // the same object: if `_getOrAddApiClient` handed the second session a NEW client the
            // mark is gone, and the whole premise of this file - that the seam is reused rather
            // than rebuilt - would be false without anyone noticing.
            firstToken = await sessionToken(page);
            expect(
                firstToken.length,
                'the first session has a token'
            ).toBeGreaterThan(0);
            // A marker on the DOCUMENT itself, so a lost ApiClient mark can be told apart from a
            // reconstructed document. Without this, "the object changed" and "the whole page was
            // rebuilt" produce the identical reading, and only one of them is a product fact.
            documentMark = await page.evaluate(() => {
                const mark = `doc-${Math.random().toString(36).slice(2, 10)}`;
                (
                    window as unknown as Record<string, unknown>
                ).__a1DocumentMark = mark;
                return mark;
            });
            apiClientMark = await page.evaluate(() => {
                const client = (
                    window as unknown as { ApiClient?: Record<string, unknown> }
                ).ApiClient;
                if (!client) return null;
                const mark = `a1-${Math.random().toString(36).slice(2, 10)}`;
                (client as Record<string, unknown>).__a1IdentityMark = mark;
                return mark;
            });
            expect(
                apiClientMark,
                'the shell must expose an ApiClient to mark'
            ).not.toBeNull();

            const socketsBeforeLogout = sockets.length;
            expect(
                socketsBeforeLogout,
                'an authenticated socket must exist before signing out'
            ).toBeGreaterThan(0);

            await signOut(page);
            signedOut = true;

            // The socket must go down with the session. Polled, not assumed: the close frame and
            // the sign-out navigation are separate hops.
            await expect
                .poll(
                    () =>
                        sockets
                            .slice(0, socketsBeforeLogout)
                            .filter((entry) => entry.closed).length,
                    {
                        timeout: 30_000,
                        message:
                            'every socket opened by the first session must close when it ends'
                    }
                )
                .toBe(socketsBeforeLogout);
            socketsClosedAtLogout = sockets
                .slice(0, socketsBeforeLogout)
                .filter((entry) => entry.closed).length;

            // NO DOCUMENT LOAD between the two sessions - see signInAgainInPlace. The point is that
            // the SAME `ApiClient` is reused, exactly as it is for a person who signs out and signs
            // back in without touching the browser. `play()` moves by hash only, which stays in the
            // same document too.
            phase = 'after';
            await signInAgainInPlace(page);
            // Polled, and DISAMBIGUATED. A single `?.__a1IdentityMark ?? null` cannot tell "the
            // shell has no ApiClient yet" from "the ApiClient is a different object", and those
            // two readings call for opposite conclusions.
            await expect
                .poll(
                    async () => {
                        const state = await page.evaluate(() => {
                            const client = (
                                window as unknown as {
                                    ApiClient?: Record<string, unknown>;
                                }
                            ).ApiClient;
                            return {
                                present: Boolean(client),
                                mark:
                                    (client?.__a1IdentityMark as string) ??
                                    null,
                                documentMark:
                                    ((
                                        window as unknown as Record<
                                            string,
                                            unknown
                                        >
                                    ).__a1DocumentMark as string) ?? null
                            };
                        });
                        apiClientPresentAfter = state.present;
                        apiClientMarkAfter = state.mark;
                        documentMarkAfter = state.documentMark;
                        return state.present ? 'present' : 'absent';
                    },
                    {
                        timeout: 20_000,
                        message:
                            'the shell must expose an ApiClient again after signing back in'
                    }
                )
                .toBe('present');
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
            await audio.dispose();
            await a.dispose();
            writeReport();
        }

        // The SAME object, not a rebuilt one. See the mark above.
        expect(
            apiClientPresentAfter,
            'the shell must expose an ApiClient after signing back in'
        ).toBe(true);
        // The document was never reconstructed. This is asserted BEFORE the ApiClient identity
        // because it is the thing that would invalidate that reading entirely.
        expect(
            documentMarkAfter,
            'signing out and back in must not reload the document'
        ).toBe(documentMark);
        expect(
            apiClientMarkAfter,
            'the second session must reuse the SAME ApiClient object'
        ).toBe(apiClientMark);

        // The first session's socket really went down.
        expect(
            socketsClosedAtLogout,
            "signing out must close the first session's socket"
        ).toBeGreaterThan(0);

        // The ended authorization is never used again - not in a header, not in a url.
        expect(
            staleAuthorizationUses,
            "no request after sign-out may carry the ended session's token"
        ).toEqual([]);

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

        // Both authenticated attempts are ticket-only, and the tickets are DIFFERENT. A ticket is
        // single-use; two upgrades sharing one digest would mean the second replayed a ticket the
        // server had already consumed, which no boolean about "carries a ticket" can detect.
        const digests = sockets
            .filter((s) => s.carriesTicket)
            .map((s) => s.ticketDigest)
            .filter((d): d is string => d !== null);
        expect(
            digests.length,
            'both phases must have opened a ticketed socket'
        ).toBeGreaterThanOrEqual(2);
        expect(
            new Set(digests).size,
            'every upgrade must mint its own ticket; none may be replayed'
        ).toBe(digests.length);
    });
});

/**
 * S4-D — THE SHIPPED BUNDLE MUST NOT PUBLISH THE SESSION CREDENTIAL FROM A DEPENDENCY EITHER.
 *
 * #154 removed the first-party console sinks. This is the regression for #152: `jellyfin-apiclient`
 * shipped a `console.log` of the WebSocket url built with `api_key=<accessToken()>`, plus a dozen
 * more full-url and credential-bearing statements. `scripts/patch-jellyfin-apiclient.mjs` removes
 * them at install time; this proves the removal holds against a real server and the production
 * bundle, which no source-level check can.
 *
 * NOTHING HERE PRINTS A CREDENTIAL. The console observer compares text against the page's own token
 * in memory and reports only counts, the emitting asset, and — for triage — which of the dependency's
 * own CONSTANT message prefixes matched. Those prefixes are literals from the dependency's source,
 * never data, and the assertion messages carry no payload.
 *
 * Driven against `ci/serve-e2e.sh --webdir <dist>` in the server repository.
 */
import { expect, test } from '@playwright/test';

import { signIn } from '../e2e/support/b2';
import {
    admin,
    expectPlaybackAdvances,
    openDetailByName,
    playControl,
    sessionToken
} from './support/rig';

const MOVIE = 'Smoke Test Movie';

/**
 * The dependency's own constant message prefixes for the statements that can carry a credential.
 * Matching one of these tells a maintainer WHICH statement fired without quoting what it printed.
 */
const KNOWN_SINK_PREFIXES = [
    'opening web socket with url',
    'Stored JSON credentials',
    'ConnectionManager requesting url',
    'ConnectionManager response status',
    'ConnectionManager request failed to url',
    'fetchWithTimeout',
    'Requesting url without automatic networking',
    'Request failed to',
    'Request timed out to',
    'Requesting '
] as const;

/**
 * Messages Chromium itself writes about a failing request or socket. They quote the url because the
 * BROWSER quotes it, not because any script logged it, so no change to this repository or to a
 * dependency can remove them — only moving the credential out of the url can. That is #153, and
 * these are counted and reported separately rather than folded into either party's total.
 */
const BROWSER_EMITTED_PREFIXES = ['WebSocket connection to'] as const;

interface Hit {
    party: 'first-party' | 'dependency';
    asset: string;
    level: string;
    category: string;
    /** Emitting site, so an unclassified hit is still identifiable without quoting its text. */
    site: string;
}

test('the production bundle discloses no session credential, first-party or dependency', async ({
    page
}) => {
    const rig = await admin();
    try {
        const hits: Hit[] = [];
        const browserHits: string[] = [];
        let token = '';
        let socketOpen = false;

        page.on('console', (message) => {
            const text = message.text();
            const needles = [token, 'ApiKey=', 'api_key='].filter(Boolean);
            if (!needles.some((n) => text.includes(n))) return;
            const location = message.location();
            const url = location.url;
            // Both halves are required. A prefix alone would let a future PACKAGE sink whose
            // message happens to start the same way exclude itself; Chromium's own messages are
            // never attributed to a first-party asset.
            const browserEmitted =
                BROWSER_EMITTED_PREFIXES.some((p) => text.startsWith(p)) &&
                !/main\.tesserafin|\.tesserafin\.bundle/.test(url);
            if (browserEmitted) {
                browserHits.push(
                    `${message.type()}:${BROWSER_EMITTED_PREFIXES.find((p) => text.startsWith(p))}`
                );
                return;
            }
            hits.push({
                party: /node_modules\./.test(url)
                    ? 'dependency'
                    : 'first-party',
                asset:
                    (url.split('/').pop() ?? '').split(/[?#]/)[0] || '(inline)',
                level: message.type(),
                category:
                    KNOWN_SINK_PREFIXES.find((p) => text.startsWith(p)) ??
                    'unclassified',
                site: `${location.lineNumber}:${location.columnNumber}`
            });
        });

        // Framework-level socket truth: a socket that exchanges a frame reached OPEN. This does not
        // depend on any client-exposed helper, and the url is never read.
        let socketsSeen = 0;
        page.on('websocket', (ws) => {
            socketsSeen += 1;
            ws.on('framereceived', () => {
                socketOpen = true;
            });
            ws.on('framesent', () => {
                socketOpen = true;
            });
        });

        // The observer is attached before sign-in: the WebSocket sink fires during it.
        await signIn(page);
        token = await sessionToken(page);
        expect(
            token.length,
            'the page must hold a session token'
        ).toBeGreaterThan(0);

        // Give the client its normal window to open the socket; `socketOpen` is set by the
        // websocket frame listener above, not by any client-exposed helper.
        await page.waitForTimeout(8_000);

        // A normal authenticated API request through the client's own fetch path.
        const apiOk = await page.evaluate(async () => {
            const api = (
                window as unknown as {
                    ApiClient?: {
                        getPublicSystemInfo?: () => Promise<{ Id?: string }>;
                    };
                }
            ).ApiClient;
            try {
                const info = await api?.getPublicSystemInfo?.();
                return Boolean(info?.Id);
            } catch {
                return false;
            }
        });

        // A failing request through the same path, so the failure/timeout sinks run.
        await page.evaluate(async () => {
            const api = (
                window as unknown as {
                    ApiClient?: {
                        getUrl: (n: string) => string;
                        ajax: (r: unknown) => Promise<unknown>;
                    };
                }
            ).ApiClient;
            if (!api) return;
            await api
                .ajax({
                    url: api.getUrl('S4D1/NoSuchEndpoint'),
                    type: 'GET',
                    dataType: 'json'
                })
                .catch(() => undefined);
        });

        // Reconnect: close the socket and let the client re-open it, re-running openWebSocket.
        await page.evaluate(() => {
            const api = (
                window as unknown as {
                    ApiClient?: {
                        closeWebSocket?: () => void;
                        ensureWebSocket?: () => void;
                    };
                }
            ).ApiClient;
            api?.closeWebSocket?.();
            setTimeout(() => api?.ensureWebSocket?.(), 500);
        });
        await page.waitForTimeout(4_000);

        // Playback, so the media-url paths run too.
        await openDetailByName(page, MOVIE);
        await playControl(page).click();
        await page.waitForURL(/#\/video/, { timeout: 30_000 });
        await expect(page.locator('video')).toBeVisible({ timeout: 30_000 });
        await expectPlaybackAdvances(page);
        await page.waitForTimeout(2_000);

        const firstParty = hits.filter((h) => h.party === 'first-party');
        const dependency = hits.filter((h) => h.party === 'dependency');
        const summarize = (l: Hit[]) => {
            const by: Record<string, number> = {};
            for (const h of l) {
                const k = `${h.asset}:${h.level}:${h.category}@${h.site}`;
                by[k] = (by[k] ?? 0) + 1;
            }
            return by;
        };

        // Counts, asset names, levels and constant categories only.
        console.log(
            `[s4d1] socketOpen=${socketOpen} socketsSeen=${socketsSeen} apiOk=${apiOk} total=${hits.length} ` +
                `firstParty=${firstParty.length} dependency=${dependency.length}`
        );
        console.log(
            `[s4d1] firstParty=${JSON.stringify(summarize(firstParty))}`
        );
        console.log(
            `[s4d1] dependency=${JSON.stringify(summarize(dependency))}`
        );
        // Reported, never asserted to zero: see BROWSER_EMITTED_PREFIXES. Tracked as #153.
        console.log(
            `[s4d1] browserEmitted(#153)=${browserHits.length} ${JSON.stringify(
                browserHits.reduce<Record<string, number>>((a, k) => {
                    a[k] = (a[k] ?? 0) + 1;
                    return a;
                }, {})
            )}`
        );

        // The browser-emitted bucket is bounded, so it cannot become somewhere a real disclosure
        // hides. One entry is expected: the deliberate reconnect closes a socket, and Chromium
        // names the url it failed to reach. That url carries the credential — which is #153, not a
        // console statement this repository or its dependency can remove.
        expect(
            browserHits.length,
            `browser-emitted url disclosures (tracked as #153): ${JSON.stringify(browserHits)}`
        ).toBeLessThanOrEqual(1);
        expect(
            socketOpen,
            'the WebSocket must still reach OPEN after the patch'
        ).toBe(true);
        expect(apiOk, 'an ordinary API request must still succeed').toBe(true);
        expect(
            firstParty.length,
            `first-party console entries carrying the session credential: ${JSON.stringify(summarize(firstParty))}`
        ).toBe(0);
        expect(
            dependency.length,
            `DEPENDENCY console entries carrying the session credential: ${JSON.stringify(summarize(dependency))}`
        ).toBe(0);
    } finally {
        await rig.dispose();
    }
});

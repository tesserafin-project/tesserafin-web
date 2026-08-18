/**
 * #153-A1 — the real browser/server matrix.
 *
 * Production bundle, real merged server, real media. `migratedTrace.spec.ts` proves the families the
 * rig already seeds (direct video with Range, HLS master/variant/segments, subtitles, the first
 * socket upgrade). This file seeds the families the rig does not have and adds the socket lifecycle
 * the first upgrade cannot show: message exchange and RECONNECT.
 *
 * OUTPUT SAFETY. Urls are redacted to path plus sorted query KEY names before anything is recorded.
 * WebSocket frames are recorded as `MessageType` names and counts only, never as payloads. No
 * credential value is printed, asserted on by value, or written to a file.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { signIn } from '../e2e/support/b2';
import {
    enableFallbackFont,
    seedAssLibrary,
    seedAudioLibrary
} from './support/fixtures';
import { admin, itemIdByName, playControl, sessionToken } from './support/rig';

interface Observed {
    family: string;
    method: string;
    redactedUrl: string;
    queryKeys: string[];
    carriesDurableToken: boolean;
    carriesApiKeyParam: boolean;
    carriesPlaybackCapability: boolean;
    status: number | null;
}

function family(url: string): string | null {
    const u = url.toLowerCase();
    if (/\/fallbackfont\/fonts/.test(u)) return 'font';
    if (/\/attachments\//.test(u)) return 'attachment';
    if (/\/trickplay\//.test(u)) return 'trickplay';
    if (/\/subtitles\//.test(u)) return 'subtitle';
    if (/\/hls\//.test(u)) return 'legacy-hls';
    if (/hls1\//.test(u)) return 'hls-segment';
    if (/master\.m3u8/.test(u)) return 'hls-master';
    if (/(main|live)\.m3u8/.test(u)) return 'hls-variant';
    if (/\/audio\/[^/]+\/universal/.test(u)) return 'universal-audio';
    if (/\/audio\/[^/]+\/stream/.test(u)) return 'direct-audio';
    if (/\/videos\/[^/]+\/stream/.test(u)) return 'direct-video';
    return null;
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
 * Navigate straight to an item's detail route.
 *
 * The search flow `openDetailByName` drives is what a person does, and `migratedTrace.spec.ts`
 * exercises it. Here it is the wrong tool: after the first playback the shell leaves a
 * `.dialogContainer` in the tree that intercepts pointer events, so the SECOND search click can
 * never land — a ten-minute timeout that says nothing about credentials. Addressing the route
 * directly keeps this file measuring what it is for.
 */
async function openDetailById(page: Page, itemId: string): Promise<void> {
    await page.goto(`/#/details?id=${itemId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: 30_000
    });
}

/** Close whatever modal the previous playback left behind. */
async function dismissDialogs(page: Page): Promise<void> {
    for (let i = 0; i < 4; i++) {
        const dialog = page.locator('.dialogContainer:visible').first();
        if ((await dialog.count()) === 0) return;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }
}

test.describe('#153-A1 browser matrix', () => {
    test('every seeded family carries a capability, and the socket reconnects on a fresh ticket', async ({
        page
    }) => {
        test.setTimeout(600_000);

        const a = await admin();
        const audio = await seedAudioLibrary(a);
        const ass = await seedAssLibrary(a);
        const fallbackFont = await enableFallbackFont(a);

        const observed: Observed[] = [];
        let token = '';

        page.on('response', (response) => {
            const url = response.url();
            const kind = family(url);
            if (!kind) return;
            let queryKeys: string[] = [];
            try {
                queryKeys = [...new URL(url).searchParams.keys()];
            } catch {
                queryKeys = [];
            }
            observed.push({
                family: kind,
                method: response.request().method(),
                redactedUrl: redact(url),
                queryKeys,
                carriesDurableToken: token.length > 0 && url.includes(token),
                carriesApiKeyParam: queryKeys.some(
                    (k) => k.toLowerCase() === 'apikey' || k === 'api_key'
                ),
                carriesPlaybackCapability:
                    queryKeys.includes('playbackCapability'),
                status: response.status()
            });
        });

        // The socket lifecycle: every physical upgrade attempt, and the frames each carried.
        interface SocketRecord {
            redactedUrl: string;
            queryKeys: string[];
            /** Truncated SHA-256 of the ticket. Distinct digests prove distinct tickets; a
             *  digest discloses nothing. */
            ticketDigest: string | null;
            sentTypes: string[];
            receivedTypes: string[];
        }
        const sockets: SocketRecord[] = [];
        page.on('websocket', (ws) => {
            let queryKeys: string[] = [];
            try {
                queryKeys = [...new URL(ws.url()).searchParams.keys()];
            } catch {
                queryKeys = [];
            }
            let ticketDigest: string | null = null;
            try {
                const value = new URL(ws.url()).searchParams.get(
                    'webSocketTicket'
                );
                ticketDigest = value
                    ? createHash('sha256')
                          .update(value, 'utf8')
                          .digest('hex')
                          .slice(0, 16)
                    : null;
            } catch {
                ticketDigest = null;
            }
            const record: SocketRecord = {
                redactedUrl: redact(ws.url()),
                queryKeys,
                ticketDigest,
                sentTypes: [],
                receivedTypes: []
            };
            sockets.push(record);
            // MessageType names only — never the payload.
            const typeOf = (payload: string): string => {
                try {
                    return String(JSON.parse(payload).MessageType ?? 'unknown');
                } catch {
                    return 'unparseable';
                }
            };
            ws.on('framesent', (frame) =>
                record.sentTypes.push(typeOf(frame.payload as string))
            );
            ws.on('framereceived', (frame) =>
                record.receivedTypes.push(typeOf(frame.payload as string))
            );
        });

        /**
         * Always emit the ledger, even when an assertion below fails: a matrix run that proves
         * nothing AND records nothing is the worst of both.
         */
        const writeReport = () => {
            const report = {
                generatedFor: '#153-A1 browser matrix',
                note: 'route classes, query KEY names, ticket digests, socket MessageType names and booleans only',
                familiesReached: [
                    ...new Set(observed.map((o) => o.family))
                ].sort(),
                requests: observed.map((o) => ({
                    family: o.family,
                    method: o.method,
                    redactedUrl: o.redactedUrl,
                    status: o.status,
                    carriesPlaybackCapability: o.carriesPlaybackCapability,
                    carriesApiKeyParam: o.carriesApiKeyParam,
                    carriesDurableToken: o.carriesDurableToken
                })),
                socketAttempts: sockets
            };
            const out = join(process.cwd(), 'test-results', 'a1-matrix.json');
            if (!existsSync(dirname(out))) {
                mkdirSync(dirname(out), { recursive: true });
            }
            writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(report, null, 2));
        };

        try {
            await signIn(page);
            token = await sessionToken(page);
            expect(token.length).toBeGreaterThan(0);

            // Ids, not search: see openDetailById.
            const audioId = await itemIdByName(a, 'A1 Audio Probe');
            const assId = await itemIdByName(a, 'A1 Subtitle Probe');

            // ── audio: universal and/or direct ────────────────────────────────────────────────
            await openDetailById(page, audioId);
            await playControl(page).click();
            await page.waitForTimeout(8_000);
            await page.keyboard.press('Escape');
            await dismissDialogs(page);

            // ── ASS subtitles: unlocks attachments AND the fallback font list ─────────────────
            await openDetailById(page, assId);
            await playControl(page).click();
            await page.waitForTimeout(10_000);
            // The subtitle track has to be SELECTED for libass to render, which is what reaches
            // renderSsaAss and therefore the attachment and font families.
            await page.keyboard.press('c').catch(() => undefined);
            await page.waitForTimeout(8_000);
            await page.keyboard.press('Escape');
            await dismissDialogs(page);

            // ── a SECOND physical upgrade attempt ────────────────────────────────────────────
            //
            // A reload, not `context.setOffline`. Offline emulation was tried first and produced no
            // further attempt, and the reason is correct behaviour rather than a defect: by then
            // the player had been closed, the last subscriber had gone, and the service's own
            // unsubscribe path disconnects and disarms the backoff. A reconnect that does not
            // happen because nothing is subscribed is not evidence of anything.
            //
            // The BACKOFF reconnect path is proven deterministically by the unit suite against a
            // fake socket ("mints AGAIN on reconnect and never replays the first ticket"). What
            // this file adds is the real-browser statement: a second physical upgrade against a
            // real server mints a SECOND, DIFFERENT ticket.
            const before = sockets.length;
            await page.reload();
            await expect
                .poll(() => sockets.length, { timeout: 60_000 })
                .toBeGreaterThan(before);
            await page.waitForTimeout(2_000);
        } finally {
            await fallbackFont.dispose();
            audio.dispose();
            ass.dispose();
            await a.dispose();
            writeReport();
        }

        const families = [...new Set(observed.map((o) => o.family))].sort();

        // Whatever was reached must be clean. A family that was NOT reached is reported above and
        // is not silently asserted as passing.
        expect(
            observed.length,
            'the matrix must have exercised media'
        ).toBeGreaterThan(0);
        for (const request of observed) {
            expect(
                request.carriesApiKeyParam,
                `${request.family} ${request.redactedUrl} must not carry ApiKey/api_key`
            ).toBe(false);
            expect(
                request.carriesDurableToken,
                `${request.family} ${request.redactedUrl} must not carry the durable token`
            ).toBe(false);
            expect(
                request.carriesPlaybackCapability,
                `${request.family} ${request.redactedUrl} must carry a playbackCapability`
            ).toBe(true);
            expect(
                (request.status ?? 0) < 400,
                `${request.family} ${request.redactedUrl} must succeed (got ${request.status})`
            ).toBe(true);
        }

        // At least one audio family, which is what this file exists to add.
        expect(
            families.some(
                (f) => f === 'direct-audio' || f === 'universal-audio'
            ),
            `expected an audio family; reached ${families.join(', ')}`
        ).toBe(true);

        // Socket lifecycle: more than one physical attempt, each with its OWN ticket.
        const ticketed = sockets.filter((s) => s.ticketDigest !== null);
        expect(
            sockets.length,
            'more than one physical upgrade attempt'
        ).toBeGreaterThan(1);
        expect(
            ticketed.length,
            'at least two attempts carried a ticket'
        ).toBeGreaterThan(1);
        expect(
            new Set(ticketed.map((s) => s.ticketDigest)).size,
            'every ticketed attempt used a DISTINCT ticket — a replayed one would collide'
        ).toBe(ticketed.length);
        for (const socket of sockets) {
            expect(
                socket.queryKeys.some(
                    (k) => k.toLowerCase() === 'apikey' || k === 'api_key'
                ),
                `socket ${socket.redactedUrl} must not carry a durable credential`
            ).toBe(false);
        }
        expect(
            sockets.some(
                (s) => s.sentTypes.length > 0 || s.receivedTypes.length > 0
            ),
            'at least one socket exchanged messages'
        ).toBe(true);
    });
});

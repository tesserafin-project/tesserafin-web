/**
 * #153-A1 — the migrated runtime trace.
 *
 * Same rig, same production bundle, same redaction rules as `baselineTrace.spec.ts`. What differs
 * is the assertion: every media request and every socket upgrade must now carry a short-lived
 * credential and NOT the durable session token.
 *
 * This runs against whatever families are migrated at the time; it reports what it saw before it
 * asserts, so a partial migration produces a readable ledger rather than one opaque failure.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { MOVIE_TITLE, signIn } from '../e2e/support/b2';
import {
    expectPlaybackAdvances,
    openDetailByName,
    playControl,
    sessionToken,
    TRANSCODE_TITLE
} from './support/rig';

interface Observed {
    routeClass: string;
    method: string;
    redactedUrl: string;
    queryKeys: string[];
    carriesDurableToken: boolean;
    carriesApiKeyParam: boolean;
    carriesPlaybackCapability: boolean;
    carriesWebSocketTicket: boolean;
    status: number | null;
}

function classify(url: string): string {
    const u = url.toLowerCase();
    if (u.startsWith('ws:') || u.startsWith('wss:')) return 'websocket';
    if (/\/livetv\/live(streamfiles|recordings)\//.test(u))
        return 'livetv-delivery';
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
    if (/\/playback\/capabilities/.test(u)) return 'capability-mint';
    if (/\/websocket\/tickets/.test(u)) return 'ticket-mint';
    if (/\/playbackinfo/.test(u)) return 'playback-info';
    if (/\.(js|css|png|jpg|svg|woff2?|json|ico|html)(\?|$)/.test(u))
        return 'static-asset';
    return 'general-api';
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

const MEDIA_CLASSES = new Set([
    'direct-video',
    'direct-audio',
    'universal-audio',
    'hls-master',
    'hls-variant',
    'hls-segment',
    'legacy-hls',
    'subtitle',
    'font',
    'attachment',
    'trickplay'
]);

test.describe('#153-A1 migrated credential trace', () => {
    test('media and socket requests carry short-lived credentials only', async ({
        page
    }) => {
        const observed: Observed[] = [];
        let token = '';
        const mintAuthHeaders: boolean[] = [];

        const record = (
            url: string,
            method: string,
            headers: Record<string, string>,
            status: number | null
        ) => {
            let queryKeys: string[] = [];
            try {
                queryKeys = [...new URL(url).searchParams.keys()];
            } catch {
                queryKeys = [];
            }
            const routeClass = classify(url);
            if (
                routeClass === 'capability-mint' ||
                routeClass === 'ticket-mint'
            ) {
                mintAuthHeaders.push(
                    Boolean(headers.authorization ?? headers.Authorization)
                );
            }
            observed.push({
                routeClass,
                method,
                redactedUrl: redact(url),
                queryKeys,
                carriesDurableToken: token.length > 0 && url.includes(token),
                carriesApiKeyParam: queryKeys.some(
                    (k) => k.toLowerCase() === 'apikey' || k === 'api_key'
                ),
                carriesPlaybackCapability:
                    queryKeys.includes('playbackCapability'),
                carriesWebSocketTicket: queryKeys.includes('webSocketTicket'),
                status
            });
        };

        // A refused mint answers with ProblemDetails, which names the failure and carries no
        // credential. Capturing it is what turns "a mint failed" into a diagnosis.
        const mintFailures: string[] = [];
        page.on('response', (response) => {
            const request = response.request();
            record(
                response.url(),
                request.method(),
                request.headers(),
                response.status()
            );
            if (
                response.status() >= 400 &&
                /\/(Playback\/Capabilities|WebSocket\/Tickets)/i.test(
                    response.url()
                )
            ) {
                void response
                    .text()
                    .then((body) => mintFailures.push(body.slice(0, 400)))
                    .catch(() => mintFailures.push('<unreadable>'));
            }
        });
        page.on('websocket', (ws) => record(ws.url(), 'GET', {}, null));

        await signIn(page);
        token = await sessionToken(page);
        expect(token.length).toBeGreaterThan(0);

        await openDetailByName(page, MOVIE_TITLE);
        await playControl(page).click();
        await expectPlaybackAdvances(page, 0.2);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1_000);

        await openDetailByName(page, TRANSCODE_TITLE);
        await playControl(page).click();
        await expectPlaybackAdvances(page, 0.2);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1_000);

        const media = observed.filter((e) => MEDIA_CLASSES.has(e.routeClass));
        const sockets = observed.filter((e) => e.routeClass === 'websocket');
        const mints = observed.filter(
            (e) =>
                e.routeClass === 'capability-mint' ||
                e.routeClass === 'ticket-mint'
        );

        const report = {
            generatedFor: '#153-A1 migrated trace',
            note: 'route classes, query KEY names and booleans only; no credential value is recorded',
            totalRequests: observed.length,
            mints: mints.map((m) => ({
                routeClass: m.routeClass,
                method: m.method,
                redactedUrl: m.redactedUrl,
                status: m.status
            })),
            mintsAuthenticatedInHeader: mintAuthHeaders,
            mintFailureBodies: mintFailures,
            media: media.map((m) => ({
                routeClass: m.routeClass,
                method: m.method,
                redactedUrl: m.redactedUrl,
                status: m.status,
                carriesApiKeyParam: m.carriesApiKeyParam,
                carriesDurableToken: m.carriesDurableToken,
                carriesPlaybackCapability: m.carriesPlaybackCapability
            })),
            sockets: sockets.map((s) => ({
                redactedUrl: s.redactedUrl,
                queryKeys: s.queryKeys,
                carriesApiKeyParam: s.carriesApiKeyParam,
                carriesWebSocketTicket: s.carriesWebSocketTicket
            }))
        };

        const out = join(
            process.cwd(),
            'test-results',
            'a1-migrated-trace.json'
        );
        if (!existsSync(dirname(out)))
            mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(report, null, 2));

        // Minting happened at all, and authenticated in the HEADER.
        expect(
            mints.length,
            'at least one credential was minted'
        ).toBeGreaterThan(0);
        expect(
            mints.every((m) => (m.status ?? 0) < 400),
            'every mint must succeed'
        ).toBe(true);
        expect(
            mintAuthHeaders.every(Boolean),
            'every mint authenticates in the Authorization header'
        ).toBe(true);
        for (const mint of mints) {
            expect(mint.queryKeys ?? []).toEqual([]);
        }

        // Media: capability only.
        expect(media.length, 'media was fetched').toBeGreaterThan(0);
        for (const request of media) {
            expect(
                request.carriesApiKeyParam,
                `${request.routeClass} ${request.redactedUrl} must not carry ApiKey/api_key`
            ).toBe(false);
            expect(
                request.carriesDurableToken,
                `${request.routeClass} ${request.redactedUrl} must not carry the durable token`
            ).toBe(false);
            expect(
                request.carriesPlaybackCapability,
                `${request.routeClass} ${request.redactedUrl} must carry a playbackCapability`
            ).toBe(true);
            expect(
                (request.status ?? 0) < 400,
                `${request.routeClass} ${request.redactedUrl} must succeed`
            ).toBe(true);
        }

        // Range semantics survived: the direct video is still a partial response.
        const directVideo = media.filter(
            (m) => m.routeClass === 'direct-video'
        );
        if (directVideo.length > 0) {
            expect(
                directVideo.some((m) => m.status === 206 || m.status === 200)
            ).toBe(true);
        }

        // Sockets: ticket only.
        expect(sockets.length, 'a websocket was opened').toBeGreaterThan(0);
        for (const socket of sockets) {
            expect(
                socket.carriesApiKeyParam,
                `socket ${socket.redactedUrl} must not carry api_key`
            ).toBe(false);
        }
        expect(
            sockets.some((s) => s.carriesWebSocketTicket),
            'at least one socket upgrade carries a webSocketTicket'
        ).toBe(true);

        // Live TV delivery stays unreached.
        expect(
            observed.filter((e) => e.routeClass === 'livetv-delivery').length
        ).toBe(0);
    });
});

/**
 * #153-A1 phase 0 — the REAL baseline network trace.
 *
 * The static inventory (`ci/credential-transport-inventory.mjs`) says which producers exist. This
 * says what the browser ACTUALLY requests against a real server, with a real production bundle and
 * real media, using an EPHEMERAL runtime-generated durable token that this rig boots fresh.
 *
 * OUTPUT SAFETY. The session token is read into memory only so requests can be compared against it.
 * Nothing here prints, asserts on, or persists a credential VALUE. The written report contains
 * route classes, query KEY names and booleans — never a value, and every url is redacted before it
 * is recorded.
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

/** Where a request url falls in the credential-transport taxonomy. */
type RouteClass =
    | 'direct-video'
    | 'direct-audio'
    | 'universal-audio'
    | 'hls-master'
    | 'hls-variant'
    | 'hls-segment'
    | 'legacy-hls'
    | 'subtitle'
    | 'subtitle-playlist'
    | 'font'
    | 'attachment'
    | 'trickplay'
    | 'livetv-delivery'
    | 'websocket'
    | 'playback-info'
    | 'general-api'
    | 'static-asset';

function classify(url: string): RouteClass {
    const u = url.toLowerCase();
    if (u.startsWith('ws:') || u.startsWith('wss:') || /\/socket\?/.test(u))
        return 'websocket';
    if (/\/livetv\/live(streamfiles|recordings)\//.test(u))
        return 'livetv-delivery';
    if (/\/fallbackfont\/fonts/.test(u)) return 'font';
    if (/\/attachments\//.test(u)) return 'attachment';
    if (/\/trickplay\//.test(u)) return 'trickplay';
    if (/\/subtitles\/.*subtitles\.m3u8/.test(u)) return 'subtitle-playlist';
    if (/\/subtitles\//.test(u)) return 'subtitle';
    if (/\/hls\//.test(u)) return 'legacy-hls';
    if (/hls1\//.test(u)) return 'hls-segment';
    if (/master\.m3u8/.test(u)) return 'hls-master';
    if (/(main|live)\.m3u8/.test(u)) return 'hls-variant';
    if (/\/audio\/[^/]+\/universal/.test(u)) return 'universal-audio';
    if (/\/audio\/[^/]+\/stream/.test(u)) return 'direct-audio';
    if (/\/videos\/[^/]+\/stream/.test(u)) return 'direct-video';
    if (/\/playbackinfo/.test(u)) return 'playback-info';
    if (/\.(js|css|png|jpg|svg|woff2?|json|ico|html)(\?|$)/.test(u))
        return 'static-asset';
    return 'general-api';
}

/** A url with every VALUE stripped: path plus the sorted set of query key names. */
function redact(url: string): string {
    try {
        const parsed = new URL(url);
        const keys = [...parsed.searchParams.keys()].sort();
        return `${parsed.pathname}${keys.length ? `?{${keys.join(',')}}` : ''}`;
    } catch {
        return '<unparseable>';
    }
}

interface Observed {
    routeClass: RouteClass;
    method: string;
    redactedUrl: string;
    queryKeys: string[];
    carriesDurableToken: boolean;
    carriesApiKeyParam: boolean;
    carriesPlaybackCapability: boolean;
    carriesWebSocketTicket: boolean;
    hasAuthorizationHeader: boolean;
    status: number | null;
}

test.describe('#153-A1 baseline credential trace', () => {
    test('record every media and socket request the real client makes', async ({
        page
    }) => {
        const observed: Observed[] = [];
        let token = '';

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
            observed.push({
                routeClass: classify(url),
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
                hasAuthorizationHeader: Boolean(
                    headers.authorization ?? headers.Authorization
                ),
                status
            });
        };

        page.on('response', (response) => {
            const request = response.request();
            record(
                response.url(),
                request.method(),
                request.headers(),
                response.status()
            );
        });
        page.on('websocket', (ws) => {
            record(ws.url(), 'GET', {}, null);
        });

        await signIn(page);
        token = await sessionToken(page);
        expect(
            token.length,
            'the rig must have produced a session token'
        ).toBeGreaterThan(0);

        // Re-classify the entries captured before the token was readable.
        for (const entry of observed) {
            entry.carriesDurableToken =
                entry.carriesDurableToken ||
                entry.queryKeys.some(
                    (k) => k.toLowerCase() === 'apikey' || k === 'api_key'
                );
        }

        // Direct play, with the external subtitle sidecar the rig seeds.
        await openDetailByName(page, MOVIE_TITLE);
        await playControl(page).click();
        await expectPlaybackAdvances(page, 0.2);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1_000);

        // Transcode, which is the HLS family.
        await openDetailByName(page, TRANSCODE_TITLE);
        await playControl(page).click();
        await expectPlaybackAdvances(page, 0.2);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1_000);

        const byClass = new Map<RouteClass, Observed[]>();
        for (const entry of observed) {
            const list = byClass.get(entry.routeClass) ?? [];
            list.push(entry);
            byClass.set(entry.routeClass, list);
        }

        const summary = [...byClass.entries()]
            .map(([routeClass, entries]) => ({
                routeClass,
                requests: entries.length,
                methods: [...new Set(entries.map((e) => e.method))].sort(),
                anyCarriesDurableToken: entries.some(
                    (e) => e.carriesDurableToken
                ),
                anyCarriesApiKeyParam: entries.some(
                    (e) => e.carriesApiKeyParam
                ),
                anyCarriesPlaybackCapability: entries.some(
                    (e) => e.carriesPlaybackCapability
                ),
                anyCarriesWebSocketTicket: entries.some(
                    (e) => e.carriesWebSocketTicket
                ),
                distinctRedactedUrls: [
                    ...new Set(entries.map((e) => e.redactedUrl))
                ].sort(),
                statuses: [
                    ...new Set(
                        entries.map((e) => e.status).filter((s) => s !== null)
                    )
                ].sort((a, b) => (a as number) - (b as number))
            }))
            .sort((a, b) => a.routeClass.localeCompare(b.routeClass));

        const report = {
            generatedFor: '#153-A1 phase 0 baseline',
            note: 'route classes, query KEY names and booleans only; no credential value is recorded',
            totalRequests: observed.length,
            byClass: summary
        };

        const out = join(
            process.cwd(),
            'test-results',
            'a1-baseline-trace.json'
        );
        if (!existsSync(dirname(out)))
            mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

        // eslint-disable-next-line no-console
        console.log(JSON.stringify(report, null, 2));

        // The BASELINE claim: the durable token reaches media urls today. If this ever stops being
        // true before A1 lands, the baseline is not what the design was built against.
        const mediaClasses: RouteClass[] = [
            'direct-video',
            'direct-audio',
            'universal-audio',
            'hls-master',
            'hls-variant',
            'hls-segment',
            'legacy-hls',
            'subtitle',
            'subtitle-playlist',
            'font',
            'trickplay'
        ];
        const mediaSeen = summary.filter((s) =>
            mediaClasses.includes(s.routeClass)
        );
        expect(
            mediaSeen.length,
            'the trace must have exercised at least one media family'
        ).toBeGreaterThan(0);
        expect(
            mediaSeen.some((s) => s.anyCarriesDurableToken),
            'BASELINE: at least one media request must carry the durable token today'
        ).toBe(true);

        // Live TV delivery must not appear at all in an ordinary session.
        expect(
            byClass.get('livetv-delivery')?.length ?? 0,
            'no Live TV delivery route may be requested by an ordinary playback session'
        ).toBe(0);

        // The socket upgrade must be observed, and it carries api_key today.
        const socket = byClass.get('websocket') ?? [];
        expect(
            socket.length,
            'the client must open a websocket'
        ).toBeGreaterThan(0);
        expect(
            socket.some((s) => s.carriesApiKeyParam),
            'BASELINE: the websocket upgrade carries api_key today'
        ).toBe(true);
    });
});

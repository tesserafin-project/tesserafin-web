/**
 * #153-A1 — the universal-audio capability is bound to the play session, and survives its end.
 *
 * WHAT THIS FILE PINS, AND WHY IT EXISTS.
 *
 * `/Audio/{id}/universal` is the one family whose play session the client INVENTS: it builds the
 * url before any `PlaybackInfo` round trip, so no server value is available to bind to. An earlier
 * revision of `getAudioStreamUrl` therefore refused to bind at all and filed the capability under
 * the broker's own synthetic id, on the measurement that binding it made the client revoke its own
 * credential and answer 401. That left the audio credential outside the contract in #153: bound to
 * the play session, invalidated when it ends.
 *
 * Re-measured on the rig, the premise does not hold: the audio path reports one `/Sessions/Playing`
 * at 0 ms, one Progress, and one `/Sessions/Playing/Stopped` at the end of the track. There is no
 * stop at 0 ms during start, and the binding is safe.
 *
 * WHAT THIS FILE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * The load-bearing assertion is the REPLAY: the exact url the first playback used is re-requested
 * after that playback's stop has been reported, and the server must now refuse it. That is the half
 * of #153's contract - "invalidated when the play session ends" - that no amount of watching
 * successful requests can show. Bound to the broker's synthetic play session, as an earlier
 * revision did, the same replay answers 200 and this file fails.
 *
 * A second playback in the SAME document is also driven, and must succeed. That part is a
 * regression check, NOT a control for the release wiring in `onPlaybackStopped`: the broker's cache
 * key names the play session, so a second play session misses the cache and mints afresh whether
 * that wiring is present or not. Measured, not assumed - the control was run.
 *
 * OUTPUT SAFETY. The replayed url is held in memory and never recorded: the report keeps path plus
 * sorted query KEY names and a status code, and no credential value of any kind.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, request, test } from '@playwright/test';

import { signIn } from '../e2e/support/b2';
import { mediaItemIdByName, seedAudioLibrary } from './support/fixtures';
import { admin, playControl } from './support/rig';

interface AudioRequest {
    redactedUrl: string;
    carriesPlaybackCapability: boolean;
    carriesApiKeyParam: boolean;
    status: number | null;
    /** Real bytes. A 200 with an empty body is not media. */
    bytes: number | null;
    /** The play session the URL itself names. */
    urlPlaySessionId: string | null;
}

/** One mint, by its REQUEST body. No response is ever read. */
interface MintRecord {
    scopes: string[];
    playSessionId: string | null;
}

interface Lifecycle {
    path: string;
    playSessionId: string | null;
    positionTicks: number | null;
}

/** Path plus sorted query KEY names. No value of any kind is recorded. */
function redact(url: string): string {
    try {
        const parsed = new URL(url);
        const keys = [...parsed.searchParams.keys()].sort();
        return `${parsed.pathname}${keys.length ? `?{${keys.join(',')}}` : ''}`;
    } catch {
        return '<unparseable>';
    }
}

test.describe('#153-A1 universal-audio revocation', () => {
    test('a second playback of the same item mints a fresh capability and succeeds', async ({
        page
    }) => {
        test.setTimeout(300_000);

        const a = await admin();
        // Its OWN library. Sharing `A1 Audio` with matrix.spec.ts made whichever spec ran second
        // resolve the first one's disposed item and answer 404.
        const audio = await seedAudioLibrary(a, 'A1 Revocation Audio');

        const requests: AudioRequest[] = [];
        const lifecycle: Lifecycle[] = [];
        let token = '';
        let firstPlaybackUrl: string | null = null;
        let replayStatus: number | null = null;
        let replayBytes: number | null = null;
        const mints: MintRecord[] = [];
        const renewalsAfterStop: string[] = [];
        let stopReported = false;

        page.on('response', async (response) => {
            const url = response.url();
            if (!/\/audio\/[^/]+\/universal/i.test(url)) return;
            let keys: string[] = [];
            try {
                keys = [...new URL(url).searchParams.keys()];
            } catch {
                keys = [];
            }
            // Held in memory for the replay below, and never recorded anywhere.
            if (firstPlaybackUrl === null) firstPlaybackUrl = url;
            let bytes: number | null = null;
            try {
                bytes = (await response.body()).length;
            } catch {
                bytes = null;
            }
            let urlPlaySessionId: string | null = null;
            try {
                urlPlaySessionId = new URL(url).searchParams.get(
                    'PlaySessionId'
                );
            } catch {
                urlPlaySessionId = null;
            }
            requests.push({
                redactedUrl: redact(url),
                carriesPlaybackCapability: keys.includes('playbackCapability'),
                carriesApiKeyParam: keys.some(
                    (k) => k.toLowerCase() === 'apikey' || k === 'api_key'
                ),
                status: response.status(),
                bytes,
                urlPlaySessionId
            });
        });

        page.on('request', (req) => {
            const url = req.url();
            // Mints and renewals, by REQUEST body only. The renewal route names the capability,
            // never the play session, so a renewal seen AFTER the stop is recorded by its arrival
            // time rather than by matching an id.
            if (
                /\/Playback\/Capabilities$/i.test(url) &&
                req.method() === 'POST'
            ) {
                let body: Record<string, unknown> = {};
                try {
                    body = JSON.parse(req.postData() ?? '{}');
                } catch {
                    body = {};
                }
                mints.push({
                    scopes: Array.isArray(body.Scopes)
                        ? (body.Scopes as string[])
                        : [],
                    playSessionId: (body.PlaySessionId as string) ?? null
                });
                return;
            }
            if (/\/Playback\/Capabilities\/.+\/Renew/i.test(url)) {
                renewalsAfterStop.push(
                    stopReported ? 'after-stop' : 'before-stop'
                );
                return;
            }
            if (!/\/Sessions\/Playing/i.test(url)) return;
            let body: Record<string, unknown> = {};
            try {
                body = JSON.parse(req.postData() ?? '{}');
            } catch {
                body = {};
            }
            if (/\/Sessions\/Playing\/Stopped/i.test(url)) stopReported = true;
            lifecycle.push({
                path: new URL(url).pathname,
                playSessionId: (body.PlaySessionId as string) ?? null,
                positionTicks: (body.PositionTicks as number) ?? null
            });
        });

        const writeReport = () => {
            const out = join(
                process.cwd(),
                'test-results',
                'a1-audio-revocation.json'
            );
            if (!existsSync(dirname(out))) {
                mkdirSync(dirname(out), { recursive: true });
            }
            const report = {
                requests,
                lifecycle,
                mints,
                renewalsAfterStop,
                replayStatus,
                replayBytes
            };
            writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(report, null, 2));
        };

        try {
            await signIn(page);
            token = (await page.evaluate(
                () =>
                    JSON.parse(
                        localStorage.getItem('jellyfin_credentials') ?? '{}'
                    )?.Servers?.[0]?.AccessToken ?? ''
            )) as string;

            const audioId = await mediaItemIdByName(
                a,
                'A1 Revocation Audio Probe',
                'Audio'
            );
            await page.goto(`/#/details?id=${audioId}`);
            await expect(playControl(page)).toBeVisible({ timeout: 60_000 });

            // ── first playback: play it to its natural end ───────────────────────────────────
            //
            // The fixture is eight seconds long, so waiting is what produces the stop REPORT that
            // makes the server revoke. Stopping through the UI would report the same thing, but the
            // natural end needs no dialog handling and cannot be defeated by an intercepting modal.
            await playControl(page).click();
            await expect
                .poll(
                    () =>
                        lifecycle.filter((l) => l.path.endsWith('/Stopped'))
                            .length,
                    {
                        timeout: 60_000,
                        message: 'the first playback must report a stop'
                    }
                )
                .toBeGreaterThan(0);

            const afterFirst = requests.length;

            // ── the contract: the ended play session's capability is REFUSED ────────────────
            //
            // Issued OUTSIDE the page, through a request context of its own. Two reasons, both
            // measured: a `fetch` from the page is seen by this file's own response handler and
            // lands in `requests` as a 401, failing the "every request succeeded" loop against a
            // probe rather than against playback; and a fresh context carries no cookie, so a 200
            // here could only mean the capability itself is still accepted. `Range` keeps the
            // response to one byte - this is an authorization probe, not a download.
            expect(
                firstPlaybackUrl,
                'the first playback must have requested the audio route'
            ).not.toBeNull();
            const replay = await request.newContext();
            try {
                const response = await replay.get(firstPlaybackUrl as string, {
                    headers: { Range: 'bytes=0-0' }
                });
                replayStatus = response.status();
                replayBytes = (await response.body()).length;
            } finally {
                await replay.dispose();
            }

            // ── second playback of the SAME item, in the SAME document ──────────────────────
            //
            // DELIBERATELY NOT a reload. A reload builds a new `ApiClient` and therefore a new
            // broker with an empty cache, which is exactly the state this file has to avoid: the
            // defect is a cache entry that outlives the server-side revocation, and a reload
            // clears it whether the fix is present or not. Clicking play again in the same
            // document is what puts the surviving cache in the path of the second request.
            await expect(playControl(page)).toBeVisible({ timeout: 60_000 });
            await playControl(page).click();
            await expect
                .poll(() => requests.length, {
                    timeout: 60_000,
                    message: 'the second playback must request the audio again'
                })
                .toBeGreaterThan(afterFirst);
            await page.waitForTimeout(4_000);
        } finally {
            await audio.dispose();
            await a.dispose();
            writeReport();
        }

        expect(token.length, 'a session token was read').toBeGreaterThan(0);

        // Both playbacks. Neither may fall back to the durable token, and neither may fail.
        expect(
            requests.length,
            'both playbacks requested the universal audio route'
        ).toBeGreaterThan(1);
        for (const observed of requests) {
            expect(
                observed.carriesApiKeyParam,
                `${observed.redactedUrl} must not carry ApiKey/api_key`
            ).toBe(false);
            expect(
                observed.carriesPlaybackCapability,
                `${observed.redactedUrl} must carry a playbackCapability`
            ).toBe(true);
            expect(
                (observed.status ?? 0) < 400,
                `${observed.redactedUrl} must succeed (got ${observed.status})`
            ).toBe(true);
        }

        // Real bytes, not merely a 2xx. An empty 200 is not media, and the whole point of the
        // pre-stop half is that the capability WORKED before it was revoked.
        expect(
            Math.max(...requests.map((r) => r.bytes ?? 0)),
            'a playback must have carried real media bytes'
        ).toBeGreaterThan(0);

        // THE CONTRACT. The capability the first playback carried is dead now that its play session
        // has ended. Filed under the broker's synthetic play session instead, nothing revokes it and
        // this replay answers 200.
        //
        // `401/403` specifically, not "any 4xx": a 404 would mean the item vanished and a 416 would
        // mean the Range was wrong, and either would pass a `>= 400` assertion while proving
        // nothing about authorization.
        expect(
            [401, 403],
            `the ended play session's capability must be refused with 401/403 (got ${replayStatus})`
        ).toContain(replayStatus);
        expect(
            replayBytes,
            'a refused replay must return no media bytes at all'
        ).toBe(0);

        // The MINT and the LIFECYCLE name the same play session, and it is not empty. Without this
        // the capability could be minted under one identity and reported under another - which is
        // exactly the defect the synthetic-id revision had, and no url alone can show it.
        const mediaMints = mints.filter((m) => m.scopes.includes('Media'));
        expect(
            mediaMints.length,
            'a Media capability was minted'
        ).toBeGreaterThan(0);
        for (const mint of mediaMints) {
            expect(
                mint.playSessionId ?? '',
                'every mint must name a non-empty play session'
            ).not.toBe('');
        }
        const reportedStarts = lifecycle
            .filter((l) => l.path.endsWith('/Playing'))
            .map((l) => l.playSessionId ?? '');
        for (const reported of reportedStarts) {
            expect(
                reported,
                'every reported start names a play session'
            ).not.toBe('');
        }
        const urlSessions = new Set(
            requests
                .map((r) => r.urlPlaySessionId ?? '')
                .filter((v) => v !== '')
        );
        expect(
            urlSessions.size,
            'the media urls must name a play session'
        ).toBeGreaterThan(0);
        for (const urlSession of urlSessions) {
            expect(
                mediaMints.some((m) => m.playSessionId === urlSession),
                `the url's play session ${urlSession.slice(0, 4)}… must be the one it was minted under`
            ).toBe(true);
            expect(
                reportedStarts.includes(urlSession),
                "the url's play session must be the one playback reported"
            ).toBe(true);
        }

        // No renewal was attempted for a play session that had already ended. The broker cancels
        // the timer in `releasePlaySession`; a surviving timer is what this would catch.
        expect(
            renewalsAfterStop.filter((phase) => phase === 'after-stop'),
            'no renewal may be attempted after the play session ended'
        ).toEqual([]);

        // The play session the capability is bound to is the one playback reports, and it really
        // did end: a stop was reported for it before the second playback began.
        const stops = lifecycle.filter((l) => l.path.endsWith('/Stopped'));
        expect(stops.length, 'a stop was reported').toBeGreaterThan(0);
        const starts = lifecycle.filter((l) => l.path.endsWith('/Playing'));
        expect(
            new Set(starts.map((s) => s.playSessionId)).size,
            'the two playbacks are distinct play sessions'
        ).toBeGreaterThan(1);
    });
});

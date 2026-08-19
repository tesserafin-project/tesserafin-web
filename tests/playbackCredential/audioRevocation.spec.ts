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
 * The 401 was real, but the play session was not its cause. `SessionManager.OnPlaybackStopped`
 * revokes every capability bound to the reported play session - correctly - and the broker went on
 * serving the SAME capability out of its cache to the next request, because nothing dropped the
 * cache entry when playback ended. Binding is safe once the client hands the play session back at
 * the stop it just reported.
 *
 * So this file plays one audio item, lets it end, and plays it AGAIN. The second playback is the
 * assertion: it must mint a fresh capability and succeed. Run against the tree without the release
 * wiring in `onPlaybackStopped`, the second playback answers 401 and this file fails - which is the
 * hostile control that makes it load-bearing rather than decorative.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { signIn } from '../e2e/support/b2';
import { mediaItemIdByName, seedAudioLibrary } from './support/fixtures';
import { admin, playControl } from './support/rig';

interface AudioRequest {
    redactedUrl: string;
    carriesPlaybackCapability: boolean;
    carriesApiKeyParam: boolean;
    status: number | null;
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
        const audio = await seedAudioLibrary(a);

        const requests: AudioRequest[] = [];
        const lifecycle: Lifecycle[] = [];
        let token = '';

        page.on('response', (response) => {
            const url = response.url();
            if (!/\/audio\/[^/]+\/universal/i.test(url)) return;
            let keys: string[] = [];
            try {
                keys = [...new URL(url).searchParams.keys()];
            } catch {
                keys = [];
            }
            requests.push({
                redactedUrl: redact(url),
                carriesPlaybackCapability: keys.includes('playbackCapability'),
                carriesApiKeyParam: keys.some(
                    (k) => k.toLowerCase() === 'apikey' || k === 'api_key'
                ),
                status: response.status()
            });
        });

        page.on('request', (request) => {
            const url = request.url();
            if (!/\/Sessions\/Playing/i.test(url)) return;
            let body: Record<string, unknown> = {};
            try {
                body = JSON.parse(request.postData() ?? '{}');
            } catch {
                body = {};
            }
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
            const report = { requests, lifecycle };
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
                'A1 Audio Probe',
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
            audio.dispose();
            await a.dispose();
            writeReport();
        }

        expect(token.length, 'a session token was read').toBeGreaterThan(0);

        // Both playbacks. Neither may fall back to the durable token, and neither may fail.
        expect(
            requests.length,
            'both playbacks requested the universal audio route'
        ).toBeGreaterThan(1);
        for (const request of requests) {
            expect(
                request.carriesApiKeyParam,
                `${request.redactedUrl} must not carry ApiKey/api_key`
            ).toBe(false);
            expect(
                request.carriesPlaybackCapability,
                `${request.redactedUrl} must carry a playbackCapability`
            ).toBe(true);
            expect(
                (request.status ?? 0) < 400,
                `${request.redactedUrl} must succeed (got ${request.status})`
            ).toBe(true);
        }

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

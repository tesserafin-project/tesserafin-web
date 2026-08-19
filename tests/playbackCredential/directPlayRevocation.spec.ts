/**
 * #153-A1 — a direct-play VIDEO capability must die with its play session too.
 *
 * `audioRevocation.spec.ts` proves the contract for `/Audio/{id}/universal`. This file asks the
 * same question of the family the rest of the suite already exercises, `/Videos/{id}/stream`,
 * because the two are built by different code with different play-session plumbing:
 *
 *   * the audio url is built by `getAudioStreamUrl`, which invents the play session and puts it in
 *     the url as `PlaySessionId`;
 *   * the direct-play url is built from `directOptions`, which carries `Static`, `mediaSourceId`,
 *     `deviceId` and `playbackCapability` - and NO play session - while the capability itself is
 *     minted with `playSessionIdFor(requestOptions)`.
 *
 * `streamInfo.playSessionId` is read back out of the url (`getParam('playSessionId', mediaUrl)`),
 * and it is what the client reports playback lifecycle with and what `onPlaybackStopped` hands
 * back. So if the minted id and the url disagree, the capability is filed under an id nothing ever
 * reports: the server never revokes it, and it outlives the playback it was minted for. That is the
 * same defect the audio family had, reached by a different route, and only a replay can see it.
 *
 * OUTPUT SAFETY. The replayed url is held in memory and never recorded: the report keeps a path,
 * sorted query KEY names and status codes, and no credential value of any kind.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, request, test } from '@playwright/test';

import { signIn } from '../e2e/support/b2';
import { admin, openDetailByName, playControl } from './support/rig';

const MOVIE = 'Smoke Test Movie';

interface Lifecycle {
    path: string;
    playSessionId: string | null;
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

test.describe('#153-A1 direct-play video revocation', () => {
    test('the capability a direct playback used is refused once that play session ends', async ({
        page
    }) => {
        test.setTimeout(300_000);

        const a = await admin();
        const lifecycle: Lifecycle[] = [];
        const statuses: number[] = [];
        let firstUrl: string | null = null;
        let redactedFirst = '';
        let replayStatus: number | null = null;

        page.on('response', (response) => {
            const url = response.url();
            if (!/\/videos\/[^/]+\/stream/i.test(url)) return;
            if (firstUrl === null) {
                firstUrl = url;
                redactedFirst = redact(url);
            }
            statuses.push(response.status());
        });

        page.on('request', (req) => {
            const url = req.url();
            if (!/\/Sessions\/Playing/i.test(url)) return;
            let body: Record<string, unknown> = {};
            try {
                body = JSON.parse(req.postData() ?? '{}');
            } catch {
                body = {};
            }
            lifecycle.push({
                path: new URL(url).pathname,
                playSessionId: (body.PlaySessionId as string) ?? null
            });
        });

        const writeReport = () => {
            const out = join(
                process.cwd(),
                'test-results',
                'a1-directplay-revocation.json'
            );
            if (!existsSync(dirname(out))) {
                mkdirSync(dirname(out), { recursive: true });
            }
            const report = {
                redactedFirst,
                statuses,
                lifecycle,
                replayStatus
            };
            writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(report, null, 2));
        };

        try {
            await signIn(page);
            await openDetailByName(page, MOVIE);
            await playControl(page).click();
            await page.waitForURL(/#\/video/, { timeout: 30_000 });
            await expect(page.locator('video')).toBeVisible({
                timeout: 30_000
            });
            await expect
                .poll(() => statuses.length, {
                    timeout: 60_000,
                    message: 'the direct-play route must be requested'
                })
                .toBeGreaterThan(0);
            await page.waitForTimeout(4_000);

            // Stop through the UI. That is what reports the stop, which is what the server revokes
            // on - a test that merely navigates away proves nothing about revocation.
            await page.keyboard.press('Escape');
            await expect
                .poll(
                    () =>
                        lifecycle.filter((l) => l.path.endsWith('/Stopped'))
                            .length,
                    {
                        timeout: 60_000,
                        message: 'stopping playback must report a stop'
                    }
                )
                .toBeGreaterThan(0);
            // The stop report and the server's revocation are two separate hops.
            await page.waitForTimeout(2_000);

            expect(firstUrl, 'a direct-play url was captured').not.toBeNull();
            const replay = await request.newContext();
            try {
                const response = await replay.get(firstUrl as string, {
                    headers: { Range: 'bytes=0-0' }
                });
                replayStatus = response.status();
            } finally {
                await replay.dispose();
            }
        } finally {
            await a.dispose();
            writeReport();
        }

        // Playback really happened, on a capability rather than the durable token.
        expect(statuses.length, 'media was fetched').toBeGreaterThan(0);
        expect(
            redactedFirst.includes('playbackCapability'),
            `${redactedFirst} must carry a playbackCapability`
        ).toBe(true);
        expect(
            redactedFirst.toLowerCase().includes('apikey'),
            `${redactedFirst} must not carry ApiKey/api_key`
        ).toBe(false);

        // The contract: the play session ended, so its capability is dead.
        expect(
            replayStatus,
            `the ended play session's capability must be refused (got ${replayStatus})`
        ).toBeGreaterThanOrEqual(400);
    });
});

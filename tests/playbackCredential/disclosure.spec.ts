import { expect, test } from '@playwright/test';

import { signIn } from '../e2e/support/b2';
import {
    admin,
    expectPlaybackAdvances,
    openDetailByName,
    playControl,
    sessionFacts,
    sessionToken,
    TRANSCODE_TITLE,
    watchDisclosure,
    watchMedia
} from './support/rig';

/**
 * S4 — THE SHIPPED CLIENT MUST NOT PUBLISH THE SESSION CREDENTIAL WHILE PLAYING.
 *
 * Driven against the production bundle served by a real Tesserafin server (`ci/serve-e2e.sh
 * --webdir <dist>`), for both playback modes the product actually uses. The disclosure counter
 * compares console text against the page's own session token IN MEMORY and answers with counts
 * only: no url, console payload or credential ever reaches the runner's output.
 *
 * The functional half is asserted first and separately, so a bundle that is quiet because playback
 * never happened cannot pass.
 */
const MOVIE = 'Smoke Test Movie';

for (const [title, mode] of [
    [MOVIE, 'DirectPlay'],
    [TRANSCODE_TITLE, 'Transcode']
] as const) {
    test(`${mode.toLowerCase()} plays without disclosing the session credential`, async ({
        page
    }) => {
        const rig = await admin();
        try {
            const media = watchMedia(page);
            await signIn(page);
            const token = await sessionToken(page);
            expect(
                token.length,
                'the page must hold a session token'
            ).toBeGreaterThan(0);
            const disclosure = watchDisclosure(page, token);

            await openDetailByName(page, title);
            await playControl(page).click();
            await page.waitForURL(/#\/video/, { timeout: 30_000 });
            await expect(page.locator('video')).toBeVisible({
                timeout: 30_000
            });
            await page.evaluate(() => {
                const video = document.querySelector('video');
                if (video) video.loop = true;
            });

            const reachedTime = await expectPlaybackAdvances(page);
            await page.waitForTimeout(3_000);

            const facts = await sessionFacts(rig, title);
            const bytes = media();
            // Counts and booleans only.
            console.log(
                `[s4] ${mode} playMethod=${facts.playMethod} transcoding=${facts.hasTranscodingInfo} ` +
                    `mediaRequests=${bytes.requests} bytes=${bytes.bytes} advanced=${reachedTime > 0} ` +
                    `disclosures=${disclosure.total()}`
            );

            expect(
                facts.playMethod,
                'the server must report the intended play method'
            ).toBe(mode);
            if (mode === 'Transcode') {
                expect(
                    facts.hasTranscodingInfo,
                    'a real transcode session must exist'
                ).toBe(true);
            } else {
                expect(
                    facts.hasTranscodingInfo,
                    'no transcode session may exist'
                ).toBe(false);
            }
            expect(
                bytes.requests,
                'the browser must have fetched media'
            ).toBeGreaterThan(0);
            expect(
                bytes.bytes,
                'the browser must have fetched real bytes'
            ).toBeGreaterThan(0);
            expect(reachedTime, 'playback must advance').toBeGreaterThan(0);

            expect(
                disclosure.total(),
                `console entries carrying the session credential, by level: ${JSON.stringify(disclosure.byLevel())}`
            ).toBe(0);
        } finally {
            await rig.dispose();
        }
    });
}

/**
 * #153-A1 — the fallback-font and attachment families, reached through the REAL subtitle path.
 *
 * WHY THIS FILE EXISTS. Both families are produced only by `htmlVideoPlayer.renderSsaAss`, which
 * runs only when an ASS/SSA track actually renders through libass. `matrix.spec.ts` already seeded
 * the fixture and enabled the fallback font, then tried to select the track by pressing `c` — which
 * does nothing in this shell. So `renderSsaAss` was never entered, and both families sat in
 * `FAMILY_CONTRACT` as `unreached` with a note describing a driving bug as if it were a product gap.
 *
 * The real path is the one a person uses: the video OSD's subtitle control opens an action sheet,
 * and choosing a track calls `playbackManager.setSubtitleStreamIndex`. Driving THAT reaches
 * `renderSsaAss`, and both families follow.
 *
 * WHAT IS ASSERTED, AND WHY EACH HALF IS NEEDED.
 *
 *   * the transport: every request carries a `playbackCapability` and no durable credential;
 *   * the BINDING, which no request url can show: the mint bodies. `Fonts` is item-less — the
 *     server never compares an item for a fallback-font request — while `Attachments` names the
 *     item AND the media source. Asserting only the urls would pass on a capability minted with
 *     the wrong scope set entirely.
 *   * real bytes. A 200 with an empty body is not a font.
 *
 * OUTPUT SAFETY. Mint REQUEST bodies are recorded (scope names and ids, no credential); mint
 * RESPONSES are never read. Urls are reduced to path plus sorted query KEY names.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { signIn } from '../e2e/support/b2';
import {
    enableFallbackFont,
    mediaItemIdByName,
    seedAssLibrary
} from './support/fixtures';
import {
    admin,
    expectPlaybackAdvances,
    playControl,
    sessionToken
} from './support/rig';

interface Observed {
    family: string;
    method: string;
    redactedUrl: string;
    queryKeys: string[];
    status: number | null;
    bytes: number | null;
    carriesPlaybackCapability: boolean;
    carriesApiKeyParam: boolean;
    carriesDurableToken: boolean;
}

interface Mint {
    scopes: string[];
    hasItemId: boolean;
    hasMediaSourceId: boolean;
    playSessionIdPresent: boolean;
}

/** Which family a url belongs to. The file-vs-list split matters: only the file carries bytes. */
function family(url: string): string | null {
    const u = url.toLowerCase();
    if (/\/fallbackfont\/fonts\/[^/?]+/.test(u)) return 'font-file';
    if (/\/fallbackfont\/fonts/.test(u)) return 'font-list';
    if (/\/attachments\//.test(u)) return 'attachment';
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

test.describe('#153-A1 libass families', () => {
    test('selecting an ASS track reaches the fallback fonts and the attachment, on capabilities only', async ({
        page
    }) => {
        test.setTimeout(600_000);

        const a = await admin();
        // Its OWN library: sharing the ASS fixture with matrix.spec.ts made whichever spec ran
        // second resolve the first one's disposed item and answer 404.
        const ass = await seedAssLibrary(a, 'A1 Libass');
        const fallback = await enableFallbackFont(a);

        const observed: Observed[] = [];
        const mints: Mint[] = [];
        const menuItems: string[] = [];
        let token = '';
        let chosen: string | null = null;
        let advanced: number | null = null;

        page.on('request', (request) => {
            if (!/\/Playback\/Capabilities$/i.test(request.url())) return;
            let body: Record<string, unknown> = {};
            try {
                body = JSON.parse(request.postData() ?? '{}');
            } catch {
                body = {};
            }
            mints.push({
                scopes: Array.isArray(body.Scopes)
                    ? (body.Scopes as string[])
                    : [],
                hasItemId: 'ItemId' in body,
                hasMediaSourceId: 'MediaSourceId' in body,
                playSessionIdPresent: Boolean(body.PlaySessionId)
            });
        });

        page.on('response', async (response) => {
            const url = response.url();
            const kind = family(url);
            if (!kind) return;
            let queryKeys: string[] = [];
            try {
                queryKeys = [...new URL(url).searchParams.keys()];
            } catch {
                queryKeys = [];
            }
            let bytes: number | null = null;
            try {
                bytes = (await response.body()).length;
            } catch {
                bytes = null;
            }
            observed.push({
                family: kind,
                method: response.request().method(),
                redactedUrl: redact(url),
                queryKeys,
                status: response.status(),
                bytes,
                carriesPlaybackCapability:
                    queryKeys.includes('playbackCapability'),
                carriesApiKeyParam: queryKeys.some(
                    (k) => k.toLowerCase() === 'apikey' || k === 'api_key'
                ),
                carriesDurableToken: token.length > 0 && url.includes(token)
            });
        });

        const writeReport = () => {
            const out = join(
                process.cwd(),
                'test-results',
                'a1-libass-families.json'
            );
            if (!existsSync(dirname(out))) {
                mkdirSync(dirname(out), { recursive: true });
            }
            const report = {
                generatedFor: '#153-A1 libass families',
                note: 'route classes, query KEY names, mint REQUEST scope names and byte counts only; no credential value is recorded',
                menuItems,
                chosen,
                advanced,
                requests: observed.map((o) => ({
                    family: o.family,
                    method: o.method,
                    redactedUrl: o.redactedUrl,
                    status: o.status,
                    bytes: o.bytes,
                    carriesPlaybackCapability: o.carriesPlaybackCapability,
                    carriesApiKeyParam: o.carriesApiKeyParam,
                    carriesDurableToken: o.carriesDurableToken
                })),
                mints
            };
            writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(report, null, 2));
        };

        try {
            await signIn(page);
            token = await sessionToken(page);
            expect(token.length).toBeGreaterThan(0);

            const assId = await mediaItemIdByName(
                a,
                'A1 Libass Probe',
                'Video'
            );
            await page.goto(`/#/details?id=${assId}`);
            await expect(playControl(page)).toBeVisible({ timeout: 60_000 });
            await playControl(page).click();
            advanced = await expectPlaybackAdvances(page, 0.2);

            // The OSD hides itself; a real pointer movement is what brings it back, and the
            // subtitle control only exists while it is up.
            await page.mouse.move(700, 450);
            await page.mouse.move(720, 460);
            const subtitleControl = page
                .locator('.btnSubtitles:visible')
                .first();
            await expect(
                subtitleControl,
                'the video OSD must offer a subtitle control'
            ).toBeVisible({ timeout: 30_000 });
            await subtitleControl.click();

            const items = page.locator('.actionSheetMenuItem');
            await expect(
                items.first(),
                'the subtitle control must open a track menu'
            ).toBeVisible({ timeout: 15_000 });
            const count = await items.count();
            for (let index = 0; index < count; index++) {
                const item = items.nth(index);
                menuItems.push(
                    `${await item.getAttribute('data-id')} :: ${(
                        (await item.textContent()) ?? ''
                    )
                        .trim()
                        .slice(0, 60)}`
                );
            }
            // Anything that is not "Off" (-1) and not the secondary-subtitle entry.
            for (let index = 0; index < count; index++) {
                const item = items.nth(index);
                const id = await item.getAttribute('data-id');
                if (id && id !== '-1' && id !== 'secondarysubtitle') {
                    chosen = menuItems[index];
                    await item.click();
                    break;
                }
            }
            expect(
                chosen,
                'the menu must offer a real subtitle track to select'
            ).not.toBeNull();

            // libass fetches the font list, then the font, then the attachment. Poll for the
            // LAST of those rather than sleeping a fixed time.
            await expect
                .poll(() => new Set(observed.map((o) => o.family)).size, {
                    timeout: 90_000,
                    message:
                        'selecting the track must reach the font list, a font file and the attachment'
                })
                .toBeGreaterThanOrEqual(3);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(2_000);
        } finally {
            await fallback.dispose();
            await ass.dispose();
            await a.dispose();
            writeReport();
        }

        expect(
            advanced,
            'playback must have advanced before the track was chosen'
        ).toBeGreaterThan(0);

        // ── every family was reached, with real bytes ────────────────────────────────────────
        for (const required of ['font-list', 'font-file', 'attachment']) {
            const hits = observed.filter((o) => o.family === required);
            expect(
                hits.length,
                `${required} must have been requested`
            ).toBeGreaterThan(0);
            expect(
                hits.some(
                    (h) => (h.status ?? 0) >= 200 && (h.status ?? 0) < 300
                ),
                `${required} must have succeeded`
            ).toBe(true);
        }
        // The list is a JSON payload; the file and the attachment are real media bytes.
        for (const required of ['font-file', 'attachment']) {
            const best = Math.max(
                ...observed
                    .filter((o) => o.family === required)
                    .map((o) => o.bytes ?? 0)
            );
            expect(
                best,
                `${required} must have returned real bytes`
            ).toBeGreaterThan(0);
        }
        expect(
            Math.max(
                ...observed
                    .filter((o) => o.family === 'font-list')
                    .map((o) => o.bytes ?? 0)
            ),
            'the font list must have a payload'
        ).toBeGreaterThan(0);

        // ── transport: capability only, never a durable credential ───────────────────────────
        for (const request of observed) {
            expect(
                request.carriesPlaybackCapability,
                `${request.family} ${request.redactedUrl} must carry a playbackCapability`
            ).toBe(true);
            expect(
                request.carriesApiKeyParam,
                `${request.family} ${request.redactedUrl} must not carry ApiKey/api_key`
            ).toBe(false);
            expect(
                request.carriesDurableToken,
                `${request.family} ${request.redactedUrl} must not carry the durable token`
            ).toBe(false);
        }

        // ── binding: what no url can show ────────────────────────────────────────────────────
        //
        // `Fonts` is item-less on purpose: the server never compares an item for a fallback-font
        // request, so minting one bound to an item would be a capability nobody can renew against
        // the right authority. `Attachments` is the opposite - it names both.
        const fontsMint = mints.find((m) => m.scopes.includes('Fonts'));
        expect(
            fontsMint,
            'a Fonts capability must have been minted'
        ).toBeTruthy();
        expect(
            fontsMint?.hasItemId,
            'the Fonts capability must not be bound to an item'
        ).toBe(false);
        expect(
            fontsMint?.hasMediaSourceId,
            'the Fonts capability must not be bound to a media source'
        ).toBe(false);
        expect(
            fontsMint?.playSessionIdPresent,
            'the Fonts capability must still name a play session'
        ).toBe(true);

        const attachmentMint = mints.find((m) =>
            m.scopes.includes('Attachments')
        );
        expect(
            attachmentMint,
            'an Attachments capability must have been minted'
        ).toBeTruthy();
        expect(
            attachmentMint?.hasItemId,
            'the Attachments capability must be bound to its item'
        ).toBe(true);
        expect(
            attachmentMint?.hasMediaSourceId,
            'the Attachments capability must be bound to its media source'
        ).toBe(true);
    });
});

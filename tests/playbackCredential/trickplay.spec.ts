/**
 * #153-A1 — the trickplay family, reached through the real scrub-preview interaction.
 *
 * WHY THIS FILE EXISTS. `FAMILY_CONTRACT` carried `trickplay` as `unreached` because "the rig
 * seeds no trickplay tiles". That was accurate and it was not a product gap: the tiles are a
 * library option plus a scheduled task away, and once they exist the production controller builds
 * the url itself.
 *
 * The producer is `updateTrickplayBubbleHtml` in the legacy video controller, which the OSD's
 * position slider calls through `updateBubbleHtml` when a pointer moves across it. It mints a
 * `Trickplay` capability and writes the url into the preview element's `background-image`. So the
 * only honest way to reach it is to hover the real slider during real playback.
 *
 * WHAT IS ASSERTED
 *
 *   * the browser really requested a tile, and the response carried real image bytes;
 *   * the url the CONTROLLER wrote reached the CSS preview - a request without the style would
 *     mean something else fetched the tile, and a style without the request would mean the
 *     preview never rendered;
 *   * the capability is bound to the item AND the media source;
 *   * neither the request nor the DOM style carries a durable credential. The style matters on its
 *     own: a token in `background-image` is readable by any script on the page and survives in the
 *     DOM long after the request is over.
 *
 * OUTPUT SAFETY. The style is reduced to path plus sorted query KEY names before it is recorded,
 * and compared against the session token in memory only.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { signIn } from '../e2e/support/b2';
import {
    generateTrickplay,
    mediaItemIdByName,
    seedTrickplayLibrary
} from './support/fixtures';
import {
    admin,
    expectPlaybackAdvances,
    playControl,
    sessionToken
} from './support/rig';

interface TileRequest {
    redactedUrl: string;
    queryKeys: string[];
    status: number | null;
    bytes: number | null;
    carriesPlaybackCapability: boolean;
    carriesApiKeyParam: boolean;
    carriesDurableToken: boolean;
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

test.describe('#153-A1 trickplay', () => {
    test('scrubbing the real position slider fetches a tile on a Trickplay capability', async ({
        page
    }) => {
        test.setTimeout(900_000);

        const a = await admin();
        const library = await seedTrickplayLibrary(a);

        const tiles: TileRequest[] = [];
        const mints: Array<{
            scopes: string[];
            hasItemId: boolean;
            hasMediaSourceId: boolean;
        }> = [];
        let token = '';
        let resolutions: Record<string, unknown> = {};
        let styleUrl: string | null = null;
        let styleCarriesDurableToken: boolean | null = null;
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
                hasMediaSourceId: 'MediaSourceId' in body
            });
        });

        page.on('response', async (response) => {
            const url = response.url();
            if (!/\/Trickplay\//i.test(url)) return;
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
            tiles.push({
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
                'a1-trickplay.json'
            );
            if (!existsSync(dirname(out))) {
                mkdirSync(dirname(out), { recursive: true });
            }
            const report = {
                generatedFor: '#153-A1 trickplay',
                note: 'route class, query KEY names, mint REQUEST scope names and byte counts only; no credential value is recorded',
                resolutions,
                advanced,
                styleUrl,
                styleCarriesDurableToken,
                tiles,
                mints
            };
            writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(report, null, 2));
        };

        try {
            const itemId = await mediaItemIdByName(
                a,
                library.itemName,
                'Video'
            );
            resolutions = await generateTrickplay(a, itemId);

            await signIn(page);
            token = await sessionToken(page);
            expect(token.length).toBeGreaterThan(0);

            await page.goto(`/#/details?id=${itemId}`);
            await expect(playControl(page)).toBeVisible({ timeout: 60_000 });
            await playControl(page).click();
            advanced = await expectPlaybackAdvances(page, 0.2);

            // The OSD hides itself; a pointer movement brings it back, and the slider only
            // exists while it is up.
            await page.mouse.move(700, 450);
            const slider = page.locator('.osdPositionSlider:visible').first();
            await expect(
                slider,
                'the OSD must show a position slider'
            ).toBeVisible({ timeout: 30_000 });
            const box = await slider.boundingBox();
            expect(
                box,
                'the position slider must have a box to hover'
            ).toBeTruthy();

            // Read the style WHILE hovering. The bubble is torn down as soon as the pointer
            // leaves, so a read after the loop finds an empty style and proves nothing - which
            // is exactly what the first run of this measurement recorded.
            for (const fraction of [0.3, 0.5, 0.7, 0.9]) {
                await page.mouse.move(
                    box!.x + box!.width * fraction,
                    box!.y + box!.height / 2
                );
                await page.waitForTimeout(1_200);
                // `.chapterThumbWrapper`, not `.chapterThumb`: the controller creates the
                // wrapper and writes `background-image` onto it, then serializes the whole
                // container through `bubble.innerHTML = container.outerHTML`, so the url lives
                // in an inline style attribute. Reading the wrong element found nothing and
                // said nothing about whether the url ever reached the DOM.
                const seen = await page.evaluate(() => {
                    const thumb = document.querySelector(
                        '.chapterThumbWrapper'
                    ) as HTMLElement | null;
                    return (
                        thumb?.style.backgroundImage ||
                        thumb?.getAttribute('style') ||
                        ''
                    );
                });
                const match = /url\(["']?([^"')]+)["']?\)/.exec(seen);
                if (match) {
                    styleCarriesDurableToken =
                        token.length > 0 && match[1].includes(token);
                    styleUrl = redact(match[1]);
                    break;
                }
            }
            await page.waitForTimeout(2_000);
            await page.keyboard.press('Escape');
        } finally {
            await library.dispose();
            await a.dispose();
            writeReport();
        }

        expect(
            advanced,
            'playback must have advanced before scrubbing'
        ).toBeGreaterThan(0);
        expect(
            Object.keys(resolutions).length,
            'the trickplay task must have produced at least one resolution'
        ).toBeGreaterThan(0);

        // ── the browser fetched a tile, and it was a real image ──────────────────────────────
        expect(
            tiles.length,
            'scrubbing must request a trickplay tile'
        ).toBeGreaterThan(0);
        const served = tiles.filter(
            (t) => (t.status ?? 0) >= 200 && (t.status ?? 0) < 300
        );
        expect(
            served.length,
            'a trickplay tile must have been served'
        ).toBeGreaterThan(0);
        expect(
            Math.max(...served.map((t) => t.bytes ?? 0)),
            'the tile must carry real image bytes'
        ).toBeGreaterThan(0);

        // ── the production controller wrote that url into the preview ───────────────────────
        expect(
            styleUrl,
            'the controller must write the tile url into the preview style'
        ).not.toBeNull();
        expect(
            styleUrl,
            'the preview style must point at the trickplay route'
        ).toContain('/Trickplay/');
        expect(
            styleCarriesDurableToken,
            'the preview style must not carry the durable token'
        ).toBe(false);

        // ── transport ──────────────────────────────────────────────────────────────────────
        for (const tile of served) {
            expect(
                tile.carriesPlaybackCapability,
                `${tile.redactedUrl} must carry a playbackCapability`
            ).toBe(true);
            expect(
                tile.carriesApiKeyParam,
                `${tile.redactedUrl} must not carry ApiKey/api_key`
            ).toBe(false);
            expect(
                tile.carriesDurableToken,
                `${tile.redactedUrl} must not carry the durable token`
            ).toBe(false);
        }

        // ── binding ────────────────────────────────────────────────────────────────────────
        const trickplayMint = mints.find((m) => m.scopes.includes('Trickplay'));
        expect(
            trickplayMint,
            'a Trickplay capability must have been minted'
        ).toBeTruthy();
        expect(
            trickplayMint?.hasItemId,
            'the Trickplay capability must be bound to its item'
        ).toBe(true);
        expect(
            trickplayMint?.hasMediaSourceId,
            'the Trickplay capability must be bound to its media source'
        ).toBe(true);
    });
});

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { BASE_URL, MOVIE_TITLE, navLibrary, signIn } from '../e2e/support/b2';
import {
    admin,
    expectPlaybackAdvances,
    openDetailByName,
    playControl,
    sessionFacts,
    TRANSCODE_TITLE,
    watchMedia
} from '../playbackCredential/support/rig';
import { violations, watchConsole } from './observer.mjs';

// Deliberate targets, not measured results. Do not increase them to bless chatter.
const CEILINGS = {
    signIn: 0,
    library: 0,
    detail: 0,
    directPlay: 0,
    transcode: 0
};
type Flow = keyof typeof CEILINGS;

test.beforeAll(async ({ request }) => {
    // Require an immutable image reference in the evidence. The caller supplies it;
    // this is provenance metadata, not independent proof of which container is running.
    expect(process.env.TESSERAFIN_CONSOLE_IMAGE).toMatch(
        /(?:@|^)sha256:[a-f0-9]{64}$/
    );
    const root = await request.get(BASE_URL);
    expect(root.ok()).toBe(true);
    const html = await root.text();
    const script = html.match(
        /<script\b[^>]*\bsrc=["']([^"']*main\.tesserafin\.bundle\.js[^"']*)["']/i
    );
    expect(
        script,
        'the image must serve the production SPA entry'
    ).toBeTruthy();
    const assetBase = new URL('.', new URL(script![1], root.url()));
    const sha256 = (bytes: Buffer) =>
        createHash('sha256').update(bytes).digest('hex');
    // Include lazy and vendor chunks: matching just the entry could test a stale
    // image whose player/detail code differs from the candidate.
    const assets = readdirSync(resolve('dist')).filter(
        (name) =>
            /\.(bundle|chunk)\.js$/.test(name) || name === 'serviceworker.js'
    );
    expect(assets).toContain('main.tesserafin.bundle.js');
    for (const name of assets) {
        const response = await request.get(new URL(name, assetBase).href);
        expect(response.ok(), `served asset ${name}`).toBe(true);
        expect(
            sha256(await response.body()),
            `served production asset ${name}`
        ).toBe(sha256(readFileSync(resolve('dist', name))));
    }
    await test.info().attach('bundle-identity', {
        body: JSON.stringify({
            image: process.env.TESSERAFIN_CONSOLE_IMAGE,
            matchedScripts: assets.length
        }),
        contentType: 'application/json'
    });
});

async function measure(page: Page, flow: Flow, action: () => Promise<void>) {
    const observer = watchConsole(page, new URL(BASE_URL).origin);
    let report;
    try {
        await action();
        // Include asynchronous effects. Playback is separately observed for 3 s below.
        await page.waitForTimeout(2_000);
    } finally {
        report = observer.finish();
        await test.info().attach(`${flow}-console-counts`, {
            body: JSON.stringify(
                {
                    flow,
                    ceiling: CEILINGS[flow],
                    image: process.env.TESSERAFIN_CONSOLE_IMAGE,
                    counts: report
                },
                null,
                2
            ),
            contentType: 'application/json'
        });
    }
    expect(
        violations(report, CEILINGS[flow]),
        'severity and volume gate'
    ).toEqual([]);
}

test('first sign-in', async ({ page }) => {
    // Fresh Playwright context; observer attached before the initial document load.
    await measure(page, 'signIn', () => signIn(page));
});

test('library navigation', async ({ page }) => {
    await signIn(page);
    await measure(page, 'library', async () => {
        await navLibrary(page).click();
        await page.waitForURL('**/#/library/**');
        await expect(
            page.getByText(MOVIE_TITLE, { exact: false }).first()
        ).toBeVisible();
    });
});

test('item detail', async ({ page }) => {
    await signIn(page);
    await measure(page, 'detail', () => openDetailByName(page, MOVIE_TITLE));
});

for (const [flow, title, mode] of [
    ['directPlay', MOVIE_TITLE, 'DirectPlay'],
    ['transcode', TRANSCODE_TITLE, 'Transcode']
] as const) {
    test(flow, async ({ page }) => {
        const rig = await admin();
        try {
            await signIn(page);
            await openDetailByName(page, title);
            await measure(page, flow, async () => {
                const media = watchMedia(page);
                const playing = page.waitForURL(/#\/video/, {
                    timeout: 30_000
                });
                await playControl(page).click();
                await playing;
                await expect(page.locator('video')).toBeVisible();
                await page.evaluate(() => {
                    const video = document.querySelector('video');
                    if (video) video.loop = true;
                });
                await expectPlaybackAdvances(page);
                await page.waitForTimeout(3_000);
                const facts = await sessionFacts(rig, title);
                expect(facts.playMethod).toBe(mode);
                expect(facts.hasTranscodingInfo).toBe(mode === 'Transcode');
                expect(media().requests).toBeGreaterThan(0);
                expect(media().bytes).toBeGreaterThan(0);
            });
        } finally {
            await rig.dispose();
        }
    });
}

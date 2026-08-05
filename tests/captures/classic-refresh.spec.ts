import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * Before/after captures for the Tesserafin Classic visual refresh (RFC-0007, #114).
 *
 * These are **owner-acceptance evidence**, not assertions about pixels. There is deliberately no
 * screenshot comparison: the whole point of the change is that the pixels differ, and a snapshot
 * baseline would have to be updated by the same commit that changes the design — which makes it
 * a record of what happened rather than a check on it.
 *
 * What IS asserted is the small set of things that would make a capture misleading:
 *
 *   - the harness finished loading its tokens before the shot (`data-capture-ready`);
 *   - the palette actually reaching the DOM is the one the capture claims;
 *   - `before` and `after` really differ;
 *   - reduced motion really zeroes the durations rather than merely setting an attribute.
 *
 * Every combination the loop requires is covered: Home desktop, Library mobile/touch, Item Details
 * TV/remote, one dark and one light state, and a reduced-motion proof.
 */

// Playwright transpiles specs to CommonJS, so `import.meta.url` is unavailable here — `__dirname`
// is the portable way to anchor to this directory rather than to the process's cwd.
const HERE = __dirname;
const OUT = join(HERE, 'out');

const VIEWPORT = {
    pointer: { width: 1440, height: 900 },
    touch: { width: 390, height: 844 },
    remote: { width: 1920, height: 1080 }
} as const;

type Side = 'before' | 'after';

interface Shot {
    name: string;
    surface: 'home' | 'library' | 'itemDetails';
    profile: keyof typeof VIEWPORT;
    mode: 'dark' | 'light';
    reducedMotion?: boolean;
}

const SHOTS: Shot[] = [
    {
        name: '01-home-desktop-dark',
        surface: 'home',
        profile: 'pointer',
        mode: 'dark'
    },
    {
        name: '02-library-mobile-dark',
        surface: 'library',
        profile: 'touch',
        mode: 'dark'
    },
    {
        name: '03-item-details-tv-dark',
        surface: 'itemDetails',
        profile: 'remote',
        mode: 'dark'
    },
    {
        name: '04-home-desktop-light',
        surface: 'home',
        profile: 'pointer',
        mode: 'light'
    },
    {
        name: '05-library-mobile-light',
        surface: 'library',
        profile: 'touch',
        mode: 'light'
    },
    {
        name: '06-home-desktop-dark-reduced-motion',
        surface: 'home',
        profile: 'pointer',
        mode: 'dark',
        reducedMotion: true
    }
];

function harnessUrl(side: Side, shot: Shot): string {
    const params = new URLSearchParams({
        tokens: side,
        surface: shot.surface,
        profile: shot.profile,
        mode: shot.mode
    });
    if (shot.reducedMotion) params.set('reducedMotion', '1');
    return `/index.html?${params.toString()}`;
}

/** The palette the harness claims to be rendering, read out of the served token file. */
function expectedBackground(side: Side, mode: 'dark' | 'light'): string {
    const tokens = JSON.parse(
        readFileSync(
            join(HERE, 'dist', '__tokens__', `classic.${side}.json`),
            'utf8'
        )
    );
    return tokens.color[mode].background as string;
}

test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
});

for (const side of ['before', 'after'] as const) {
    for (const shot of SHOTS) {
        test(`${side} — ${shot.name}`, async ({ page }) => {
            await page.setViewportSize(VIEWPORT[shot.profile]);
            await page.goto(harnessUrl(side, shot));

            // Waits on the harness's own readiness flag rather than a timeout: a shot taken before
            // the tokens landed would capture the wrong palette and still look plausible.
            await page.waitForSelector('html[data-capture-ready="true"]');

            const preview = page.locator(
                '[data-testid="theme-studio-preview"]'
            );
            await expect(preview).toBeVisible();

            // The capture is of the palette it says it is.
            const background = await preview.evaluate((element) =>
                getComputedStyle(element)
                    .getPropertyValue('--rf-color-background')
                    .trim()
            );
            expect(background).toBe(expectedBackground(side, shot.mode));

            await preview.screenshot({
                path: join(OUT, `${shot.name}.${side}.png`)
            });
        });
    }
}

test('the two sides are genuinely different palettes', () => {
    // Guards the whole exercise: if `prepare-tokens.mjs` fell back to comparing a commit against
    // itself, every capture pair above would be identical and the evidence would be worthless
    // while still looking complete.
    expect(expectedBackground('before', 'dark')).not.toBe(
        expectedBackground('after', 'dark')
    );
});

test('a shelf lays out as a row of items, not one full-width card', async ({
    page
}) => {
    // This is the defect the first capture run surfaced. `MediaCard` is `width: 100%` — right
    // inside `MediaGrid`, where the grid track sizes it — but in the shelf's flex scroller
    // `flex-basis: auto` resolved that against the scroller's content box, so one card filled the
    // whole shelf. The loading skeleton was 260px wide the entire time, so every shelf reflowed
    // from a row of tiles to a single card the moment data arrived.
    //
    // Asserted in a real browser because it is a layout fact: jsdom computes no box, so the
    // component unit tests could not have caught it and did not.
    await page.setViewportSize(VIEWPORT.pointer);
    await page.goto(harnessUrl('after', SHOTS[0]));
    await page.waitForSelector('html[data-capture-ready="true"]');

    const shelf = page.locator('[data-rf-slot="media-shelf"]').first();
    const cards = shelf.locator('[data-rf-slot="media-card"]');

    expect(await cards.count()).toBeGreaterThan(1);

    const [first, scroller] = await Promise.all([
        cards.first().boundingBox(),
        shelf.boundingBox()
    ]);
    if (!first || !scroller) throw new Error('shelf did not lay out');

    expect(first.width).toBeCloseTo(260, 0);
    // And the row really is a row: a second card starts to the right of the first, on the same line.
    const second = await cards.nth(1).boundingBox();
    if (!second) throw new Error('second card did not lay out');
    expect(second.x).toBeGreaterThan(first.x + first.width - 1);
    expect(second.y).toBeCloseTo(first.y, 0);
});

test('reduced motion really zeroes durations, not just an attribute', async ({
    page
}) => {
    await page.setViewportSize(VIEWPORT.pointer);

    await page.goto(harnessUrl('after', SHOTS[0]));
    await page.waitForSelector('html[data-capture-ready="true"]');
    const normal = await page
        .locator('[data-testid="theme-studio-preview"]')
        .evaluate((element) =>
            getComputedStyle(element)
                .getPropertyValue('--rf-motion-duration-normal')
                .trim()
        );

    await page.goto(harnessUrl('after', SHOTS[5]));
    await page.waitForSelector('html[data-capture-ready="true"]');
    const reduced = await page
        .locator('[data-testid="theme-studio-preview"]')
        .evaluate((element) =>
            getComputedStyle(element)
                .getPropertyValue('--rf-motion-duration-normal')
                .trim()
        );

    expect(normal).not.toBe('0ms');
    expect(reduced).toBe('0ms');
});

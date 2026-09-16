/**
 * The home composition must leave room at the viewport edges for what its cards paint outside
 * their own box (#179 — the inline half of #177, whose vertical half landed as #178).
 *
 * `MediaCard:focus-visible` is `outline: 2px` at `outline-offset: 2px`, so the ring reaches 4px
 * beyond the card's border box. Measured on `bd6614da15` at 1440x900 and 412x839, both official
 * themes: every box from `body` down to `.rf-media-shelf__scroller` was full-bleed, the scroller's
 * left was `0` and the first card's left was `0`, so the ring's outer half was painted at
 * x = -4..0. At 412 the shelf also scrolls (scrollWidth 535 > 412) and the last card's right edge
 * landed on the viewport's own right edge.
 *
 * WHY IT ASSERTS TWO CONTAINMENTS AND NOT ONE. The ring has to survive two different cuts, and a
 * fix for either one alone leaves the other:
 *
 *   - the VIEWPORT. A ring painted at a negative x is simply not on screen.
 *   - the SCROLLER. `overflow-x: auto` clips at the padding box on both axes, and `scrollLeft`
 *     cannot go negative in LTR, so anything outside the content-box start is unreachable. A
 *     gutter on the composition alone passes the viewport check and still fails this one: it moves
 *     the clip inward instead of removing it.
 *
 * WHY IT RUNS AT TWO WIDTHS. At 1440 the fixture's shelf does not overflow, so `scrollLeft` is
 * pinned at 0, the end edge is never reached and `scroll-snap-align: start` can never snap the
 * scroller's inline padding away. Both of those only bite once the shelf actually scrolls, which it
 * does at 412. A desktop-only version of this spec passes on a tree where mobile is still broken.
 *
 * WHY KEYBOARD FOCUS. `:focus-visible` is the browser's own "navigating by keyboard" heuristic and
 * a programmatic `focus()` does not reliably satisfy it. A ring measured while the selector does
 * not match is a ring of width 0, which would pass this spec for the wrong reason — hence the
 * explicit `ring > 0` assertion before any containment is checked.
 */
import type { Page } from '@playwright/test';

import { REQUESTED_THEMES, waitForResolvedTheme } from './support/captureBody';
import { administrator, installFixtureApi, USER_A } from './support/fixtureApi';
import { DIST, expect, test } from './support/harness';

const HOME = '[data-rf-slot="home-composition"]';
const SCROLLER = `${HOME} .rf-media-shelf__scroller`;
const CARD = `${SCROLLER} .rf-media-card`;

/** Pixel 7's width, the one `playwright.m3.config.ts`'s `mobile` project already declares. */
const VIEWPORTS = [
    { width: 1440, height: 900, label: '1440x900' },
    { width: 412, height: 839, label: '412x839' }
] as const;

interface RingGeometry {
    /** `outline-width + outline-offset`: what the ring paints outside the border box. */
    ring: number;
    ringLeft: number;
    ringRight: number;
    viewport: number;
    scrollerLeft: number;
    scrollerRight: number;
    /** No horizontal page scroll may be introduced by the gutter. */
    documentScrollWidth: number;
    outline: string;
}

/** Tab until `which` card in the home shelf has keyboard focus, or throw naming the failure. */
async function focusCard(page: Page, which: 'first' | 'last'): Promise<void> {
    for (let press = 0; press < 120; press += 1) {
        const onTarget = await page.evaluate(
            ([scrollerSelector, side]: readonly string[]) => {
                const scroller =
                    document.querySelector<HTMLElement>(scrollerSelector);
                if (!scroller) return false;
                const cards = [...scroller.querySelectorAll('.rf-media-card')];
                const target =
                    side === 'first' ? cards[0] : cards[cards.length - 1];
                return !!target && document.activeElement === target;
            },
            [SCROLLER, which] as const
        );
        if (onTarget) return;
        await page.keyboard.press('Tab');
    }
    throw new Error(
        `the ${which} home card was not reached by keyboard within 120 tab presses`
    );
}

function measure(page: Page): Promise<RingGeometry> {
    return page.evaluate((scrollerSelector: string) => {
        const scroller = document.querySelector<HTMLElement>(scrollerSelector);
        if (!scroller) throw new Error('the home shelf is not on screen');

        const card = document.activeElement as HTMLElement | null;
        if (!card?.matches('.rf-media-card')) {
            throw new Error(
                `focus is on ${card?.tagName ?? 'nothing'}, not on a card`
            );
        }

        const style = getComputedStyle(card);
        const ring =
            style.outlineStyle === 'none'
                ? 0
                : (Number.parseFloat(style.outlineWidth) || 0) +
                  (Number.parseFloat(style.outlineOffset) || 0);

        const cardBox = card.getBoundingClientRect();
        const scrollerBox = scroller.getBoundingClientRect();

        return {
            ring,
            ringLeft: cardBox.left - ring,
            ringRight: cardBox.right + ring,
            viewport: window.innerWidth,
            scrollerLeft: scrollerBox.left,
            scrollerRight: scrollerBox.right,
            documentScrollWidth: document.documentElement.scrollWidth,
            outline: `${style.outlineStyle} ${style.outlineWidth} offset ${style.outlineOffset}`
        } satisfies RingGeometry;
    }, SCROLLER);
}

const report = (where: string, g: RingGeometry) =>
    `${where}: ring ${g.ring.toFixed(2)} (${g.outline}) at ` +
    `${g.ringLeft.toFixed(2)}..${g.ringRight.toFixed(2)}, ` +
    `scroller ${g.scrollerLeft.toFixed(2)}..${g.scrollerRight.toFixed(2)}, ` +
    `viewport ${g.viewport}, documentScrollWidth ${g.documentScrollWidth}`;

const measured: string[] = [];

test.afterAll(() => {
    console.log(`[m3 home gutter]\n  ${measured.join('\n  ')}`);
});

function assertContained(where: string, g: RingGeometry) {
    expect(g.ring, `${where}: the ring is not painted`).toBeGreaterThan(0);

    expect(
        g.ringLeft,
        `${where}: the ring starts left of the viewport — ${report(where, g)}`
    ).toBeGreaterThanOrEqual(0);

    expect(
        g.ringRight,
        `${where}: the ring ends right of the viewport — ${report(where, g)}`
    ).toBeLessThanOrEqual(g.viewport);

    /*
     * The scroller is the one ancestor that clips. Containment in the viewport is not enough on its
     * own: with a gutter and no inline padding on the scroller the ring sits at a positive x and is
     * still cut here.
     */
    expect(
        g.ringLeft,
        `${where}: the scroller clips the ring on the start edge — ${report(where, g)}`
    ).toBeGreaterThanOrEqual(g.scrollerLeft);

    expect(
        g.ringRight,
        `${where}: the scroller clips the ring on the end edge — ${report(where, g)}`
    ).toBeLessThanOrEqual(g.scrollerRight);

    /*
     * The gutter must not buy its room by making the page wider — that is the `-8..1448` shape this
     * slice rejected, and it reads as a horizontal scrollbar rather than as a clipped ring.
     */
    expect(
        g.documentScrollWidth,
        `${where}: the gutter widened the document — ${report(where, g)}`
    ).toBeLessThanOrEqual(g.viewport);
}

for (const theme of REQUESTED_THEMES) {
    test(`the home shelf keeps the first and last card's focus ring on screen, in ${theme}`, async ({
        page,
        baseURL
    }) => {
        await installFixtureApi(page, baseURL!, DIST, {
            signedIn: true,
            wizardCompleted: true,
            users: [
                administrator({
                    configuration: { PlayDefaultAudioTrack: true }
                })
            ],
            currentUserId: USER_A,
            packs: [],
            theme,
            layout: 'desktop'
        });

        for (const viewport of VIEWPORTS) {
            await page.setViewportSize({
                width: viewport.width,
                height: viewport.height
            });
            await page.goto('about:blank');
            await page.goto('/#/home');
            await page.waitForSelector(CARD, { timeout: 45_000 });
            await waitForResolvedTheme(page, theme);

            // Start edge: the first card, with the shelf at rest.
            await focusCard(page, 'first');
            const first = await measure(page);
            const firstWhere = `${theme} ${viewport.label} first card`;
            measured.push(report(firstWhere, first));
            assertContained(firstWhere, first);

            /*
             * End edge: the last card, and then the shelf driven to its scroll end. Focusing the
             * card only scrolls it far enough to be visible, and `scroll-snap-align: start` lands
             * it at the START of the scrollport — which never exercises the end edge at all. The
             * explicit scroll is what puts the last card against it.
             */
            await focusCard(page, 'last');
            await page.evaluate((scrollerSelector: string) => {
                const scroller =
                    document.querySelector<HTMLElement>(scrollerSelector);
                if (scroller) scroller.scrollLeft = scroller.scrollWidth;
            }, SCROLLER);
            await page.waitForTimeout(300);

            const last = await measure(page);
            const lastWhere = `${theme} ${viewport.label} last card at the scroll end`;
            measured.push(report(lastWhere, last));
            assertContained(lastWhere, last);
        }
    });
}

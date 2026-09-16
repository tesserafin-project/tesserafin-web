/**
 * The home shelf must not clip what its cards paint outside their own box (#177).
 *
 * `MediaShelf`'s scroller is `overflow-x: auto`, which forces the cross axis to be a clipping axis
 * — `overflow-y: visible` is coerced to `auto`, and `overflow-y: clip` is coerced to `hidden`, so
 * `overflow-clip-margin` cannot reach it either. Measured on `e7b2d80509` at 1440x900 the scroller's
 * box was EXACTLY the card's box, top 120.797 / bottom 300.609 on both, i.e. zero vertical slack.
 * Everything a card paints outside its border box was cut: the `surface.elevation` shadow #176 bound,
 * and `MediaCard`'s 2px `:focus-visible` ring at `outline-offset: 2px`.
 *
 * WHY THIS IS A GEOMETRY SPEC AND NOT A MATERIAL ONE. Computed style reports the full `box-shadow`
 * and the full `outline` whether or not the pixels survive, so every existing assertion on this
 * screen — `m3.captures`' material records included — passed while the ring was invisible. The only
 * thing that can fail when the clip comes back is a comparison of BOXES: the scroller's box against
 * the card's, against what the card's own shadow and ring actually need.
 *
 * WHY IT ALSO ASSERTS THE RESTING LAYOUT. The repair is vertical padding on the scroller cancelled
 * by an equal negative margin. That is only correct if the cards do not move, so the spec pins the
 * distance from the shelf header to the first card against the shelf's own `row-gap`: a padding
 * that was not cancelled shows up here as a card pushed down, not as a screenshot somebody has to
 * squint at.
 */
import { REQUESTED_THEMES, waitForResolvedTheme } from './support/captureBody';
import { administrator, installFixtureApi, USER_A } from './support/fixtureApi';
import { DIST, expect, test } from './support/harness';

const HOME = '[data-rf-slot="home-composition"]';
const SCROLLER = `${HOME} .rf-media-shelf__scroller`;
const CARD = `${SCROLLER} .rf-media-card`;

interface ShelfGeometry {
    /** `card.top - scroller.top` and `scroller.bottom - card.bottom`: the room outside the card. */
    slackTop: number;
    slackBottom: number;
    /** What the card's own `box-shadow` paints above and below its border box. */
    shadowAbove: number;
    shadowBelow: number;
    /** What the `:focus-visible` ring paints outside it: `outline-width + outline-offset`. */
    ring: number;
    /** Resting layout: the gap the shelf declares, and the gap the card actually sits at. */
    declaredGap: number;
    headerToCard: number;
    boxShadow: string;
    outline: string;
}

/**
 * Reads the geometry with the first card in the shelf KEYBOARD-focused.
 *
 * Tab rather than `element.focus()`: `:focus-visible` is the browser's own "this user is navigating
 * by keyboard" heuristic, and a programmatic focus does not reliably satisfy it. A ring measured
 * while the selector does not match is a ring of width 0, which would make this spec pass for the
 * wrong reason.
 */
async function focusFirstCard(
    page: Parameters<typeof waitForResolvedTheme>[0]
) {
    for (let press = 0; press < 80; press += 1) {
        const onCard = await page.evaluate(
            (selector: string) =>
                document.activeElement?.matches(selector) ?? false,
            CARD
        );
        if (onCard) return press;
        await page.keyboard.press('Tab');
    }
    throw new Error(`no ${CARD} reached by keyboard within 80 tab presses`);
}

function measure(page: Parameters<typeof waitForResolvedTheme>[0]) {
    return page.evaluate(
        ([scrollerSelector, cardSelector]: readonly string[]) => {
            const scroller =
                document.querySelector<HTMLElement>(scrollerSelector);
            const card = document.querySelector<HTMLElement>(cardSelector);
            if (!scroller || !card) throw new Error('shelf not on screen');
            const shelf = scroller.closest('.rf-media-shelf') as HTMLElement;
            const header = shelf.querySelector(
                '.rf-media-shelf__header'
            ) as HTMLElement;

            const scrollerBox = scroller.getBoundingClientRect();
            const cardBox = card.getBoundingClientRect();
            const style = getComputedStyle(card);

            /*
             * A CSS shadow's blur radius spreads the edge over `blur`, half of it OUTSIDE the
             * shadow rectangle, so the paint reaches `blur / 2 + spread` beyond the box, shifted by
             * the offset. Parsed from the computed value rather than from the token, because the
             * token that is live here is whatever the resolved recipe chose.
             */
            const lengths = [...style.boxShadow.matchAll(/(-?[\d.]+)px/g)].map(
                (match) => Number(match[1])
            );
            const [, offsetY = 0, blur = 0, spread = 0] = lengths;
            const reach = blur / 2 + spread;
            const hasShadow = style.boxShadow !== 'none' && lengths.length >= 3;

            const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
            const outlineOffset = Number.parseFloat(style.outlineOffset) || 0;

            return {
                slackTop: cardBox.top - scrollerBox.top,
                slackBottom: scrollerBox.bottom - cardBox.bottom,
                shadowAbove: hasShadow ? Math.max(0, reach - offsetY) : 0,
                shadowBelow: hasShadow ? Math.max(0, reach + offsetY) : 0,
                ring:
                    style.outlineStyle === 'none'
                        ? 0
                        : outlineWidth + outlineOffset,
                declaredGap:
                    Number.parseFloat(getComputedStyle(shelf).rowGap) || 0,
                headerToCard:
                    cardBox.top - header.getBoundingClientRect().bottom,
                boxShadow: style.boxShadow,
                outline: `${style.outlineStyle} ${style.outlineWidth} offset ${style.outlineOffset}`
            } satisfies ShelfGeometry;
        },
        [SCROLLER, CARD] as const
    );
}

const report = (theme: string, g: ShelfGeometry) =>
    `${theme}: slack ${g.slackTop.toFixed(2)}/${g.slackBottom.toFixed(2)}, ` +
    `shadow needs ${g.shadowAbove.toFixed(2)}/${g.shadowBelow.toFixed(2)} (${g.boxShadow}), ` +
    `ring needs ${g.ring.toFixed(2)} (${g.outline}), ` +
    `header-to-card ${g.headerToCard.toFixed(2)} vs gap ${g.declaredGap.toFixed(2)}`;

const measured: string[] = [];

test.afterAll(() => {
    console.log(`[m3 shelf geometry]\n  ${measured.join('\n  ')}`);
});

for (const theme of REQUESTED_THEMES) {
    test(`the home shelf clips neither the card shadow nor the focus ring, in ${theme}`, async ({
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

        await page.goto('about:blank');
        await page.goto('/#/home');
        await page.waitForSelector(CARD, { timeout: 45_000 });
        await waitForResolvedTheme(page, theme);

        await focusFirstCard(page);
        const geometry = await measure(page);
        measured.push(report(theme, geometry));

        expect(
            geometry.ring,
            `${theme}: the ring is not painted`
        ).toBeGreaterThan(0);

        expect(
            geometry.slackTop,
            `${theme}: clipped above — ${report(theme, geometry)}`
        ).toBeGreaterThanOrEqual(Math.max(geometry.ring, geometry.shadowAbove));

        expect(
            geometry.slackBottom,
            `${theme}: clipped below — ${report(theme, geometry)}`
        ).toBeGreaterThanOrEqual(Math.max(geometry.ring, geometry.shadowBelow));

        /*
         * The repair must be invisible at rest. The scroller may grow; the card may not move.
         */
        expect(
            geometry.headerToCard,
            `${theme}: the first card moved — ${report(theme, geometry)}`
        ).toBeCloseTo(geometry.declaredGap, 1);
    });
}

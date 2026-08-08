/**
 * The body every capture spec shares: run each scenario in Classic and in Frosted, refuse a
 * screenshot whose theme did not actually load, and then assert the PAIR differs.
 *
 * The pair assertion is the one that catches the "half a theme" defect. A single capture can look
 * plausible while the harness quietly fell back; two captures that agree on every token AND on
 * every resolved presentation value did not come from two themes.
 */
import { capture, writeIndex } from './captures';
import { expect, test } from './harness';
import { CLASSIC, FROSTED, recipeDifferences, tokenDifferences } from './theme';
import type { Scenario } from './captureScenarios';

export function captureMatrix(
    viewport: string,
    scenarios: Scenario[],
    options: { layout?: 'tv' } = {}
): void {
    for (const scenario of scenarios) {
        test(`${scenario.state} @ ${viewport}`, async ({ page, baseURL }) => {
            const readings: Record<
                string,
                Awaited<ReturnType<typeof capture>>
            > = {};

            for (const theme of [CLASSIC, FROSTED]) {
                /*
                 * A full document teardown between themes, and not merely another `goto`.
                 * Everything in this suite is hash-routed, so navigating from `#/contentpacks` to
                 * `#/contentpacks` does not reload the document — the init script that writes the
                 * theme never runs again and the second capture comes back wearing the first
                 * theme. The harness caught exactly that and refused the screenshot; this is the
                 * fix rather than a relaxed assertion.
                 */
                await page.goto('about:blank');
                await scenario.run({
                    page,
                    baseURL: baseURL as string,
                    theme,
                    layout: options.layout
                });
                readings[theme] = await capture(page, {
                    state: scenario.state,
                    viewport,
                    theme,
                    inspect: scenario.inspect,
                    waitFor: scenario.waitFor
                });
            }

            const tokens = tokenDifferences(
                readings[CLASSIC],
                readings[FROSTED]
            );
            const recipe = recipeDifferences(
                readings[CLASSIC],
                readings[FROSTED]
            );

            expect(
                tokens.length,
                `${scenario.state}: Classic and Frosted resolved identical tokens — the token stylesheet did not switch`
            ).toBeGreaterThan(0);

            /*
             * The recipe half is only observable where a presentation-reading primitive is on
             * screen. `Surface` and `MediaCard` publish their resolved values as data attributes;
             * the Item Details route and its assignment dialog contain neither, so both readings
             * are all-null there and "they are equal" says nothing about the theme.
             *
             * That is stated, not skipped: the state is required to be observable UNLESS it has no
             * primitive at all, and which case applied is recorded in the capture index so the
             * report cannot claim a proof it did not make.
             */
            const observable = Object.values(readings[CLASSIC].recipe).some(
                (value) => value !== null
            );
            if (observable) {
                expect(
                    recipe.length,
                    `${scenario.state}: Classic and Frosted resolved an identical presentation recipe — the recipe did not switch`
                ).toBeGreaterThan(0);
            } else {
                expect(
                    Object.values(readings[FROSTED].recipe).every(
                        (value) => value === null
                    ),
                    `${scenario.state}: the recipe was unobservable in Classic but not in Frosted, which cannot be right`
                ).toBe(true);
            }
        });
    }

    test.afterAll(() => writeIndex(viewport));
}

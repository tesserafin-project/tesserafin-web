import { expect, test, type Page } from '@playwright/test';

import {
    buildFixtureHtml,
    PROBE_SELECTOR,
    PROJECTOR_GLOBAL,
    SIDEBAR_ITEM_SELECTOR,
    SIDEBAR_SELECTOR
} from './support/glassProfileFixture';

/**
 * Reefin Glass light frosted mode and the floating sidebar — **computed-style** proof
 * (RFC-0005 §8.2, issue #18 / W13.8b).
 *
 * Same discipline as `./glass-interaction-profiles.spec.ts`, and for the same reason: a light
 * palette and a sidebar are both trivially "true in TypeScript", and the only question worth
 * asking is what Chromium actually resolved. So every assertion here reads `getComputedStyle`.
 *
 * Two claims are specific to this tranche and could not be checked before it:
 *
 *   - **Glass Light is still Glass.** `blur.md` is not per-mode in
 *     `tesserafin-design/themes/glass/tokens.json`, so light mode must paint the same `blur(16px)` the
 *     dark mode does, over a *translucent* light surface. A light mode that resolved to `none` or
 *     to an opaque surface would be a flat theme wearing Glass's name.
 *   - **The reduced-transparency profile works in light mode.** Before W13.8b the override carried
 *     only `color.dark`, and `toCustomProperties` projects only the active mode — so light mode
 *     would have zeroed the blur and kept a translucent surface, which is worse than the blur. That
 *     regression is pinned below by reading the resolved background color, not the token object.
 *
 * These specs need no Reefin server — they run against `page.setContent`.
 */

interface SurfaceMeasurement {
    backdropFilter: string;
    backgroundColor: string;
    color: string;
    blurMd: string;
}

const measureSurface = (page: Page): Promise<SurfaceMeasurement> =>
    page.evaluate((selector) => {
        const probe = document.querySelector(selector);
        if (!probe) throw new Error(`probe ${selector} not found`);
        const style = getComputedStyle(probe);
        return {
            backdropFilter: style.backdropFilter,
            backgroundColor: style.backgroundColor,
            color: style.color,
            blurMd: getComputedStyle(document.documentElement)
                .getPropertyValue('--rf-blur-md')
                .trim()
        };
    }, PROBE_SELECTOR);

const activate = (page: Page, active: Record<string, boolean>, mode: string) =>
    page.evaluate(
        ([globalName, state, paletteMode]) => {
            const projector = (window as never as Record<string, never>)[
                globalName as string
            ] as unknown as {
                applyProfilesToRoot: (
                    root: HTMLElement,
                    active: unknown,
                    mode: string
                ) => () => void;
            };
            (window as unknown as Record<string, unknown>).__rfRestore =
                projector.applyProfilesToRoot(
                    document.documentElement,
                    state,
                    paletteMode as string
                );
        },
        [PROJECTOR_GLOBAL, active, mode] as const
    );

const deactivate = (page: Page): Promise<void> =>
    page.evaluate(() => {
        const restore = (window as unknown as Record<string, unknown>)
            .__rfRestore as (() => void) | undefined;
        restore?.();
    });

test.describe('Glass light frosted mode: computed styles', () => {
    test.beforeEach(async ({ page }) => {
        await page.setContent(
            await buildFixtureHtml('official.glass', 'light')
        );
    });

    test('is frosted, not merely light: same blur over a translucent light surface', async ({
        page
    }) => {
        const baseline = await measureSurface(page);

        // The identity claim. Blur is shared across modes, so it must be the dark mode's 16px.
        expect(baseline.blurMd).toBe('16px');
        expect(baseline.backdropFilter).toBe('blur(16px)');
        // Translucent — an `rgb(...)` here (no alpha) would mean the frost had been flattened away.
        expect(baseline.backgroundColor).toBe('rgba(255, 255, 255, 0.55)');
    });

    test('resolves the light color tier, not the dark one', async ({
        page
    }) => {
        const custom = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            const read = (name: string) => style.getPropertyValue(name).trim();
            return {
                background: read('--rf-color-background'),
                text: read('--rf-color-text'),
                primary: read('--rf-color-primary'),
                textMuted: read('--rf-color-text-muted')
            };
        });

        expect(custom.background).toBe('#eef2f8');
        expect(custom.text).toBe('#0b1220');
        expect(custom.primary).toBe('#0a6689');
        expect(custom.textMuted).toBe('rgba(11, 18, 32, 0.68)');
    });

    test('reducedTransparency makes the light surface genuinely opaque', async ({
        page
    }) => {
        const before = await measureSurface(page);
        expect(before.backgroundColor).toBe('rgba(255, 255, 255, 0.55)');

        await activate(page, { reducedTransparency: true }, 'light');
        const during = await measureSurface(page);

        // `none`, not `blur(0px)`: zero blur would keep the compositing layer this profile exists
        // to remove.
        expect(during.backdropFilter).toBe('none');
        // `rgb(...)` with no alpha channel — opacity verifiable from the computed value itself.
        expect(during.backgroundColor).toBe('rgb(247, 249, 252)');

        await deactivate(page);
        const after = await measureSurface(page);
        expect(after).toEqual(before);
    });

    test('lowPower and remote reach the light mode too', async ({ page }) => {
        await activate(page, { lowPower: true }, 'light');
        expect((await measureSurface(page)).backdropFilter).toBe('blur(4px)');
        await deactivate(page);

        await activate(page, { remote: true }, 'light');
        expect((await measureSurface(page)).backdropFilter).toBe('blur(10px)');
        await deactivate(page);

        expect((await measureSurface(page)).backdropFilter).toBe('blur(16px)');
    });
});

test.describe('Classic is unaffected by the light Glass tokens', () => {
    test('Classic light renders flat, with no blur and an opaque surface', async ({
        page
    }) => {
        await page.setContent(
            await buildFixtureHtml('official.classic', 'light')
        );

        const baseline = await measureSurface(page);
        // The human-stop this guards: adding Glass's light tier must not give Classic a blur, and
        // must not move it from `none` to `blur(0px)` either.
        expect(baseline.backdropFilter).toBe('none');
        expect(baseline.backgroundColor).toBe('rgb(232, 232, 232)');
    });

    test('every profile is inert against Classic light', async ({ page }) => {
        await page.setContent(
            await buildFixtureHtml('official.classic', 'light')
        );
        const before = await measureSurface(page);

        // The projector is theme-agnostic by design — `useInteractionProfiles` is what refuses to
        // call it for a non-Glass theme. Driving it directly here is therefore the *harsher* test:
        // even a projection that should never happen leaves Classic's blur at `none`.
        await activate(
            page,
            {
                remote: true,
                lowPower: true,
                reducedTransparency: true,
                reducedMotion: true
            },
            'light'
        );

        const during = await measureSurface(page);
        expect(during.backdropFilter).toBe('none');

        await deactivate(page);
        expect(await measureSurface(page)).toEqual(before);
    });
});

test.describe('Floating sidebar: computed styles', () => {
    test('takes the frosted treatment from the shared mixin under Glass', async ({
        page
    }) => {
        await page.setContent(await buildFixtureHtml('official.glass'));

        const sidebar = await page.evaluate((selector) => {
            const style = getComputedStyle(
                document.querySelector(selector) as Element
            );
            return {
                position: style.position,
                backdropFilter: style.backdropFilter,
                backgroundColor: style.backgroundColor
            };
        }, SIDEBAR_SELECTOR);

        // "Floating" is geometry, and the frost is the shared mixin's — the same
        // `--rf-backdrop-filter-md` the Surface probe reads.
        expect(sidebar.position).toBe('fixed');
        expect(sidebar.backdropFilter).toBe('blur(16px)');
        expect(sidebar.backgroundColor).toBe('rgba(22, 27, 38, 0.55)');
    });

    test('renders flat under Classic, with no blur — the same stylesheet', async ({
        page
    }) => {
        await page.setContent(await buildFixtureHtml('official.classic'));

        const sidebar = await page.evaluate((selector) => {
            const style = getComputedStyle(
                document.querySelector(selector) as Element
            );
            return {
                backdropFilter: style.backdropFilter,
                backgroundColor: style.backgroundColor
            };
        }, SIDEBAR_SELECTOR);

        expect(sidebar.backdropFilter).toBe('none');
        expect(sidebar.backgroundColor).toBe('rgb(32, 32, 32)');
    });

    test('shows a visible focus ring on the focused entry, in both modes', async ({
        page
    }) => {
        for (const mode of ['dark', 'light'] as const) {
            await page.setContent(
                await buildFixtureHtml('official.glass', mode)
            );

            // Keyboard focus specifically: `:focus-visible` must match, which is what a D-pad or a
            // Tab press produces and what a mouse click deliberately does not.
            await page.keyboard.press('Tab');

            const focus = await page.evaluate((selector) => {
                const item = document.querySelector(selector) as HTMLElement;
                const style = getComputedStyle(item);
                return {
                    isFocused: document.activeElement === item,
                    outlineStyle: style.outlineStyle,
                    outlineWidth: style.outlineWidth,
                    outlineColor: style.outlineColor
                };
            }, SIDEBAR_ITEM_SELECTOR);

            expect(focus.isFocused, `focused in ${mode}`).toBe(true);
            expect(focus.outlineStyle, `outline style in ${mode}`).toBe(
                'solid'
            );
            expect(focus.outlineWidth, `outline width in ${mode}`).toBe('2px');
            // The ring is the theme's own focus token, resolved per mode — not a hardcoded color.
            expect(focus.outlineColor, `outline color in ${mode}`).toBe(
                mode === 'dark'
                    ? 'rgba(79, 209, 255, 0.45)'
                    : 'rgba(10, 102, 137, 0.45)'
            );
        }
    });

    test('collapses its transitions to zero under reducedMotion', async ({
        page
    }) => {
        await page.setContent(await buildFixtureHtml('official.glass'));

        const durationOf = () =>
            page.evaluate(
                (selector) =>
                    getComputedStyle(
                        document.querySelector(selector) as Element
                    ).transitionDuration,
                SIDEBAR_ITEM_SELECTOR
            );

        expect(await durationOf()).toBe('0.15s, 0.15s');

        await activate(page, { reducedMotion: true }, 'dark');
        // Zero *duration*, reached through the token the stylesheet already names — the component
        // contains no reduced-motion branch of its own.
        expect(await durationOf()).toBe('0s, 0s');

        await deactivate(page);
        expect(await durationOf()).toBe('0.15s, 0.15s');
    });

    test('grows its targets and type under the remote profile', async ({
        page
    }) => {
        await page.setContent(await buildFixtureHtml('official.glass'));

        const metrics = () =>
            page.evaluate((selector) => {
                const style = getComputedStyle(
                    document.querySelector(selector) as Element
                );
                return {
                    fontSize: style.fontSize,
                    paddingInlineStart: style.paddingInlineStart
                };
            }, SIDEBAR_ITEM_SELECTOR);

        const before = await metrics();
        expect(before.fontSize).toBe('16px');
        expect(before.paddingInlineStart).toBe('16px');

        await activate(page, { remote: true }, 'dark');
        const during = await metrics();

        // 3-metre sizing arrives entirely as tokens: `typography.fontSize.md` 1rem -> 1.125rem and
        // `spacing.md` 16px -> 20px. The stylesheet never learns what a TV is.
        expect(during.fontSize).toBe('18px');
        expect(during.paddingInlineStart).toBe('20px');

        await deactivate(page);
        expect(await metrics()).toEqual(before);
    });
});

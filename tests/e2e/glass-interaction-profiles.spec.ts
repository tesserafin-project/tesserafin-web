import { expect, test, type Page } from '@playwright/test';

import {
    buildFixtureHtml,
    PROBE_SELECTOR,
    PROJECTOR_GLOBAL
} from './support/glassProfileFixture';

/**
 * Reefin Glass interaction profiles — **computed-style** proof (RFC-0005 §7.2, issue #18).
 *
 * The defect this suite exists to pin down: a profile used to change `blur.*` in the resolved
 * `TesserafinTokens` object while the page kept painting the build-time blur, because
 * `_glass-surface.scss` reads the *derived* `--rf-backdrop-filter-md` and nothing re-derived it at
 * run time. An override was true in TypeScript and false in the browser.
 *
 * So every assertion below reads Chromium's own `getComputedStyle` — the resolved
 * `backdrop-filter`, the resolved background color, the resolved custom properties. Asserting on
 * the token object instead would re-certify exactly the half of the chain that was never broken.
 * Nothing about the CSSOM is stubbed; see `./support/glassProfileFixture.ts` for what the page is
 * made of (short version: the committed generated token CSS, the real `Surface.scss` compiled by
 * the project's sass, and the real `applyProfilesToRoot` bundled by esbuild).
 *
 * These specs need no Reefin server — unlike the rest of `tests/e2e/`, they run against
 * `page.setContent`.
 */

/** Everything the browser actually resolved, read in one round trip. */
interface Measurement {
    backdropFilter: string;
    backgroundColor: string;
    blurMd: string;
    backdropFilterMd: string;
    surface: string;
    density: string;
    fontSizeMd: string;
    spacingLg: string;
    elevationLevel2: string;
    motionDurationNormal: string;
    profileAttribute: string | null;
    reducedMotionAttribute: string | null;
}

const measure = (page: Page): Promise<Measurement> =>
    page.evaluate((selector) => {
        const root = document.documentElement;
        const probe = document.querySelector(selector);
        if (!probe) throw new Error(`probe ${selector} not found`);

        const rootStyle = getComputedStyle(root);
        const probeStyle = getComputedStyle(probe);
        const custom = (name: string) =>
            rootStyle.getPropertyValue(name).trim();

        return {
            // The two the defect was about: what the surface is actually painting.
            backdropFilter: probeStyle.backdropFilter,
            backgroundColor: probeStyle.backgroundColor,
            // The primitive and its derived companion, as the browser resolved them.
            blurMd: custom('--rf-blur-md'),
            backdropFilterMd: custom('--rf-backdrop-filter-md'),
            surface: custom('--rf-color-surface'),
            density: custom('--rf-density'),
            fontSizeMd: custom('--rf-typography-font-size-md'),
            spacingLg: custom('--rf-spacing-lg'),
            elevationLevel2: custom('--rf-elevation-level2'),
            motionDurationNormal: custom('--rf-motion-duration-normal'),
            profileAttribute: root.getAttribute('data-rf-profile'),
            reducedMotionAttribute: root.getAttribute('data-rf-reduced-motion')
        };
    }, PROBE_SELECTOR);

/** Activates a profile state through the production projector, keeping its restore function. */
const activate = (page: Page, active: Record<string, boolean>): Promise<void> =>
    page.evaluate(
        ([globalName, state]) => {
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
                    'dark'
                );
        },
        [PROJECTOR_GLOBAL, active] as const
    );

/** Runs the restore function the projector returned — the reversibility path. */
const deactivate = (page: Page): Promise<void> =>
    page.evaluate(() => {
        const restore = (window as unknown as Record<string, unknown>)
            .__rfRestore as (() => void) | undefined;
        restore?.();
    });

test.describe('Glass interaction profiles: computed styles', () => {
    test.beforeEach(async ({ page }) => {
        await page.setContent(await buildFixtureHtml('official.glass'));
    });

    test('baseline Glass paints the blur its generated tokens declare', async ({
        page
    }) => {
        const baseline = await measure(page);

        // Establishes that the fixture really is Glass, and that the chain
        // tokens.json → generated CSS → mixin → computed style is intact before any profile runs.
        expect(baseline.blurMd).toBe('16px');
        expect(baseline.backdropFilterMd).toBe('blur(16px)');
        expect(baseline.backdropFilter).toBe('blur(16px)');
        expect(baseline.backgroundColor).toBe('rgba(22, 27, 38, 0.55)');
        expect(baseline.profileAttribute).toBeNull();
    });

    test('lowPower really reduces the painted blur, and restores it exactly', async ({
        page
    }) => {
        const before = await measure(page);
        expect(before.backdropFilter).toBe('blur(16px)');

        await activate(page, { lowPower: true });
        const during = await measure(page);

        // The object-level override (`blur.md: "4px"`) reached the paint. This is the assertion
        // that used to be impossible to make true.
        expect(during.blurMd).toBe('4px');
        expect(during.backdropFilterMd).toBe('blur(4px)');
        expect(during.backdropFilter).toBe('blur(4px)');
        // Flattened elevation is the profile's other GPU-cost lever.
        expect(during.elevationLevel2).toBe('0 1px 3px rgba(0, 0, 0, 0.28)');
        expect(during.profileAttribute).toBe('low-power');
        // lowPower is not a typography or motion profile; those axes must not move.
        expect(during.fontSizeMd).toBe(before.fontSizeMd);
        expect(during.motionDurationNormal).toBe(before.motionDurationNormal);

        await deactivate(page);
        expect(await measure(page)).toEqual(before);
    });

    test('reducedTransparency gives blur none — not blur(0px) — and an opaque surface', async ({
        page
    }) => {
        const before = await measure(page);

        await activate(page, { reducedTransparency: true });
        const during = await measure(page);

        // `none`, not `blur(0px)`: a zero-radius blur still allocates a compositing layer, so
        // "reduce transparency" would otherwise keep costing what it asked to stop costing.
        expect(during.backdropFilterMd).toBe('none');
        expect(during.backdropFilter).toBe('none');

        // Opaque, and provably so: the computed background is `rgb(...)` with no alpha channel.
        // Zero blur over a translucent surface is worse than the blur — the content underneath
        // shows through sharply — so both halves are required for this profile to mean anything.
        expect(during.backgroundColor).toBe('rgb(20, 26, 34)');
        expect(during.backgroundColor).not.toContain('rgba');
        expect(during.surface).toBe('#141a22');
        expect(during.profileAttribute).toBe('reduced-transparency');

        await deactivate(page);
        expect(await measure(page)).toEqual(before);
    });

    test('remote keeps the density and typography it promises', async ({
        page
    }) => {
        const before = await measure(page);

        await activate(page, { remote: true });
        const during = await measure(page);

        expect(during.density).toBe('spacious');
        expect(during.fontSizeMd).toBe('1.125rem');
        expect(during.spacingLg).toBe('32px');
        // Cheaper blur for TV SoCs, but still glass.
        expect(during.backdropFilter).toBe('blur(10px)');
        expect(during.profileAttribute).toBe('remote');

        await deactivate(page);
        expect(await measure(page)).toEqual(before);
    });

    test('the cascade is cumulative, and reducedTransparency wins the blur', async ({
        page
    }) => {
        const before = await measure(page);

        await activate(page, {
            remote: true,
            lowPower: true,
            reducedTransparency: true
        });
        const during = await measure(page);

        // Highest priority takes the contested key…
        expect(during.backdropFilter).toBe('none');
        expect(during.backgroundColor).toBe('rgb(20, 26, 34)');
        // …while the keys only the weaker profiles set survive untouched. A winning profile
        // overrides key by key; it does not cancel the others.
        expect(during.density).toBe('spacious');
        expect(during.fontSizeMd).toBe('1.125rem');
        expect(during.elevationLevel2).toBe('0 1px 3px rgba(0, 0, 0, 0.28)');
        // One name only — the attribute cannot arbitrate a priority, so it publishes the winner.
        expect(during.profileAttribute).toBe('reduced-transparency');

        await deactivate(page);
        expect(await measure(page)).toEqual(before);
    });

    test('reducedMotion is an orthogonal axis, on its own attribute', async ({
        page
    }) => {
        await activate(page, { remote: true, reducedMotion: true });
        const during = await measure(page);

        // Both apply in full: they describe different things (how the surface is composed vs. how
        // it changes over time) and cannot collide.
        expect(during.motionDurationNormal).toBe('0ms');
        expect(during.density).toBe('spacious');
        expect(during.backdropFilter).toBe('blur(10px)');

        // Two axes, two attributes. reducedMotion never appears in `data-rf-profile`.
        expect(during.profileAttribute).toBe('remote');
        expect(during.reducedMotionAttribute).toBe('true');
    });

    test('repeated activate/deactivate cycles leave no residue', async ({
        page
    }) => {
        const before = await measure(page);

        // Guards the accumulation failure mode: a projection that forgot to revert the previous
        // state would strand the stronger profile's properties after stepping back down.
        for (const active of [
            { remote: true },
            { remote: true, lowPower: true },
            { reducedTransparency: true, reducedMotion: true }
        ]) {
            await activate(page, active);
            await deactivate(page);
            expect(await measure(page)).toEqual(before);
        }
    });
});

test.describe('Reefin Classic is untouched by Glass profiles', () => {
    test.beforeEach(async ({ page }) => {
        await page.setContent(await buildFixtureHtml('official.classic'));
    });

    test('Classic paints flat — the baseline any profile regression would move', async ({
        page
    }) => {
        const baseline = await measure(page);

        // Classic's own identity: no blur at all, and `none` rather than `blur(0px)`.
        expect(baseline.backdropFilterMd).toBe('none');
        expect(baseline.backdropFilter).toBe('none');
        expect(baseline.backgroundColor).toBe('rgb(32, 32, 32)');
        expect(baseline.profileAttribute).toBeNull();

        // Scope note, so this is not read as more than it is: this page does not run
        // `useInteractionProfiles`, so it does not exercise the theme guard. What it pins is that
        // Classic's *own* rendering — the flat, opaque baseline above — is stable, i.e. the values
        // any regression would have to move away from. The guard itself (Classic + an active
        // signal ⇒ nothing projected, Glass + the same signal ⇒ projected) is asserted in
        // `src/themes/useInteractionProfiles.test.tsx`, which renders the real hook.
        expect(await measure(page)).toEqual(baseline);
    });

    test('the guard is what protects Classic — bypassing it demonstrably would not', async ({
        page
    }) => {
        const baseline = await measure(page);

        // Deliberately calls the projector against Classic, which production code never does.
        // If this changed nothing, the "Classic is unaffected" guarantee above would be vacuous —
        // proving instead that it is the theme guard doing the work.
        await activate(page, { reducedTransparency: true });
        const bypassed = await measure(page);

        expect(bypassed.backgroundColor).not.toBe(baseline.backgroundColor);
        expect(bypassed.backgroundColor).toBe('rgb(20, 26, 34)');

        await deactivate(page);
        expect(await measure(page)).toEqual(baseline);
    });
});

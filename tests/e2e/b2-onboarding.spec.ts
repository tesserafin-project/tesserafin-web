import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { request } from '@playwright/test';
import { expect, test } from './support/origin-inventory';
import { AXE_VERSION, scanPage } from './support/axe';
import {
    BASE_URL,
    type FormFactor,
    VIEWPORTS,
    applyFormFactor,
    measureLayoutStable
} from './support/b2';

/**
 * B2 (#55) — the ONBOARDING form factor and accessibility target.
 *
 * WHY THIS FILE IS SEPARATE, and must not be added to the pair gate's spec list. Every other spec
 * in this directory runs against a rig whose startup wizard has already been completed and whose
 * fixtures are seeded — `ci/verify-release-pair.sh` does that before it starts Playwright. The
 * onboarding wizard only exists BEFORE that. So this file is run on its own, against a container
 * created from the same release image on pristine volumes and left at the wizard.
 *
 * FAIL-CLOSED ON THE PRECONDITION. If the target's `StartupWizardCompleted` is already true, the
 * wizard is not on screen and a scan of the login page would pass while proving nothing about
 * onboarding. That is a hard failure here, not a skip: a silently skipped clause is exactly the
 * kind of green #55 must not accept.
 */

const CAPTURE_DIR =
    process.env.TESSERAFIN_E2E_CAPTURE_DIR ??
    resolve(process.cwd(), 'test-results', 'b2-captures');

const capturePath = (name: string): string => {
    const path = resolve(CAPTURE_DIR, name);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return path;
};

async function wizardIsPending(): Promise<boolean> {
    const api = await request.newContext({ baseURL: BASE_URL });
    try {
        const res = await api.get('/System/Info/Public');
        expect(res.ok(), 'the candidate must answer /System/Info/Public').toBe(
            true
        );
        return (await res.json()).StartupWizardCompleted === false;
    } finally {
        await api.dispose();
    }
}

const FORM_FACTORS: FormFactor[] = ['desktop', 'mobile'];

test.describe('B2 onboarding: first-run wizard presentation and accessibility', () => {
    test.beforeAll(async () => {
        expect(
            await wizardIsPending(),
            'this file must be run against a container whose startup wizard has NOT been completed; ' +
                'against a seeded rig it would scan the login page and prove nothing about onboarding'
        ).toBe(true);
    });

    for (const factor of FORM_FACTORS) {
        test(`the first-run wizard is usable at ${factor} (${VIEWPORTS[factor].width}x${VIEWPORTS[factor].height}) and reports no critical accessibility violations`, async ({
            page
        }, testInfo) => {
            await applyFormFactor(page, factor);
            await page.goto('/', { waitUntil: 'domcontentloaded' });

            // The wizard's own first step is the settled state to wait on.
            const wizardControl = page
                .locator('#btnNext:visible, button[type="submit"]:visible')
                .first();
            await expect(
                wizardControl,
                'the first-run wizard must present a control to proceed with'
            ).toBeVisible({ timeout: 40_000 });

            // LAYOUT — the same three measurable failures as the authenticated flows.
            const report = await measureLayoutStable(page);
            testInfo.annotations.push({
                type: `layout:onboarding:${factor}`,
                description: JSON.stringify(report)
            });
            expect(
                report.horizontalOverflowPx,
                `the wizard at ${factor} must not scroll horizontally`
            ).toBeLessThanOrEqual(1);
            expect(
                report.offscreenControls,
                `the wizard at ${factor} must not leave a control outside the viewport`
            ).toEqual([]);
            expect(
                report.clippedDialogs,
                `the wizard at ${factor} must not clip a dialog`
            ).toEqual([]);

            await page.screenshot({
                path: capturePath(`onboarding-${factor}.png`),
                fullPage: false
            });

            // KEYBOARD — a first-run wizard has to be completable without a pointer, so the
            // control that proceeds must be focusable and must show its focus.
            await wizardControl.focus();
            const focusVisible = await wizardControl.evaluate((el) => {
                const style = window.getComputedStyle(el);
                const outline =
                    Number.parseFloat(style.outlineWidth || '0') > 0 &&
                    style.outlineStyle !== 'none';
                const shadow =
                    (style.boxShadow || 'none') !== 'none' &&
                    (style.boxShadow || '').trim() !== '';
                return {
                    outline,
                    shadow,
                    focused: el === document.activeElement
                };
            });
            expect(
                focusVisible.focused,
                'the wizard control must accept keyboard focus'
            ).toBe(true);

            // ACCESSIBILITY — the gate's first named target.
            const result = await scanPage(page);
            expect(result.engineVersion).toBe(AXE_VERSION);
            expect(
                result.passCount,
                'the onboarding scan must have actually evaluated rules'
            ).toBeGreaterThan(0);
            testInfo.annotations.push({
                type: `axe:onboarding:${factor}`,
                description: JSON.stringify({
                    engine: result.engineVersion,
                    bySeverity: result.bySeverity,
                    passes: result.passCount,
                    incomplete: result.incompleteCount,
                    violations: result.violations.map((v) => ({
                        id: v.id,
                        impact: v.impact,
                        nodes: v.nodes.length
                    }))
                })
            });
            console.log(
                `[b2-onboarding] ${factor}: critical=${result.bySeverity.critical} serious=${result.bySeverity.serious} moderate=${result.bySeverity.moderate} minor=${result.bySeverity.minor} passes=${result.passCount} incomplete=${result.incompleteCount}`
            );
            expect(
                result.violations
                    .filter((v) => v.impact === 'critical')
                    .map((v) => `${v.id}: ${v.help} (${v.nodes.join(', ')})`),
                `the first-run wizard at ${factor} must have no critical accessibility violations`
            ).toEqual([]);
        });
    }
});

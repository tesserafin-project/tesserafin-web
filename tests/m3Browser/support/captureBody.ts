/**
 * The capture body every M3 capture spec runs, once per theme.
 *
 * Split out of the specs so that desktop, mobile and TV capture the SAME states from the SAME code
 * — a capture set where the mobile run visited a different screen than the desktop run is not a
 * comparison, and that is the only thing a matched set is for.
 *
 * Each capture is recorded in an index alongside the theme that actually RESOLVED, which is not
 * always the theme that was requested. The index is written next to the images so a reviewer can
 * tell what they are looking at without reading this file.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { installFixtureApi, administrator, USER_A } from './fixtureApi';
import {
    addCustomPack,
    ARTIFACTS,
    DIST,
    openPacksStep,
    openUserStep,
    PACKS_PAGE,
    selectPack,
    USER_PAGE
} from './harness';

export const CLASSIC = 'official.classic';
export const FROSTED = 'official.glass';

export interface CaptureRecord {
    file: string;
    theme: string;
    /** What the application resolved to, read off the document. */
    resolvedTheme: string | null;
    mode: string | null;
    /** A couple of resolved token values, so two records can be told apart mechanically. */
    tokens: Record<string, string>;
    layout: string;
    viewport: string;
    state: string;
    /** Where a reviewer should look. */
    inspect: string;
}

const TOKEN_NAMES = ['--rf-color-surface', '--rf-color-background'];

async function evidence(page: Page) {
    return page.evaluate((names: string[]) => {
        const root = document.documentElement;
        const style = getComputedStyle(root);
        const tokens: Record<string, string> = {};
        for (const name of names)
            tokens[name] = style.getPropertyValue(name).trim();
        return {
            resolvedTheme: root.getAttribute('data-rf-theme'),
            mode: root.getAttribute('data-rf-mode'),
            tokens
        };
    }, TOKEN_NAMES);
}

/**
 * Freeze everything that moves before a shutter opens.
 *
 * Two captures of the same screen that differ because a transition was mid-flight are worthless as
 * evidence, and worse, they look like a real difference.
 */
async function freeze(page: Page) {
    await page.addStyleTag({
        content: `*, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
            caret-color: transparent !important;
        }`
    });
    await page.waitForTimeout(150);
}

/**
 * Captures the M3 states for ONE requested theme, naming each file by the theme that actually
 * RESOLVED rather than the one that was asked for.
 *
 * That distinction is the whole reason this function reads the resolved theme at all. A first run of
 * this suite produced ten files named `…-frosted-…` in which the application had resolved Classic,
 * and nothing in the artefacts said so. Naming by the resolved value makes that impossible: a
 * mislabelled capture cannot be produced, only a missing one.
 */
export async function captureTheme(
    page: Page,
    baseURL: string,
    label: string,
    layout: 'desktop' | 'mobile' | 'tv',
    theme: string
): Promise<CaptureRecord[]> {
    const records: CaptureRecord[] = [];

    {
        const shoot = async (state: string, inspect: string) => {
            await freeze(page);
            const resolved = (await evidence(page)).resolvedTheme ?? 'unknown';
            const themeName = resolved.split('.').pop() ?? resolved;
            const file = `${label}-${themeName}-${state}.png`;
            await page.screenshot({ path: join(ARTIFACTS, file) });
            const seen = await evidence(page);
            const viewport = page.viewportSize();
            records.push({
                file,
                theme,
                resolvedTheme: seen.resolvedTheme,
                mode: seen.mode,
                tokens: seen.tokens,
                layout,
                viewport: viewport
                    ? `${viewport.width}x${viewport.height}`
                    : 'unknown',
                state,
                inspect
            });
        };

        const fixture = await installFixtureApi(page, baseURL, DIST, {
            signedIn: false,
            wizardCompleted: false,
            users: [administrator()],
            currentUserId: USER_A,
            packs: [],
            theme,
            layout
        });

        await openUserStep(page);
        await shoot(
            'user-step',
            'the first-run account form before anything is submitted'
        );

        // The failure state, authored rather than provoked with real credentials, so no capture
        // anywhere in this set can contain a password.
        fixture.profile.faults = { authenticateStatus: 401 };
        await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
        await page.fill(
            `${USER_PAGE} #txtManualPassword`,
            'capture-placeholder'
        );
        await page.fill(
            `${USER_PAGE} #txtPasswordConfirm`,
            'capture-placeholder'
        );
        await page.click(`${USER_PAGE} button[type="submit"]`);
        await page.waitForSelector(`${USER_PAGE} .wizardUserError:not(.hide)`, {
            timeout: 30_000
        });
        await shoot(
            'user-step-error',
            'the account exists but sign-in failed: message, focus, username kept, passwords cleared'
        );

        fixture.profile.faults = {};
        await page.fill(
            `${USER_PAGE} #txtManualPassword`,
            'capture-placeholder'
        );
        await page.fill(
            `${USER_PAGE} #txtPasswordConfirm`,
            'capture-placeholder'
        );
        await page.click(`${USER_PAGE} button[type="submit"]`);
        await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });

        /*
         * Reload once the session exists.
         *
         * `userSettings.theme()` reads `appSettings.get('appTheme')`, whose key is namespaced by the
         * signed-in user id. Before authentication there is no user, so the theme written by the
         * fixture cannot be found and the app resolves to Classic no matter what was asked for —
         * which is exactly what the first capture run reported for every "frosted" image. After the
         * session is installed the key resolves, and a boot from that point picks the theme up.
         */
        await page.reload();
        await openPacksStep(page);
        await shoot(
            'packs-none',
            'the resting state: nothing selected, and the step says that is fine'
        );

        await selectPack(page, 'Movies and series');
        await selectPack(page, 'Music');
        await selectPack(page, 'Photos and home video');
        await addCustomPack(page, 'Grandad’s tapes');
        await page.check('#radioContentPackFirst', { force: true });
        await shoot(
            'packs-populated',
            'three suggestions and one pack of their own, with content-pack-first chosen'
        );

        await page
            .locator(`${PACKS_PAGE} .wizardPacksError`)
            .evaluate((node) => {
                node.textContent = 'Some content packs could not be created.';
                node.classList.remove('hide');
            });
        await shoot(
            'packs-error',
            'the partial-failure message, in place, without losing the selections behind it'
        );
    }

    return records;
}

/** Every theme this suite asks for, in order. */
export const REQUESTED_THEMES = [CLASSIC, FROSTED];

export function writeIndex(label: string, records: CaptureRecord[]) {
    writeFileSync(
        join(ARTIFACTS, `captures-${label}.json`),
        `${JSON.stringify(records, null, 2)}\n`,
        'utf8'
    );
}

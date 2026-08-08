/**
 * The capture harness (#138 §8), and the four things it refuses to screenshot without.
 *
 * A capture is EVIDENCE for a human review, so a bad one is worse than a missing one: two
 * screenshots that look identical read as "the two themes are the same" when what actually happened
 * is that the harness never switched. So {@link capture} will not write a file until:
 *
 *   1. `data-rf-theme` on `<html>` is the theme that was requested — `useAppTheme` sets it from the
 *      theme it RESOLVED, so a silent fallback shows up here rather than in the picture;
 *   2. the surface being captured is present and has finished its state transition;
 *   3. every image has either loaded or failed — a half-loaded grid is a capture of the network,
 *      not of the design;
 *   4. animations are frozen, so two runs of the same state produce the same file.
 *
 * The matched-pair assertion (Classic and Frosted actually differing in tokens AND in the resolved
 * presentation recipe) lives in the specs, because it needs both readings at once.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { ARTIFACTS } from './harness';
import { artworkSettled, themeEvidence, type ThemeEvidence } from './theme';

export const CAPTURE_DIR = join(ARTIFACTS, 'captures');
mkdirSync(CAPTURE_DIR, { recursive: true });

export interface CaptureRow {
    state: string;
    viewport: string;
    theme: string;
    file: string;
    resolvedTheme: string | null;
    tokens: Record<string, string>;
    recipe: Record<string, string | null>;
    /**
     * Whether any presentation-reading primitive was on screen. `false` means the theme proof for
     * this state rests on the token layer alone, because the surface holds no `Surface`/`MediaCard`
     * to publish a resolved recipe.
     */
    recipeObservable: boolean;
    /** What a reviewer is being asked to look at in this one. */
    inspect: string;
}

const rows: CaptureRow[] = [];

export interface CaptureOptions {
    state: string;
    viewport: string;
    theme: string;
    inspect: string;
    /** A selector that must be present and visible before the shutter opens. */
    waitFor: string;
}

export async function capture(
    page: Page,
    options: CaptureOptions
): Promise<ThemeEvidence> {
    await page.waitForSelector(options.waitFor, {
        state: 'visible',
        timeout: 45_000
    });

    const evidence = await themeEvidence(page);
    if (evidence.resolvedTheme !== options.theme) {
        throw new Error(
            `capture refused: asked for ${options.theme}, the application resolved ` +
                `${evidence.resolvedTheme}. A screenshot taken now would be labelled with a theme ` +
                'it does not show.'
        );
    }

    await artworkSettled(page);
    // Freeze anything still moving, so the same state screenshots identically twice.
    await page.addStyleTag({
        content:
            '*, *::before, *::after { animation-duration: 0s !important; ' +
            'animation-delay: 0s !important; transition-duration: 0s !important; ' +
            'transition-delay: 0s !important; }'
    });

    const file = `${options.state}.${options.viewport}.${options.theme}.png`;
    await page.screenshot({ path: join(CAPTURE_DIR, file), fullPage: false });

    rows.push({
        state: options.state,
        viewport: options.viewport,
        theme: options.theme,
        file,
        resolvedTheme: evidence.resolvedTheme,
        tokens: evidence.tokens,
        recipe: evidence.recipe,
        recipeObservable: Object.values(evidence.recipe).some(
            (value) => value !== null
        ),
        inspect: options.inspect
    });
    return evidence;
}

/**
 * Append this run's rows to the capture index.
 *
 * Appends rather than overwrites: the three viewport projects run as three separate Playwright
 * projects in one invocation, each with its own module instance, and an overwrite would leave the
 * index holding whichever finished last.
 */
export function writeIndex(project: string): void {
    if (rows.length === 0) return;
    writeFileSync(
        join(CAPTURE_DIR, `index.${project}.json`),
        `${JSON.stringify(rows, null, 2)}\n`,
        'utf8'
    );
}

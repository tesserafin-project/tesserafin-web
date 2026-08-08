/**
 * Proving a theme actually LOADED, rather than that one was requested (#138 §8).
 *
 * The earlier "half a theme" capture defect is the reason this module exists. Writing a theme id
 * into storage and taking a screenshot proves nothing: the id can be honoured by the presentation
 * record while the token stylesheet never arrives, or the tokens can apply while the recipe stays
 * on its default — and either way two captures come back looking identical, which reads as "the
 * themes are the same" rather than as "the harness did not switch".
 *
 * So a capture is accepted only when THREE independent things agree:
 *
 *   1. `data-rf-theme` on `<html>` is the requested id — `useAppTheme` sets it from the theme it
 *      RESOLVED, not from the one it was asked for, so a fallback shows up here;
 *   2. a resolved token value differs between the two themes — the generated stylesheet keyed on
 *      that attribute is actually in the cascade;
 *   3. a presentation-derived attribute differs — `Surface`/`MediaCard` read the resolved
 *      presentation record through their own context, so this is the recipe half.
 */
import type { Page } from '@playwright/test';

export const CLASSIC = 'official.classic';
export const FROSTED = 'official.glass';

export interface ThemeEvidence {
    /** What `useAppTheme` resolved to, which is not always what was requested. */
    resolvedTheme: string | null;
    mode: string | null;
    /** A handful of resolved token values, read off `<html>` after the cascade settled. */
    tokens: Record<string, string>;
    /** What the frosted surface actually paints, as the browser computed it. */
    surfaceBackdrop: string | null;
    surfaceBackground: string | null;
    /** The presentation record's own footprint on the rendered primitives. */
    recipe: Record<string, string | null>;
}

/**
 * Tokens chosen because a frosted surface cannot look like an opaque one and still agree on them:
 * `--rf-color-surface` carries the alpha channel that makes Frosted translucent, and
 * `--rf-color-background` is what shows through it.
 */
const TOKEN_NAMES = ['--rf-color-surface', '--rf-color-background'];

export async function themeEvidence(page: Page): Promise<ThemeEvidence> {
    return page.evaluate((tokenNames) => {
        const root = document.documentElement;
        const style = getComputedStyle(root);
        const surface = document.querySelector('[data-rf-slot="surface"]');
        const card = document.querySelector('[data-rf-slot="media-card"]');
        const tokens: Record<string, string> = {};
        for (const name of tokenNames) {
            tokens[name] = style.getPropertyValue(name).trim();
        }
        return {
            resolvedTheme: root.getAttribute('data-rf-theme'),
            mode: root.getAttribute('data-rf-mode'),
            tokens,
            surfaceBackdrop: surface
                ? getComputedStyle(surface).backdropFilter
                : null,
            surfaceBackground: surface
                ? getComputedStyle(surface).backgroundColor
                : null,
            recipe: {
                surfaceElevation:
                    surface?.getAttribute('data-rf-surface-elevation') ?? null,
                surfaceVariant:
                    surface?.getAttribute('data-rf-surface-variant') ?? null,
                cardHover: card?.getAttribute('data-rf-hover') ?? null,
                cardTitlePlacement:
                    card?.getAttribute('data-rf-title-placement') ?? null
            }
        };
    }, TOKEN_NAMES);
}

/**
 * Wait until the artwork on the page has finished one way or the other.
 *
 * "Loaded" and "failed into the asserted placeholder" are both acceptable; "still in flight" is
 * not, because that is what produces a capture with half its images missing.
 */
export async function artworkSettled(page: Page): Promise<void> {
    await page.waitForFunction(
        () =>
            [...document.querySelectorAll('img')].every(
                (img) => img.complete || img.naturalWidth > 0
            ),
        undefined,
        { timeout: 30_000 }
    );
}

/** Every token that differs between two evidence readings. */
export function tokenDifferences(
    a: ThemeEvidence,
    b: ThemeEvidence
): string[] {
    return Object.keys(a.tokens).filter(
        (name) => a.tokens[name] !== b.tokens[name]
    );
}

export function recipeDifferences(
    a: ThemeEvidence,
    b: ThemeEvidence
): string[] {
    return Object.keys(a.recipe).filter(
        (name) => a.recipe[name] !== b.recipe[name]
    );
}

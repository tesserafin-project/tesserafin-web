/**
 * The one place the universal Home recipe meets what the Web renderer can actually draw
 * (RFC-0007 §4.7).
 *
 * `presentation.page.home.sections` is UNIVERSAL vocabulary: it names sections any renderer could
 * offer. This module answers the narrower Web question — "given that recipe, in what order do I
 * render which of my sections?" — and it is deliberately the only module that knows both sides.
 *
 * ## What a recipe may and may not do
 *
 * A recipe SELECTS AND ORDERS. It never changes what a section contains and it never changes
 * whether that section's data is requested: `HomeTab` calls `useUserViews`, `useResumeItems` and
 * `useNextUp` unconditionally, above any recipe read, so the set of API queries Home issues is
 * identical under every recipe (`HomeTab.recipe.test.tsx` asserts exactly that). Omitting a section
 * hides it; it does not stop fetching it, does not reorder results inside it, and is therefore not
 * a content-ranking mechanism (RFC-0007 §6.1).
 *
 * ## `recommendations`
 *
 * Declared by the contract, rendered by nothing here. It would need `/Movies/Recommendations`, and
 * a recipe token whose presence makes a request fire is a theme controlling API queries — the one
 * thing §6.1 forbids outright. Web therefore drops it. Making it real is a PRODUCT decision about
 * what Home offers (always fetch recommendations, for every theme), not a theming decision, and it
 * is recorded as such in `docs/tesserafin/presentation-boundary.md`.
 */

import type { HomeSection } from 'themes/platform/contract';
import { PLATFORM_DEFAULT_PRESENTATION } from 'themes/platform/resolvePresentation';

/**
 * The sections this renderer draws. `recommendations` is absent on purpose — see the module note.
 *
 * `latestMedia` is 1:N: it expands to one shelf per eligible user view, so a recipe orders the
 * whole group and can never address an individual library. Which libraries exist is authorization
 * and library state.
 */
export const WEB_RENDERED_HOME_SECTIONS = [
    'hero',
    'continueWatching',
    'nextUp',
    'latestMedia',
    'libraries'
] as const satisfies readonly HomeSection[];

export type WebHomeSection = (typeof WEB_RENDERED_HOME_SECTIONS)[number];

const RENDERABLE: ReadonlySet<string> = new Set(WEB_RENDERED_HOME_SECTIONS);

/** Sections declared by the contract that this renderer draws nothing for. */
export const WEB_UNRENDERED_HOME_SECTIONS: readonly HomeSection[] = [
    'recommendations'
];

/**
 * The ordered sections `HomeTab` should render for a resolved recipe.
 *
 * Falls back to the platform default order when the recipe leaves nothing renderable — a recipe of
 * `['recommendations']` alone is valid against the schema, and honouring it literally would produce
 * a blank Home. A composition nobody designed is exactly what the fallback path exists to avoid,
 * and it is the same rule `resolvePresentation` applies when a recipe sanitises down to nothing.
 */
export function toRenderedHomeSections(
    sections: readonly HomeSection[]
): readonly WebHomeSection[] {
    const rendered = sections.filter((section): section is WebHomeSection =>
        RENDERABLE.has(section)
    );

    if (rendered.length > 0) return rendered;

    return PLATFORM_DEFAULT_PRESENTATION.page.home.sections.filter(
        (section): section is WebHomeSection => RENDERABLE.has(section)
    );
}

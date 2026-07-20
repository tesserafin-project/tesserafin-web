/**
 * Applies a resolved interaction-profile state to a DOM element (RFC-0005 §7.2, issue #18).
 *
 * Deliberately free of React, of the signal layer, and of the theme registry: this is the whole
 * observable effect of a profile — custom properties plus two attributes — expressed as one pure
 * DOM function. `./useInteractionProfiles.ts` is the React binding that drives it from live
 * signals; `tests/e2e/glass-interaction-profiles.spec.ts` bundles *this* module into a real browser
 * page to read the resulting `getComputedStyle` before, during and after each profile. Keeping it
 * dependency-light is what lets that proof exercise the real production code path rather than a
 * re-implementation of it.
 */

import {
    getProfileAttribute,
    resolveProfileOverride,
    type ActiveProfiles
} from '../ui/tokens/profiles';
import {
    applyCustomProperties,
    toCustomProperties
} from '../ui/tokens/projectTokens';

/**
 * The only theme interaction profiles apply to. Glass is the theme whose identity *is* compositing
 * — translucency and blur — so flattening that compositing is an adaptation of Glass rather than a
 * redesign of it. The profile partials are not no-ops against Reefin Classic
 * (`reducedTransparency` would repaint its opaque `#202020` surface, `remote` would give it a blur
 * it deliberately does not have), so this constant guards correctness, not merely scope.
 *
 * It is the *token* theme id (`registry.ts#tokenThemeId`), not the registry entry id, so both Glass
 * entries — `official.glass` and `official.glass.light` — are covered by one predicate while every
 * non-Glass theme, including the legacy `light` preset, provably is not. Keying on the entry id
 * would silently drop profiles for Glass Light, whose frosted surface needs them exactly as much.
 */
export const PROFILE_THEME_ID = 'official.glass';

/** Carries the single cascade winner, for CSS scoping only — never for deriving values. */
export const PROFILE_ATTRIBUTE = 'data-rf-profile';

/** The orthogonal motion axis. A separate attribute because it is a separate axis. */
export const REDUCED_MOTION_ATTRIBUTE = 'data-rf-reduced-motion';

/**
 * Projects `active` onto `root`, returning a function that restores `root` to exactly the state it
 * was in beforehand.
 *
 * @param mode Which `color.<mode>` group of the override to project.
 */
export const applyProfilesToRoot = (
    root: HTMLElement,
    active: ActiveProfiles,
    mode: 'dark' | 'light' = 'dark'
): (() => void) => {
    const restoreProperties = applyCustomProperties(
        root,
        toCustomProperties(resolveProfileOverride(active), mode)
    );

    const previousProfile = root.getAttribute(PROFILE_ATTRIBUTE);
    const previousReducedMotion = root.getAttribute(REDUCED_MOTION_ATTRIBUTE);

    const profile = getProfileAttribute(active);
    if (profile) {
        root.setAttribute(PROFILE_ATTRIBUTE, profile);
    } else {
        root.removeAttribute(PROFILE_ATTRIBUTE);
    }

    if (active.reducedMotion) {
        root.setAttribute(REDUCED_MOTION_ATTRIBUTE, 'true');
    } else {
        root.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
    }

    return () => {
        restoreProperties();

        // Restore both attributes to their prior presence *and* value — an attribute that was
        // absent must go back to absent, not to the empty string, so a `[data-rf-profile]`
        // presence selector cannot start matching after a round trip.
        if (previousProfile === null) {
            root.removeAttribute(PROFILE_ATTRIBUTE);
        } else {
            root.setAttribute(PROFILE_ATTRIBUTE, previousProfile);
        }

        if (previousReducedMotion === null) {
            root.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
        } else {
            root.setAttribute(REDUCED_MOTION_ATTRIBUTE, previousReducedMotion);
        }
    };
};

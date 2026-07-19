/**
 * Binds the live interaction-profile signals to the document (RFC-0005 §7.2, issue #18).
 *
 * This is the piece that makes a profile *observable in the browser* rather than merely true in a
 * TypeScript object. On every signal change it:
 *
 *   1. resolves the active profiles into a single token delta (`resolveProfileOverride`),
 *   2. projects that delta onto `<html>` as `--rf-*` custom properties, **re-deriving**
 *      `--rf-backdrop-filter-*` from the overridden `blur.*` (`projectTokens.ts`),
 *   3. mirrors the cascade winner onto `data-rf-profile` and the orthogonal motion axis onto
 *      `data-rf-reduced-motion`.
 *
 * Step 2 is the whole point. Steps 1 and 3 were already possible before; without step 2 the
 * overridden blur never reached `_glass-surface.scss`, which reads the *derived* property.
 *
 * ## The attributes are a mirror, not the source of truth
 *
 * `data-rf-profile` carries exactly one name — the cascade winner — because a CSS selector cannot
 * arbitrate a priority on its own. It exists for scoping (a rule that wants to know a profile is
 * on), never for deriving values: CSS that computed its blur from the profile *name* would be the
 * hidden per-theme resolution table that `docs/reefin/design-glass-interaction-profiles.md` §1
 * rejects. The values arrive as custom properties, from the partials, and only from there.
 *
 * ## Glass only, and provably so
 *
 * Nothing is projected and no attribute is set unless the active theme is {@link PROFILE_THEME_ID}.
 * The profile partials are *not* no-ops against Reefin Classic — `reducedTransparency` would
 * repaint its opaque `#202020` surface and `remote` would give it a blur it deliberately does not
 * have — so this guard is a correctness requirement, not a scoping nicety. It is asserted against
 * real computed styles in `tests/e2e/glass-interaction-profiles.spec.ts` (Classic active, every
 * signal on, nothing moves).
 *
 * Glass is still `experimental` in `./registry.ts` and therefore absent from every theme picker;
 * this hook only ever engages for a user who reached Glass by id.
 */

import { useEffect } from 'react';

import {
    getProfileAttribute,
    resolveProfileOverride,
    type ActiveProfiles
} from '../ui/tokens/profiles';
import {
    applyCustomProperties,
    toCustomProperties
} from '../ui/tokens/projectTokens';

import { subscribeToProfileSignals } from './interactionProfileSignals';
import { getThemeEntry } from './registry';

/**
 * The only theme interaction profiles apply to. Glass is the theme whose identity is compositing —
 * translucency and blur — so it is the only one where flattening that compositing is an adaptation
 * rather than a redesign.
 */
export const PROFILE_THEME_ID = 'official.glass';

const PROFILE_ATTRIBUTE = 'data-rf-profile';
const REDUCED_MOTION_ATTRIBUTE = 'data-rf-reduced-motion';

/**
 * Applies one resolved profile state to `root`, returning a function that restores `root` to
 * exactly the state it was in beforehand.
 *
 * Exported for the E2E proof harness, which drives profile states directly in a real browser so it
 * can read `getComputedStyle` before, during and after — see
 * `tests/e2e/glass-interaction-profiles.spec.ts`.
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

/**
 * Keeps `<html>`'s profile projection in sync with the platform signals, for as long as
 * {@link PROFILE_THEME_ID} is the active theme.
 *
 * @param activeThemeId The theme id `useAppTheme` resolved as active.
 */
export function useInteractionProfiles(activeThemeId: string): void {
    useEffect(() => {
        if (activeThemeId !== PROFILE_THEME_ID) {
            return undefined;
        }

        const root = document.documentElement;
        const mode = getThemeEntry(activeThemeId)?.defaultMode ?? 'dark';

        // Holds the undo for whatever is currently projected. Each signal change fully reverts the
        // previous projection before applying the next, so custom properties never accumulate:
        // `remote` then `remote + lowPower` then `remote` again leaves the document byte-identical
        // to the first `remote`, instead of stranding `lowPower`'s flattened elevations.
        let restore: (() => void) | undefined;

        const unsubscribe = subscribeToProfileSignals((active) => {
            restore?.();
            restore = applyProfilesToRoot(root, active, mode);
        });

        return () => {
            unsubscribe();
            restore?.();
            restore = undefined;
        };
    }, [activeThemeId]);
}

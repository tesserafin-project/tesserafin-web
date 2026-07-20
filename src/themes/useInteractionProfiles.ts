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
 * Steps 2 and 3 are `./applyProfiles.ts`; this module owns only *when* they happen. Step 2 is the
 * whole point of the feature: steps 1 and 3 were already possible before it, but without it the
 * overridden blur never reached `_glass-surface.scss`, which reads the *derived* property and so
 * kept painting the value baked in at build time.
 *
 * ## The attributes are a mirror, not the source of truth
 *
 * `data-rf-profile` carries exactly one name — the cascade winner — because a CSS selector cannot
 * arbitrate a priority on its own. It exists for scoping, never for deriving values: CSS that
 * computed its blur from the profile *name* would be the hidden per-theme resolution table that
 * `docs/reefin/design-glass-interaction-profiles.md` §1 rejects. The values arrive as custom
 * properties, from the concrete partials, and only from there.
 *
 * ## Glass only, and provably so
 *
 * Nothing is projected and no attribute is set unless the active theme is `PROFILE_THEME_ID`.
 * Since the profile partials are not no-ops against Classic, that guard is a correctness
 * requirement; it is asserted against real computed styles in
 * `tests/e2e/glass-interaction-profiles.spec.ts` (Classic active, every signal on, nothing moves)
 * rather than trusted.
 *
 * Since issue #18's G18b-1 slice Glass is selectable from the theme pickers (opt-in and badged,
 * never the default), so this hook engages for ordinary users rather than only for someone who
 * applied Glass by id — and for BOTH Glass modes, which is why the guard below keys on the token
 * theme id rather than the registry entry id. Note it is keyed on the theme `useAppTheme` resolved
 * as *active*, not on the one requested — so a Glass preference whose chunk failed to load falls
 * back to Classic and projects nothing, rather than projecting for a theme that never rendered.
 */

import { useEffect } from 'react';

import { applyProfilesToRoot, PROFILE_THEME_ID } from './applyProfiles';
import { subscribeToProfileSignals } from './interactionProfileSignals';
import { getThemeEntry } from './registry';

/**
 * Keeps `<html>`'s profile projection in sync with the platform signals, for as long as
 * `PROFILE_THEME_ID` is the active theme.
 *
 * @param activeThemeId The theme id `useAppTheme` resolved as active.
 */
export function useInteractionProfiles(activeThemeId: string): void {
    useEffect(() => {
        const entry = getThemeEntry(activeThemeId);

        // Keyed on the *token* theme id, so both Glass entries (dark and light) engage and every
        // other theme provably does not — see `applyProfiles.ts#PROFILE_THEME_ID`.
        if ((entry?.tokenThemeId ?? activeThemeId) !== PROFILE_THEME_ID) {
            return undefined;
        }

        const root = document.documentElement;
        // Selects which `color.<mode>` group of the override is projected. Glass Light resolves
        // 'light' here, which is why `REDUCED_TRANSPARENCY_OVERRIDE` carries a concrete
        // `color.light` partial — without it, light mode would zero the blur and keep a
        // translucent surface.
        const mode = entry?.defaultMode ?? 'dark';

        // Holds the undo for whatever is currently projected. Each signal change fully reverts the
        // previous projection before applying the next, so custom properties never accumulate:
        // `remote` then `remote + lowPower` then `remote` again leaves the document identical to
        // the first `remote`, instead of stranding `lowPower`'s flattened elevations.
        let restore: (() => void) | undefined;

        const unsubscribe = subscribeToProfileSignals((active) => {
            restore?.();
            restore = applyProfilesToRoot(root, active, mode);
        });

        // Teardown order mirrors setup: stop the signals first, so no callback can re-project
        // between the unsubscribe and the restore, then undo what is on the document. Switching
        // away from Glass therefore leaves `<html>` exactly as Classic's stylesheet declares it.
        return () => {
            unsubscribe();
            restore?.();
            restore = undefined;
        };
    }, [activeThemeId]);
}

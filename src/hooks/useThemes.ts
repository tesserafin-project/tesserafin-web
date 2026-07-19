import { useMemo } from 'react';

import { getSelectableThemeEntries } from 'themes/registry';
import type { Theme } from 'types/webConfig';

/**
 * Reads the theme catalog from the single registry (RFC-0005 §7.4) rather than `config.json`'s
 * `themes` array — see the deprecation note on `Theme[]`/`themes` in `types/webConfig.ts` and on
 * `scripts/settings/webSettings.js#getThemes` for the legacy (non-React) equivalent. Uses
 * `getSelectableThemeEntries()`, not `THEME_REGISTRY` directly, so "what a picker may offer" stays
 * one decision in one place.
 *
 * `experimental` is carried through to the picker (`DisplayPreferences.tsx`), which renders a badge
 * on those entries — since issue #18's G18b-1 slice, Reefin Glass is selectable rather than hidden.
 * `defaultTheme` still resolves to Classic, so nothing here changes what an unset preference gets.
 */
export function useThemes() {
    const themes = useMemo<Theme[]>(
        () =>
            getSelectableThemeEntries().map((entry) => ({
                id: entry.id,
                name: entry.name,
                color: entry.color,
                default: entry.default,
                experimental: entry.experimental
            })),
        []
    );

    const defaultTheme = useMemo(
        () => themes.find((theme) => theme.default),
        [themes]
    );

    return {
        themes,
        defaultTheme
    };
}

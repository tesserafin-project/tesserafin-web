import { useMemo } from 'react';

import { getSelectableThemeEntries } from 'themes/registry';
import type { Theme } from 'types/webConfig';

/**
 * Reads the theme catalog from the single registry (RFC-0005 §7.4) rather than `config.json`'s
 * `themes` array — see the deprecation note on `Theme[]`/`themes` in `types/webConfig.ts` and on
 * `scripts/settings/webSettings.js#getThemes` for the legacy (non-React) equivalent. Uses
 * `getSelectableThemeEntries()`, not `THEME_REGISTRY` directly, so `experimental` themes (Reefin
 * Glass, pending issue #18) stay out of every picker built on this hook while remaining fully
 * resolvable by id via `getThemeEntry()`.
 */
export function useThemes() {
    const themes = useMemo<Theme[]>(
        () =>
            getSelectableThemeEntries().map((entry) => ({
                id: entry.id,
                name: entry.name,
                color: entry.color,
                default: entry.default
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

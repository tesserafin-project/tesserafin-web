/**
 * The bridge between the theme *registry* and the theme *contract* (RFC-0007 §4.6).
 *
 * `src/themes/registry.ts` answers "what may a picker offer, and how is its colour scheme loaded".
 * `tesserafin-design/themes/<id>/theme.json` answers "what presentation does this theme declare".
 * Nothing joined the two, which is why the `presentation.*` capabilities were declared supported by
 * the Web renderer while nothing read them. This module is that join.
 *
 * ## Why a lookup rather than a field on the registry entry
 *
 * A registry entry is not one-to-one with a theme: `official.glass.light` is a second entry for the
 * *same* theme, and `dark`, `light`, `appletv`, `blueradiance`, `purplehaze` and `wmc` are legacy
 * colour presets with no manifest at all (RFC-0005 §8.1). Putting a manifest on each entry would
 * mean duplicating one for Glass and inventing six that do not exist. A lookup keyed by
 * `tokenThemeId ?? id` — the same resolution `useAppTheme` already uses to pick a stylesheet —
 * returns Glass's manifest for both its entries and `undefined` for the presets, which then get the
 * platform default. That is the honest answer: a legacy preset declares no presentation.
 *
 * ## Bundle cost
 *
 * Both manifests are imported statically, ~3 KB of JSON before minification. They are read on the
 * app's main theme path, so a dynamic import would only move the cost to a chunk that is always
 * fetched anyway, while making the presentation arrive one tick after first paint.
 */

import classicManifest from '../../../tesserafin-design/themes/classic/theme.json';
import glassManifest from '../../../tesserafin-design/themes/glass/theme.json';

import { getThemeEntry } from '../registry';

import type { ThemeManifest } from './contract';

const MANIFESTS: Readonly<Record<string, ThemeManifest>> = {
    [(classicManifest as ThemeManifest).id]: classicManifest as ThemeManifest,
    [(glassManifest as ThemeManifest).id]: glassManifest as ThemeManifest
};

/**
 * The manifest backing a registry theme id, or `undefined` when the entry has none.
 *
 * @param themeId A registry id, e.g. `official.classic`, `official.glass.light`, `blueradiance`.
 */
export function getManifestForThemeId(
    themeId: string
): ThemeManifest | undefined {
    const entry = getThemeEntry(themeId);
    // Same resolution as `useAppTheme`'s `data-rf-theme`: a `.light` entry renders its parent
    // theme's tokens, and must therefore also render its parent theme's presentation.
    return MANIFESTS[entry?.tokenThemeId ?? themeId];
}

/**
 * Every theme id that declares a manifest. Read by the parity assertions in
 * `ui/presentation/PresentationContext.test.tsx`, not by the app: a registry rename would otherwise
 * orphan a manifest silently — the theme would keep its palette and quietly lose its presentation,
 * with nothing failing.
 */
export const MANIFEST_THEME_IDS = Object.keys(MANIFESTS);

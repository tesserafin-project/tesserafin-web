import type { ColorSystemOptions } from '@mui/material/styles';

import darkColorScheme from './dark';
import lightColorScheme from './light';
import officialClassicColorScheme from './official.classic';

/**
 * Single source of truth for the themes Reefin Web ships with (RFC-0005 §7.4).
 *
 * This registry replaces the three previously independent sources described in RFC-0005 §4.1:
 * `src/config.json`'s `themes` array, the static `colorSchemes` map in `src/themes/index.ts`, and
 * the implicit list of `src/themes/<id>/` folders. `src/hooks/useThemes.ts` and
 * `src/scripts/settings/webSettings.js` (legacy) both derive their theme catalog from here now —
 * see the deprecation notes at their respective read sites. Both read the `getSelectableThemeEntries()`
 * filter (below), not `THEME_REGISTRY` directly, so `experimental` entries stay out of every picker.
 */
export interface ThemeRegistryEntry {
    /**
     * Stable identifier. Used as the persisted `userSettings.theme()` value, the MUI color scheme
     * key (`data-theme` attribute, `[data-theme="%s"]` selector), and the legacy CSS folder name
     * consumed by `components/ThemeCss.tsx` (`themes/<id>/theme.css`).
     */
    id: string;
    /** Display name shown in theme pickers. */
    name: string;
    /** Swatch color used as a gallery/selector preview. */
    color: string;
    /** The palette mode ('dark' | 'light') this entry renders in. */
    defaultMode: 'dark' | 'light';
    /** True for themes shipped and maintained by the Reefin team. */
    builtin: boolean;
    /**
     * True for the six themes inherited from Jellyfin: per RFC-0005 §8.1 these are no longer
     * maintained as independent structural themes, only as color presets compatible with Classic.
     */
    legacyPreset?: boolean;
    /** True for the theme selected when the user has no saved preference. */
    default?: boolean;
    /**
     * True for a theme that is fully defined and functional (`getThemeEntry()`/
     * `loadColorScheme()` resolve it normally, and it can be applied directly by id) but not yet
     * meant to be reachable from a theme picker — a hidden/experimental foundation landing ahead
     * of its own enablement work. Selector-facing consumers (`useThemes()`,
     * `webSettings.js#getSelectableThemes`, the legacy display-settings `<select>`) must filter
     * these out via `getSelectableThemeEntries()`; direct id lookups are unaffected. Set on
     * `official.glass` until issue #18 lifts it.
     */
    experimental?: boolean;
    /**
     * Resolves this theme's MUI color scheme. Non-default themes use a dynamic `import()` (one
     * webpack chunk per theme) so they are not part of the main bundle (RFC-0005 §9.1) — only
     * Reefin Classic and the two legacy presets it absorbs (`dark`, `light`) are bundled
     * synchronously, since they back the default, no-loading-flash experience.
     */
    loadColorScheme: () => Promise<ColorSystemOptions>;
}

export const THEME_REGISTRY: readonly ThemeRegistryEntry[] = [
    {
        id: 'official.classic',
        name: 'Reefin Classic',
        color: '#101010',
        defaultMode: 'dark',
        builtin: true,
        default: true,
        loadColorScheme: () => Promise.resolve(officialClassicColorScheme)
    },
    {
        id: 'official.glass',
        name: 'Reefin Glass',
        color: '#0b0e14',
        defaultMode: 'dark',
        builtin: true,
        // Hidden/experimental foundation (RFC-0005 §8.2): fully functional, but not yet
        // user-selectable — see the `experimental` field doc and issue #18.
        experimental: true,
        loadColorScheme: async () =>
            (
                await import(
                    /* webpackChunkName: "theme-colorscheme-official-glass" */ './official.glass'
                )
            ).default
    },
    {
        id: 'dark',
        name: 'Dark',
        color: '#202020',
        defaultMode: 'dark',
        builtin: true,
        legacyPreset: true,
        loadColorScheme: () => Promise.resolve(darkColorScheme)
    },
    {
        id: 'light',
        name: 'Light',
        color: '#303030',
        defaultMode: 'light',
        builtin: true,
        legacyPreset: true,
        loadColorScheme: () => Promise.resolve(lightColorScheme)
    },
    {
        id: 'appletv',
        name: 'Apple TV',
        color: '#bcbcbc',
        defaultMode: 'light',
        builtin: true,
        legacyPreset: true,
        loadColorScheme: async () =>
            (
                await import(
                    /* webpackChunkName: "theme-colorscheme-appletv" */ './appletv'
                )
            ).default
    },
    {
        id: 'blueradiance',
        name: 'Blue Radiance',
        color: '#011432',
        defaultMode: 'dark',
        builtin: true,
        legacyPreset: true,
        loadColorScheme: async () =>
            (
                await import(
                    /* webpackChunkName: "theme-colorscheme-blueradiance" */ './blueradiance'
                )
            ).default
    },
    {
        id: 'purplehaze',
        name: 'Purple Haze',
        color: '#000420',
        defaultMode: 'dark',
        builtin: true,
        legacyPreset: true,
        loadColorScheme: async () =>
            (
                await import(
                    /* webpackChunkName: "theme-colorscheme-purplehaze" */ './purplehaze'
                )
            ).default
    },
    {
        id: 'wmc',
        name: 'WMC',
        color: '#0c2450',
        defaultMode: 'dark',
        builtin: true,
        legacyPreset: true,
        loadColorScheme: async () =>
            (
                await import(
                    /* webpackChunkName: "theme-colorscheme-wmc" */ './wmc'
                )
            ).default
    }
] as const;

/** Looks up a registry entry by id, or `undefined` if it is not a known theme. */
export const getThemeEntry = (id: string): ThemeRegistryEntry | undefined =>
    THEME_REGISTRY.find((theme) => theme.id === id);

/**
 * The subset of `THEME_REGISTRY` a theme picker should offer (RFC-0005 §7.4). Excludes
 * `experimental` entries — currently `official.glass` — which stay fully functional via
 * `getThemeEntry()`/`loadColorScheme()` but must not be reachable from any selector until their
 * own enablement work lands (issue #18). `useThemes()` and `webSettings.js#getSelectableThemes`
 * are the two read sites; keep any future selector UI reading from here too rather than
 * `THEME_REGISTRY` directly.
 */
export const getSelectableThemeEntries = (): readonly ThemeRegistryEntry[] =>
    THEME_REGISTRY.filter((theme) => !theme.experimental);

/** The theme applied when the user has no saved preference. */
export const getDefaultThemeEntry = (): ThemeRegistryEntry =>
    THEME_REGISTRY.find((theme) => theme.default) ?? THEME_REGISTRY[0];

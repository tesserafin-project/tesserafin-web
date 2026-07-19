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
 * see the deprecation notes at their respective read sites. Both read `getSelectableThemeEntries()`
 * (below), not `THEME_REGISTRY` directly, so "what a picker may offer" stays one decision in one
 * place. `experimental` entries are offered too, carrying a badge — see that field's doc.
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
    /**
     * The `--rf-*` design-token stylesheet this entry renders with, i.e. the value written to
     * `data-rf-theme` — defaulting to {@link id} when omitted.
     *
     * It exists because a theme's *modes* and its *registry entries* are not one-to-one here. Mode
     * is a per-entry property (`defaultMode`), and nothing in the app toggles light/dark
     * independently of theme identity — `dark` and `light` are themselves two separate entries. So
     * a theme offering both modes offers them as two entries, and the second one needs to select
     * the same generated stylesheet as the first: `official.glass.light` renders
     * `[data-rf-theme="official.glass"][data-rf-mode="light"]`, a tier
     * `reefin-design/scripts/generate-web-tokens.mjs` already emits for every mode in
     * `theme.json#modes`.
     *
     * Declared explicitly rather than derived by stripping a `.light` suffix: a naming convention
     * that load-bearing would be an unpublished resolution rule, and this field is readable at the
     * one place it is decided. `themes/useAppTheme.ts` is the only consumer.
     */
    tokenThemeId?: string;
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
     * True for a theme that is offered to users but is still stabilising: it is fully functional
     * and freely selectable, and every picker must additionally mark it as experimental/new so the
     * choice is informed (`hooks/useThemes.ts` → `DisplayPreferences.tsx`'s MUI menu, and
     * `webSettings.js` → the legacy display-settings `<select>`).
     *
     * NOTE — the meaning of this flag changed in issue #18's G18b-1 slice. It previously meant
     * "hidden from every picker", and `getSelectableThemeEntries()` filtered it out. Glass's first
     * slice (G18a) wired its interaction profiles to real CSS custom properties while leaving it
     * unreachable; this slice makes Glass **selectable, opt-in and badged**. The flag is now a
     * presentation marker only — it never affects reachability. Nothing is auto-activated by it:
     * Classic keeps `default: true`, so a user with no saved preference still lands on Classic.
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
        // Opt-in and badged (RFC-0005 §8.2, issue #18 G18b-1): selectable from every picker, but
        // never the default and never auto-activated — Classic below keeps `default: true`. See
        // the `experimental` field doc.
        experimental: true,
        loadColorScheme: async () =>
            (
                await import(
                    /* webpackChunkName: "theme-colorscheme-official-glass" */ './official.glass'
                )
            ).default
    },
    {
        id: 'official.glass.light',
        name: 'Reefin Glass Light',
        color: '#eef2f8',
        defaultMode: 'light',
        // Renders the same generated token stylesheet as the dark entry above; only the
        // `[data-rf-mode="light"]` color tier differs. See `tokenThemeId`'s field doc.
        tokenThemeId: 'official.glass',
        builtin: true,
        experimental: true,
        // The *same* dynamic import as the dark entry, so both modes share one webpack chunk and
        // neither palette reaches the main bundle (RFC-0005 §9.1).
        loadColorScheme: async () =>
            (
                await import(
                    /* webpackChunkName: "theme-colorscheme-official-glass" */ './official.glass'
                )
            ).light
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
 * The set of entries a theme picker should offer (RFC-0005 §7.4). `useThemes()` and
 * `webSettings.js#getSelectableThemes` are the two read sites; keep any future selector UI reading
 * from here rather than `THEME_REGISTRY` directly, so "what a picker may offer" stays one decision
 * in one place.
 *
 * Since issue #18's G18b-1 slice this excludes nothing: `official.glass` was the only entry ever
 * withheld, and it is now selectable (opt-in, and rendered with an experimental badge driven by
 * `ThemeRegistryEntry.experimental` — see that field's doc). The indirection is kept because it is
 * the established seam both pickers already read; re-introducing an exclusion later is a change
 * here alone, not at every call site.
 */
export const getSelectableThemeEntries = (): readonly ThemeRegistryEntry[] =>
    THEME_REGISTRY;

/** The theme applied when the user has no saved preference. */
export const getDefaultThemeEntry = (): ThemeRegistryEntry =>
    THEME_REGISTRY.find((theme) => theme.default) ?? THEME_REGISTRY[0];

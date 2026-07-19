export interface Theme {
    name: string;
    default?: boolean;
    id: string;
    color: string;
    /**
     * Mirrors `themes/registry.ts`'s `ThemeRegistryEntry.experimental`: the theme is selectable
     * like any other, and pickers must additionally mark it as experimental/new. Presentation
     * only — it never affects which themes are offered or which one is the default.
     */
    experimental?: boolean;
}

// NOTE(RFC-0005 §7.4): `WebConfig.themes` (backed by `config.json`'s `themes` array) is no longer
// read by the app — `hooks/useThemes.ts` and `scripts/settings/webSettings.js#getThemes` both
// derive the theme catalog from `themes/registry.ts` instead, so the three previously independent
// sources of truth (config.json, `themes/index.ts`'s colorSchemes, the `themes/<id>/` folders)
// converge on one. The field below is kept only so an existing `config.json` on disk (e.g. a
// self-hosted deployment that customized it) does not fail to parse; its contents are ignored.

export interface MenuLink {
    name: string;
    icon?: string;
    url: string;
}

export interface WebConfig {
    includeCorsCredentials?: boolean;
    multiserver?: boolean;
    themes?: Theme[];
    menuLinks?: MenuLink[];
    servers?: string[];
    plugins?: string[];
}

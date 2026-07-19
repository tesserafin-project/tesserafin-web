import DefaultConfig from '../../config.json';
import {
    THEME_REGISTRY,
    getSelectableThemeEntries
} from '../../themes/registry.ts';
import fetchLocal from '../../utils/fetchLocal.ts';

let data;

async function getConfig() {
    if (data) return Promise.resolve(data);
    try {
        const response = await fetchLocal('config.json', {
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error('network response was not ok');
        }

        data = await response.json();

        return data;
    } catch (error) {
        console.warn('failed to fetch the web config file:', error);
        data = DefaultConfig;
        return data;
    }
}

export function getIncludeCorsCredentials() {
    return getConfig()
        .then((config) => !!config.includeCorsCredentials)
        .catch((error) => {
            console.log('cannot get web config:', error);
            return false;
        });
}

export function getMultiServer() {
    // Enable multi-server support when served by webpack
    if (__WEBPACK_SERVE__) {
        return Promise.resolve(true);
    }

    return getConfig()
        .then((config) => {
            return !!config.multiserver;
        })
        .catch((error) => {
            console.log('cannot get web config:', error);
            return false;
        });
}

export function getServers() {
    return getConfig()
        .then((config) => {
            return config.servers || [];
        })
        .catch((error) => {
            console.log('cannot get web config:', error);
            return [];
        });
}

// NOTE(RFC-0005 §7.4): the theme catalog used to come from `config.json`'s `themes` array (and
// needed the `checkDefaultTheme`/async dance below since that file is fetched at runtime). It now
// comes from `themes/registry.ts`, the single source of truth also used by `hooks/useThemes.ts` —
// `config.json`'s own `themes` field is no longer read (kept on disk only for backward
// compatibility, see the note on `WebConfig.themes` in `types/webConfig.ts`). Deriving from the
// registry is synchronous, so both functions below no longer need to wait on `getConfig()`.
const toLegacyTheme = (entry) => ({
    name: entry.name,
    id: entry.id,
    color: entry.color,
    default: entry.default,
    // Presentation marker only (issue #18 G18b-1): the legacy display-settings `<select>` appends
    // an "experimental" suffix to these entries' labels, since an `<option>` can carry no markup.
    experimental: entry.experimental
});

// Every registry entry — the resolution catalog `themeManager.js#getThemeStylesheetInfo` uses to
// map an id (including one restored from storage) onto a theme.
const REGISTRY_THEMES = THEME_REGISTRY.map(toLegacyTheme);

// What a picker may offer. Since issue #18's G18b-1 slice this is the whole registry — Reefin
// Glass is selectable (badged), not hidden — but the two lists stay distinct so reachability
// remains one decision in `themes/registry.ts#getSelectableThemeEntries`, read by the legacy
// display-settings `<select>` (`components/displaySettings/displaySettings.js#fillThemes`, via
// `scripts/themeManager.js#getSelectableThemes`).
const SELECTABLE_REGISTRY_THEMES =
    getSelectableThemeEntries().map(toLegacyTheme);

const internalDefaultTheme =
    REGISTRY_THEMES.find((theme) => theme.default) || REGISTRY_THEMES[0];

export function getThemes() {
    return Promise.resolve(REGISTRY_THEMES);
}

export function getSelectableThemes() {
    return Promise.resolve(SELECTABLE_REGISTRY_THEMES);
}

export const getDefaultTheme = () => internalDefaultTheme;

export function getMenuLinks() {
    return getConfig()
        .then((config) => {
            if (!config.menuLinks) {
                console.error(
                    'web config is invalid, missing menuLinks:',
                    config
                );
            }
            return config.menuLinks || [];
        })
        .catch((error) => {
            console.log('cannot get web config:', error);
            return [];
        });
}

export function getPlugins() {
    return getConfig()
        .then((config) => {
            if (!config.plugins) {
                console.error(
                    'web config is invalid, missing plugins:',
                    config
                );
            }
            return config.plugins || DefaultConfig.plugins;
        })
        .catch((error) => {
            console.log('cannot get web config:', error);
            return DefaultConfig.plugins;
        });
}

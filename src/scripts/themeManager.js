import Events from 'utils/events';
import { EventType } from 'constants/eventType';

import {
    getDefaultTheme,
    getThemes as getConfiguredThemes,
    getSelectableThemes as getConfiguredSelectableThemes
} from './settings/webSettings';

let currentThemeId;

function getThemes() {
    return getConfiguredThemes();
}

// Picker-safe subset of `getThemes()` — excludes `experimental` registry entries (Reefin Glass,
// pending issue #18). `getThemes()`/`getThemeStylesheetInfo` above still resolve those by id, so a
// theme already applied (or set programmatically) keeps working; only selector UIs should call
// this instead of `getThemes()`. See `components/displaySettings/displaySettings.js#fillThemes`.
function getSelectableThemes() {
    return getConfiguredSelectableThemes();
}

function getThemeStylesheetInfo(id) {
    return getThemes().then((themes) => {
        let theme;

        if (id) {
            theme = themes.find((currentTheme) => {
                return currentTheme.id === id;
            });
        }

        if (!theme) {
            theme = getDefaultTheme();
        }

        return theme;
    });
}

function setTheme(id) {
    return new Promise(function (resolve) {
        if (currentThemeId && currentThemeId === id) {
            resolve();
            return;
        }

        getThemeStylesheetInfo(id).then(function (info) {
            if (currentThemeId && currentThemeId === info.id) {
                resolve();
                return;
            }

            currentThemeId = info.id;

            // set the theme attribute for mui
            document.documentElement.setAttribute('data-theme', info.id);

            // set the meta theme color
            document.getElementById('themeColor').content = info.color;

            Events.trigger(document, EventType.THEME_CHANGE, [info.id]);
        });
    });
}

export default {
    getThemes,
    getSelectableThemes,
    setTheme
};

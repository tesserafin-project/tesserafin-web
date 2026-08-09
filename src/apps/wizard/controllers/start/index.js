import loading from 'components/loading/loading';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Dashboard from 'utils/dashboard';
import dom from 'utils/dom';
import { deriveMetadataCountry } from 'apps/wizard/utils/metadataCountry';
import {
    browserLocales,
    deriveMetadataLanguage
} from 'apps/wizard/utils/metadataLocale';

import 'elements/emby-button/emby-button';
import 'elements/emby-input/emby-input';

function loadPage(page, systemInfo, config) {
    const serverNameElem = page.querySelector('#txtServerName');
    serverNameElem.value = config.ServerName || systemInfo.ServerName;

    loading.hide();
}

/**
 * Writes the metadata locale this household should start with onto the configuration object.
 *
 * Neither value is asked for. The display language is not a first-run decision at all — Tesserafin
 * launches English-only — so `UICulture` is not written here either: a partially completed setup
 * that already carries one keeps it.
 */
function applyMetadataLocale(config, cultures, countries) {
    const availableLanguageCodes = cultures
        .map((culture) => culture.TwoLetterISOLanguageName)
        .filter(Boolean);
    const availableCountryCodes = countries
        .map((country) => country.TwoLetterISORegionName)
        .filter(Boolean);

    const language = deriveMetadataLanguage(
        browserLocales(),
        availableLanguageCodes,
        config.PreferredMetadataLanguage
    );
    config.PreferredMetadataLanguage = language;

    // Null-preserving on purpose: a language CLDR cannot place, or a region the server does not
    // offer, leaves whatever `MetadataCountryCode` the server already had.
    const derivedCountry = deriveMetadataCountry(
        language,
        availableCountryCodes
    );
    if (derivedCountry) {
        config.MetadataCountryCode = derivedCountry;
    }
}

function save(page) {
    loading.show();
    const apiClient = ServerConnections.currentApiClient();
    Promise.all([
        apiClient.getJSON(apiClient.getUrl('Startup/Configuration')),
        apiClient.getCultures(),
        apiClient.getCountries()
    ])
        .then(function ([config, cultures, countries]) {
            config.ServerName = page.querySelector('#txtServerName').value;
            applyMetadataLocale(config, cultures, countries);

            return apiClient.ajax({
                type: 'POST',
                data: JSON.stringify(config),
                url: apiClient.getUrl('Startup/Configuration'),
                contentType: 'application/json'
            });
        })
        .then(function () {
            Dashboard.navigate('wizard/user');
        });
}

function onSubmit(e) {
    e.preventDefault();
    save(dom.parentWithClass(this, 'page'));
}

export default function (view) {
    view.querySelector('.wizardStartForm').addEventListener('submit', onSubmit);

    view.addEventListener('viewshow', function () {
        document
            .querySelector('.skinHeader')
            .classList.add('noHomeButtonHeader');
        loading.show();
        const page = this;
        const apiClient = ServerConnections.currentApiClient();

        Promise.all([
            apiClient.getPublicSystemInfo(),
            apiClient.getJSON(apiClient.getUrl('Startup/Configuration'))
        ]).then(([systemInfo, config]) => {
            loadPage(page, systemInfo, config);
        });
    });

    view.addEventListener('viewhide', function () {
        document
            .querySelector('.skinHeader')
            .classList.remove('noHomeButtonHeader');
    });
}

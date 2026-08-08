import loading from 'components/loading/loading';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Dashboard from 'utils/dashboard';
import { deriveMetadataCountry } from 'apps/wizard/utils/metadataCountry';

import 'elements/emby-button/emby-button';
import 'elements/emby-checkbox/emby-checkbox';
import 'elements/emby-select/emby-select';

function save(page) {
    loading.show();
    const apiClient = ServerConnections.currentApiClient();
    apiClient
        .getJSON(apiClient.getUrl('Startup/Configuration'))
        .then(function (config) {
            const language = page.querySelector('#selectLanguage').value;
            config.PreferredMetadataLanguage = language;
            // The country is derived from the language rather than asked for. See
            // `apps/wizard/utils/metadataCountry` for why, and note the null-preserving fallback:
            // a language CLDR cannot place, or a region the server does not offer, leaves whatever
            // the server already had.
            const derived = deriveMetadataCountry(
                language,
                availableCountryCodes
            );
            if (derived) {
                config.MetadataCountryCode = derived;
            }
            apiClient
                .ajax({
                    type: 'POST',
                    data: JSON.stringify(config),
                    url: apiClient.getUrl('Startup/Configuration'),
                    contentType: 'application/json'
                })
                .then(function () {
                    loading.hide();
                    navigateToNextPage();
                });
        });
}

function populateLanguages(select, languages) {
    let html = '';
    html += "<option value=''></option>";

    for (let i = 0, length = languages.length; i < length; i++) {
        const culture = languages[i];
        html +=
            "<option value='" +
            culture.TwoLetterISOLanguageName +
            "'>" +
            culture.DisplayName +
            '</option>';
    }

    select.innerHTML = html;
}

/**
 * Every region code the server is willing to store, captured when the step loads so that the
 * derivation can refuse to invent one the server does not know.
 */
let availableCountryCodes = [];

function reloadData(page, config, cultures, countries) {
    availableCountryCodes = countries
        .map((country) => country.TwoLetterISORegionName)
        .filter(Boolean);
    populateLanguages(page.querySelector('#selectLanguage'), cultures);
    page.querySelector('#selectLanguage').value =
        config.PreferredMetadataLanguage;
    loading.hide();
}

function reload(page) {
    loading.show();
    const apiClient = ServerConnections.currentApiClient();
    const promise1 = apiClient.getJSON(
        apiClient.getUrl('Startup/Configuration')
    );
    const promise2 = apiClient.getCultures();
    const promise3 = apiClient.getCountries();
    Promise.all([promise1, promise2, promise3]).then(function (responses) {
        reloadData(page, responses[0], responses[1], responses[2]);
    });
}

function navigateToNextPage() {
    Dashboard.navigate('wizard/remoteaccess');
}

function onSubmit(e) {
    save(this);
    e.preventDefault();
    return false;
}

export default function (view) {
    view.querySelector('.wizardSettingsForm').addEventListener(
        'submit',
        onSubmit
    );
    view.addEventListener('viewshow', function () {
        document
            .querySelector('.skinHeader')
            .classList.add('noHomeButtonHeader');
        reload(this);
    });
    view.addEventListener('viewhide', function () {
        document
            .querySelector('.skinHeader')
            .classList.remove('noHomeButtonHeader');
    });
}

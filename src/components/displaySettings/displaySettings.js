import escapeHtml from 'escape-html';

import { AppFeature } from 'constants/appFeature';
import { PluginType } from 'constants/pluginType';
import { getUserQuery, QUERY_KEY as USER_QUERY_KEY } from 'hooks/api/useUser';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { ContentPackBrowsingPreference } from 'lib/tesserafin-sdk/generated/models/content-pack-browsing-preference';
import { queryClient } from 'utils/query/queryClient';

import layoutManager from '../layoutManager';
import { pluginManager } from '../pluginManager';
import { appHost } from '../apphost';
import focusManager from '../focusManager';
import datetime from '../../scripts/datetime';
import globalize from '../../lib/globalize';
import loading from '../loading/loading';
import skinManager from '../../scripts/themeManager';
import Events from '../../utils/events.ts';
import toast from '../toast/toast';

import template from './displaySettings.template.html';

import '../../elements/emby-select/emby-select';
import '../../elements/emby-checkbox/emby-checkbox';
import '../../elements/emby-button/emby-button';
import '../../elements/emby-textarea/emby-textarea';

function fillThemes(select, selectedTheme) {
    // What a picker may offer, per `themes/registry.ts#getSelectableThemeEntries` — not
    // `skinManager.getThemes()`, which is the wider catalog `setTheme()` resolves a stored id
    // through.
    skinManager.getSelectableThemes().then((themes) => {
        select.innerHTML = themes
            .map((t) => {
                // An `<option>` can carry no markup, so `experimental` entries (Tesserafin Glass —
                // opt-in and badged since issue #18's G18b-1 slice) are marked by suffixing the
                // label. The modern picker renders a real badge instead; see
                // `apps/modern/features/preferences/components/DisplayPreferences.tsx`.
                const label = t.experimental
                    ? `${t.name} (${globalize.translate('LabelExperimentalTheme')})`
                    : t.name;
                return `<option value="${t.id}">${escapeHtml(label)}</option>`;
            })
            .join('');

        // get default theme
        const defaultTheme = themes.find((theme) => theme.default);

        // set the current theme
        select.value = selectedTheme || defaultTheme.id;
    });
}

/**
 * The browsing arrangement (#139 gate 5), on the surface the legacy shells reach.
 *
 * `apps/modern`'s Display preferences page offers the same two outcomes through MUI. That page is
 * never rendered in the legacy phone or television layout, so without this the choice would exist
 * for one of the three shells this branch ships — and the wizard would have asked a question the
 * household could not later change.
 *
 * The values come from the generated model rather than from string literals in the template: this
 * is the server's enum, and the two spellings must not be able to drift apart.
 */
function fillBrowsingArrangement(select, saved) {
    select.innerHTML = [
        [
            ContentPackBrowsingPreference.MediaFamilyFirst,
            'OptionBrowseByMediaFamily'
        ],
        [
            ContentPackBrowsingPreference.ContentPackFirst,
            'OptionBrowseByContentPack'
        ]
    ]
        .map(
            ([value, key]) =>
                `<option value="${value}">${escapeHtml(globalize.translate(key))}</option>`
        )
        .join('');

    /*
     * Absent, `undefined` and any value this build does not recognise all resolve to
     * media-family-first, which is exactly today's arrangement. There is deliberately no third
     * "unset" state, which is what makes "existing users are not prompted" true without a
     * migration.
     */
    select.value =
        saved === ContentPackBrowsingPreference.ContentPackFirst
            ? ContentPackBrowsingPreference.ContentPackFirst
            : ContentPackBrowsingPreference.MediaFamilyFirst;
}

function showBrowsingArrangementHelp(context) {
    context.querySelector('.selectBrowsingArrangementDescription').textContent =
        globalize.translate(
            context.querySelector('#selectBrowsingArrangement').value ===
                ContentPackBrowsingPreference.ContentPackFirst
                ? 'OptionBrowseByContentPackHelp'
                : 'OptionBrowseByMediaFamilyHelp'
        );
}

function loadScreensavers(context, userSettings) {
    const selectScreensaver = context.querySelector('.selectScreensaver');
    const options = pluginManager
        .ofType(PluginType.Screensaver)
        .map((plugin) => {
            return {
                name: globalize.translate(plugin.name),
                value: plugin.id
            };
        });

    options.unshift({
        name: globalize.translate('None'),
        value: 'none'
    });

    selectScreensaver.innerHTML = options
        .map((o) => {
            return `<option value="${o.value}">${escapeHtml(o.name)}</option>`;
        })
        .join('');

    selectScreensaver.value = userSettings.screensaver();

    if (!selectScreensaver.value) {
        // TODO: set the default instead of none
        selectScreensaver.value = 'none';
    }
}

function showOrHideMissingEpisodesField(context) {
    context
        .querySelector('.fldDisplayMissingEpisodes')
        .classList.remove('hide');
}

function loadForm(context, user, userSettings) {
    if (appHost.supports(AppFeature.DisplayLanguage)) {
        context.querySelector('.languageSection').classList.remove('hide');
    } else {
        context.querySelector('.languageSection').classList.add('hide');
    }

    if (appHost.supports(AppFeature.DisplayMode)) {
        context.querySelector('.fldDisplayMode').classList.remove('hide');
    } else {
        context.querySelector('.fldDisplayMode').classList.add('hide');
    }

    if (appHost.supports(AppFeature.ExternalLinks)) {
        context
            .querySelector('.learnHowToContributeContainer')
            .classList.remove('hide');
    } else {
        context
            .querySelector('.learnHowToContributeContainer')
            .classList.add('hide');
    }

    context
        .querySelector('.selectDashboardThemeContainer')
        .classList.toggle('hide', !user.Policy.IsAdministrator);
    context
        .querySelector('.txtSlideshowIntervalContainer')
        .classList.remove('hide');

    if (appHost.supports(AppFeature.Screensaver)) {
        context
            .querySelector('.selectScreensaverContainer')
            .classList.remove('hide');
        context
            .querySelector('.txtBackdropScreensaverIntervalContainer')
            .classList.remove('hide');
        context
            .querySelector('.txtScreensaverTimeContainer')
            .classList.remove('hide');
    } else {
        context
            .querySelector('.selectScreensaverContainer')
            .classList.add('hide');
        context
            .querySelector('.txtBackdropScreensaverIntervalContainer')
            .classList.add('hide');
        context
            .querySelector('.txtScreensaverTimeContainer')
            .classList.add('hide');
    }

    if (datetime.supportsLocalization()) {
        context.querySelector('.fldDateTimeLocale').classList.remove('hide');
    } else {
        context.querySelector('.fldDateTimeLocale').classList.add('hide');
    }

    fillThemes(context.querySelector('#selectTheme'), userSettings.theme());
    fillThemes(
        context.querySelector('#selectDashboardTheme'),
        userSettings.dashboardTheme()
    );

    loadScreensavers(context, userSettings);

    context.querySelector('#txtBackdropScreensaverInterval').value =
        userSettings.backdropScreensaverInterval();
    context.querySelector('#txtSlideshowInterval').value =
        userSettings.slideshowInterval();
    context.querySelector('#txtScreensaverTime').value =
        userSettings.screensaverTime();

    context.querySelector('.chkDisplayMissingEpisodes').checked =
        user.Configuration.DisplayMissingEpisodes || false;

    fillBrowsingArrangement(
        context.querySelector('#selectBrowsingArrangement'),
        user.Configuration.ContentPackBrowsingPreference
    );
    showBrowsingArrangementHelp(context);

    context.querySelector('#chkThemeSong').checked =
        userSettings.enableThemeSongs();
    context.querySelector('#chkThemeVideo').checked =
        userSettings.enableThemeVideos();
    context.querySelector('#chkFadein').checked =
        userSettings.enableFastFadein();
    context.querySelector('#chkBlurhash').checked =
        userSettings.enableBlurhash();
    context.querySelector('#chkBackdrops').checked =
        userSettings.enableBackdrops();
    context.querySelector('#chkDetailsBanner').checked =
        userSettings.detailsBanner();

    context.querySelector('#chkDisableCustomCss').checked =
        userSettings.disableCustomCss();
    context.querySelector('#txtLocalCustomCss').value =
        userSettings.customCss();

    context.querySelector('#selectLanguage').value =
        userSettings.language() || '';
    context.querySelector('.selectDateTimeLocale').value =
        userSettings.dateTimeLocale() || '';

    context.querySelector('#txtLibraryPageSize').value =
        userSettings.libraryPageSize();

    context.querySelector('#txtMaxDaysForNextUp').value =
        userSettings.maxDaysForNextUp();
    context.querySelector('#chkRewatchingNextUp').checked =
        userSettings.enableRewatchingInNextUp();
    context.querySelector('#chkUseEpisodeImagesInNextUp').checked =
        userSettings.useEpisodeImagesInNextUpAndResume();

    context.querySelector('.selectLayout').value =
        layoutManager.getSavedLayout() || '';

    showOrHideMissingEpisodesField(context);

    loading.hide();
}

function saveUser(context, user, userSettingsInstance, apiClient) {
    user.Configuration.DisplayMissingEpisodes = context.querySelector(
        '.chkDisplayMissingEpisodes'
    ).checked;

    /*
     * One more key on the configuration the server last returned, exactly as the line above does.
     *
     * The whole object goes back in the request, so nothing else on it is lost, and the preference
     * stays server-owned: there is no browser-side copy of it anywhere in this file. Changing your
     * own arrangement needs no administrator right and no content-pack permission —
     * `POST /Users/{userId}/Configuration` is plain `[Authorize]`.
     */
    user.Configuration.ContentPackBrowsingPreference = context.querySelector(
        '#selectBrowsingArrangement'
    ).value;

    if (appHost.supports(AppFeature.DisplayLanguage)) {
        userSettingsInstance.language(
            context.querySelector('#selectLanguage').value
        );
    }

    userSettingsInstance.dateTimeLocale(
        context.querySelector('.selectDateTimeLocale').value
    );

    userSettingsInstance.enableThemeSongs(
        context.querySelector('#chkThemeSong').checked
    );
    userSettingsInstance.enableThemeVideos(
        context.querySelector('#chkThemeVideo').checked
    );
    userSettingsInstance.theme(context.querySelector('#selectTheme').value);
    userSettingsInstance.dashboardTheme(
        context.querySelector('#selectDashboardTheme').value
    );
    userSettingsInstance.screensaver(
        context.querySelector('.selectScreensaver').value
    );
    userSettingsInstance.backdropScreensaverInterval(
        context.querySelector('#txtBackdropScreensaverInterval').value
    );
    userSettingsInstance.slideshowInterval(
        context.querySelector('#txtSlideshowInterval').value
    );
    userSettingsInstance.screensaverTime(
        context.querySelector('#txtScreensaverTime').value
    );

    userSettingsInstance.libraryPageSize(
        context.querySelector('#txtLibraryPageSize').value
    );

    userSettingsInstance.maxDaysForNextUp(
        context.querySelector('#txtMaxDaysForNextUp').value
    );
    userSettingsInstance.enableRewatchingInNextUp(
        context.querySelector('#chkRewatchingNextUp').checked
    );
    userSettingsInstance.useEpisodeImagesInNextUpAndResume(
        context.querySelector('#chkUseEpisodeImagesInNextUp').checked
    );

    userSettingsInstance.enableFastFadein(
        context.querySelector('#chkFadein').checked
    );
    userSettingsInstance.enableBlurhash(
        context.querySelector('#chkBlurhash').checked
    );
    userSettingsInstance.enableBackdrops(
        context.querySelector('#chkBackdrops').checked
    );
    userSettingsInstance.detailsBanner(
        context.querySelector('#chkDetailsBanner').checked
    );

    userSettingsInstance.disableCustomCss(
        context.querySelector('#chkDisableCustomCss').checked
    );
    userSettingsInstance.customCss(
        context.querySelector('#txtLocalCustomCss').value
    );

    if (user.Id === apiClient.getCurrentUserId()) {
        skinManager.setTheme(userSettingsInstance.theme());
    }

    layoutManager.setLayout(context.querySelector('.selectLayout').value);

    const written = apiClient.updateUserConfiguration(
        user.Id,
        user.Configuration
    );

    if (user.Id !== apiClient.getCurrentUserId()) {
        return written;
    }

    /*
     * Re-read the user and republish it, so the primary navigation shows the arrangement now.
     *
     * The legacy nav drawer reads the arrangement off `Configuration`, and it gets there through
     * `apiClient`'s `_currentUser`, which is filled once at sign-in and which a configuration write
     * does not invalidate. Without this the drawer would keep the arrangement the session started
     * with until the next full reload, and the setting would look as though it had not taken.
     *
     * `getUser` rather than `getCurrentUser`: the second answers from that same cache. The React
     * Query entry behind `loadData` is dropped for the same reason.
     */
    return written.then(async () => {
        const refreshed = await apiClient.getUser(user.Id);
        await queryClient.invalidateQueries({
            queryKey: [USER_QUERY_KEY, user.Id]
        });
        Events.trigger(ServerConnections, 'localusersignedin', [refreshed]);
        return refreshed;
    });
}

function save(
    instance,
    context,
    userId,
    userSettings,
    apiClient,
    enableSaveConfirmation
) {
    loading.show();

    apiClient.getUser(userId).then((user) => {
        saveUser(context, user, userSettings, apiClient).then(
            () => {
                loading.hide();
                if (enableSaveConfirmation) {
                    toast(globalize.translate('SettingsSaved'));
                }
                Events.trigger(instance, 'saved');
            },
            () => {
                loading.hide();
            }
        );
    });
}

function onSubmit(e) {
    const self = this;
    const apiClient = ServerConnections.getApiClient(self.options.serverId);
    const userId = self.options.userId;
    const userSettings = self.options.userSettings;

    userSettings.setUserInfo(userId, apiClient).then(() => {
        const enableSaveConfirmation = self.options.enableSaveConfirmation;
        save(
            self,
            self.options.element,
            userId,
            userSettings,
            apiClient,
            enableSaveConfirmation
        );
    });

    // Disable default form submission
    if (e) {
        e.preventDefault();
    }
    return false;
}

function embed(options, self) {
    options.element.innerHTML = globalize.translateHtml(template, 'core');
    options.element
        .querySelector('form')
        .addEventListener('submit', onSubmit.bind(self));
    options.element
        .querySelector('#selectBrowsingArrangement')
        .addEventListener('change', () =>
            showBrowsingArrangementHelp(options.element)
        );
    if (options.enableSaveButton) {
        options.element.querySelector('.btnSave').classList.remove('hide');
    }
    self.loadData(options.autoFocus);
}

class DisplaySettings {
    constructor(options) {
        this.options = options;
        embed(options, this);
    }

    async loadData(autoFocus) {
        const self = this;
        const context = self.options.element;

        loading.show();

        const userId = self.options.userId;
        const api = ServerConnections.getApi(self.options.serverId);
        const apiClient = ServerConnections.getApiClient(self.options.serverId);
        const userSettings = self.options.userSettings;

        const user = await queryClient.fetchQuery(
            getUserQuery(api, { userId })
        );
        await userSettings.setUserInfo(userId, apiClient);

        self.dataLoaded = true;
        loadForm(context, user, userSettings);
        if (autoFocus) {
            focusManager.autoFocus(context);
        }
    }

    submit() {
        onSubmit.call(this);
    }

    destroy() {
        this.options = null;
    }
}

export default DisplaySettings;

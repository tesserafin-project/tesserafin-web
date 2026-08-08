import loading from 'components/loading/loading';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Dashboard from 'utils/dashboard';
import { toTesserafinApi } from 'utils/jellyfin-apiclient/compat';

import { createContentPack } from 'apps/modern/features/contentPacks/adapters/contentPacksApi';
import { ContentPackBrowsingPreference } from 'apps/modern/features/contentPacks/adapters/browsingPreference';
import { saveBrowsingPreference } from 'apps/modern/features/contentPacks/adapters/saveBrowsingPreference';
import { SUGGESTED_CONTENT_PACK_NAMES } from 'apps/modern/features/contentPacks/constants/suggestedPacks';

import 'styles/dashboard.scss';
import 'elements/emby-input/emby-input';
import 'elements/emby-button/emby-button';
import 'elements/emby-checkbox/emby-checkbox';
import 'elements/emby-radio/emby-radio';

/**
 * Packs this attempt has already created on the server, keyed by the name that was sent.
 *
 * The retry contract (#139 gate 1) is that pressing Next again after a partial failure finishes the
 * job rather than doubling it. Names in here are skipped on the next submit, so a run where four of
 * six writes succeeded issues two writes on retry, not six.
 */
const createdNames = new Set();
let submitPending = false;

/**
 * The step's own state, and the reason the rows are not simply read back out of the DOM.
 *
 * Adding or removing a pack re-renders the whole list. If selections and edited names lived only in
 * the inputs, that re-render would silently discard them — tick three suggestions, rename one, add a
 * pack of your own, and the three ticks and the rename would be gone. So the DOM is synchronised
 * back into here before every structural change, and the list is rendered from here afterwards.
 *
 * `key` is the name the row was created with and never changes; it is what addresses a row after it
 * has been renamed.
 */
let rows = [];

const rowKey = (name) => name.trim().toLowerCase();

function initRows() {
    rows = SUGGESTED_CONTENT_PACK_NAMES.map((name) => ({
        key: name,
        name,
        // Suggestions start unticked so that "select none" is the resting state, not an action.
        selected: false,
        custom: false
    }));
}

/** Pull the live inputs back into `rows` before anything re-renders. */
function syncFromDom(view) {
    const elements = view.querySelectorAll('.wizardPackRow');
    elements.forEach((element, index) => {
        const row = rows[index];
        if (!row) return;
        row.name = element.querySelector('.txtPackName').value;
        row.selected = element.querySelector('.chkPack').checked;
    });
}

function renderRows(view) {
    const container = view.querySelector('.wizardPackRows');
    container.innerHTML = '';

    const append = (entry, index) => {
        const { name, key, custom: isCustom, selected } = entry;
        const id = `${isCustom ? 'custom' : 'suggested'}Pack${index}`;
        const row = document.createElement('div');
        row.className = 'wizardPackRow checkboxContainer';
        row.dataset.custom = String(isCustom);
        // Addressable by the name the row STARTED with, so a spec (or a person reading the DOM)
        // can still find a row after it has been renamed.
        row.dataset.pack = key;

        const label = document.createElement('label');
        label.className = 'wizardPackToggle';

        const checkbox = document.createElement('input');
        checkbox.setAttribute('is', 'emby-checkbox');
        checkbox.type = 'checkbox';
        checkbox.className = 'chkPack';
        checkbox.id = `${id}Selected`;
        checkbox.checked = selected;

        const labelText = document.createElement('span');
        labelText.textContent = name;

        label.appendChild(checkbox);
        label.appendChild(labelText);

        const nameInput = document.createElement('input');
        nameInput.setAttribute('is', 'emby-input');
        nameInput.type = 'text';
        nameInput.className = 'txtPackName';
        nameInput.id = `${id}Name`;
        nameInput.value = name;
        nameInput.autocomplete = 'off';
        nameInput.setAttribute(
            'aria-label',
            `${globalize.translate('LabelContentPackNameField')} — ${name}`
        );

        row.appendChild(label);
        row.appendChild(nameInput);

        if (isCustom) {
            const remove = document.createElement('button');
            remove.setAttribute('is', 'emby-button');
            remove.type = 'button';
            remove.className = 'btnRemoveCustomPack';
            remove.dataset.index = String(index);
            remove.setAttribute(
                'aria-label',
                `${globalize.translate('Delete')} — ${name}`
            );
            remove.textContent = globalize.translate('Delete');
            row.appendChild(remove);
        }

        container.appendChild(row);
    };

    rows.forEach((entry, index) => {
        append(entry, index);
    });

    updateNoneSelectedHint(view);
}

function selectedNames(view) {
    const names = [];
    const seen = new Set();

    for (const row of view.querySelectorAll('.wizardPackRow')) {
        if (!row.querySelector('.chkPack').checked) continue;

        const name = row.querySelector('.txtPackName').value.trim();
        if (!name || seen.has(rowKey(name))) continue;

        seen.add(rowKey(name));
        names.push(name);
    }

    return names;
}

function updateNoneSelectedHint(view) {
    const hint = view.querySelector('.wizardPacksNoneSelected');
    hint.classList.toggle('hide', selectedNames(view).length > 0);
}

function selectedPreference(view) {
    return view.querySelector('#radioContentPackFirst').checked
        ? ContentPackBrowsingPreference.ContentPackFirst
        : ContentPackBrowsingPreference.MediaFamilyFirst;
}

function clearError(view) {
    const error = view.querySelector('.wizardPacksError');
    error.textContent = '';
    error.classList.add('hide');
}

function showError(view, message) {
    const error = view.querySelector('.wizardPacksError');
    error.textContent = message;
    error.classList.remove('hide');
    error.focus();
}

function nextWizardPage() {
    Dashboard.navigate('wizard/settings').catch((err) => {
        console.error('[Wizard > Packs] error navigating to settings', err);
    });
}

/**
 * Creates the selected packs, records the arrangement, and only then advances.
 *
 * Selecting nothing is a first-class outcome: `names` is empty, no `POST /ContentPacks` is issued at
 * all, and the step still writes the arrangement and moves on. The two writes are deliberately not
 * collapsed into one "seed" call — there is no such endpoint, and inventing one would put a
 * first-run-shaped API on a server that correctly has none.
 */
async function submit(view) {
    if (submitPending) return;
    submitPending = true;

    clearError(view);
    loading.show();

    const apiClient = ServerConnections.currentApiClient();
    const api = toTesserafinApi(apiClient);
    const names = selectedNames(view);

    let failed = 0;
    for (const name of names) {
        if (createdNames.has(rowKey(name))) continue;

        try {
            await createContentPack(api, { Name: name });
            createdNames.add(rowKey(name));
        } catch (err) {
            failed += 1;
            console.warn('[Wizard > Packs] pack creation failed', err);
        }
    }

    if (failed > 0) {
        loading.hide();
        submitPending = false;
        showError(view, globalize.translate('MessageContentPackCreateFailed'));
        return;
    }

    try {
        const userId = apiClient.getCurrentUserId();
        await saveBrowsingPreference(
            apiClient,
            userId,
            selectedPreference(view)
        );
    } catch (err) {
        console.warn('[Wizard > Packs] browsing preference save failed', err);
        loading.hide();
        submitPending = false;
        showError(
            view,
            globalize.translate('MessageBrowsingArrangementSaveFailed')
        );
        return;
    }

    loading.hide();
    submitPending = false;
    nextWizardPage();
}

export default function (view) {
    view.querySelector('.wizardPacksForm').addEventListener('submit', (e) => {
        e.preventDefault();
        submit(view).catch((err) => {
            console.error('[Wizard > Packs] unexpected submit failure', err);
        });
        return false;
    });

    view.querySelector('.btnAddCustomPack').addEventListener('click', () => {
        const input = view.querySelector('#txtCustomPackName');
        const name = input.value.trim();
        if (!name) return;

        syncFromDom(view);
        // A pack the household typed itself is selected by definition: it exists because they asked
        // for it.
        rows.push({ key: name, name, selected: true, custom: true });
        input.value = '';
        renderRows(view);
        input.focus();
    });

    view.querySelector('.wizardPackRows').addEventListener('click', (e) => {
        const remove = e.target.closest?.('.btnRemoveCustomPack');
        if (!remove) return;

        syncFromDom(view);
        rows.splice(Number(remove.dataset.index), 1);
        renderRows(view);
    });

    view.querySelector('.wizardPackRows').addEventListener('change', () =>
        updateNoneSelectedHint(view)
    );
    view.querySelector('.wizardPackRows').addEventListener('input', () =>
        updateNoneSelectedHint(view)
    );

    view.addEventListener('viewshow', function () {
        submitPending = false;
        document
            .querySelector('.skinHeader')
            .classList.add('noHomeButtonHeader');
        if (rows.length === 0) initRows();
        renderRows(view);
        loading.hide();
    });

    view.addEventListener('viewhide', function () {
        document
            .querySelector('.skinHeader')
            .classList.remove('noHomeButtonHeader');
    });
}

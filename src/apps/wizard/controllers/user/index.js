import loading from 'components/loading/loading';
import toast from 'components/toast/toast';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Dashboard from 'utils/dashboard';

import 'styles/dashboard.scss';
import 'elements/emby-input/emby-input';
import 'elements/emby-button/emby-button';

/**
 * Guards against a second submission while either the startup-user write or the authentication
 * that follows it is still in flight. `loading.show()` is a spinner, not a latch: without this a
 * double click sends `Startup/User` twice, and the retry path below would be entered twice.
 */
let submitPending = false;

function nextWizardPage() {
    Dashboard.navigate('wizard/library').catch((err) => {
        console.error('[Wizard > User] error navigating to library setup', err);
    });
}

function clearError(form) {
    const error = form.querySelector('.wizardUserError');
    error.textContent = '';
    error.classList.add('hide');
}

/**
 * Shows an actionable failure on the user step and puts focus on it. The step stays where it is —
 * the account may already exist server-side, so bouncing the operator forward or backward would
 * hide the one screen from which the situation is recoverable.
 */
function showError(form, message) {
    const error = form.querySelector('.wizardUserError');
    error.textContent = message;
    error.classList.remove('hide');
    error.focus();
}

async function readErrorMessage(response) {
    try {
        return await response.text();
    } catch {
        return '';
    }
}

/**
 * Creates the first user, then signs it in through the ordinary authentication API.
 *
 * The wizard needs an authenticated session from here on: the seeding step writes content packs and
 * the browsing preference through ordinary authenticated endpoints, and the server has no
 * onboarding-specific surface for either. The credentials used are the ones the operator just typed;
 * they live in the two locals below and nowhere else. Nothing writes them to storage, to the URL or
 * to a log line, and neither the password nor the returned token is ever put in the DOM.
 *
 * The session is installed exactly the way the login page installs it — `authenticateUserByName`
 * followed by `Dashboard.onServerChanged` — so there is no second, wizard-only token store to keep
 * in sync. `ConnectionRequired level='wizard'` gates on the startup wizard being incomplete rather
 * than on there being no user, so the remaining wizard routes stay reachable with a session in hand,
 * and `FirstTimeSetupHandler` judges an administrator token through its role branch.
 */
async function submit(form) {
    if (submitPending) return;
    submitPending = true;

    const username = form.querySelector('#txtUsername').value.trim();
    const password = form.querySelector('#txtManualPassword').value;

    clearError(form);
    loading.show();

    const apiClient = ServerConnections.currentApiClient();

    try {
        await apiClient.ajax({
            type: 'POST',
            data: JSON.stringify({ Name: username, Password: password }),
            url: apiClient.getUrl('Startup/User'),
            contentType: 'application/json'
        });
    } catch (response) {
        // The account was not created. Do not attempt to authenticate: there is nothing to
        // authenticate against, and a login attempt here would only produce a second, misleading
        // error.
        console.warn(
            '[Wizard > User] user update failed:',
            await readErrorMessage(response)
        );
        loading.hide();
        showError(form, globalize.translate('ErrorDefault'));
        toast(globalize.translate('ErrorDefault'));
        submitPending = false;
        return;
    }

    try {
        const result = await apiClient.authenticateUserByName(
            username,
            password
        );
        Dashboard.onServerChanged(
            result.User.Id,
            result.AccessToken,
            apiClient
        );
    } catch (response) {
        // The account exists but the session does not. Staying here is deliberate: submitting again
        // updates the same first user rather than creating a second one, because `Startup/User`
        // renames and re-passwords the existing account.
        console.warn('[Wizard > User] authentication after setup failed');
        loading.hide();
        form.querySelector('#txtManualPassword').value = '';
        form.querySelector('#txtPasswordConfirm').value = '';
        showError(
            form,
            globalize.translate(
                response?.status === 401
                    ? 'WizardUserSignInInvalid'
                    : 'WizardUserSignInFailed'
            )
        );
        submitPending = false;
        return;
    }

    loading.hide();
    submitPending = false;
    nextWizardPage();
}

function onSubmit(e) {
    const form = this;

    e.preventDefault();

    if (
        form.querySelector('#txtManualPassword').value !=
        form.querySelector('#txtPasswordConfirm').value
    ) {
        toast(globalize.translate('PasswordMatchError'));
        return false;
    }

    submit(form).catch((err) => {
        console.error('[Wizard > User] unexpected submit failure', err);
    });

    return false;
}

function onViewShow() {
    loading.show();
    const page = this;
    const apiClient = ServerConnections.currentApiClient();
    apiClient.getJSON(apiClient.getUrl('Startup/User')).then(function (user) {
        page.querySelector('#txtUsername').value = user.Name || '';
        // The password is deliberately not repopulated. `Startup/User` answers with the name only,
        // and a password field that filled itself from anywhere would be a credential the operator
        // did not just type.
        loading.hide();
    });
}

export default function (view) {
    view.querySelector('.wizardUserForm').addEventListener('submit', onSubmit);
    view.addEventListener('viewshow', function () {
        submitPending = false;
        document
            .querySelector('.skinHeader')
            .classList.add('noHomeButtonHeader');
    });
    view.addEventListener('viewhide', function () {
        document
            .querySelector('.skinHeader')
            .classList.remove('noHomeButtonHeader');
    });
    view.addEventListener('viewshow', onViewShow);
}

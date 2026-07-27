import { expect, request, test, type Page } from '@playwright/test';

/**
 * B1 (#54) — authentication and session, through the real product UI.
 *
 * #54's gate names "authentication (login/logout/session)" and "consistent error
 * handling (network/auth/playback failures surface actionable messages)". Before this
 * file the suite proved neither: every other spec signs in with GOOD credentials in a
 * `beforeEach` and never looks at the failure path, and nothing signs OUT at all.
 *
 * The four things B1 asks about a REJECTED login are each asserted separately, because
 * they fail independently:
 *
 *   1. no session is created           — the app stays on /login and an authenticated
 *                                        route still bounces back to it;
 *   2. a visible error replaces the    — the toast is on screen AND the loading
 *      indefinite loading state          indicator is gone;
 *   3. the rejected credentials are    — neither the browser console nor the server's
 *      not echoed into diagnostics       own /System/Logs contains the password;
 *   4. recovery needs no manual        — the immediately following correct login, in
 *      storage clearing                  the SAME browser context, reaches /home.
 *
 * ON ASSERTION STYLE. The login error is a `toast()` — `src/components/toast/toast.ts`
 * builds a `div.toast` inside `div.toastContainer` and removes it after ~3.6 s. It carries
 * no ARIA role, so there is no role to select on; `.toastContainer .toast` is the
 * component's own structural contract and is what this file uses. The TEXT is matched
 * loosely and in both shipped locales rather than pinned to a whole translated sentence:
 * what B1 requires is that the message identifies bad credentials, not that it keeps a
 * particular wording. That the toast is not announced to assistive technology is a real
 * finding, but it is an accessibility one and belongs to B2 (#55), not here.
 *
 * ON THE ABSENCE OF A `beforeEach` LOGIN. Every test in this file drives the login form
 * itself, because the login form is the subject. Playwright gives each test a fresh
 * browser context, so a test that signs out cannot leak that state into the next one.
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

/**
 * A password that is wrong, and recognisable. It is deliberately a single distinctive
 * token so the "must not be echoed" assertions below can search for it verbatim without
 * matching anything the server would legitimately write.
 */
const WRONG_PASSWORD = 'zzq-b1-rejected-secret-7413';

const AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-auth", Version="0.0.0"';

/** The login form, as the login controller renders it (`session/login/index.html`). */
const loginForm = (page: Page) => ({
    name: page.locator('#txtManualName:visible'),
    password: page.locator('#txtManualPassword:visible'),
    submit: page.locator('button[type="submit"]:visible').first()
});

/** The toast component's own structure — see the header for why this and not a role. */
const toast = (page: Page) => page.locator('.toastContainer .toast');

/**
 * The app's loading indicator, in its ACTIVE state.
 *
 * `components/loading/loading.ts` creates one `div.docspinner.mdl-spinner`, appends it to
 * the body and never removes it: `show()` adds `mdlSpinnerActive` and `hide()` removes it.
 * So the element's mere presence means nothing, and selecting on `.docspinner` alone finds
 * a spinner on every page forever. `mdlSpinnerActive` is the product's own "I am waiting"
 * state, and its absence is what "the indefinite loading was replaced" actually means.
 */
const activeSpinner = (page: Page) =>
    page.locator('.docspinner.mdlSpinnerActive');

async function gotoLogin(page: Page) {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), 'the server did not serve the SPA').toBeTruthy();
    await expect(
        loginForm(page).name,
        'the SPA never rendered the login form'
    ).toBeVisible({ timeout: 30_000 });
}

async function signIn(page: Page, user: string, password: string) {
    const form = loginForm(page);
    await form.name.fill(user);
    await form.password.fill(password);
    await form.submit.click();
}

/**
 * The server's own account, read over the real `/System/Logs` API. Used only to prove an
 * ABSENCE (the rejected password), so a rig whose log endpoint is unavailable would make
 * this assertion vacuous — hence the status is asserted rather than tolerated.
 */
async function readServerLog(): Promise<string> {
    const api = await request.newContext({ baseURL: BASE_URL });
    try {
        const auth = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        expect(
            auth.ok(),
            'the admin credentials must authenticate so the server log can be read'
        ).toBe(true);
        const token = `${AUTH_HEADER}, Token="${(await auth.json()).AccessToken}"`;

        const list = await api.get('/System/Logs', {
            headers: { Authorization: token }
        });
        expect(list.status(), 'GET /System/Logs must answer 200').toBe(200);
        const files = (await list.json()) as {
            Name: string;
            DateModified: string;
        }[];
        expect(
            files.length,
            'the server must be writing at least one log file'
        ).toBeGreaterThan(0);
        const newest = [...files].sort((a, b) =>
            String(a.DateModified).localeCompare(String(b.DateModified))
        )[files.length - 1];
        const content = await api.get('/System/Logs/Log', {
            params: { name: newest.Name },
            headers: { Authorization: token }
        });
        expect(
            content.status(),
            `GET /System/Logs/Log?name=${newest.Name} must answer 200`
        ).toBe(200);
        return await content.text();
    } finally {
        await api.dispose();
    }
}

test.describe('authentication failure (B1)', () => {
    test('invalid credentials create no session, and an authenticated route still bounces to login', async ({
        page
    }) => {
        await gotoLogin(page);

        const rejected = page.waitForResponse(
            (res) =>
                /\/users\/authenticatebyname/i.test(res.url()) &&
                res.status() >= 400,
            { timeout: 20_000 }
        );
        await signIn(page, USER, WRONG_PASSWORD);
        const response = await rejected;

        // 401 is the contract for a bad password. Asserting the class rather than the exact
        // code would let a 500 — a server fault, not a rejection — pass as "handled".
        expect(
            response.status(),
            'a wrong password must be rejected with 401, not with a server error'
        ).toBe(401);

        // No session: the app never left /login …
        await expect(page).toHaveURL(/#\/login/);

        // … and asking for an authenticated route directly comes straight back. This is the
        // real proof: a token that was quietly stored would let /home render.
        await page.goto('/#/home');
        await expect(
            page,
            'a rejected login must not leave a usable session behind'
        ).toHaveURL(/#\/login/, { timeout: 20_000 });
    });

    test('a visible error replaces the loading state, and the password field is cleared', async ({
        page
    }) => {
        await gotoLogin(page);
        await signIn(page, USER, WRONG_PASSWORD);

        const message = toast(page);
        await expect(
            message,
            'a rejected login must put a visible message on screen'
        ).toBeVisible({ timeout: 15_000 });

        // The message must IDENTIFY the failure, not merely exist. Matched loosely and in
        // both shipped locales — see the file header on why not a whole sentence.
        await expect(
            message,
            'the message must name the credentials as the problem'
        ).toHaveText(
            /(invalid|incorrect|invalide|incorrect)[\s\S]*(user|password|utilisateur|mot de passe)|(user|password|utilisateur|mot de passe)[\s\S]*(invalid|incorrect|invalide)/i
        );

        // "Replaces the indefinite loading" — the spinner is gone, and the form is usable.
        await expect(
            activeSpinner(page),
            'the loading indicator must not still be active behind the error'
        ).toHaveCount(0);
        await expect(loginForm(page).submit).toBeEnabled();

        // The login controller clears the password on failure; retyping must not append to
        // the rejected one.
        await expect(loginForm(page).password).toHaveValue('');
    });

    test('the rejected password is not echoed into the browser console or the server log', async ({
        page
    }) => {
        const consoleText: string[] = [];
        page.on('console', (msg) => consoleText.push(msg.text()));
        page.on('pageerror', (err) => consoleText.push(String(err)));

        await gotoLogin(page);
        const rejected = page.waitForResponse(
            (res) =>
                /\/users\/authenticatebyname/i.test(res.url()) &&
                res.status() >= 400,
            { timeout: 20_000 }
        );
        await signIn(page, USER, WRONG_PASSWORD);
        await rejected;
        await expect(toast(page)).toBeVisible({ timeout: 15_000 });

        expect(
            consoleText.filter((line) => line.includes(WRONG_PASSWORD)),
            'the rejected password must not reach the browser console'
        ).toEqual([]);

        const log = await readServerLog();
        expect(
            log.includes(WRONG_PASSWORD),
            'the rejected password must not be written to the server log'
        ).toBe(false);
        // The username is not a secret, but a log line that quotes the whole attempt is one
        // step from quoting the password too. The server logs "Invalid username or password
        // entered." without either, and that is the shape this pins.
        expect(
            log.includes(`Pw=${WRONG_PASSWORD}`) ||
                log.includes(`"Pw":"${WRONG_PASSWORD}"`),
            'the server log must not contain the submitted credential pair'
        ).toBe(false);
    });

    test('a correct login immediately afterwards succeeds, with no manual storage clearing', async ({
        page
    }) => {
        await gotoLogin(page);
        await signIn(page, USER, WRONG_PASSWORD);
        await expect(toast(page)).toBeVisible({ timeout: 15_000 });

        // Same page, same browser context, nothing cleared: exactly what a real user does.
        const accepted = page.waitForResponse(
            (res) =>
                /\/users\/authenticatebyname/i.test(res.url()) &&
                res.status() < 400,
            { timeout: 20_000 }
        );
        await signIn(page, USER, PASSWORD);
        await accepted;

        await page.waitForURL('**/#/home**', { timeout: 20_000 });
        await expect(
            page.getByRole('tab', { name: /accueil|home/i }),
            'the recovered login must reach the real home shell, not a blank route'
        ).toBeVisible({ timeout: 30_000 });
    });
});

test.describe('session lifecycle (B1)', () => {
    test('logout makes authenticated content inaccessible, and a fresh login restores the library', async ({
        page
    }) => {
        await gotoLogin(page);
        const accepted = page.waitForResponse(
            (res) =>
                /\/users\/authenticatebyname/i.test(res.url()) &&
                res.status() < 400,
            { timeout: 20_000 }
        );
        await signIn(page, USER, PASSWORD);
        await accepted;
        await page.waitForURL('**/#/home**', { timeout: 20_000 });
        await expect(
            page.getByRole('tab', { name: /accueil|home/i })
        ).toBeVisible({ timeout: 30_000 });

        // What the user can reach BEFORE signing out, re-checked identically afterwards.
        // Read from the real product surface — the library link the shell renders — rather
        // than from the API, so this is library state as the product presents it. The link's
        // TARGET is what gets compared, not its label: the same library id on both sides is
        // a much stronger statement than "something called Movies is on screen again".
        const moviesLink = page.getByRole('link', { name: /^Movies$/ });
        await expect(
            moviesLink.first(),
            'the seeded Movies library must be reachable before signing out'
        ).toBeAttached({ timeout: 30_000 });
        const libraryHrefBefore = await moviesLink.first().getAttribute('href');
        expect(
            libraryHrefBefore,
            'the Movies link must address a library route'
        ).toMatch(/#\/library\/[0-9a-f]{32}/);

        // Sign out through the real user menu — the only route a user has.
        await page
            .getByRole('button', { name: /user menu|menu utilisateur/i })
            .click();
        await page
            .getByRole('menuitem', { name: /sign out|se déconnecter|déconnexion/i })
            .click();

        await expect(
            page,
            'signing out must return to the login screen'
        ).toHaveURL(/#\/login/, { timeout: 20_000 });

        // Authenticated content is genuinely gone, not merely navigated away from.
        await page.goto('/#/home');
        await expect(
            page,
            'after signing out, an authenticated route must not render'
        ).toHaveURL(/#\/login/, { timeout: 20_000 });

        // Fresh login, same context: the library is where it was.
        const reaccepted = page.waitForResponse(
            (res) =>
                /\/users\/authenticatebyname/i.test(res.url()) &&
                res.status() < 400,
            { timeout: 20_000 }
        );
        await expect(loginForm(page).name).toBeVisible({ timeout: 20_000 });
        await signIn(page, USER, PASSWORD);
        await reaccepted;
        await page.waitForURL('**/#/home**', { timeout: 20_000 });
        await expect(
            page.getByRole('tab', { name: /accueil|home/i })
        ).toBeVisible({ timeout: 30_000 });
        await expect(
            moviesLink.first(),
            'the library present before signing out must still be present after signing back in'
        ).toBeAttached({ timeout: 30_000 });
        expect(
            await moviesLink.first().getAttribute('href'),
            'the fresh session must land on the SAME library, not merely on one with the same name'
        ).toBe(libraryHrefBefore);
    });
});

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * B1 (#54) — network/server failure, through the real product UI.
 *
 * #54 requires that "network/auth/playback failures surface actionable messages". Nothing
 * in the suite exercised the network class before this file: every other spec runs against
 * a healthy server and would not notice an endless spinner.
 *
 * WHY REQUEST INTERCEPTION AND NOT A STOPPED CONTAINER. The rig's server is shared by the
 * whole single-worker suite; stopping it here would take every following spec down with
 * it. Interception is also the more precise instrument: it cuts the API and nothing else,
 * which is exactly the failure a user hits when the server goes away while their browser
 * still holds the loaded application. `route.abort('connectionrefused')` is the same
 * network error the browser raises for a server that is not listening.
 *
 * WHAT IS ALLOWED THROUGH. The SPA's own assets, so the failure under test is "the server
 * is unreachable", not "the page never loaded" — a blank page from a killed document is a
 * browser condition, not a product state, and asserting on it would prove nothing about
 * error handling.
 *
 * ON "BOUNDED". The assertion is a real deadline, not a courtesy: the visible state must
 * be reached within {@link RECOVERY_BUDGET_MS}. An indefinite spinner is precisely a state
 * that never arrives, so a generous-but-finite budget is what tells the two apart.
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';

/** How long the product gets to reach a visible failure state before this spec calls it stuck. */
const RECOVERY_BUDGET_MS = 45_000;

/** Requests the SPA needs in order to BE loaded. Everything else is API traffic. */
const STATIC_ASSET = /\.(js|mjs|css|html|png|jpe?g|svg|ico|woff2?|ttf|map|json)(\?|$)/i;

const loginForm = (page: Page) => ({
    name: page.locator('#txtManualName:visible'),
    password: page.locator('#txtManualPassword:visible'),
    submit: page.locator('button[type="submit"]:visible').first()
});

/** See auth-session.spec.ts: the element persists; only `mdlSpinnerActive` means "waiting". */
const activeSpinner = (page: Page) =>
    page.locator('.docspinner.mdlSpinnerActive');

async function signIn(page: Page) {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), 'the server did not serve the SPA').toBeTruthy();
    await expect(loginForm(page).name).toBeVisible({ timeout: 30_000 });
    const accepted = page.waitForResponse(
        (res) =>
            /\/users\/authenticatebyname/i.test(res.url()) && res.status() < 400,
        { timeout: 20_000 }
    );
    await loginForm(page).name.fill(USER);
    await loginForm(page).password.fill(PASSWORD);
    await loginForm(page).submit.click();
    await accepted;
    await page.waitForURL('**/#/home**', { timeout: 20_000 });
    await expect(
        page.getByRole('tab', { name: /accueil|home/i })
    ).toBeVisible({ timeout: 30_000 });
}

/**
 * Cuts every API request.
 *
 * The document itself and the SPA's static assets pass. Aborting the document instead
 * fails the navigation with `net::ERR_CONNECTION_REFUSED` before any product code runs —
 * that is the browser's error page, not Tesserafin's, and asserting on it would prove
 * nothing about how the product handles an unreachable server. What this models is the
 * real shape of the failure: the application is loaded and running, and every call it
 * makes to its server is refused.
 */
const cutTheServer = (route: Route) => {
    const request = route.request();
    if (
        request.resourceType() === 'document' ||
        STATIC_ASSET.test(new URL(request.url()).pathname)
    ) {
        return route.continue();
    }
    return route.abort('connectionrefused');
};

test.describe('network/server failure (B1)', () => {
    test('an unreachable server reaches a bounded visible state, and never an endless spinner', async ({
        page
    }, testInfo) => {
        await signIn(page);

        await page.route('**/*', cutTheServer);
        await page.reload({ waitUntil: 'domcontentloaded' });

        // The product must SAY something. Which surface says it is the product's choice —
        // the standalone connection-error page, or an error state inside the shell — so the
        // assertion is on reaching a visible failure, not on one particular component.
        const failureSurface = page
            .locator('#connectionErrorPage')
            .or(page.locator('[data-rf-slot="state-error"]'))
            .or(page.locator('.toastContainer .toast'))
            .first();
        await expect(
            failureSurface,
            'an unreachable server must produce a visible state within the budget, not an endless wait'
        ).toBeVisible({ timeout: RECOVERY_BUDGET_MS });

        // Not stuck behind it.
        await expect(
            activeSpinner(page),
            'the loading indicator must not still be active once the failure is on screen'
        ).toHaveCount(0);

        // Not blank: something is genuinely rendered.
        const bodyText = ((await page.locator('body').innerText()) || '').trim();
        expect(
            bodyText.length,
            'the failure state must not be a blank page'
        ).toBeGreaterThan(0);

        testInfo.annotations.push({
            type: 'network-failure-surface',
            description: bodyText.slice(0, 400)
        });

        // Nothing sensitive on screen. The password is the obvious one; `/config`, `/cache`
        // and `/media` are the container's internal mount points, and an error that quotes a
        // server path tells a user things they have no business seeing.
        expect(
            bodyText,
            'the error must not contain the password'
        ).not.toContain(PASSWORD);
        for (const internalPath of ['/config/', '/cache/', '/media/']) {
            expect(
                bodyText,
                `the error must not expose the server-internal path ${internalPath}`
            ).not.toContain(internalPath);
        }
        expect(
            /api[_-]?key|accesstoken|token="/i.test(bodyText),
            'the error must not display an API key or access token'
        ).toBe(false);
    });

    test('the same server becoming reachable again recovers the session, with nothing cleared', async ({
        page
    }) => {
        await signIn(page);

        await page.route('**/*', cutTheServer);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(
            page
                .locator('#connectionErrorPage')
                .or(page.locator('[data-rf-slot="state-error"]'))
                .or(page.locator('.toastContainer .toast'))
                .first(),
            'the failure state must be reached before recovery can be claimed'
        ).toBeVisible({ timeout: RECOVERY_BUDGET_MS });

        // The server comes back. Browser storage is untouched — no context reset, no
        // localStorage clearing — which is the whole point: a user does not clear site data
        // to recover from their server having been down.
        await page.unroute('**/*');
        await page.goto('/#/home');

        await expect(
            page.getByRole('tab', { name: /accueil|home/i }),
            'recovery must reach the real home shell again without clearing browser data'
        ).toBeVisible({ timeout: RECOVERY_BUDGET_MS });
        await expect(
            page.getByRole('link', { name: /^Movies$/ }).first(),
            'the library must be browsable again after recovery'
        ).toBeAttached({ timeout: RECOVERY_BUDGET_MS });
    });
});

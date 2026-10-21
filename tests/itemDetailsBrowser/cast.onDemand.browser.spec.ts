import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
    administrator,
    installFixtureApi,
    USER_A
} from '../m3Browser/support/fixtureApi';

const DIST = resolve(__dirname, '../../dist');
const SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js';
const requestedThemes = new WeakMap<Page, string>();
const SDK_STUB = `(() => {
    const proof = window.__castProof = { initialized: 0, pickers: 0 };
    window.chrome = window.chrome || {};
    window.chrome.cast = {
        isAvailable: true,
        SessionRequest: function(id) { this.id = id; },
        ApiConfig: function(request, session, receiver) { this.receiver = receiver; },
        initialize: function(config, success) {
            proof.initialized++; success(); config.receiver('available');
        },
        requestSession: function(success) {
            proof.pickers++;
            success({sessionId:'fixture-session', receiver:{friendlyName:'Fixture TV'}, media:[],
                addMessageListener(){}, addMediaListener(){}, addUpdateListener(){}, sendMessage(){}});
        }
    };
})();`;

async function setup(
    page: Page,
    origin: string,
    theme: string,
    layout = 'desktop',
    preference = ''
) {
    requestedThemes.set(page, theme);
    const fixture = await installFixtureApi(page, origin, DIST, {
        signedIn: true,
        wizardCompleted: true,
        currentUserId: USER_A,
        packs: [],
        users: [
            administrator({
                configuration: { CastReceiverId: 'fixture-receiver' }
            })
        ],
        theme,
        layout: layout as 'desktop'
    });
    await page.addInitScript((value) => {
        if (value) localStorage.setItem('autocastPlayerId', value);
        else localStorage.removeItem('autocastPlayerId');
    }, preference);
    // Explicit transport fixture: household sessions are empty and ticketing is
    // unavailable. This is not a receiver/server-authorization acceptance test.
    let failure = '';
    await page.route('**/*', async (route) => {
        const u = new URL(route.request().url());
        const path = u.pathname.toLowerCase();
        if (u.origin !== origin) return route.fallback();
        if (
            route.request().resourceType() === 'document' &&
            failure !== 'csp'
        ) {
            // The reused reader server has a self-only script policy. Positive
            // SDK fixtures permit only this exact fixture URL; production CSP and
            // the reader server remain unchanged. A separate case retains it.
            const response = await route.fetch();
            const headers = response.headers();
            headers['content-security-policy'] = headers[
                'content-security-policy'
            ].replace("script-src 'self'", `script-src 'self' ${SDK}`);
            return route.fulfill({ response, headers });
        }
        if (path === '/sessions' && route.request().method() === 'GET')
            return route.fulfill({ json: [] });
        if (path === '/websocket/tickets')
            return route.fulfill({ status: 503 });
        return route.fallback();
    });
    let requests = 0;
    await page.route(SDK, async (route) => {
        requests++;
        if (failure === 'blocked') return route.abort('failed');
        return route.fulfill({
            contentType: 'text/javascript',
            body: failure === 'stalled' ? '/* SDK not ready */' : SDK_STUB
        });
    });
    return {
        fixture,
        requests: () => requests,
        fail: (value: string) => {
            failure = value;
        }
    };
}
async function open(page: Page) {
    await expect(page.locator('html')).toHaveAttribute(
        'data-rf-theme',
        requestedThemes.get(page)!,
        { timeout: 15000 }
    );
    const button = page
        .getByRole('button', { name: 'Cast to Device', exact: true })
        .first();
    await expect(button).toBeVisible();
    await button.click();
}
const castTarget = (page: Page) =>
    page
        .getByRole('menuitem', { name: /Google Cast/ })
        .or(page.getByRole('button', { name: 'Google Cast', exact: true }));

for (const theme of ['official.classic', 'official.glass']) {
    for (const layout of ['desktop', 'desktop-legacy']) {
        test(`${theme} ${layout}: startup is quiet, menu discovers once and the picker still pairs`, async ({
            page,
            baseURL
        }) => {
            const state = await setup(page, baseURL!, theme, layout);
            await page.goto('/#/home');
            await expect(
                page
                    .getByRole('button', {
                        name: 'Cast to Device',
                        exact: true
                    })
                    .first()
            ).toBeVisible();
            expect(state.requests()).toBe(0);
            await expect(
                page.locator('script[src*="gstatic.com"]')
            ).toHaveCount(0);
            await open(page);
            await expect(castTarget(page).first()).toBeVisible();
            expect(state.requests()).toBe(1);
            await page.keyboard.press('Escape');
            await open(page);
            await castTarget(page).first().click();
            await expect
                .poll(() =>
                    page.evaluate(() => (window as any).__castProof?.pickers)
                )
                .toBe(1);
            expect(state.requests()).toBe(1);
            expect(
                await page.evaluate(
                    () => (window as any).__castProof.initialized
                )
            ).toBe(1);
            expect(state.fixture.ledger.undeclared).toEqual([]);
        });
    }
    test(`${theme}: a blocked SDK leaves the menu usable and another action can retry`, async ({
        page,
        baseURL
    }) => {
        const state = await setup(page, baseURL!, theme);
        state.fail('blocked');
        await page.goto('/#/home');
        await open(page);
        await expect(
            page.getByText('No cast targets available', { exact: true })
        ).toBeVisible();
        expect(state.requests()).toBe(1);
        await expect(page.locator('script[src*="gstatic.com"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        state.fail('');
        await open(page);
        await expect(castTarget(page).first()).toBeVisible();
        expect(state.requests()).toBe(2);
    });
}
test('loaded-but-unavailable SDK times out and can retry without reloading the application', async ({
    page,
    baseURL
}) => {
    const state = await setup(page, baseURL!, 'official.classic');
    state.fail('stalled');
    await page.goto('/#/home');
    await open(page);
    await expect(
        page.getByText('No cast targets available', { exact: true })
    ).toBeVisible({ timeout: 12_000 });
    // The empty menu also appears while discovery is pending. Wait for the
    // bounded loader to remove its failed script before issuing a fresh action.
    await expect(page.locator('script[src*="gstatic.com"]')).toHaveCount(0, {
        timeout: 12_000
    });
    expect(state.requests()).toBe(1);
    await page.keyboard.press('Escape');
    state.fail('');
    await open(page);
    await expect(castTarget(page).first()).toBeVisible();
    expect(state.requests()).toBe(2);
});
test('saved Google Cast opt-in still reconnects on startup', async ({
    page,
    baseURL
}) => {
    const state = await setup(
        page,
        baseURL!,
        'official.classic',
        'desktop',
        'Google Cast'
    );
    await page.goto('/#/home');
    await expect
        .poll(() => page.evaluate(() => (window as any).__castProof?.pickers))
        .toBe(1);
    expect(state.requests()).toBe(1);
});
test('a different saved household target does not enable Google discovery', async ({
    page,
    baseURL
}) => {
    const state = await setup(
        page,
        baseURL!,
        'official.classic',
        'desktop',
        'household-tv'
    );
    await page.goto('/#/home');
    await expect(
        page
            .getByRole('button', { name: 'Cast to Device', exact: true })
            .first()
    ).toBeVisible();
    expect(state.requests()).toBe(0);
    await expect(page.locator('script[src*="gstatic.com"]')).toHaveCount(0);
});

test('a self-only CSP refuses the SDK cleanly without loosening that policy', async ({
    page,
    baseURL
}) => {
    const state = await setup(page, baseURL!, 'official.classic');
    state.fail('csp');
    await page.goto('/#/home');
    await open(page);
    await expect(
        page.getByText('No cast targets available', { exact: true })
    ).toBeVisible();
    expect(state.requests()).toBe(0);
    await expect(page.locator('script[src*="gstatic.com"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(
        page
            .getByRole('button', { name: 'Cast to Device', exact: true })
            .first()
    ).toBeVisible();
});

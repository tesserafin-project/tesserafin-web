import { expect, test } from './support/origin-inventory';
import { request, type Page } from '@playwright/test';

/**
 * B1 (#54) — Search, through the real product UI.
 *
 * The suite proves library browse, detail, playback and error handling, but nothing proved
 * that a user can FIND an item. #54 names Search explicitly, so this drives it the way a
 * user does: press the Search control in the app bar, type into the real field, wait for the
 * real debounced query, click the real card, and require the detail page that opens to be
 * the item that was searched for — not merely "a detail page appeared".
 *
 * DETERMINISTIC BY CONSTRUCTION. The query is a distinctive substring of a seeded rig
 * fixture ("Smoke Test Movie (2020)"), and the expected identity is resolved through the
 * API before the browser is driven, so the assertion compares the opened item's id against
 * the id the server says that title has. No reliance on result ordering, on how many cards
 * a section renders, or on the card's internal markup.
 *
 * `SearchFields` debounces by 500 ms (`useDebounceValue(query, 500)` in
 * apps/legacy/routes/search.tsx), so every wait here is on a product state, never a fixed
 * sleep.
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
const RESTRICTED_USER =
    process.env.TESSERAFIN_E2E_RESTRICTED_USER ?? 'smokerestricted';
const RESTRICTED_PASSWORD =
    process.env.TESSERAFIN_E2E_RESTRICTED_PASSWORD ?? 'restrictedpass123';
const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-search", Version="0.0.0"';

/** The Movies fixture the rig always seeds. See ci/serve-e2e.sh "MEDIA FIXTURES". */
const MOVIE_TITLE = 'Smoke Test Movie';
/** Seeded into the "Codec Probes" library, which the restricted user is NOT granted. */
const WITHHELD_TITLE = 'Remux Probe';
/** Matches nothing in either library. */
const NO_MATCH = 'zzzznosuchtitlezzzz';

interface Session {
    api: import('@playwright/test').APIRequestContext;
    token: string;
    userId: string;
}

async function apiSession(user: string, pw: string): Promise<Session> {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await api.post('/Users/AuthenticateByName', {
        headers: { Authorization: AUTH_HEADER },
        data: { Username: user, Pw: pw }
    });
    expect(auth.ok(), `${user} must authenticate`).toBe(true);
    const body = await auth.json();
    return {
        api,
        token: `${AUTH_HEADER}, Token="${body.AccessToken}"`,
        userId: String(body.User.Id)
    };
}

/** The id the SERVER says the title has — the identity the UI is then held to. */
async function idOfTitle(s: Session, title: string): Promise<string> {
    const res = await s.api.get('/Items', {
        params: {
            userId: s.userId,
            recursive: 'true',
            searchTerm: title,
            includeItemTypes: 'Movie,Video'
        },
        headers: { Authorization: s.token }
    });
    expect(res.status(), 'GET /Items must answer 200').toBe(200);
    const items = (await res.json()).Items as Array<{
        Id: string;
        Name: string;
    }>;
    const hit = items.find((i) => i.Name.includes(title));
    expect(hit, `the rig must seed an item named like "${title}"`).toBeTruthy();
    return String(hit!.Id);
}

async function signIn(page: Page, user: string, pw: string) {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), 'the server did not serve the SPA').toBeTruthy();
    const loginName = page.locator('#txtManualName:visible');
    const homeTab = page.getByRole('tab', { name: /accueil|home/i });
    await expect(loginName.or(homeTab).first()).toBeVisible({
        timeout: 25_000
    });
    if (page.url().includes('/login')) {
        const accepted = page.waitForResponse(
            (res) =>
                /\/users\/authenticatebyname/i.test(res.url()) &&
                res.status() < 400,
            { timeout: 15_000 }
        );
        await loginName.fill(user);
        await page.locator('#txtManualPassword:visible').fill(pw);
        await page.locator('button[type="submit"]:visible').first().click();
        await accepted;
        await page.waitForURL('**/#/home**', { timeout: 15_000 });
    }
    await expect(page.getByRole('tab', { name: /accueil|home/i })).toBeVisible({
        timeout: 25_000
    });
}

/**
 * Opens Search THROUGH THE REAL UI — the app bar control, not a hand-written hash. That is
 * the point of the coverage: a user must be able to reach Search, not merely be able to be
 * put there.
 */
async function openSearch(page: Page) {
    const searchControl = page
        .getByRole('link', { name: /search|rechercher/i })
        .or(page.getByRole('button', { name: /search|rechercher/i }))
        .first();
    await expect(
        searchControl,
        'the app bar must offer a Search control'
    ).toBeVisible({ timeout: 25_000 });
    await searchControl.click();
    await page.waitForURL('**/#/search**', { timeout: 15_000 });
    return page.locator('.searchFields input:visible').first();
}

test.describe('search (B1)', () => {
    test('a seeded title is findable, and its card opens that exact item', async ({
        page
    }) => {
        const s = await apiSession(USER, PASSWORD);
        try {
            const expectedId = await idOfTitle(s, MOVIE_TITLE);

            await signIn(page, USER, PASSWORD);
            const field = await openSearch(page);
            await expect(
                field,
                'the search field must be present and focusable'
            ).toBeVisible({ timeout: 15_000 });

            await field.fill(MOVIE_TITLE);

            // The query is debounced by 500 ms and then issued. Wait on the product's own
            // result state, never on a fixed delay.
            const card = page
                .locator(`.searchResults a[href*="${expectedId}"]`)
                .first();
            await expect(
                card,
                'the seeded movie must appear in the search results'
            ).toBeVisible({ timeout: 25_000 });

            // OPEN THE CARD BY KEYBOARD ACTIVATION, and not for convenience.
            //
            // `cardBuilder` renders a hover overlay (`getHoverMenuHtml`:
            // `.cardOverlayContainer.itemAction[data-action="link"]`) stacked above the
            // anchor, with a centred Resume button inside it. Two pointer routes were tried
            // against the real rig and neither expresses "open this item":
            //
            //   * `card.click()` never lands — Playwright retried 112 times, each time
            //     reporting that the overlay's `play_arrow` span intercepts pointer events;
            //   * clicking the overlay container lands on that Resume button and STARTS
            //     PLAYBACK — the run navigated to `#/video`, not to the detail page.
            //
            // Pressing Enter on the focused anchor activates the link itself. It is a real
            // user action (the keyboard path the card already supports), it is independent of
            // hover state and card geometry, and it cannot be satisfied by the play control —
            // so it asserts exactly what this test claims. `force: true` is deliberately not
            // used anywhere here: it would assert nothing about the card being reachable.
            await card.focus();
            await card.press('Enter');

            // IDENTITY, not "a detail page appeared". Both the route and the rendered
            // heading must name the item the server resolved the title to.
            await page.waitForURL(`**/#/details?id=${expectedId}**`, {
                timeout: 25_000
            });
            await expect(
                page.getByRole('heading', { level: 1 }),
                'the opened detail page must be the item that was searched for'
            ).toContainText(MOVIE_TITLE, { timeout: 25_000 });
        } finally {
            await s.api.dispose();
        }
    });

    test('a query that matches nothing reports no results rather than an empty screen', async ({
        page
    }) => {
        await signIn(page, USER, PASSWORD);
        const field = await openSearch(page);
        await field.fill(NO_MATCH);

        await expect(
            page.locator('.noItemsMessage'),
            'a search with no matches must say so'
        ).toBeVisible({ timeout: 25_000 });
        await expect(
            page.locator('.searchResults a[href*="#/details"]'),
            'a search with no matches must not still be showing result cards'
        ).toHaveCount(0);
    });

    test('search does not surface an item from a library the user was not granted', async ({
        page
    }) => {
        // The rig grants the restricted user Movies only; "Remux Probe" lives in the
        // withheld "Codec Probes" library. Admin resolves its id, then the restricted user
        // searches for it and must not be offered it.
        const adminSession = await apiSession(USER, PASSWORD);
        let withheldId: string;
        try {
            withheldId = await idOfTitle(adminSession, WITHHELD_TITLE);
        } finally {
            await adminSession.api.dispose();
        }

        await signIn(page, RESTRICTED_USER, RESTRICTED_PASSWORD);
        const field = await openSearch(page);
        await field.fill(WITHHELD_TITLE);

        // Wait on a settled state before asserting an absence: the "no results" message is
        // the product's own end state for this query, so this is not a bare sleep.
        await expect(
            page.locator('.noItemsMessage'),
            'the restricted user must be told there is nothing to show'
        ).toBeVisible({ timeout: 25_000 });
        await expect(
            page.locator(`.searchResults a[href*="${withheldId}"]`),
            'search must not surface an item from a library the user was not granted'
        ).toHaveCount(0);
    });
});

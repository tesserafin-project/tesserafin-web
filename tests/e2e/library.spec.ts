import { devices, expect, request, test } from '@playwright/test';

/**
 * `/library/<libraryId>` E2E journey (RFC-0005 §11 WP-D, movies/tvshows v1 - see
 * `src/apps/modern/features/library/components/LibraryView.tsx`). Mirrors `home.spec.ts`'s
 * patterns: env-based creds, sign in through the real login form, role/label-first selectors,
 * `data-rf-slot` as a secondary hook, no invented `data-testid`s.
 *
 * The movies library id isn't known ahead of time, so it's discovered at run time through a
 * direct API login (`POST /Users/AuthenticateByName` with a standard `MediaBrowser ...`
 * `Authorization` header - same shape `src/lib/reefin-sdk/index.ts`'s `buildAuthorizationHeader`
 * produces) followed by a `/UserViews` lookup for the user's `movies`-`CollectionType` view.
 * (The mission mentions the classic `GET /Users/{userId}/Views` alias; this server's own OpenAPI
 * surface - `src/lib/reefin-sdk/spec/openapi.json` - only lists `/UserViews`, so that's the
 * endpoint actually called here.) This API login is independent from the UI login each test does
 * in `beforeEach`; it only exists to resolve `libraryId` once for the whole file.
 *
 * Pagination (`StartIndex` <-> page) is unit-tested in `utils/pagination.test.ts` (WP-C) and not
 * re-exercised here: the smoke-test movies library has 2 items, far under the default library
 * page size of 100 (`scripts/settings/userSettings.js`'s `libraryPageSize`), so there's no second
 * page to navigate to.
 */

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const E2E_AUTH_HEADER =
    'MediaBrowser Client="Reefin Web E2E", Device="Playwright", DeviceId="reefin-e2e-library", Version="0.0.0"';

const MOVIE_TITLE = 'Smoke Test Movie';
const OTHER_MOVIE_TITLE = 'Transcode Probe';

test.describe('library', () => {
    let libraryId = '';

    test.beforeAll(async () => {
        const api = await request.newContext({ baseURL: BASE_URL });

        const authResponse = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        expect(authResponse.ok()).toBeTruthy();
        const auth = await authResponse.json();

        const viewsResponse = await api.get('/UserViews', {
            params: { userId: auth.User.Id },
            headers: {
                Authorization: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
            }
        });
        expect(viewsResponse.ok()).toBeTruthy();
        const views = await viewsResponse.json();

        const moviesView = (
            views.Items as Array<Record<string, unknown>>
        )?.find((item) => item.CollectionType === 'movies');
        if (!moviesView?.Id) {
            throw new Error(
                'No movies-type library found via /UserViews for the e2e user - cannot resolve libraryId'
            );
        }
        libraryId = String(moviesView.Id);

        await api.dispose();
    });

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        if (page.url().includes('/login')) {
            await page.locator('#txtManualName:visible').fill(USER);
            await page.locator('#txtManualPassword:visible').fill(PASSWORD);
            await page.locator('button[type="submit"]:visible').first().click();
            await page.waitForURL('**/#/home**', { timeout: 20_000 });
        }
        await page.waitForLoadState('networkidle');
    });

    test('shows the grid with both smoke-test movies', async ({ page }) => {
        await page.goto(`/#/library/${libraryId}`);
        await page.waitForLoadState('networkidle');

        await expect(
            page.locator('.rf-library-view').getByRole('heading', { level: 1 })
        ).toBeVisible();

        const grid = page.locator('[data-rf-slot="media-grid"]');
        await expect(grid).toBeVisible();
        await expect(grid.locator('[data-rf-slot="media-card"]')).toHaveCount(
            2
        );
        await expect(page.getByText(MOVIE_TITLE)).toBeVisible();
        await expect(page.getByText(OTHER_MOVIE_TITLE)).toBeVisible();
    });

    test('sort order changes the URL and flips card order (SortName asc/desc)', async ({
        page
    }) => {
        await page.goto(`/#/library/${libraryId}`);
        await page.waitForLoadState('networkidle');

        const cardTexts = () =>
            page.locator('[data-rf-slot="media-card"]').allTextContents();

        // Default state (no `sort`/`order` params): SortName ascending, so "Smoke Test Movie"
        // sorts before "Transcode Probe".
        await expect
            .poll(async () => (await cardTexts())[0])
            .toContain(MOVIE_TITLE);
        await expect
            .poll(async () => (await cardTexts())[1])
            .toContain(OTHER_MOVIE_TITLE);

        const orderSelect = page.getByRole('combobox', {
            name: /sort order|ordre de tri/i
        });
        // Select by option *value* (`SortOrder.Descending`'s wire value, not its localized
        // label) - `selectOption({ label })` only matches an exact string, not a `RegExp`, so a
        // label-regex match here would silently fail to select anything at runtime.
        await orderSelect.selectOption('Descending');

        await expect(page).toHaveURL(/order=Descending/);
        await expect
            .poll(async () => (await cardTexts())[0])
            .toContain(OTHER_MOVIE_TITLE);
        await expect
            .poll(async () => (await cardTexts())[1])
            .toContain(MOVIE_TITLE);
    });

    test('year filter round-trips through "All" without losing either card', async ({
        page
    }) => {
        // Both smoke-test items are dated 2026 (mission fixture), so no single year value can
        // exclude one of the two - a discriminating filter isn't exercisable here. Per the
        // mission's documented fallback, this instead round-trips All -> a value -> All and
        // checks the card count stays stable and the URL stays in sync throughout.
        await page.goto(`/#/library/${libraryId}`);
        await page.waitForLoadState('networkidle');

        const grid = page.locator('[data-rf-slot="media-grid"]');
        await expect(grid.locator('[data-rf-slot="media-card"]')).toHaveCount(
            2
        );

        const yearSelect = page.getByRole('combobox', {
            name: /^year$|^année$/i
        });
        // `filtersQuery` (genre/year facets) resolves independently of `itemsQuery` (cards) and
        // the select stays `disabled`/`'all'`-only until it does (`LibraryView.tsx`'s
        // `disabled={filtersQuery.isPending}`) - wait for it explicitly so the option-value read
        // below can't race a still-pending request into a spurious (silently green) `test.skip`.
        await expect(yearSelect).toBeEnabled();
        // Read option *values*, not labels: the "All" sentinel (`FILTER_ALL_VALUE`, `'all'`) and
        // every year value (`String(year)`) are wire values, not localized text, so matching on
        // them sidesteps both the locale guesswork and `selectOption({ label })`'s string-only
        // (no `RegExp`) contract.
        const yearOptionValues = await yearSelect
            .locator('option')
            .evaluateAll((options) =>
                options.map((option) => (option as HTMLOptionElement).value)
            );
        const specificYear = yearOptionValues.find((value) => value !== 'all');
        test.skip(
            !specificYear,
            'server returned no year facet for this library'
        );

        await yearSelect.selectOption(specificYear!);
        await expect(page).toHaveURL(/year=\d+/);
        await expect(grid.locator('[data-rf-slot="media-card"]')).toHaveCount(
            2
        );

        await yearSelect.selectOption('all');
        await expect(page).not.toHaveURL(/year=/);
        await expect(grid.locator('[data-rf-slot="media-card"]')).toHaveCount(
            2
        );
    });

    test('density toggle switches the grid to compact and persists across reload', async ({
        page
    }) => {
        await page.goto(`/#/library/${libraryId}`);
        await page.waitForLoadState('networkidle');

        const grid = page.locator('[data-rf-slot="media-grid"]');
        await expect(grid).toHaveClass(/rf-media-grid--comfortable/);

        const densityToggle = page.getByRole('button', { name: /density/i });
        await densityToggle.click();
        await expect(densityToggle).toHaveAttribute('aria-pressed', 'true');
        await expect(grid).toHaveClass(/rf-media-grid--compact/);

        // Strip the `?density=` param the toggle just wrote (without navigating - `replaceState`
        // doesn't reload) then force a real browser reload, so the fresh mount has nothing but
        // `localStorage` (`getDensityStorageKey`) to resolve density from - proving persistence
        // isn't just the URL param carrying over.
        await page.evaluate((id: string) => {
            window.history.replaceState(
                null,
                '',
                `${window.location.pathname}${window.location.search}#/library/${id}`
            );
        }, libraryId);
        await page.reload();
        await page.waitForLoadState('networkidle');

        await expect(
            page.getByRole('button', { name: /density/i })
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-rf-slot="media-grid"]')).toHaveClass(
            /rf-media-grid--compact/
        );
    });
});

/**
 * `/library/:libraryId` **activation** journey (issue #15, L15b).
 *
 * Everything below drives the real app against a real Reefin server: no route is stubbed, no
 * response is mocked, and no `page.route` interception is used anywhere in this file. That is a
 * requirement of this lane rather than a stylistic preference — the thing under test *is* the
 * routing, so a mocked router would assert the test's own fixture instead of the product.
 *
 * The library id is discovered at run time by the `test.beforeAll` above.
 */
test.describe('library activation', () => {
    let libraryId = '';

    test.beforeAll(async () => {
        const api = await request.newContext({ baseURL: BASE_URL });

        const authResponse = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        expect(authResponse.ok()).toBeTruthy();
        const auth = await authResponse.json();

        const viewsResponse = await api.get('/UserViews', {
            params: { userId: auth.User.Id },
            headers: {
                Authorization: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
            }
        });
        expect(viewsResponse.ok()).toBeTruthy();
        const views = await viewsResponse.json();

        const moviesView = (
            views.Items as Array<Record<string, unknown>>
        )?.find((item) => item.CollectionType === 'movies');
        if (!moviesView?.Id) {
            throw new Error(
                'No movies-type library found via /UserViews for the e2e user - cannot resolve libraryId'
            );
        }
        libraryId = String(moviesView.Id);

        await api.dispose();
    });

    const signIn = async (page: import('@playwright/test').Page) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        if (page.url().includes('/login')) {
            await page.locator('#txtManualName:visible').fill(USER);
            await page.locator('#txtManualPassword:visible').fill(PASSWORD);
            await page.locator('button[type="submit"]:visible').first().click();
            await page.waitForURL('**/#/home**', { timeout: 20_000 });
        }
        await page.waitForLoadState('networkidle');
    };

    test.beforeEach(async ({ page }) => {
        await signIn(page);
    });

    /**
     * The activation itself, exercised the way a user meets it: a real click on a real library card
     * on `/home`. This is the assertion that `getRouteUrl()`'s repoint actually reached the UI —
     * asserting the builder in a unit test proves the string, this proves the journey.
     */
    test('home → library by a real click on a library card', async ({
        page
    }) => {
        const myMedia = page.getByRole('tabpanel');
        await expect(myMedia.getByText(/mes médias|my media/i)).toBeVisible({
            timeout: 15_000
        });

        await page.locator(`a[href="#/library/${libraryId}"]`).first().click();

        await expect(page).toHaveURL(new RegExp(`#/library/${libraryId}`));
        await expect(
            page.locator('.rf-library-view').getByRole('heading', { level: 1 })
        ).toBeVisible();
        await expect(page.locator('[data-rf-slot="media-grid"]')).toBeVisible();
    });

    /** A shared link lands directly on the destination, with its content, not on Browse. */
    test('deep link straight to a destination renders that destination', async ({
        page
    }) => {
        await page.goto(`/#/library/${libraryId}/genres`);
        await page.waitForLoadState('networkidle');

        await expect(page).toHaveURL(/\/genres$/);
        await expect(
            page.getByRole('tab', { name: /genres/i })
        ).toHaveAttribute('aria-selected', 'true');
    });

    /** Reload must reproduce the destination, which is the point of it being a route segment. */
    test('reload keeps the destination', async ({ page }) => {
        await page.goto(`/#/library/${libraryId}/collections`);
        await page.waitForLoadState('networkidle');

        await page.reload();
        await page.waitForLoadState('networkidle');

        await expect(page).toHaveURL(/\/collections$/);
        await expect(
            page.getByRole('tab', { name: /collections/i })
        ).toHaveAttribute('aria-selected', 'true');
    });

    /**
     * Back/forward across destinations. This is what the design bought by making the destination a
     * route segment rather than local state, and it is only true because switching destination
     * *pushes* a history entry while the URL canonicalizations *replace* — get either wrong and the
     * back button skips a destination or lands on a URL that immediately redirects again.
     */
    test('back and forward walk the destinations in order', async ({
        page
    }) => {
        await page.goto(`/#/library/${libraryId}`);
        await page.waitForLoadState('networkidle');

        await page.getByRole('tab', { name: /genres/i }).click();
        await expect(page).toHaveURL(/\/genres$/);

        await page.getByRole('tab', { name: /collections/i }).click();
        await expect(page).toHaveURL(/\/collections$/);

        await page.goBack();
        await expect(page).toHaveURL(/\/genres$/);

        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`#/library/${libraryId}$`));

        await page.goForward();
        await expect(page).toHaveURL(/\/genres$/);
    });

    /**
     * The legacy URL keeps working — and lands *once*. `waitForURL` then a settle check is what
     * distinguishes "redirected" from "redirecting forever": if the two directions overlapped, the
     * URL would keep changing and the second read would differ from the first.
     */
    test('a legacy #/movies URL redirects to the canonical route without bouncing', async ({
        page
    }) => {
        await page.goto(
            `/#/movies?topParentId=${libraryId}&collectionType=movies`
        );
        await page.waitForURL(new RegExp(`#/library/${libraryId}`), {
            timeout: 15_000
        });

        const settled = page.url();
        await page.waitForTimeout(1500);
        expect(page.url()).toBe(settled);
        expect(page.url()).not.toContain('#/movies');

        await expect(page.locator('[data-rf-slot="media-grid"]')).toBeVisible();
    });

    /** A legacy tab whose fate is a destination lands on that destination, not on Browse. */
    test('a legacy tab URL lands on the destination its content moved to', async ({
        page
    }) => {
        await page.goto(`/#/movies?topParentId=${libraryId}&tab=4`);
        await page.waitForURL(/\/genres/, { timeout: 15_000 });

        await expect(
            page.getByRole('tab', { name: /genres/i })
        ).toHaveAttribute('aria-selected', 'true');
    });

    /** A legacy Favorites tab URL becomes Browse carrying the filter — the param must survive. */
    test('a legacy favorites URL arrives with its filter applied', async ({
        page
    }) => {
        await page.goto(`/#/movies?topParentId=${libraryId}&tab=2`);
        await page.waitForURL(/favorite=1/, { timeout: 15_000 });

        expect(page.url()).toContain(`#/library/${libraryId}`);
    });

    /**
     * `/browse` and unknown segments both canonicalize to the short URL, and must do so once. The
     * settle check is the no-loop assertion for the *inbound* direction, the mirror of the legacy
     * test above.
     */
    test('the /browse segment and unknown segments canonicalize once', async ({
        page
    }) => {
        for (const segment of ['browse', 'not-a-destination']) {
            await page.goto(`/#/library/${libraryId}/${segment}`);
            await page.waitForURL(new RegExp(`#/library/${libraryId}(\\?|$)`), {
                timeout: 15_000
            });

            const settled = page.url();
            await page.waitForTimeout(1000);
            expect(page.url()).toBe(settled);
        }
    });

    /** Canonicalizing must not silently discard the query the shared link carried. */
    test('canonicalizing /browse preserves the query string', async ({
        page
    }) => {
        await page.goto(
            `/#/library/${libraryId}/browse?sort=DateCreated&order=Descending`
        );
        await page.waitForURL(new RegExp(`#/library/${libraryId}\\?`), {
            timeout: 15_000
        });

        expect(page.url()).toContain('sort=DateCreated');
        expect(page.url()).toContain('order=Descending');
        expect(page.url()).not.toContain('/browse');
    });

    /**
     * A stale bookmark to a deleted library. Reefin's `GET /Items/{itemId}` filters by user and
     * answers 404 for both "gone" and "not visible to you" (see `utils/libraryAccess.ts`), so this
     * is the state a user reaches in either case — and it offers no retry, because retrying a
     * deleted library cannot succeed.
     */
    test('a library id that does not exist shows the not-found state, not a retry loop', async ({
        page
    }) => {
        await page.goto('/#/library/00000000000000000000000000000000');
        await page.waitForLoadState('networkidle');

        await expect(page.locator('[data-rf-slot="state-empty"]')).toBeVisible({
            timeout: 15_000
        });

        // No retry affordance, and no bounce away from the URL that was asked for.
        await expect(
            page.getByRole('button', { name: /retry|réessayer/i })
        ).toHaveCount(0);
        expect(page.url()).toContain(
            '#/library/00000000000000000000000000000000'
        );
    });

    /**
     * A second unresolvable id, asserting that the terminal state is stable rather than specific to
     * one id shape.
     *
     * **This does not exercise access-denied, and must not be read as doing so.** Reaching the
     * access-denied branch needs a library that exists but is invisible to the e2e user, and this
     * rig has no such fixture — a made-up id simply 404s, landing on the same not-found state as
     * the test above. Access-denied is proven only at unit level (`utils/libraryAccess.test.ts`,
     * against synthetic 401/403) plus the grid's classification of `GET /Items`' real 401. Naming
     * that gap here rather than letting a passing test imply coverage it does not have.
     */
    test('a second unresolvable library id lands on the same terminal state', async ({
        page
    }) => {
        await page.goto('/#/library/ffffffffffffffffffffffffffffffff');
        await page.waitForLoadState('networkidle');

        await expect(page.locator('[data-rf-slot="state-empty"]')).toBeVisible({
            timeout: 15_000
        });
        await expect(
            page.getByRole('button', { name: /retry|réessayer/i })
        ).toHaveCount(0);
    });
});

const { defaultBrowserType: _phoneBrowser, ...PHONE } = devices['Pixel 5'];

/**
 * The same route on a phone viewport. Two things are only true on mobile: the drawer is the way out
 * of a library, and four destinations have to fit 360px without becoming a horizontal carousel —
 * the counted reason design §5 stops at four rather than porting seven tabs.
 */
test.describe('library activation (mobile)', () => {
    /*
     * `devices['Pixel 5']` also carries `defaultBrowserType`, which Playwright refuses inside a
     * `describe` because switching browser forces a new worker — and this config runs a single
     * worker on purpose (see `playwright.config.ts`). Only the viewport/user-agent/touch half is
     * applied; the browser stays the config's chromium, which is what Pixel 5 would have selected
     * anyway.
     */
    test.use(PHONE);

    let libraryId = '';

    test.beforeAll(async () => {
        const api = await request.newContext({ baseURL: BASE_URL });
        const authResponse = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        const auth = await authResponse.json();
        const viewsResponse = await api.get('/UserViews', {
            params: { userId: auth.User.Id },
            headers: {
                Authorization: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
            }
        });
        const views = await viewsResponse.json();
        libraryId = String(
            (views.Items as Array<Record<string, unknown>>)?.find(
                (item) => item.CollectionType === 'movies'
            )?.Id ?? ''
        );
        await api.dispose();
        expect(libraryId).not.toBe('');
    });

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        if (page.url().includes('/login')) {
            await page.locator('#txtManualName:visible').fill(USER);
            await page.locator('#txtManualPassword:visible').fill(PASSWORD);
            await page.locator('button[type="submit"]:visible').first().click();
            await page.waitForURL('**/#/home**', { timeout: 20_000 });
        }
        await page.waitForLoadState('networkidle');
    });

    /**
     * Issue #17 one level deeper: `AppLayout` gates the hamburger on `isDrawerAvailable`, so a
     * destination route the drawer does not recognise would strand a phone user with no way to
     * another library. Asserted on a destination segment, not just on Browse.
     */
    test('the drawer opens from a destination and navigates away', async ({
        page
    }) => {
        await page.goto(`/#/library/${libraryId}/genres`);
        await page.waitForLoadState('networkidle');

        const menuButton = page
            .getByRole('button', { name: /menu|main menu/i })
            .first();
        await expect(menuButton).toBeVisible({ timeout: 15_000 });
        await menuButton.click();

        const drawer = page.getByRole('presentation').last();
        await expect(drawer.getByText(/home|accueil/i).first()).toBeVisible();

        await drawer
            .getByText(/home|accueil/i)
            .first()
            .click();
        await expect(page).toHaveURL(/#\/home/);
    });

    /** The drawer's own library link must use the repointed URL, like every other entry point. */
    test('the drawer links a movies library to the canonical route', async ({
        page
    }) => {
        await page.goto(`/#/library/${libraryId}`);
        await page.waitForLoadState('networkidle');

        await page
            .getByRole('button', { name: /menu|main menu/i })
            .first()
            .click();

        await expect(
            page.locator(`a[href*="library/${libraryId}"]`).first()
        ).toBeVisible({ timeout: 15_000 });
    });

    /** Four destinations, one row, no horizontal page scroll at 360px. */
    test('the four destinations fit the phone viewport', async ({ page }) => {
        await page.goto(`/#/library/${libraryId}`);
        await page.waitForLoadState('networkidle');

        await expect(page.locator('[data-rf-slot="tabs"]')).toBeVisible({
            timeout: 15_000
        });
        await expect(page.locator('[data-rf-slot="tab"]')).toHaveCount(4);

        const overflows = await page.evaluate(
            () =>
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth
        );
        expect(overflows).toBe(false);
    });
});

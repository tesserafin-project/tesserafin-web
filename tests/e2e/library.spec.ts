import { devices, expect, request, test } from '@playwright/test';

/**
 * `/library/<libraryId>` E2E journey (RFC-0005 §11 WP-D, movies/tvshows v1 - see
 * `src/apps/modern/features/library/components/LibraryView.tsx`). Mirrors `home.spec.ts`'s
 * patterns: env-based creds, sign in through the real login form, role/label-first selectors,
 * `data-rf-slot` as a secondary hook, no invented `data-testid`s.
 *
 * The movies library id isn't known ahead of time, so it's discovered at run time through a
 * direct API login (`POST /Users/AuthenticateByName` with a standard `MediaBrowser ...`
 * `Authorization` header - same shape `src/lib/tesserafin-sdk/index.ts`'s `buildAuthorizationHeader`
 * produces) followed by a `/UserViews` lookup for the user's `movies`-`CollectionType` view.
 * (The mission mentions the classic `GET /Users/{userId}/Views` alias; this server's own OpenAPI
 * surface - `src/lib/tesserafin-sdk/spec/openapi.json` - only lists `/UserViews`, so that's the
 * endpoint actually called here.) This API login is independent from the UI login each test does
 * in `beforeEach`; it only exists to resolve `libraryId` once for the whole file.
 *
 * Pagination (`StartIndex` <-> page) is unit-tested in `utils/pagination.test.ts` (WP-C) and not
 * re-exercised here: the smoke-test movies library has 2 items, far under the default library
 * page size of 100 (`scripts/settings/userSettings.js`'s `libraryPageSize`), so there's no second
 * page to navigate to.
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const E2E_AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-library", Version="0.0.0"';

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

        /*
         * Scoped to the `src/ui` card slot, NOT to `a[href=...]` alone. Three anchors on /home
         * carry this href: the legacy nav drawer's `a.lnkMediaFolder.navMenuOption` (rendered by
         * `scripts/libraryMenu.js` into the closed `.mainDrawer`, so never visible), an AppBar
         * link, and the actual home card. A bare `.first()` picks whichever the legacy drawer's
         * asynchronous render happens to have inserted first — it passed on one run and timed out
         * on another against the same build. Targeting the card slot is what makes this test
         * deterministic, and it is a stricter assertion than the one it replaces, not a looser one:
         * it now requires the click to land on the home card specifically.
         *
         * The href itself was never in question — all three anchors already carried the canonical
         * `#/library/:id`, which is the repoint working.
         */
        await page
            .locator(
                `[data-rf-slot="media-card"][href="#/library/${libraryId}"]`
            )
            .click();

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
     * A stale bookmark to a library that no longer exists.
     *
     * The id matters, and picking it carelessly is how this test was wrong before. An earlier
     * version used the all-zeros GUID, which is **not** a missing id at all:
     * `UserLibraryController.GetItem` branches on `itemId.IsEmpty()` and answers `Guid.Empty` with
     * the user's *root folder*, HTTP 200. Measured against this rig:
     * `GET /Items/00000000000000000000000000000000` → 200 "Media Folders", while
     * `GET /Items/ffffffffffffffffffffffffffffffff` → 404. So the old test was asserting the
     * not-found state on a request that had succeeded, and the product was right to not show it.
     * The empty-GUID case is now exercised for what it really is, in the test below.
     *
     * Tesserafin's `GET /Items/{itemId}` filters by user and answers 404 for both "gone" and "not
     * visible to you" (see `utils/libraryAccess.ts`), so this is the state a user reaches in either
     * case — and it offers no retry, because retrying a deleted library cannot succeed.
     */
    test('a library id that does not exist shows the not-found state, not a retry loop', async ({
        page
    }) => {
        await page.goto('/#/library/ffffffffffffffffffffffffffffffff');
        await page.waitForLoadState('networkidle');

        await expect(page.locator('[data-rf-slot="state-empty"]')).toBeVisible({
            timeout: 15_000
        });

        // No retry affordance, and no bounce away from the URL that was asked for.
        await expect(
            page.getByRole('button', { name: /retry|réessayer/i })
        ).toHaveCount(0);
        expect(page.url()).toContain(
            '#/library/ffffffffffffffffffffffffffffffff'
        );
    });

    /**
     * The **outbound** half of the no-loop proof, against a real server response.
     *
     * The all-zeros GUID resolves — server-side — to the user's root folder, an item with no
     * `CollectionType`. That is exactly the case `getLibraryRedirectPath` exists for: a real item
     * this route does not render, which must leave for the mixed-content page and stay left. It is
     * a better fixture than a synthetic one because the server produced it, and it is the outbound
     * direction I previously had no way to exercise end to end.
     *
     * The settle check is the assertion that matters: if the inbound and outbound redirects
     * overlapped, the URL would keep changing and the second read would differ from the first.
     *
     * **This is not an access-denied test, and nothing here should be read as one.** Reaching that
     * branch needs a library that exists but is invisible to the e2e user, and this rig has no such
     * fixture. Access-denied remains proven at unit level (`utils/libraryAccess.test.ts`, against
     * synthetic 401/403) plus the grid's classification of `GET /Items`' real 401.
     */
    test('a library this route cannot render leaves for its own page and stays left', async ({
        page
    }) => {
        await page.goto('/#/library/00000000000000000000000000000000');
        await page.waitForURL((url) => !url.hash.startsWith('#/library/'), {
            timeout: 15_000
        });

        expect(page.url()).toContain('#/mixed');

        const settled = page.url();
        await page.waitForTimeout(1500);
        expect(page.url()).toBe(settled);
        expect(page.url()).not.toContain('#/library/');
    });
});

const { defaultBrowserType: _phoneBrowser, ...PHONE } = devices['Pixel 5'];

/*
 * The app bar exposes *two* buttons whose accessible name contains "menu" — "Open Menu" (the
 * hamburger) and "User Menu" — so a `/menu/i` name match resolves to two elements and `.first()`
 * only happens to pick the right one. Anchored to the hamburger explicitly.
 */
const OPEN_MENU = /^(open menu|ouvrir le menu)$/i;

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

        const menuButton = page.getByRole('button', { name: OPEN_MENU });
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

        await page.getByRole('button', { name: OPEN_MENU }).click();

        /*
         * Scoped to `MainDrawerContent`'s own `ListItemLink` (`MuiListItemButton`), for the same
         * reason as the home-card click above: the closed legacy `.mainDrawer` also holds an
         * `a.lnkMediaFolder` with this href, and it is never visible, so an unscoped `.first()`
         * asserts visibility on the wrong element. The URL was already correct on both.
         */
        // The drawer's `ListItemLink` renders the anchor *as* the MuiListItemButton, so the class
        // and the href are on the same element.
        await expect(
            page.locator(
                `a.MuiListItemButton-root[href*="library/${libraryId}"]`
            )
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

/**
 * The four deliberate `null` cells of `utils/legacyLibraryRedirect.ts` — the tabs whose PRODUCT
 * DECISION is to stay on their legacy pages (issue #15, design §3.2):
 *
 *   - bare Studios URLs (movies tab 5, tvshows tab 4): a bare Studios URL names no studio id, so
 *     redirecting it to Browse as `?studio=<id>` would lose its meaning;
 *   - Playlists (movies tab 6, tvshows tab 7): a playlist crosses libraries, out of library scope.
 *
 * These tests pin the movies pair against the real router. The tvshows pair rides the same
 * `UNREDIRECTED_LEGACY_TABS` table and the same `getLegacyLibraryRedirect` early-return — covered
 * at unit level (`legacyLibraryRedirect.test.ts`) — and this rig seeds no tvshows library to drive
 * a browser through.
 *
 * The settle-check mirrors the file's other no-bounce proofs (`a legacy #/movies URL redirects to
 * the canonical route without bouncing`): read the URL, give any would-be redirect ample time to
 * fire, read again. NOT a wait for readiness — a proof of absence.
 */
test.describe('library legacy holdouts (Studios/Playlists)', () => {
    let libraryId = '';

    test.beforeAll(async () => {
        const api = await request.newContext({ baseURL: BASE_URL });
        const auth = await (
            await api.post('/Users/AuthenticateByName', {
                headers: { Authorization: E2E_AUTH_HEADER },
                data: { Username: USER, Pw: PASSWORD }
            })
        ).json();
        const views = await (
            await api.get('/UserViews', {
                params: { userId: auth.User.Id },
                headers: {
                    Authorization: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
                }
            })
        ).json();
        libraryId = String(
            (views.Items as Array<Record<string, unknown>>).find(
                (i) => i.CollectionType === 'movies'
            )?.Id
        );
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

    for (const [tab, name] of [
        ['5', 'Studios'],
        ['6', 'Playlists']
    ] as const) {
        test(`a legacy ${name} URL (tab=${tab}) stays on the legacy page — no redirect to /library`, async ({
            page
        }) => {
            await page.goto(`/#/movies?topParentId=${libraryId}&tab=${tab}`);
            await page.waitForLoadState('networkidle');

            const settled = page.url();
            await page.waitForTimeout(1500);
            expect(page.url()).toBe(settled);
            expect(page.url()).toContain('#/movies');
            expect(page.url()).toContain(`tab=${tab}`);
            expect(page.url()).not.toContain('#/library/');
        });
    }
});

/**
 * The access-restriction case `a library this route cannot render...` explicitly disclaims — now
 * exercisable because `ci/serve-e2e.sh` (reefin PR #68) seeds `smokerestricted`, a NON-admin user
 * granted the Movies library only, with "Codec Probes" existing but withheld.
 *
 * The server's REAL semantics, observed against this fixture and pinned here, are LAYERED:
 *
 *   - `GET /Items/{itemId}` — the info fetch this route makes FIRST — answers **404** for a
 *     withheld library, exactly as the not-found test's own header records ("404 for both 'gone'
 *     and 'not visible to you'"). The server deliberately masks EXISTENCE: a restricted user
 *     cannot distinguish a library they may not see from one that does not exist. That is a
 *     privacy semantics, and it is what the product reaches — so THAT is what this pins.
 *   - `GET /Items?parentId=...` — the grid listing — answers **401** ("is not permitted to
 *     access", `BaseItem.IsVisible`), observed on the rig's first green boot. The route never
 *     reaches it here (the 404 info fetch wins), so `classifyLibraryFailure`'s access-denied
 *     mapping of that layer stays covered at unit level (`libraryAccess.test.ts`), not invented
 *     into a screen the product never shows for this journey.
 */
test.describe('library access restriction (restricted user)', () => {
    const RESTRICTED_USER =
        process.env.TESSERAFIN_E2E_RESTRICTED_USER ?? 'smokerestricted';
    const RESTRICTED_PASSWORD =
        process.env.TESSERAFIN_E2E_RESTRICTED_PASSWORD ?? 'restrictedpass123';

    let withheldId = '';

    test.beforeAll(async () => {
        // The withheld library's id comes from the rig; re-derived and re-checked here through the
        // real API so a drifted fixture fails THIS suite loudly instead of producing vacuous green.
        const api = await request.newContext({ baseURL: BASE_URL });
        const authResponse = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: RESTRICTED_USER, Pw: RESTRICTED_PASSWORD }
        });
        // The status is read BEFORE the body is parsed. A rig that never seeded the restricted
        // user answers 401 with the plain-text "Error processing request: Invalid username or
        // password entered.", and calling .json() on it first turned a missing fixture into
        // `SyntaxError: Unexpected token 'E'` — a message that names neither the user, nor the
        // rig, nor authentication. Observed for real on the B1 image-backed run of 2026-07-27,
        // where ci/verify-release-pair.sh's reduced seeder had not created this user.
        expect(
            authResponse.ok(),
            `the restricted fixture user "${RESTRICTED_USER}" must authenticate; the rig answered ${authResponse.status()} — does this harness seed the restricted user and export TESSERAFIN_E2E_RESTRICTED_LIBRARY_ID? (${(await authResponse.text()).slice(0, 200)})`
        ).toBe(true);
        const auth = await authResponse.json();
        expect(
            auth.AccessToken,
            'the restricted fixture user authenticated but the response carried no AccessToken'
        ).toBeTruthy();

        const views = await (
            await api.get('/UserViews', {
                params: { userId: auth.User.Id },
                headers: {
                    Authorization: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
                }
            })
        ).json();
        const types = (views.Items as Array<Record<string, unknown>>).map(
            (i) => i.CollectionType
        );
        // The fixture's contract, re-asserted from the client side.
        expect(types).toContain('movies');
        expect(types).not.toContain('homevideos');

        withheldId = process.env.TESSERAFIN_E2E_RESTRICTED_LIBRARY_ID ?? '';
        expect(
            withheldId,
            'TESSERAFIN_E2E_RESTRICTED_LIBRARY_ID must name the withheld library — exported by ci/serve-e2e.sh'
        ).toBeTruthy();
        await api.dispose();
    });

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        if (page.url().includes('/login')) {
            await page.locator('#txtManualName:visible').fill(RESTRICTED_USER);
            await page
                .locator('#txtManualPassword:visible')
                .fill(RESTRICTED_PASSWORD);
            await page.locator('button[type="submit"]:visible').first().click();
            await page.waitForURL('**/#/home**', { timeout: 20_000 });
        }
        await page.waitForLoadState('networkidle');
    });

    test("the withheld library is absent from the restricted user's home", async ({
        page
    }) => {
        await page.goto('/#/home');
        // Home is ready when the granted library's card is VISIBLE — a bare text match is not
        // enough, because the (closed) nav drawer also contains a hidden "Movies" entry.
        await expect(
            page.getByText('Movies').filter({ visible: true }).first()
        ).toBeVisible({ timeout: 20_000 });
        // The withheld library appears NOWHERE — not even hidden markup mentions it, because
        // /UserViews (which feeds home and the drawer alike) already excluded it server-side.
        await expect(page.getByText('Codec Probes')).toHaveCount(0);
    });

    test("directly addressing the withheld library shows the not-found state — the server's real privacy-preserving 404, no retry, no bounce", async ({
        page
    }) => {
        await page.goto(`/#/library/${withheldId}`);

        // The not-found EmptyState, selected by the REAL 404 the server answers on the info
        // fetch: existence is masked, so a withheld library is indistinguishable from a deleted
        // one. Asserting an "Access denied" screen here would test a state the product cannot
        // reach on this journey — see the describe header.
        const state = page.locator('[data-rf-slot="state-empty"]');
        await expect(state).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Library not found')).toBeVisible();

        // Not retryable — retrying cannot succeed whether the library is gone or withheld.
        await expect(
            page.getByRole('button', { name: /retry|réessayer/i })
        ).toHaveCount(0);

        // And no bounce: the URL asked for is the URL kept (same settle proof as the
        // not-found case above).
        const settled = page.url();
        await page.waitForTimeout(1500);
        expect(page.url()).toBe(settled);
        expect(page.url()).toContain(`#/library/${withheldId}`);
    });
});

import { expect, request, test } from '@playwright/test';

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

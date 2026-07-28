import { expect, test } from './support/origin-inventory';
import {
    PASSWORD,
    THEMES,
    USER,
    activeThemeHref,
    apiUserId,
    navLibrary,
    navSearch,
    signIn,
    useTheme
} from './support/b2';

/**
 * B2 (#55) — theme availability, runtime switching, and persistence.
 *
 * WHAT WAS ALREADY PROVEN, and is not repeated here: `glass-activation.spec.ts` and
 * `theme-glass-selection.spec.ts` already prove that the picker offers both themes, that selecting
 * Glass frosts the app, that switching back to Classic restores flat surfaces, and that a RELOAD
 * restores the selection. `glass-interaction-profiles.spec.ts` already proves Classic emits a real
 * `backdrop-filter: none` rather than `blur(0px)`.
 *
 * WHAT THIS FILLS. #55 says the choice must persist "across navigation and reload". Reload was
 * covered; a client-side route change was not — and it is the one that can regress independently,
 * because a SPA route change re-mounts the tree without re-running the boot path that reads
 * storage. A theme that survives F5 but is dropped by clicking a nav entry passes the old test and
 * fails the clause.
 */

const CLASSIC_MARKER = /official\.classic/;
const GLASS_MARKER = /official\.glass/;

test.describe('B2 theme: runtime switching and persistence', () => {
    test('both themes are selectable at runtime and the choice survives a client-side route change', async ({
        page
    }) => {
        const userId = await apiUserId();
        await signIn(page);

        // Glass on, through the persisted user setting the product itself writes.
        await useTheme(page, userId, 'glass');
        await expect
            .poll(() => activeThemeHref(page), {
                timeout: 20_000,
                message: 'selecting Glass must load the Glass stylesheet'
            })
            .toMatch(GLASS_MARKER);

        // A CLIENT-SIDE route change, not a reload. Driving the real nav control is the point:
        // it is the path a user takes, and it is the one that re-mounts without re-reading
        // storage. `page.goto` would be a document navigation and would prove the reload case
        // again instead of this one.
        const beforeNav = await page.evaluate(() => {
            (window as unknown as Record<string, unknown>).__b2ThemeMarker =
                'alive';
            return document.documentElement.outerHTML.length > 0;
        });
        expect(beforeNav).toBe(true);

        const searchControl = navSearch(page);
        await expect(
            searchControl,
            'the app bar must offer a Search control to navigate with'
        ).toBeVisible({ timeout: 25_000 });
        await searchControl.click();
        await page.waitForURL('**/#/search**', { timeout: 15_000 });

        // The marker proves the route change did NOT reload the document, so what follows is a
        // statement about client-side navigation and not about boot.
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () =>
                            (window as unknown as Record<string, unknown>)
                                .__b2ThemeMarker
                    ),
                {
                    timeout: 10_000,
                    message:
                        'the navigation reloaded the document, so this does not test client-side routing'
                }
            )
            .toBe('alive');

        expect(
            await activeThemeHref(page),
            'the selected theme must survive a client-side route change'
        ).toMatch(GLASS_MARKER);

        // And back: Classic must equally survive one.
        await useTheme(page, userId, 'classic');
        await expect
            .poll(() => activeThemeHref(page), {
                timeout: 20_000,
                message: 'switching back must load the Classic stylesheet'
            })
            .toMatch(CLASSIC_MARKER);

        await page.evaluate(() => {
            (window as unknown as Record<string, unknown>).__b2ThemeMarker =
                'alive-classic';
        });
        // A second client-side route change, to a different destination. The seeded Movies library
        // is used rather than Home because the Home *tab* exists only on the home route itself,
        // while the library entry is in the persistent navigation at every route — and the clause
        // under test is "a route change", not "a particular route".
        const libraryLink = navLibrary(page);
        await expect(
            libraryLink,
            'the persistent navigation must offer the seeded library at every route'
        ).toBeVisible({ timeout: 25_000 });
        await libraryLink.click();
        await page.waitForURL(/#\/(movies|list|library)/, { timeout: 15_000 });
        await expect
            .poll(
                () =>
                    page.evaluate(
                        () =>
                            (window as unknown as Record<string, unknown>)
                                .__b2ThemeMarker
                    ),
                { timeout: 10_000 }
            )
            .toBe('alive-classic');
        expect(
            await activeThemeHref(page),
            'Classic must equally survive a client-side route change'
        ).toMatch(CLASSIC_MARKER);
    });

    test('the choice also survives a full reload, for each of the two themes', async ({
        page
    }) => {
        const userId = await apiUserId();
        await signIn(page);

        for (const theme of ['glass', 'classic'] as const) {
            await useTheme(page, userId, theme);
            const href = await activeThemeHref(page);
            expect(
                href,
                `${theme} must be the live stylesheet after the reload useTheme performs`
            ).toContain(THEMES[theme].replace('official.', ''));

            // A second, independent reload — the stored value must still decide.
            //
            // POLLED, NOT READ ONCE. `domcontentloaded` fires before the boot path has attached the
            // themed stylesheet, so a single read can catch the window in which no `themes/` link
            // exists yet and compare an empty string. That is what failed one round in three
            // against the release candidate. Waiting on a shell control instead would be the same
            // bet on a different element; the stylesheet is the thing under test, so it is the
            // thing to wait for.
            await page.reload({ waitUntil: 'domcontentloaded' });
            await expect
                .poll(() => activeThemeHref(page), {
                    timeout: 25_000,
                    message: `${theme} must still be live after a second reload`
                })
                .toBe(href);
        }

        // The stored key is the product's own user-scoped one, not a test invention.
        const stored = await page.evaluate(
            (key) => window.localStorage.getItem(key),
            `${userId}-appTheme`
        );
        expect(
            stored,
            'the selection must be persisted under the product’s user-scoped key'
        ).toBe(THEMES.classic);
        expect(
            USER.length,
            'the fixture user must be configured'
        ).toBeGreaterThan(0);
        expect(PASSWORD.length).toBeGreaterThan(0);
    });
});

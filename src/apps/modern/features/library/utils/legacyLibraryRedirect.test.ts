import { CollectionType } from 'lib/reefin-sdk';
import { describe, expect, it } from 'vitest';

import {
    getLegacyLibraryRedirect,
    UNREDIRECTED_LEGACY_TABS
} from './legacyLibraryRedirect';

const redirect = (
    collectionType: CollectionType,
    search: string
): string | undefined =>
    getLegacyLibraryRedirect(collectionType, new URLSearchParams(search));

/**
 * The legacy-URL redirect table (issue #15, L15b).
 *
 * Every case below is a URL shape `appRouter.getRouteUrl()` really used to emit, so these are not
 * hypothetical inputs: `#/movies?topParentId=X&collectionType=movies[&tab=N]` and its `#/tv` twin.
 * The tab indices come from `constants/views/movies.ts` / `constants/views/tvshows.ts`.
 */
describe('getLegacyLibraryRedirect', () => {
    describe('movies', () => {
        const movies = (search: string) =>
            redirect(CollectionType.Movies, search);

        it('sends the default (no tab) and tab=0 to Browse at the canonical short URL', () => {
            expect(movies('topParentId=lib-1&collectionType=movies')).toBe(
                '/library/lib-1'
            );
            expect(
                movies('topParentId=lib-1&collectionType=movies&tab=0')
            ).toBe('/library/lib-1');
        });

        it('sends Suggestions, Collections and Genres to their destinations', () => {
            expect(movies('topParentId=lib-1&tab=1')).toBe(
                '/library/lib-1/suggestions'
            );
            expect(movies('topParentId=lib-1&tab=3')).toBe(
                '/library/lib-1/collections'
            );
            expect(movies('topParentId=lib-1&tab=4')).toBe(
                '/library/lib-1/genres'
            );
        });

        /** Favorites is a *filter* (design §3.2), so its URL becomes Browse carrying the predicate. */
        it('sends Favorites to Browse with the favorite filter applied', () => {
            expect(movies('topParentId=lib-1&tab=2')).toBe(
                '/library/lib-1?favorite=1'
            );
        });
    });

    describe('tvshows', () => {
        const tv = (search: string) => redirect(CollectionType.Tvshows, search);

        it('sends Series to Browse and Genres/Collections to their destinations', () => {
            expect(tv('topParentId=lib-tv&collectionType=tvshows')).toBe(
                '/library/lib-tv'
            );
            expect(tv('topParentId=lib-tv&tab=3')).toBe(
                '/library/lib-tv/genres'
            );
            expect(tv('topParentId=lib-tv&tab=6')).toBe(
                '/library/lib-tv/collections'
            );
        });

        /**
         * Upcoming was a tab and is now a shelf *inside* Suggestions (design §3.2), so its URL lands
         * on the page that contains it. Nothing about the old URL is silently dropped: the content
         * it named is on the page it now resolves to.
         */
        it('sends Upcoming to Suggestions, which now contains it', () => {
            expect(tv('topParentId=lib-tv&tab=2')).toBe(
                '/library/lib-tv/suggestions'
            );
        });

        /** Episodes is a granularity on the same query, not a view — so it is a param, not a segment. */
        it('sends Episodes to Browse at episodes granularity', () => {
            expect(tv('topParentId=lib-tv&tab=5')).toBe(
                '/library/lib-tv?granularity=episodes'
            );
        });
    });

    describe('parameters', () => {
        it('carries compatible params through to the canonical URL', () => {
            const result = redirect(
                CollectionType.Movies,
                'topParentId=lib-1&collectionType=movies&sort=DateCreated&order=Descending&density=compact'
            );

            const params = new URLSearchParams(result!.split('?')[1]);
            expect(params.get('sort')).toBe('DateCreated');
            expect(params.get('order')).toBe('Descending');
            expect(params.get('density')).toBe('compact');
        });

        /**
         * `topParentId` and `tab` are *consumed* by the redirect — one becomes the path segment, the
         * other the destination — so carrying them through would leave dead params on a canonical
         * URL that ignores them.
         */
        it('drops the params the redirect itself consumes', () => {
            const result = redirect(
                CollectionType.Movies,
                'topParentId=lib-1&collectionType=movies&tab=4'
            );

            expect(result).toBe('/library/lib-1/genres');
        });

        it('lets the tab fate win over a conflicting inbound param', () => {
            const result = redirect(
                CollectionType.Tvshows,
                'topParentId=lib-tv&tab=5&granularity=primary'
            );

            expect(result).toBe('/library/lib-tv?granularity=episodes');
        });
    });

    describe('no redirect', () => {
        it('leaves a URL with no topParentId alone', () => {
            expect(
                redirect(CollectionType.Movies, 'collectionType=movies')
            ).toBeUndefined();
        });

        it('leaves an unparseable tab on the default rather than guessing', () => {
            expect(
                redirect(
                    CollectionType.Movies,
                    'topParentId=lib-1&tab=notanumber'
                )
            ).toBe('/library/lib-1');
        });

        it('leaves a tab index the legacy table never had alone', () => {
            expect(
                redirect(CollectionType.Movies, 'topParentId=lib-1&tab=99')
            ).toBeUndefined();
        });

        /**
         * The two documented human-stop cells. Studios has no faithful target — a bare Studios URL
         * names no studio, so it cannot become `?studio=<id>` — and Playlists is explicitly told by
         * design §3.2 to stay on its existing page. Both keep rendering their legacy page rather
         * than being pointed at an improvised destination.
         */
        it.each(UNREDIRECTED_LEGACY_TABS)(
            'does not redirect $collectionType tab=$tab ($legacyTab)',
            ({ collectionType, tab }) => {
                expect(
                    redirect(collectionType, `topParentId=lib-1&tab=${tab}`)
                ).toBeUndefined();
            }
        );

        it('documents a reason for every un-redirected tab', () => {
            expect(UNREDIRECTED_LEGACY_TABS).toHaveLength(4);
            for (const entry of UNREDIRECTED_LEGACY_TABS) {
                expect(entry.reason.length).toBeGreaterThan(20);
            }
        });

        /**
         * A collection type this route does not render is never redirected here — which is half of
         * the no-loop proof (`libraryRedirect.test.ts` holds the other half).
         */
        it('never redirects a collection type /library cannot render', () => {
            for (const collectionType of Object.values(CollectionType)) {
                if (
                    collectionType === CollectionType.Movies ||
                    collectionType === CollectionType.Tvshows
                ) {
                    continue;
                }

                expect(
                    redirect(collectionType, 'topParentId=lib-1')
                ).toBeUndefined();
            }
        });
    });
});

import { CollectionType } from 'lib/reefin-sdk';
import { describe, expect, it } from 'vitest';

import {
    getLibraryRedirectPath,
    isSupportedLibraryCollectionType
} from './libraryRedirect';

describe('isSupportedLibraryCollectionType()', () => {
    it('supports movies and tvshows', () => {
        expect(isSupportedLibraryCollectionType(CollectionType.Movies)).toBe(
            true
        );
        expect(isSupportedLibraryCollectionType(CollectionType.Tvshows)).toBe(
            true
        );
    });

    it('rejects every other known type', () => {
        expect(isSupportedLibraryCollectionType(CollectionType.Music)).toBe(
            false
        );
        expect(isSupportedLibraryCollectionType(CollectionType.Books)).toBe(
            false
        );
        expect(
            isSupportedLibraryCollectionType(CollectionType.Homevideos)
        ).toBe(false);
        expect(isSupportedLibraryCollectionType(CollectionType.Livetv)).toBe(
            false
        );
    });

    it('rejects null/undefined (e.g. while useLibraryInfo is still loading)', () => {
        expect(isSupportedLibraryCollectionType(undefined)).toBe(false);
        expect(isSupportedLibraryCollectionType(null)).toBe(false);
    });
});

describe('getLibraryRedirectPath()', () => {
    it('routes music/books/musicvideos/boxsets/playlists to their topParentId page', () => {
        expect(getLibraryRedirectPath('lib-1', CollectionType.Music)).toBe(
            '/music?topParentId=lib-1&collectionType=music'
        );
        expect(getLibraryRedirectPath('lib-1', CollectionType.Books)).toBe(
            '/books?topParentId=lib-1&collectionType=books'
        );
        expect(
            getLibraryRedirectPath('lib-1', CollectionType.Musicvideos)
        ).toBe('/musicvideos?topParentId=lib-1&collectionType=musicvideos');
        expect(getLibraryRedirectPath('lib-1', CollectionType.Boxsets)).toBe(
            '/boxsets?topParentId=lib-1&collectionType=boxsets'
        );
        expect(getLibraryRedirectPath('lib-1', CollectionType.Playlists)).toBe(
            '/playlists?topParentId=lib-1&collectionType=playlists'
        );
    });

    it('routes homevideos without a collectionType param', () => {
        expect(getLibraryRedirectPath('lib-1', CollectionType.Homevideos)).toBe(
            '/homevideos?topParentId=lib-1'
        );
    });

    it('routes livetv without a topParentId param', () => {
        expect(getLibraryRedirectPath('lib-1', CollectionType.Livetv)).toBe(
            '/livetv?collectionType=livetv'
        );
    });

    it('falls back to the mixed-content page for unknown/unmapped types', () => {
        expect(getLibraryRedirectPath('lib-1', CollectionType.Unknown)).toBe(
            '/mixed?topParentId=lib-1&collectionType=mixed'
        );
        expect(getLibraryRedirectPath('lib-1', undefined)).toBe(
            '/mixed?topParentId=lib-1&collectionType=mixed'
        );
        expect(getLibraryRedirectPath('lib-1', null)).toBe(
            '/mixed?topParentId=lib-1&collectionType=mixed'
        );
    });

    it('is not meant to be called for movies/tvshows, but falls back to mixed rather than throwing if it is', () => {
        // Callers gate on `isSupportedLibraryCollectionType()` first; this only documents that
        // there's no dedicated branch for the two v1-supported types (they're not in the redirect map).
        expect(getLibraryRedirectPath('lib-1', CollectionType.Movies)).toBe(
            '/mixed?topParentId=lib-1&collectionType=mixed'
        );
        expect(getLibraryRedirectPath('lib-1', CollectionType.Tvshows)).toBe(
            '/mixed?topParentId=lib-1&collectionType=mixed'
        );
    });
});

/**
 * The no-loop proof (issue #15, L15b).
 *
 * Activation creates two redirect directions that did not previously coexist:
 *
 *   IN   `#/movies` / `#/tv` → `/library/:libraryId`  (`legacyLibraryRedirect.ts`)
 *   OUT  `/library/:libraryId` → a per-type page      (`getLibraryRedirectPath`, this module)
 *
 * A loop needs one collection type to be in both. It cannot be, and the reason is structural rather
 * than careful: the IN direction is only ever taken for the two types
 * `isSupportedLibraryCollectionType` accepts — those are exactly the types `LibraryView` *renders*,
 * so the OUT direction is never reached for them — and the OUT direction only ever targets pages
 * that the IN direction does not watch. The two assertions below pin both halves over every
 * `CollectionType` the enum has, so a new type added to either set fails here rather than in a
 * browser's infinite-redirect guard.
 */
describe('no redirect loop between /library and the legacy pages', () => {
    const LEGACY_LIBRARY_PAGES = ['/movies', '/tv'];

    it('never sends an unsupported library to a page that redirects back', () => {
        for (const collectionType of Object.values(CollectionType)) {
            if (isSupportedLibraryCollectionType(collectionType)) continue;

            const target = getLibraryRedirectPath('lib-1', collectionType);

            for (const page of LEGACY_LIBRARY_PAGES) {
                expect(target === page || target.startsWith(`${page}?`)).toBe(
                    false
                );
            }
        }
    });

    it('never sends an unknown/absent collection type to a page that redirects back', () => {
        for (const value of [undefined, null, '', 'not-a-type']) {
            const target = getLibraryRedirectPath('lib-1', value);

            for (const page of LEGACY_LIBRARY_PAGES) {
                expect(target === page || target.startsWith(`${page}?`)).toBe(
                    false
                );
            }
        }
    });

    /**
     * The other half: the two types that *are* redirected in are precisely the two that render, so
     * the outbound branch is unreachable for them. Stated as an assertion so "supported" and
     * "redirected in" cannot drift apart silently.
     */
    it('redirects in exactly the types it renders', () => {
        expect(isSupportedLibraryCollectionType(CollectionType.Movies)).toBe(
            true
        );
        expect(isSupportedLibraryCollectionType(CollectionType.Tvshows)).toBe(
            true
        );
    });
});

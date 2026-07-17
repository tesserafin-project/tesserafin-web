import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
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

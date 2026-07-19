import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { describe, expect, it } from 'vitest';

import {
    CANONICAL_LIBRARY_COLLECTION_TYPES,
    getCanonicalLibraryUrl,
    isCanonicalLibraryCollectionType
} from './libraryRoute';

/**
 * The activation, asserted at its source (issue #15, L15b). This module is what
 * `appRouter.getRouteUrl()` and `/home`'s card adapter both call, so these assertions cover every
 * library entry point in the app at once — home cards, the mobile drawer, `UserViewNav`,
 * `UserViewsMenu`, the card builders and item context menus.
 *
 * It is tested here rather than through `appRouter` itself because that module transitively imports
 * the legacy shell (`apphost`, `pluginManager`, `.template.html` files) which vitest cannot load —
 * the practical reason the rule was extracted to a leaf in the first place.
 */
describe('isCanonicalLibraryCollectionType()', () => {
    it('claims exactly the two types /library renders', () => {
        expect(isCanonicalLibraryCollectionType(CollectionType.Movies)).toBe(
            true
        );
        expect(isCanonicalLibraryCollectionType(CollectionType.Tvshows)).toBe(
            true
        );
    });

    /**
     * The no-loop guarantee at its source: a type not sent to `/library/:libraryId` is a type
     * `/library/:libraryId` would otherwise have had to bounce back out.
     */
    it('claims no other collection type', () => {
        for (const collectionType of Object.values(CollectionType)) {
            if (
                collectionType === CollectionType.Movies ||
                collectionType === CollectionType.Tvshows
            ) {
                continue;
            }

            expect(isCanonicalLibraryCollectionType(collectionType)).toBe(
                false
            );
        }
    });

    it('claims nothing for an absent or unknown type', () => {
        expect(isCanonicalLibraryCollectionType(undefined)).toBe(false);
        expect(isCanonicalLibraryCollectionType(null)).toBe(false);
        expect(isCanonicalLibraryCollectionType('')).toBe(false);
        expect(isCanonicalLibraryCollectionType('not-a-type')).toBe(false);
    });

    /**
     * `appRouter.js` compares against `@jellyfin/sdk`'s enum while the library slice uses
     * `lib/reefin-sdk`'s. This module matches on the string value, so that difference cannot
     * silently make the two disagree — pinned here rather than assumed.
     */
    it('matches the enum values both SDKs emit', () => {
        expect(CANONICAL_LIBRARY_COLLECTION_TYPES).toEqual([
            'movies',
            'tvshows'
        ]);
        expect(String(CollectionType.Movies)).toBe('movies');
        expect(String(CollectionType.Tvshows)).toBe('tvshows');
    });
});

describe('getCanonicalLibraryUrl()', () => {
    it('builds the short canonical URL, which is Browse', () => {
        expect(getCanonicalLibraryUrl('lib-1')).toBe('#/library/lib-1');
        expect(getCanonicalLibraryUrl('lib-1', undefined)).toBe(
            '#/library/lib-1'
        );
        expect(getCanonicalLibraryUrl('lib-1', null)).toBe('#/library/lib-1');
    });

    /**
     * "Latest" used to mean `tab=1` — the legacy Suggestions tab, where the Recently Added shelves
     * lived. It now names the Suggestions destination, which holds the same shelves, so the
     * caller's intent survives the repoint.
     */
    it('sends the "latest" section to Suggestions, where those shelves now live', () => {
        expect(getCanonicalLibraryUrl('lib-1', 'latest')).toBe(
            '#/library/lib-1/suggestions'
        );
    });

    it('ignores a section it does not know rather than inventing a segment', () => {
        expect(getCanonicalLibraryUrl('lib-1', 'genres')).toBe(
            '#/library/lib-1'
        );
    });
});

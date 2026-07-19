/**
 * The canonical `/library/:libraryId` URL, in one place (issue #15, L15b).
 *
 * ## Why a shared constant rather than a branch in `appRouter`
 *
 * Two modules build library hrefs, and they cannot import each other:
 *
 * - `components/router/appRouter.js`'s `getRouteUrl()` — the builder behind `MainDrawerContent`,
 *   `UserViewNav`/`UserViewsMenu`, the card builders and item context menus;
 * - `apps/modern/features/home/utils/mediaCardProps.ts` — `/home`'s card adapter, which
 *   deliberately re-implements `getRouteUrl`'s library subset instead of importing the `appRouter`
 *   singleton, because that singleton transitively constructs `RootAppRouter`'s whole route tree
 *   and risks a circular import back into `routes/home.tsx`.
 *
 * Before activation those two agreed by having the same string typed twice, and `LibraryView.tsx`'s
 * TODO named that duplication as debt to retire when the route was activated. Activation is exactly
 * when leaving it would have hurt: a divergence would send `/home`'s cards to a different page than
 * the drawer for the same library, which is the kind of bug nobody reports as a bug.
 *
 * This module is a leaf — no imports, no side effects — so both sides can depend on it, and so it
 * is unit-testable without dragging in either import graph. `CollectionType` is compared by string
 * value rather than imported for the same reason: `appRouter.js` uses `@jellyfin/sdk`'s enum, the
 * library slice uses `lib/reefin-sdk`'s, and both are `openapi-generator` output over one contract
 * with identical values.
 */

/** The `CollectionType` values `/library/:libraryId` renders itself. Everything else keeps its page. */
export const CANONICAL_LIBRARY_COLLECTION_TYPES: readonly string[] = [
    'movies',
    'tvshows'
];

export const isCanonicalLibraryCollectionType = (
    collectionType: string | null | undefined
): boolean =>
    !!collectionType &&
    CANONICAL_LIBRARY_COLLECTION_TYPES.includes(collectionType);

/**
 * Builds the canonical library href.
 *
 * `section === 'latest'` used to append `tab=1` to the legacy page — the Suggestions tab, where the
 * "Recently Added" shelves lived. It now names the Suggestions *destination*, which contains the
 * same shelves (design §3.2 folds Upcoming in alongside them), so the caller's intent survives the
 * repoint instead of being quietly dropped to a plain library link.
 */
export const getCanonicalLibraryUrl = (
    libraryId: string,
    section?: string | null
): string =>
    section === 'latest'
        ? `#/library/${libraryId}/suggestions`
        : `#/library/${libraryId}`;

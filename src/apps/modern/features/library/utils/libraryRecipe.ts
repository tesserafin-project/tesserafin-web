/**
 * The one place the universal Library recipe meets what the Web renderer can actually draw
 * (RFC-0007 §4.7) — the counterpart of `apps/modern/features/home/utils/homeRecipe.ts`.
 *
 * `presentation.page.library` is UNIVERSAL vocabulary. This module answers the narrower Web
 * question — "given that recipe, what does `/library/:libraryId` compose?" — and it is deliberately
 * the only module that knows both sides. The Theme Studio imports its value lists and its labels
 * from here rather than re-typing them, so the Studio cannot offer a value this route ignores.
 *
 * ## What a recipe may and may not do
 *
 * A recipe COMPOSES. It never changes the catalogue query. The route's data hooks — `useLibraryItems`,
 * `useLibraryFilters`, `useLibraryStudios` and every destination fetcher — are called unconditionally,
 * above any recipe read, and their parameters come from the URL query state and
 * `useUserSettings().libraryPageSize`. Nothing in this module is reachable from a request parameter,
 * which is the property `LibraryView.recipe.test.tsx` asserts by comparing the full issued request
 * ledger (endpoint AND every parameter) across every recipe (RFC-0007 §6.1).
 *
 * ## What each key governs, and where it is inert
 *
 * | Key | Governs | Inert on |
 * |---|---|---|
 * | `layout` | the composition of the paginated ITEM LIST — Browse and Collections | Genres (aggregate tiles, not media items) and Suggestions (already editorial shelves) |
 * | `cardAspect` | every MEDIA-ITEM card the route renders — Browse, Collections, Suggestions | Genres, whose cards carry a name and no artwork |
 * | `filters` | where Browse's filter controls live | the three destinations that have no filters |
 *
 * The Studio states each of those exclusions in the control itself, following the precedent Home
 * set with `recommendations`: a value that is valid vocabulary but inert in a given place is
 * labelled, never silently dropped.
 *
 * ## Precedence against `presentation.mediaCard.imageAspect`
 *
 * Two published keys can name the shape of a card on this route. The MORE SPECIFIC one wins:
 * `page.library.cardAspect` decides the aspect of a library media-item card, and
 * `presentation.mediaCard.imageAspect` is the app-wide default it overrides. Both resolve to
 * `poster` in the platform default, so the choice is invisible until a theme disagrees — which is
 * exactly why it is stated here and asserted rather than left to whichever call site was edited
 * last. `MediaCard` itself is unchanged: `imageAspect` stays a required PROP the consuming route
 * decides, never a value the component reads behind its caller's back.
 *
 * ## `layout` against the user's view mode
 *
 * `viewMode` (`grid` | `list`) is USER state: a per-library `localStorage` preference, overridable
 * by `?viewMode=`. `layout` (`grid` | `shelf`) is a THEME choice. They are not the same axis and the
 * user's one is never written by a theme:
 *
 *   - `layout: 'grid'` — the item list is a `MediaGrid`, and `viewMode` behaves exactly as it did
 *     before this binding existed;
 *   - `layout: 'shelf'` — the item list is a `MediaShelf`, in which "one item per row" has no
 *     meaning, so the view-mode toggle is ABSENT rather than disabled. That is this route's own
 *     precedent: the granularity control is absent on a movies library rather than shown inert.
 *
 * The stored `viewMode` is left untouched throughout, so returning to a `grid` recipe restores the
 * user's list/grid choice unchanged.
 */

import {
    LIBRARY_CARD_ASPECTS,
    LIBRARY_FILTER_PRESENTATIONS,
    LIBRARY_LAYOUTS,
    type LibraryCardAspect,
    type LibraryFilterPresentation,
    type LibraryLayout
} from 'themes/platform/contract';
import type { ResolvedPresentation } from 'themes/platform/resolvePresentation';
import type { MediaShelfDensity } from 'ui';

import type { LibraryDensity } from './density';

export { LIBRARY_CARD_ASPECTS, LIBRARY_FILTER_PRESENTATIONS, LIBRARY_LAYOUTS };
export type { LibraryCardAspect, LibraryFilterPresentation, LibraryLayout };

/** The recipe the route composes from — every key present, because the resolver fills them all. */
export type ResolvedLibraryRecipe = ResolvedPresentation['page']['library'];

/**
 * The aspect a library MEDIA-ITEM card is drawn at.
 *
 * The precedence rule of the module note, in one function so no call site can implement it
 * differently: the page recipe wins over the app-wide media-card default.
 */
export const resolveLibraryCardAspect = (
    presentation: ResolvedPresentation
): LibraryCardAspect => presentation.page.library.cardAspect;

/**
 * The shelf density a `layout: 'shelf'` item list is drawn at, derived from the USER's density
 * toggle rather than from any theme key.
 *
 * Deliberately not `presentation.page.home.shelfDensity`: that key belongs to Home's recipe, and
 * reading it here would let a Home choice leak into Library composition. The library's own density
 * control is what a user already turns to make this page tighter, and `MediaShelf`'s third value
 * (`spacious`) is simply not reachable from a two-value toggle — a real gap, recorded rather than
 * papered over with a theme key that does not mean this.
 */
export const toLibraryShelfDensity = (
    density: LibraryDensity
): MediaShelfDensity => (density === 'compact' ? 'compact' : 'comfortable');

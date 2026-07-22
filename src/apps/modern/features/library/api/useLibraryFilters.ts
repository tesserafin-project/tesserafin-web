import { BaseItemKind } from 'lib/tesserafin-sdk';

import { useGetQueryFiltersLegacy } from 'hooks/useFetchItems';
import type { ParentId } from 'types/library';

/**
 * Available genres/years for the `/library/:libraryId` filter `SortSelect`s (RFC-0005 §11 WP-C
 * step 3). `hooks/useFetchItems.ts`'s `useGetQueryFiltersLegacy` already wraps
 * `getFilterApi(api).getQueryFiltersLegacy()` - the exact endpoint
 * `features/libraries/components/filter/FilterButton.tsx` uses to feed its own
 * `FiltersGenres`/`FiltersYears` - and its response shape (`QueryFiltersLegacy`) already carries both
 * `Genres` and `Years` in one call, so this is a thin, named re-export rather than a second
 * `getGenreApi`/custom-years implementation.
 *
 * Residual `@jellyfin/sdk` usage (issue #15): `hooks/useFetchItems` is a *shared* hook, still
 * SDK-based and used by the legacy library screens. Reusing it is precisely what avoids a manual
 * API wrapper here; rewriting this route against `lib/tesserafin-sdk`'s generated `FilterApi` would
 * duplicate an endpoint the shared hook already covers and add bundle weight for no behaviour
 * change. Migrating the shared hook is a separate, cross-cutting change.
 */
export const useLibraryFilters = (
    parentId: ParentId,
    itemType: BaseItemKind[]
) => useGetQueryFiltersLegacy(parentId, itemType);

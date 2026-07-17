import type { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';

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
 */
export const useLibraryFilters = (
    parentId: ParentId,
    itemType: BaseItemKind[]
) => useGetQueryFiltersLegacy(parentId, itemType);

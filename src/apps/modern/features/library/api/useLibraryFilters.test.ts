import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { describe, expect, it, vi } from 'vitest';

import { useLibraryFilters } from './useLibraryFilters';

/**
 * `useLibraryFilters` is a thin, named re-export of `hooks/useFetchItems.ts`'s
 * `useGetQueryFiltersLegacy` (see its own JSDoc for why: it's the same `getFilterApi().
 * getQueryFiltersLegacy()` call `features/libraries/components/filter/FilterButton.tsx` already
 * uses). This locks in the pass-through.
 */
const useGetQueryFiltersLegacyMock = vi.fn(
    (parentId?: string | null, itemType?: BaseItemKind[]) => ({
        parentId,
        itemType
    })
);
vi.mock('hooks/useFetchItems', () => ({
    useGetQueryFiltersLegacy: (
        parentId?: string | null,
        itemType?: BaseItemKind[]
    ) => useGetQueryFiltersLegacyMock(parentId, itemType)
}));

describe('useLibraryFilters()', () => {
    it('forwards parentId and itemType to useGetQueryFiltersLegacy', () => {
        const result = useLibraryFilters('library-1', [BaseItemKind.Movie]);

        expect(useGetQueryFiltersLegacyMock).toHaveBeenCalledWith('library-1', [
            BaseItemKind.Movie
        ]);
        expect(result).toEqual({
            parentId: 'library-1',
            itemType: [BaseItemKind.Movie]
        });
    });
});

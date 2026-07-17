import { describe, expect, it, vi } from 'vitest';

import { useLibraryInfo } from './useLibraryInfo';

/**
 * `useLibraryInfo` is a thin, named re-export of `hooks/useItem.ts`'s `useItem` (see its own JSDoc
 * for why: `getLibraryApi(api).getItem()` by id is already implemented and tested-by-usage there).
 * This just locks in the pass-through so a future refactor of `useLibraryInfo` that stops forwarding
 * to `useItem` fails a test instead of silently changing behavior.
 */
const useItemMock = vi.fn((itemId?: string) => ({ itemId }));
vi.mock('hooks/useItem', () => ({
    useItem: (itemId?: string) => useItemMock(itemId)
}));

describe('useLibraryInfo()', () => {
    it('forwards the libraryId to useItem', () => {
        const result = useLibraryInfo('library-1');

        expect(useItemMock).toHaveBeenCalledWith('library-1');
        expect(result).toEqual({ itemId: 'library-1' });
    });

    it('forwards undefined as-is', () => {
        useLibraryInfo(undefined);

        expect(useItemMock).toHaveBeenCalledWith(undefined);
    });
});

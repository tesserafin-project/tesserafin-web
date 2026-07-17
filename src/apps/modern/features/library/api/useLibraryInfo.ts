import { useItem } from 'hooks/useItem';

/**
 * The library's own item (`Name` + `CollectionType`) for `/library/:libraryId` (RFC-0005 §11 WP-C
 * step 1). `hooks/useItem.ts`'s `useItem` already does exactly this - `getLibraryApi(api).getItem()`
 * by id, cached under the same `['User', userId, 'Items', itemId]` key other `@jellyfin/sdk`-based
 * hooks in this app use (e.g. `LibraryToolbar.tsx`'s own `useItem(parentId)` call for the same kind
 * of lookup) - so this is a thin, named re-export rather than a second implementation of the same
 * `getItem` call.
 */
export const useLibraryInfo = (libraryId?: string) => useItem(libraryId);

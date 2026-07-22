import { useItem } from 'hooks/useItem';

/**
 * The library's own item (`Name` + `CollectionType`) for `/library/:libraryId` (RFC-0005 §11 WP-C
 * step 1). `hooks/useItem.ts`'s `useItem` already does exactly this - `getLibraryApi(api).getItem()`
 * by id, cached under the same `['User', userId, 'Items', itemId]` key other hooks in this app use
 * (e.g. `LibraryToolbar.tsx`'s own `useItem(parentId)` call for the same kind of lookup) - so this
 * is a thin, named re-export rather than a second implementation of the same `getItem` call.
 *
 * Residual `@jellyfin/sdk` usage (issue #15): `hooks/useItem` is a *shared* hook, still SDK-based
 * and used by legacy screens. It is reused here rather than reimplemented, so this is not a manual
 * API wrapper - the rule the migration enforces. Porting it to `lib/tesserafin-sdk` would change the
 * `ItemDto` type every existing caller depends on, so it belongs to a shared-hook migration, not to
 * this route's slice.
 */
export const useLibraryInfo = (libraryId?: string) => useItem(libraryId);

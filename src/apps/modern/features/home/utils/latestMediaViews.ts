import type { BaseItemDto } from 'lib/reefin-sdk';
import { CollectionType } from 'lib/reefin-sdk';

/**
 * Collection types the legacy home page never builds an "ajouts récents" section for
 * (`src/components/homesections/sections/recentlyAdded.ts`'s `excludeViewTypes`). Legacy's list
 * also includes `channels`, which has no `reefin-sdk` `CollectionType` equivalent (channel-plugin
 * views aren't modeled by this API surface), so it's dropped here.
 */
const EXCLUDED_LATEST_MEDIA_COLLECTION_TYPES: ReadonlySet<string> = new Set([
    CollectionType.Playlists,
    CollectionType.Livetv,
    CollectionType.Boxsets,
    CollectionType.Folders
]);

/** Filters a user's library views down to the ones the "ajouts récents" sections mirror. */
export const getLatestMediaViews = (
    userViews: BaseItemDto[] | undefined
): BaseItemDto[] =>
    (userViews ?? []).filter(
        (view) =>
            !!view.Id &&
            !(
                view.CollectionType &&
                EXCLUDED_LATEST_MEDIA_COLLECTION_TYPES.has(view.CollectionType)
            )
    );

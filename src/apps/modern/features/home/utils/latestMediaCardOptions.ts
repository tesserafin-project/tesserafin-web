import {
    type CardShape,
    getBackdropShape,
    getPortraitShape,
    getSquareShape
} from 'components/cardbuilder/utils/shape';
import { CollectionType } from 'lib/reefin-sdk';
import type { CardOptions } from 'types/cardOptions';

// Shape grouping - portrait also covers `Channel` items in legacy, irrelevant here since
// `getLatestMediaViews` excludes live TV/channel views before this helper ever sees them.
const PORTRAIT_COLLECTION_TYPES: ReadonlySet<string> = new Set([
    CollectionType.Movies,
    CollectionType.Books,
    CollectionType.Tvshows
]);
const SQUARE_COLLECTION_TYPES: ReadonlySet<string> = new Set([
    CollectionType.Music,
    CollectionType.Homevideos
]);
// Separate grouping: unlike shape, `books` keeps `preferThumb: 'auto'` in legacy.
const NO_PREFER_THUMB_COLLECTION_TYPES: ReadonlySet<string> = new Set([
    CollectionType.Movies,
    CollectionType.Tvshows,
    CollectionType.Music
]);

/**
 * Mirrors `src/components/homesections/sections/recentlyAdded.ts`'s `getLatestItemsHtmlFn` shape/
 * field selection for one library's "ajouts récents" section, minus the `itemType === 'Channel'`
 * branch - live TV/channel views never reach this helper (`getLatestMediaViews` excludes them).
 */
export const getLatestMediaCardOptions = (
    collectionType: string | null | undefined
): Partial<CardOptions> => {
    const isPortrait =
        !!collectionType && PORTRAIT_COLLECTION_TYPES.has(collectionType);
    const isSquare =
        !!collectionType && SQUARE_COLLECTION_TYPES.has(collectionType);
    const isPhotos = collectionType === CollectionType.Photos;
    const isMusic = collectionType === CollectionType.Music;
    const isTvshows = collectionType === CollectionType.Tvshows;
    const isMovies = collectionType === CollectionType.Movies;

    let shape: CardShape;
    if (isPortrait) {
        shape = getPortraitShape(true);
    } else if (isSquare) {
        shape = getSquareShape(true);
    } else {
        shape = getBackdropShape(true);
    }

    return {
        shape,
        preferThumb:
            collectionType &&
            NO_PREFER_THUMB_COLLECTION_TYPES.has(collectionType)
                ? false
                : 'auto',
        showTitle: !isPhotos,
        showYear: isMovies || isTvshows || !collectionType,
        showParentTitle: isMusic || isTvshows || !collectionType,
        overlayPlayButton: !isPhotos,
        overlayText: false,
        centerText: true,
        cardLayout: false,
        lines: 2
    };
};

import { describe, expect, it } from 'vitest';

import { CardShape } from 'components/cardbuilder/utils/shape';
import { CollectionType } from 'lib/reefin-sdk';

import { getLatestMediaCardOptions } from './latestMediaCardOptions';

describe('getLatestMediaCardOptions()', () => {
    it('uses a portrait shape with no thumb preference for movies', () => {
        const options = getLatestMediaCardOptions(CollectionType.Movies);

        expect(options.shape).toBe(CardShape.PortraitOverflow);
        expect(options.preferThumb).toBe(false);
        expect(options.showYear).toBe(true);
        expect(options.showParentTitle).toBe(false);
    });

    it('uses a portrait shape but keeps auto thumb preference for books', () => {
        const options = getLatestMediaCardOptions(CollectionType.Books);

        expect(options.shape).toBe(CardShape.PortraitOverflow);
        expect(options.preferThumb).toBe('auto');
        expect(options.showYear).toBe(false);
    });

    it('uses a square shape for music and home videos', () => {
        expect(getLatestMediaCardOptions(CollectionType.Music).shape).toBe(
            CardShape.SquareOverflow
        );
        expect(getLatestMediaCardOptions(CollectionType.Homevideos).shape).toBe(
            CardShape.SquareOverflow
        );
    });

    it('shows the parent title for music and tv shows only', () => {
        expect(
            getLatestMediaCardOptions(CollectionType.Music).showParentTitle
        ).toBe(true);
        expect(
            getLatestMediaCardOptions(CollectionType.Tvshows).showParentTitle
        ).toBe(true);
        expect(
            getLatestMediaCardOptions(CollectionType.Homevideos).showParentTitle
        ).toBe(false);
    });

    it('hides the title and play overlay for photos, and defaults to backdrop otherwise', () => {
        const photos = getLatestMediaCardOptions(CollectionType.Photos);

        expect(photos.shape).toBe(CardShape.BackdropOverflow);
        expect(photos.showTitle).toBe(false);
        expect(photos.overlayPlayButton).toBe(false);
    });

    it('falls back to a backdrop shape with year/parent title shown when there is no collection type', () => {
        const options = getLatestMediaCardOptions(undefined);

        expect(options.shape).toBe(CardShape.BackdropOverflow);
        expect(options.showYear).toBe(true);
        expect(options.showParentTitle).toBe(true);
    });
});

import { describe, expect, it } from 'vitest';

import type { BaseItemDto } from 'lib/tesserafin-sdk';
import { CollectionType } from 'lib/tesserafin-sdk';

import { getLatestMediaViews } from './latestMediaViews';

const view = (overrides: Partial<BaseItemDto>): BaseItemDto => ({
    Id: 'id',
    Name: 'View',
    ...overrides
});

describe('getLatestMediaViews()', () => {
    it('returns an empty array when there are no user views', () => {
        expect(getLatestMediaViews(undefined)).toEqual([]);
    });

    it('keeps views with no collection type or a non-excluded one', () => {
        const movies = view({ Id: '1', CollectionType: CollectionType.Movies });
        const folder = view({ Id: '2', CollectionType: undefined });

        expect(getLatestMediaViews([movies, folder])).toEqual([movies, folder]);
    });

    it('excludes playlists, live tv, boxsets and folders views', () => {
        const excluded = [
            view({ Id: '1', CollectionType: CollectionType.Playlists }),
            view({ Id: '2', CollectionType: CollectionType.Livetv }),
            view({ Id: '3', CollectionType: CollectionType.Boxsets }),
            view({ Id: '4', CollectionType: CollectionType.Folders })
        ];

        expect(getLatestMediaViews(excluded)).toEqual([]);
    });

    it('excludes views without an Id', () => {
        const noId = view({
            Id: undefined,
            CollectionType: CollectionType.Movies
        });

        expect(getLatestMediaViews([noId])).toEqual([]);
    });
});

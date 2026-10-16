import { describe, expect, it } from 'vitest';

import { getWatchState } from './watchState';

describe('getWatchState', () => {
    it('shows progress for a part-watched item', () => {
        expect(getWatchState({ PlayedPercentage: 41.3 })).toEqual({
            progressPercent: 41.3,
            played: false
        });
    });

    it('marks a watched item and shows no bar', () => {
        expect(
            getWatchState({ Played: true, PlayedPercentage: 100 })
        ).toEqual({ progressPercent: undefined, played: true });
    });

    it('shows nothing for an unwatched item or missing data', () => {
        expect(getWatchState({ PlayedPercentage: 0 })).toEqual({
            progressPercent: undefined,
            played: false
        });
        expect(getWatchState(undefined)).toEqual({
            progressPercent: undefined,
            played: false
        });
    });
});

import { describe, expect, it } from 'vitest';

import {
    continuousPageSize,
    expandRows,
    mountedSegments,
    pageStarts,
    rowCount,
    rowsInView
} from './libraryWindow';

const geometry = { columns: 6, rowHeight: 290, rowGap: 10 };

describe('libraryWindow', () => {
    it('finds the rows under the viewport from arithmetic alone', () => {
        expect(rowsInView(0, 900, geometry, 12_000)).toEqual({
            first: 0,
            last: 3
        });
        expect(rowsInView(300_000, 900, geometry, 12_000)).toEqual({
            first: 1000,
            last: 1003
        });
    });

    it('never goes past the last row, including after the result set shrank', () => {
        expect(rowCount(13, 6)).toBe(3);
        expect(rowsInView(999_999, 900, geometry, 13)).toEqual({
            first: 2,
            last: 2
        });
        expect(expandRows({ first: 2, last: 2 }, 4, 13, 6)).toEqual({
            first: 0,
            last: 2
        });
    });

    it('asks only for the pages a range touches, at any depth', () => {
        expect(pageStarts(5_199, 5_301, 100)).toEqual([5_100, 5_200, 5_300]);
        expect(pageStarts(0, 99, 100)).toEqual([0]);
    });

    it('keeps the request size bounded whatever the display setting says', () => {
        expect(continuousPageSize(0)).toBe(100);
        expect(continuousPageSize(5_000)).toBe(100);
        expect(continuousPageSize(1)).toBe(24);
        expect(continuousPageSize(50)).toBe(50);
    });

    it('mounts a distant focused row apart from the window, in document order', () => {
        const window = { first: 100, last: 105 };
        expect(mountedSegments(window, undefined)).toEqual([window]);
        expect(mountedSegments(window, 3)).toEqual([
            { first: 3, last: 3 },
            window
        ]);
        expect(mountedSegments(window, 300)).toEqual([
            window,
            { first: 300, last: 300 }
        ]);
    });

    it('merges a focused row touching the window, leaving no empty gap', () => {
        const window = { first: 100, last: 105 };
        expect(mountedSegments(window, 102)).toEqual([window]);
        expect(mountedSegments(window, 99)).toEqual([{ first: 99, last: 105 }]);
        expect(mountedSegments(window, 106)).toEqual([
            { first: 100, last: 106 }
        ]);
    });
});

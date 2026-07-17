import { describe, expect, it } from 'vitest';

import {
    clampPage,
    FIRST_PAGE,
    getTotalPages,
    pageToStartIndex,
    startIndexToPage
} from './pagination';

describe('pageToStartIndex()', () => {
    it('returns 0 for the first page', () => {
        expect(pageToStartIndex(1, 50)).toBe(0);
    });

    it('returns pageSize offsets for later pages', () => {
        expect(pageToStartIndex(2, 50)).toBe(50);
        expect(pageToStartIndex(3, 50)).toBe(100);
    });

    it('treats a page below 1 as the first page', () => {
        expect(pageToStartIndex(0, 50)).toBe(0);
        expect(pageToStartIndex(-5, 50)).toBe(0);
    });

    it('returns 0 when pageSize is 0 or negative', () => {
        expect(pageToStartIndex(3, 0)).toBe(0);
        expect(pageToStartIndex(3, -10)).toBe(0);
    });
});

describe('startIndexToPage()', () => {
    it('returns the first page for a 0 startIndex', () => {
        expect(startIndexToPage(0, 50)).toBe(1);
    });

    it('converts a positive offset back to its page', () => {
        expect(startIndexToPage(50, 50)).toBe(2);
        expect(startIndexToPage(100, 50)).toBe(3);
    });

    it('floors partial-page offsets into the containing page', () => {
        expect(startIndexToPage(60, 50)).toBe(2);
    });

    it('falls back to the first page for invalid input', () => {
        expect(startIndexToPage(-1, 50)).toBe(1);
        expect(startIndexToPage(50, 0)).toBe(1);
    });
});

describe('getTotalPages()', () => {
    it('is exact when the record count is a multiple of pageSize', () => {
        expect(getTotalPages(100, 50)).toBe(2);
    });

    it('rounds up a partial last page', () => {
        expect(getTotalPages(101, 50)).toBe(3);
    });

    it('is always at least 1 page, even with 0 records', () => {
        expect(getTotalPages(0, 50)).toBe(1);
    });

    it('falls back to 1 page when pageSize is 0', () => {
        expect(getTotalPages(100, 0)).toBe(1);
    });
});

describe('clampPage()', () => {
    it('leaves an in-range page unchanged', () => {
        expect(clampPage(2, 5)).toBe(2);
    });

    it('clamps below 1 up to the first page', () => {
        expect(clampPage(0, 5)).toBe(FIRST_PAGE);
        expect(clampPage(-3, 5)).toBe(FIRST_PAGE);
    });

    it('clamps above totalPages down to totalPages', () => {
        expect(clampPage(9, 5)).toBe(5);
    });
});

import { describe, expect, it } from 'vitest';

import { homeTabIndexToParam, parseHomeTabIndex } from './tabParam';

describe('parseHomeTabIndex()', () => {
    it('defaults to 0 when there is no tab param', () => {
        expect(parseHomeTabIndex(null)).toBe(0);
    });

    it('parses valid indexes', () => {
        expect(parseHomeTabIndex('0')).toBe(0);
        expect(parseHomeTabIndex('1')).toBe(1);
    });

    it('defaults to 0 for non-numeric values', () => {
        expect(parseHomeTabIndex('favorites')).toBe(0);
    });

    it('defaults to 0 for out-of-range indexes', () => {
        expect(parseHomeTabIndex('2')).toBe(0);
        expect(parseHomeTabIndex('-1')).toBe(0);
    });
});

describe('homeTabIndexToParam()', () => {
    it('stringifies the index', () => {
        expect(homeTabIndexToParam(0)).toBe('0');
        expect(homeTabIndexToParam(1)).toBe('1');
    });
});

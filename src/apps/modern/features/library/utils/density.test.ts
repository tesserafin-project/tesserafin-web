import { describe, expect, it } from 'vitest';

import {
    getDensityStorageKey,
    isLibraryDensity,
    resolveLibraryDensity,
    toggleLibraryDensity
} from './density';

describe('getDensityStorageKey()', () => {
    it('namespaces the key per library id', () => {
        expect(getDensityStorageKey('abc123')).toBe('library-density-abc123');
        expect(getDensityStorageKey('other')).toBe('library-density-other');
    });
});

describe('isLibraryDensity()', () => {
    it('accepts comfortable and compact', () => {
        expect(isLibraryDensity('comfortable')).toBe(true);
        expect(isLibraryDensity('compact')).toBe(true);
    });

    it('rejects anything else, including null/undefined', () => {
        expect(isLibraryDensity('spacious')).toBe(false);
        expect(isLibraryDensity(null)).toBe(false);
        expect(isLibraryDensity(undefined)).toBe(false);
        expect(isLibraryDensity('')).toBe(false);
    });
});

describe('resolveLibraryDensity()', () => {
    it('prefers the URL value when it is valid', () => {
        expect(resolveLibraryDensity('compact', 'comfortable')).toBe('compact');
    });

    it('falls back to the stored value when the URL has none', () => {
        expect(resolveLibraryDensity(null, 'compact')).toBe('compact');
    });

    it('falls back to comfortable when neither is set', () => {
        expect(resolveLibraryDensity(null, undefined)).toBe('comfortable');
    });

    it('ignores an invalid URL value and falls back to the stored value', () => {
        expect(resolveLibraryDensity('huge', 'compact')).toBe('compact');
    });
});

describe('toggleLibraryDensity()', () => {
    it('toggles comfortable to compact and back', () => {
        expect(toggleLibraryDensity('comfortable')).toBe('compact');
        expect(toggleLibraryDensity('compact')).toBe('comfortable');
    });
});

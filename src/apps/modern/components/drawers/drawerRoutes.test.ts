import { describe, expect, it } from 'vitest';

import { isDrawerPath } from './drawerRoutes';

/**
 * Regression tests for issue #17: `isDrawerPath` compared route paths to pathnames with string
 * equality, so the parametrised `library/:libraryId` route never matched a real pathname. On mobile
 * that hid both the hamburger button and the drawer (`AppLayout.tsx` gates them on
 * `isDrawerAvailable`), stranding the user on `/library/:libraryId`.
 */
describe('isDrawerPath', () => {
    it('matches a parametrised route against a concrete pathname (issue #17)', () => {
        expect(isDrawerPath('/library/f1e2d3')).toBe(true);
    });

    it('matches parametrised routes regardless of the parameter value', () => {
        expect(isDrawerPath('/library/7e5a1b9c4d2f')).toBe(true);
        expect(isDrawerPath('/library/a')).toBe(true);
    });

    it('still matches plain routes, with and without a leading slash', () => {
        expect(isDrawerPath('/home')).toBe(true);
        expect(isDrawerPath('home')).toBe(true);
        expect(isDrawerPath('/movies')).toBe(true);
        expect(isDrawerPath('/tv')).toBe(true);
    });

    it('does not match a parametrised route missing its parameter', () => {
        expect(isDrawerPath('/library')).toBe(false);
    });

    /**
     * The mobile drawer must be reachable from every library destination, not just Browse. This is
     * the same issue #17 failure mode one level deeper: `AppLayout.tsx` gates the hamburger button
     * on `isDrawerAvailable`, so a destination the drawer does not recognise would strand a phone
     * user on, say, `/library/x/genres` with no way back to another library.
     */
    it('matches every library destination segment (issue #15, L15b)', () => {
        expect(isDrawerPath('/library/f1e2d3/genres')).toBe(true);
        expect(isDrawerPath('/library/f1e2d3/collections')).toBe(true);
        expect(isDrawerPath('/library/f1e2d3/suggestions')).toBe(true);
    });

    /**
     * `library/:libraryId/:destination` is one parametrised route, not three literal ones, so an
     * unknown segment matches it too — and that is correct rather than sloppy: `LibraryView`
     * redirects the unknown segment back to the canonical short URL, and the drawer has to be
     * available while that happens. What still must not match is a *third* segment, which no route
     * declares.
     */
    it('matches an unknown destination segment but not a deeper path', () => {
        expect(isDrawerPath('/library/f1e2d3/extra')).toBe(true);
        expect(isDrawerPath('/library/f1e2d3/genres/extra')).toBe(false);
    });

    it('excludes drawerless routes', () => {
        expect(isDrawerPath('/video')).toBe(false);
    });

    it('does not match unknown routes', () => {
        expect(isDrawerPath('/not-a-route')).toBe(false);
    });
});

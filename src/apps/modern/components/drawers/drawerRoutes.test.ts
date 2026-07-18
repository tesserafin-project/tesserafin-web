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

    it('does not match extra path segments beyond the route', () => {
        expect(isDrawerPath('/library/f1e2d3/extra')).toBe(false);
    });

    it('excludes drawerless routes', () => {
        expect(isDrawerPath('/video')).toBe(false);
    });

    it('does not match unknown routes', () => {
        expect(isDrawerPath('/not-a-route')).toBe(false);
    });
});

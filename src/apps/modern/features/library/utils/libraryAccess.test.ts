import { describe, expect, it } from 'vitest';

import {
    classifyLibraryFailure,
    isRetryableLibraryFailure
} from './libraryAccess';

const httpError = (status: number) => ({ response: { status } });

/**
 * Activation is what makes this distinction load-bearing (issue #15, L15b): once
 * `getRouteUrl()` emits `/library/:libraryId` everywhere, stale bookmarks and shared links both
 * land on this route, and "there was an error, retry" is the wrong answer to both.
 */
describe('classifyLibraryFailure', () => {
    it('reports a 404 as a missing library', () => {
        expect(classifyLibraryFailure(httpError(404))).toBe('not-found');
    });

    it('reports 401 and 403 as access denied', () => {
        expect(classifyLibraryFailure(httpError(401))).toBe('access-denied');
        expect(classifyLibraryFailure(httpError(403))).toBe('access-denied');
    });

    it('reports server and transport failures as a plain error', () => {
        expect(classifyLibraryFailure(httpError(500))).toBe('error');
        expect(classifyLibraryFailure(httpError(502))).toBe('error');
        expect(classifyLibraryFailure(new Error('Network Error'))).toBe(
            'error'
        );
    });

    it('does not guess from anything that is not a status code', () => {
        expect(classifyLibraryFailure(undefined)).toBe('error');
        expect(classifyLibraryFailure(null)).toBe('error');
        expect(classifyLibraryFailure('403')).toBe('error');
        expect(classifyLibraryFailure({ response: { status: '404' } })).toBe(
            'error'
        );
    });
});

describe('isRetryableLibraryFailure', () => {
    /**
     * Only the transport/server case is retryable. Offering "retry" on a deleted library or on a
     * permission the user does not have would promise something the button cannot deliver.
     */
    it('offers a retry only for a genuine error', () => {
        expect(isRetryableLibraryFailure('error')).toBe(true);
        expect(isRetryableLibraryFailure('not-found')).toBe(false);
        expect(isRetryableLibraryFailure('access-denied')).toBe(false);
    });
});

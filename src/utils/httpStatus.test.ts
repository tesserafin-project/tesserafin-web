import { describe, expect, it } from 'vitest';

import { getHttpStatus, isItemUnavailable } from './httpStatus';

describe('getHttpStatus', () => {
    it('reads a fetch Response', () => {
        expect(getHttpStatus(new Response(null, { status: 404 }))).toBe(404);
    });

    it('reads an Axios-shaped error', () => {
        expect(getHttpStatus({ response: { status: 500 } })).toBe(500);
    });

    it('has no status for anything else', () => {
        expect(getHttpStatus(new Error('offline'))).toBeUndefined();
        expect(getHttpStatus(undefined)).toBeUndefined();
    });
});

describe('isItemUnavailable', () => {
    it('is true for 404 only: hidden and missing look the same', () => {
        expect(isItemUnavailable({ response: { status: 404 } })).toBe(true);
        expect(isItemUnavailable({ response: { status: 500 } })).toBe(false);
        expect(isItemUnavailable(new TypeError('Failed to fetch'))).toBe(false);
    });
});

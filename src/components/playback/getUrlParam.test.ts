import { describe, expect, it } from 'vitest';

import { getParam } from './getUrlParam';

describe('getParam', () => {
    it('reads a parameter after ? or &', () => {
        expect(
            getParam('playSessionId', 'https://h/v.mp4?playSessionId=abc&x=1')
        ).toBe('abc');
        expect(
            getParam('playSessionId', 'https://h/v.mp4?x=1&playSessionId=abc#t')
        ).toBe('abc');
    });

    it('is case-insensitive and decodes the value', () => {
        expect(getParam('playSessionId', '/v?PlaySessionId=a%2Fb+c')).toBe(
            'a/b c'
        );
    });

    it('returns an empty string when the parameter is absent', () => {
        expect(getParam('playSessionId', '/v?other=1')).toBe('');
        expect(getParam('playSessionId', '/v?xplaySessionId=1')).toBe('');
    });

    it('escapes every bracket in the name, not only the first', () => {
        const url = '/v?a[0][1]=yes&a0=no';
        expect(getParam('a[0][1]', url)).toBe('yes');
    });

    it('treats other RegExp metacharacters in the name literally', () => {
        expect(getParam('a.b', '/v?axb=no&a.b=yes')).toBe('yes');
    });
});

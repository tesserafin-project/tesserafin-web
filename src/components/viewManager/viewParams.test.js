import { describe, expect, it } from 'vitest';
import { getViewParams } from './viewParams';

describe('getViewParams', () => {
    it('returns the query parameters, last value winning', () => {
        expect(getViewParams('#/details?id=1&serverId=a&id=2')).toEqual({
            id: '2',
            serverId: 'a'
        });
    });

    // The previous inline implementation, kept verbatim as the behavioural reference.
    function legacy(url) {
        const index = url.indexOf('?');
        const searchParams = new URLSearchParams(url.substring(index + 1));
        const params = {};
        searchParams.forEach((value, key) => {
            params[key] = value;
        });
        return params;
    }

    it.each([
        '#/home',
        '#/details?id=1',
        '#/list?parentId=a&a=b+c&enc=%26%3D&empty=&flag',
        '#/x?a=1?b=2',
        '/web/#/search?query=caf%C3%A9'
    ])('matches the previous behaviour for %j', (url) => {
        expect(getViewParams(url)).toEqual(legacy(url));
    });

    it('keeps __proto__ and constructor as own data, never as prototype writes', () => {
        const params = getViewParams(
            '#/x?__proto__=evil&constructor=c&toString=t'
        );
        expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
        expect(Object.hasOwn(params, '__proto__')).toBe(true);
        expect(params.constructor).toBe('c');
        expect({}.toString).toBe(Object.prototype.toString);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ajax, getFetchPromise } from '../../src/utils/fetch';
import { endpointCategory } from '../../src/utils/urlCategory';

/**
 * S4 — `src/utils/fetch.js` MUST NOT PRINT A URL.
 *
 * The named leak in #75 was the two players, but `utils/fetch` sat on the same disclosure: it
 * printed the full url on six paths — request, response, failure, and three inside
 * `fetchWithTimeout` — and `getFetchPromise` appends the query string to that url before the
 * request goes out. An api-client call carrying `api_key`/`ApiKey` therefore published the
 * session credential on an ordinary request, with no playback involved.
 *
 * These tests drive the real exported functions against a stubbed `fetch`, with a unique synthetic
 * credential in the query, and assert the same way the player tests do: every console argument is
 * inspected recursively and a match is recorded, never forwarded to the runner's output.
 */

const SYNTHETIC_CREDENTIAL = `s4-fetch-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const SERVER = 'http://127.0.0.1:8096';
const ENDPOINT_PATH = '/Users/00000000000000000000000000000001/Items/Resume';

function containsSecret(value: unknown, needles: string[], depth = 0): boolean {
    if (depth > 6 || value == null) return false;
    if (typeof value === 'string')
        return needles.some((needle) => value.includes(needle));
    if (typeof value === 'number' || typeof value === 'boolean') return false;
    if (value instanceof Error)
        return (
            containsSecret(value.message, needles, depth + 1) ||
            containsSecret(value.stack ?? '', needles, depth + 1)
        );
    if (Array.isArray(value))
        return value.some((item) => containsSecret(item, needles, depth + 1));
    if (typeof value === 'object')
        return Object.values(value as Record<string, unknown>).some((item) =>
            containsSecret(item, needles, depth + 1)
        );
    return false;
}

const DISCLOSURE_NEEDLES = [
    SYNTHETIC_CREDENTIAL,
    encodeURIComponent(SYNTHETIC_CREDENTIAL),
    'api_key=',
    'ApiKey=',
    ENDPOINT_PATH
];

interface ConsoleWatch {
    offenders: string[];
    restore: () => void;
}

function watchConsole(): ConsoleWatch {
    const offenders: string[] = [];
    const methods = ['debug', 'log', 'info', 'warn', 'error', 'dir'] as const;
    const originals = methods.map(
        (method) => [method, console[method]] as const
    );
    for (const method of methods) {
        const original = console[method] as (...args: unknown[]) => void;
        console[method] = (...args: unknown[]) => {
            if (containsSecret(args, DISCLOSURE_NEEDLES)) {
                offenders.push(method);
                return;
            }
            original.apply(console, args);
        };
    }
    return {
        offenders,
        restore: () => {
            for (const [method, original] of originals) {
                (console as unknown as Record<string, unknown>)[method] =
                    original;
            }
        }
    };
}

describe('utils/fetch url disclosure', () => {
    let watch: ConsoleWatch;

    beforeEach(() => {
        watch = watchConsole();
    });

    afterEach(() => {
        watch.restore();
        vi.unstubAllGlobals();
    });

    it('a successful request prints no url', async () => {
        const seen: string[] = [];
        vi.stubGlobal('fetch', (url: string) => {
            seen.push(url);
            return Promise.resolve(
                new Response('{}', {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            );
        });

        await ajax({
            type: 'GET',
            url: `${SERVER}${ENDPOINT_PATH}`,
            query: { api_key: SYNTHETIC_CREDENTIAL, Limit: 10 },
            dataType: 'json'
        });

        watch.restore();
        expect(
            watch.offenders,
            'a console method emitted the request credential'
        ).toEqual([]);
        // The request itself is untouched: the credential still reaches the server, exactly once.
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain(
            `api_key=${encodeURIComponent(SYNTHETIC_CREDENTIAL)}`
        );
    });

    it('a failed request prints no url', async () => {
        vi.stubGlobal('fetch', () =>
            Promise.resolve(new Response('', { status: 401 }))
        );

        await expect(
            ajax({
                type: 'GET',
                url: `${SERVER}${ENDPOINT_PATH}`,
                query: { api_key: SYNTHETIC_CREDENTIAL }
            })
        ).rejects.toBeDefined();

        watch.restore();
        expect(watch.offenders).toEqual([]);
    });

    it('a rejected request prints no url', async () => {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')));

        await expect(
            ajax({
                type: 'POST',
                url: `${SERVER}${ENDPOINT_PATH}`,
                query: { api_key: SYNTHETIC_CREDENTIAL }
            })
        ).rejects.toBeDefined();

        watch.restore();
        expect(watch.offenders).toEqual([]);
    });

    it('the timeout path prints no url', async () => {
        vi.stubGlobal('fetch', () =>
            Promise.resolve(new Response('{}', { status: 200 }))
        );

        await getFetchPromise({
            type: 'GET',
            url: `${SERVER}${ENDPOINT_PATH}`,
            query: { api_key: SYNTHETIC_CREDENTIAL },
            timeout: 30000
        });

        watch.restore();
        expect(
            watch.offenders,
            'fetchWithTimeout emitted the request credential'
        ).toEqual([]);
    });
});

describe('endpointCategory', () => {
    it('keeps only the first path segment', () => {
        expect(
            endpointCategory(
                `${SERVER}/Videos/0000/stream.mp4?ApiKey=${SYNTHETIC_CREDENTIAL}`
            )
        ).toBe('Videos');
        expect(endpointCategory('/Audio/0000/universal?api_key=x')).toBe(
            'Audio'
        );
        expect(endpointCategory('Items?SortBy=SortName')).toBe('Items');
    });

    it('never returns a query string, a fragment or an origin', () => {
        for (const url of [
            `${SERVER}/Videos/1/stream.mp4?ApiKey=${SYNTHETIC_CREDENTIAL}#t=30`,
            `${SERVER}/Audio/1/universal?api_key=${SYNTHETIC_CREDENTIAL}`,
            `//attacker.invalid/ApiKey=${SYNTHETIC_CREDENTIAL}`
        ]) {
            const category = endpointCategory(url);
            expect(category).not.toContain(SYNTHETIC_CREDENTIAL);
            expect(category).not.toContain('?');
            expect(category).not.toContain('#');
            expect(category).not.toContain('/');
        }
    });

    it('refuses a segment that is not a plain endpoint name', () => {
        // A long opaque first segment is an identifier or an encoded blob, not a category.
        expect(endpointCategory(`/${'a'.repeat(64)}/x`)).toBe('unknown');
        expect(endpointCategory(`/${SYNTHETIC_CREDENTIAL}=/x`)).toBe('unknown');
    });

    it('has a defined answer for the degenerate inputs', () => {
        expect(endpointCategory(SERVER)).toBe('root');
        expect(endpointCategory('')).toBe('unknown');
        expect(endpointCategory(undefined)).toBe('unknown');
        expect(endpointCategory(null)).toBe('unknown');
        expect(endpointCategory(42)).toBe('unknown');
    });
});

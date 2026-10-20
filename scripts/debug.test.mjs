import assert from 'node:assert/strict';
import { test } from 'node:test';

import { debug } from '../src/utils/debug.js';

test('production is quiet, runtime opt-in is exact, and errors remain visible', () => {
    const environment = process.env.NODE_ENV;
    const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const originalDebug = console.debug;
    const originalWarn = console.warn;
    const originalError = console.error;
    const seen = [];
    let value = null;
    try {
        process.env.NODE_ENV = 'production';
        console.debug = (...args) => seen.push(['debug', ...args]);
        console.warn = (...args) => seen.push(['warn', ...args]);
        console.error = (...args) => seen.push(['error', ...args]);
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: (key) => (key === 'tesserafin.debug' ? value : null)
            }
        });
        debug('quiet');
        value = 'false';
        debug('still quiet');
        value = '1';
        debug('not an opt-in');
        assert.deepEqual(seen, []);
        value = 'true';
        debug('diagnostic', 7);
        value = null;
        debug('disabled without reload');
        console.warn('warning');
        console.error('error');
        assert.deepEqual(seen, [
            ['debug', 'diagnostic', 7],
            ['warn', 'warning'],
            ['error', 'error']
        ]);

        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get() {
                throw new Error('storage denied');
            }
        });
        debug('denied storage stays quiet');
        process.env.NODE_ENV = 'development';
        debug('development remains verbose');
        assert.deepEqual(seen.at(-1), ['debug', 'development remains verbose']);
        assert.equal(seen.length, 4);
    } finally {
        if (environment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = environment;
        if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
        else delete globalThis.localStorage;
        console.debug = originalDebug;
        console.warn = originalWarn;
        console.error = originalError;
    }
});

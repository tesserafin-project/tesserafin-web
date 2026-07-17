import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    __resetColorSchemeCacheForTests,
    ensureColorSchemeLoaded,
    getColorSchemes
} from './colorSchemeCache';

afterEach(() => {
    __resetColorSchemeCacheForTests();
    vi.restoreAllMocks();
});

describe('getColorSchemes()', () => {
    it('starts with the synchronously bundled schemes only', () => {
        const schemes = getColorSchemes();

        expect(Object.keys(schemes).sort()).toEqual(
            ['dark', 'light', 'official.classic'].sort()
        );
    });

    it('resolves official.classic to the same object as the legacy dark preset', () => {
        const schemes = getColorSchemes();
        expect(schemes['official.classic']).toBe(schemes.dark);
    });
});

describe('ensureColorSchemeLoaded()', () => {
    it('is a no-op for an already-loaded id', async () => {
        await expect(ensureColorSchemeLoaded('dark')).resolves.toBeUndefined();
        expect(Object.keys(getColorSchemes()).sort()).toEqual(
            ['dark', 'light', 'official.classic'].sort()
        );
    });

    it('is a no-op for an unknown id', async () => {
        await expect(
            ensureColorSchemeLoaded('does-not-exist')
        ).resolves.toBeUndefined();
        expect(Object.keys(getColorSchemes()).sort()).toEqual(
            ['dark', 'light', 'official.classic'].sort()
        );
    });

    it('is a no-op for an undefined id', async () => {
        await expect(
            ensureColorSchemeLoaded(undefined)
        ).resolves.toBeUndefined();
    });

    it('lazily loads and caches a legacy preset color scheme', async () => {
        expect(getColorSchemes().appletv).toBeUndefined();

        await ensureColorSchemeLoaded('appletv');

        const schemes = getColorSchemes();
        expect(schemes.appletv).toBeDefined();
        expect(schemes.appletv?.palette?.mode).toBe('light');
    });

    it('dedupes concurrent requests for the same id', async () => {
        const [a, b] = await Promise.all([
            ensureColorSchemeLoaded('purplehaze'),
            ensureColorSchemeLoaded('purplehaze')
        ]);

        expect(a).toBeUndefined();
        expect(b).toBeUndefined();
        expect(getColorSchemes().purplehaze).toBeDefined();
    });

    it('does not clobber a scheme already loaded by a concurrent request', async () => {
        await Promise.all([
            ensureColorSchemeLoaded('wmc'),
            ensureColorSchemeLoaded('wmc')
        ]);

        const schemes = getColorSchemes();
        expect(schemes.wmc).toBeDefined();
        expect(schemes.wmc?.palette?.mode).toBe('dark');
    });
});

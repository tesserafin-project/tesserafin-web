import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    __resetColorSchemeCacheForTests,
    ensureColorSchemeLoaded,
    getColorSchemes
} from './colorSchemeCache';
import { getThemeEntry } from './registry';

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
    it('reports an already-loaded id as available without touching the cache', async () => {
        await expect(ensureColorSchemeLoaded('dark')).resolves.toBe(true);
        expect(Object.keys(getColorSchemes()).sort()).toEqual(
            ['dark', 'light', 'official.classic'].sort()
        );
    });

    // An id absent from the registry is unrenderable, so it must be reported as unavailable rather
    // than as a silent no-op — that boolean is what drives `useAppTheme`'s fallback to Classic.
    it('reports an unknown id as unavailable', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(ensureColorSchemeLoaded('does-not-exist')).resolves.toBe(
            false
        );
        expect(Object.keys(getColorSchemes()).sort()).toEqual(
            ['dark', 'light', 'official.classic'].sort()
        );
    });

    it('treats an undefined id as "nothing requested, nothing missing"', async () => {
        await expect(ensureColorSchemeLoaded(undefined)).resolves.toBe(true);
    });

    // The failure this models is the real one G18b-1 introduces: Glass is now user-selectable, and
    // it is a lazily-imported chunk, so a pruned/corrupt chunk is a reachable state for a restored
    // preference. `loadColorScheme` is stubbed on the frozen registry entry because the rejection
    // has to come from the dynamic import itself.
    it('reports a theme whose lazy chunk fails to load as unavailable', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const glass = getThemeEntry('official.glass');
        expect(glass).toBeDefined();
        vi.spyOn(glass!, 'loadColorScheme').mockRejectedValue(
            new Error('ChunkLoadError: Loading chunk failed')
        );

        await expect(ensureColorSchemeLoaded('official.glass')).resolves.toBe(
            false
        );
        expect(getColorSchemes()['official.glass']).toBeUndefined();
    });

    it('does not strand the failed id as permanently pending, so a later retry can succeed', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const glass = getThemeEntry('official.glass');
        const spy = vi
            .spyOn(glass!, 'loadColorScheme')
            .mockRejectedValueOnce(new Error('ChunkLoadError'));

        expect(await ensureColorSchemeLoaded('official.glass')).toBe(false);

        spy.mockRestore();
        expect(await ensureColorSchemeLoaded('official.glass')).toBe(true);
        expect(getColorSchemes()['official.glass']).toBeDefined();
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

        expect(a).toBe(true);
        expect(b).toBe(true);
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

import type { ColorSystemOptions } from '@mui/material/styles';

import darkColorScheme from './dark';
import lightColorScheme from './light';
import officialClassicColorScheme from './official.classic';
import { getThemeEntry } from './registry';

export type ColorSchemeMap = Record<string, ColorSystemOptions>;

/**
 * Color schemes bundled synchronously with the main chunk (RFC-0005 §9.1): these back Reefin
 * Classic and the legacy "dark"/"light" presets it absorbs (RFC-0005 §8.1), so they must be ready
 * before the first paint. Every other theme is added to this same module-level cache lazily, via
 * `ensureColorSchemeLoaded` below — mutated in place (not replaced) since callers only need to know
 * *when* their id has been loaded (`themes/useAppTheme.ts` reacts to the resolved promise, not to
 * cache identity), not to be notified of loads they did not ask for.
 */
const cache: ColorSchemeMap = {
    'official.classic': officialClassicColorScheme,
    dark: darkColorScheme,
    light: lightColorScheme
};
const pending = new Map<string, Promise<boolean>>();

/** Current snapshot of loaded color schemes, keyed by theme id. */
export const getColorSchemes = (): ColorSchemeMap => cache;

/**
 * Ensures the color scheme for `id` is present in the cache, loading it from the theme registry
 * (RFC-0005 §7.4) when it is not cached yet. Concurrent requests for the same id share one
 * in-flight promise.
 *
 * Resolves to whether a usable color scheme for `id` is now cached — `false` when the id is not in
 * the registry at all (an invalid/stale manifest entry, or a preference persisted by an older
 * build) or when its lazy chunk failed to load (network error, a chunk pruned by a deploy,
 * a corrupt bundle). Both are reported the same way on purpose: from the caller's side "this theme
 * cannot be rendered" is one condition with one correct response, which is to fall back to the
 * default theme rather than leave the app tagged with a theme whose palette never arrived. That
 * fallback is `useAppTheme.ts`'s job — see the `unavailableThemeIds` state there.
 *
 * `undefined` resolves to `true`: no theme was requested, so nothing is missing.
 */
export const ensureColorSchemeLoaded = (
    id: string | undefined
): Promise<boolean> => {
    if (!id || cache[id]) {
        return Promise.resolve(true);
    }

    const existingRequest = pending.get(id);
    if (existingRequest) {
        return existingRequest;
    }

    const entry = getThemeEntry(id);
    if (!entry) {
        console.error(
            `[themes] no registry entry for theme "${id}" - falling back to the default theme`
        );
        return Promise.resolve(false);
    }

    const request = entry
        .loadColorScheme()
        .then((colorScheme) => {
            cache[id] = colorScheme;
            return true;
        })
        .catch((err: unknown) => {
            console.error(`[themes] failed to load color scheme "${id}"`, err);
            return false;
        })
        .finally(() => {
            pending.delete(id);
        });

    pending.set(id, request);
    return request;
};

/** Test-only: resets the module-level cache back to its initial state. */
export const __resetColorSchemeCacheForTests = (): void => {
    for (const id of Object.keys(cache)) {
        if (id !== 'official.classic' && id !== 'dark' && id !== 'light') {
            delete cache[id];
        }
    }
    pending.clear();
};

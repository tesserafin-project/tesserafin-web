/**
 * `MediaGrid` density state for `/library/:libraryId` (RFC-0005 §11 WP-C mission scope: "densité
 * comfortable/compact persistée localStorage ... + query params"). Read from the `density` URL
 * query param first (so a shared/refreshed link reproduces the view exactly), falling back to the
 * per-library `localStorage` value (so a fresh visit remembers the user's last choice), then to
 * `comfortable`.
 */

export type LibraryDensity = 'comfortable' | 'compact';

export const DEFAULT_DENSITY: LibraryDensity = 'comfortable';

export const DENSITY_QUERY_PARAM = 'density';

/** The `localStorage` key for one library's density preference, e.g. `library-density-abc123`. */
export const getDensityStorageKey = (libraryId: string): string =>
    `library-density-${libraryId}`;

export const isLibraryDensity = (
    value: string | null | undefined
): value is LibraryDensity => value === 'comfortable' || value === 'compact';

/** Resolves the effective density: URL param wins, then the stored preference, then the default. */
export const resolveLibraryDensity = (
    urlValue: string | null,
    storedValue: LibraryDensity | undefined
): LibraryDensity => {
    if (isLibraryDensity(urlValue)) return urlValue;
    if (isLibraryDensity(storedValue)) return storedValue;
    return DEFAULT_DENSITY;
};

export const toggleLibraryDensity = (
    density: LibraryDensity
): LibraryDensity => (density === 'comfortable' ? 'compact' : 'comfortable');

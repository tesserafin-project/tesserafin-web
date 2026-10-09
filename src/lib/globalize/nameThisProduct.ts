/**
 * The inherited dictionaries — every locale of them — call the product Jellyfin, so a first-run
 * wizard greeted new users with "Welcome to Jellyfin!". Tesserafin is not Jellyfin and says so
 * everywhere else; the name is corrected once here, where every locale passes, rather than in
 * a hundred translation files that upstream synchronisation would put straight back.
 */
export function nameThisProduct(
    dictionary: Record<string, unknown>
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(dictionary).map(([key, value]) => [
            key,
            typeof value === 'string'
                ? value.replace(/Jellyfin/g, 'Tesserafin')
                : value
        ])
    );
}

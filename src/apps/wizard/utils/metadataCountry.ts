/**
 * Derives a metadata country from the metadata language the operator chose (#139 gate 7).
 *
 * The setup wizard used to ask for both. The country question has no answer a household can give
 * better than the platform can: it exists to pick a ratings board and a release calendar, and both
 * follow from the language you asked for metadata in. #129's settings doctrine — "wizard only for
 * unavoidable initial decisions" — makes that a default, not a question.
 *
 * The derivation is CLDR's own likely-subtags table, reached through `Intl.Locale#maximize()`, so
 * there is no hand-maintained language-to-country map to drift: `fr` → `FR`, `pt` → `BR`, `en` →
 * `US`, and so on, exactly as the platform would resolve them anywhere else.
 *
 * Fail-safe by construction: an unrecognised language, an engine without `maximize`, or a region the
 * server does not offer all yield `null`, and the caller keeps whatever `MetadataCountryCode` the
 * server already had. Nothing here ever clears a country that was previously set.
 */
export const deriveMetadataCountry = (
    language: string | null | undefined,
    availableCountryCodes: readonly string[]
): string | null => {
    if (!language) return null;

    let region: string | undefined;
    try {
        region = new Intl.Locale(language).maximize().region;
    } catch {
        return null;
    }

    if (!region) return null;

    return availableCountryCodes.includes(region) ? region : null;
};

/**
 * The inherited dictionaries — every locale of them — call the product Jellyfin, so a first-run
 * wizard greeted new users with "Welcome to Jellyfin!". Until the branding wave rewrites the
 * dictionaries themselves, the name is corrected at display time, and only in the keys below.
 *
 * The list is deliberately the first-run wizard's and nothing else: each key was read in en-us and
 * names the product the user is installing. Every other string keeps its inherited text — among
 * them references to the upstream project (`LabelDisplayLanguageHelp`), technical examples
 * (`LabelAppNameExample`) and some thirty keys that mention Jellyfin in a few locales only and
 * have not been reviewed one by one.
 */
const FIRST_RUN_PRODUCT_KEYS = [
    'WelcomeToProject',
    'UserProfilesIntro',
    'WizardCompleted'
];

export function nameThisProduct(
    dictionary: Record<string, unknown>
): Record<string, unknown> {
    const named = { ...dictionary };
    for (const key of FIRST_RUN_PRODUCT_KEYS) {
        const value = named[key];
        if (typeof value === 'string') {
            named[key] = value.replace(/Jellyfin/g, 'Tesserafin');
        }
    }
    return named;
}

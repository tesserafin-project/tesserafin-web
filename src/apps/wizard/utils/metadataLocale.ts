/**
 * Derives the metadata language a first run should start with, instead of asking for it
 * (#139 gate 7, #129 "wizard only for unavoidable initial decisions").
 *
 * Tesserafin launches English-only, so the *display* language is not a first-run decision at all and
 * no control offers it. Metadata language is a different question — it is about the catalogue, not
 * the interface — but it is still not an unavoidable one: the browser already carries the
 * household's locale, ordinary Display preferences can change it afterwards, and a per-library
 * override exists for the cases that matter. So it is derived here and asked nowhere.
 *
 * The rules, in order:
 *
 * 1. An existing value that is not the server's own default is an EXPLICIT choice — a resumed or
 *    upgraded setup where somebody already answered. It is preserved untouched.
 * 2. Otherwise the browser's locale list is walked in preference order and the first language the
 *    server actually offers wins.
 * 3. Otherwise whatever the server already had is kept.
 * 4. Otherwise English, which is the server's default anyway.
 *
 * Nothing here can return an empty value, and nothing here can return a language the server did not
 * list — rule 2 checks membership, and rules 1/3/4 only ever hand back what the server itself
 * supplied. The region that goes with the result is derived separately by
 * `apps/wizard/utils/metadataCountry`.
 */

/** The server's own `PreferredMetadataLanguage` default, and this module's last resort. */
export const DEFAULT_METADATA_LANGUAGE = 'en';

/**
 * The two-letter language subtag of a BCP 47 tag.
 *
 * `Intl.Locale` is the correct parser and is used when the engine has it. The manual fallback is
 * not a second implementation of locale parsing: it takes the primary subtag, which is the only
 * part this function ever returns, and it exists so that an engine without `Intl.Locale` derives a
 * sensible language rather than throwing on the first step of a first run.
 */
const toLanguageCode = (locale: string | null | undefined): string | null => {
    if (!locale) return null;

    try {
        const language = new Intl.Locale(locale).language;
        if (language) return language.toLowerCase();
    } catch {
        // Either the engine has no `Intl.Locale` or the tag is not structurally valid. Both fall
        // through to the primary-subtag reading below, which cannot throw.
    }

    const primary = String(locale).split(/[-_]/)[0].toLowerCase();
    return /^[a-z]{2,3}$/.test(primary) ? primary : null;
};

export const deriveMetadataLanguage = (
    locales: readonly (string | null | undefined)[],
    availableLanguageCodes: readonly string[],
    existing: string | null | undefined
): string => {
    // Rule 1: somebody already answered this question. Never overwrite that.
    if (existing && existing !== DEFAULT_METADATA_LANGUAGE) return existing;

    // Rule 2: the household's own locale, in the browser's stated preference order.
    for (const locale of locales) {
        const language = toLanguageCode(locale);
        if (language && availableLanguageCodes.includes(language))
            return language;
    }

    // Rules 3 and 4.
    return existing || DEFAULT_METADATA_LANGUAGE;
};

/**
 * The locale list this browser states, most preferred first, normalised to a plain array so callers
 * do not have to care whether `navigator.languages` exists on the engine they are running on.
 */
export const browserLocales = (): string[] => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    if (!nav) return [];
    if (Array.isArray(nav.languages) && nav.languages.length > 0) {
        return [...nav.languages];
    }
    return nav.language ? [nav.language] : [];
};

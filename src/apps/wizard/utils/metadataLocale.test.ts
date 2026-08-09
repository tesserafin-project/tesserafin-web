import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_METADATA_LANGUAGE,
    browserLocales,
    deriveMetadataLanguage
} from './metadataLocale';

/** A plausible slice of what `GET /Localization/Cultures` offers. */
const SERVER_LANGUAGES = ['en', 'fr', 'pt', 'de', 'ja', 'nl'];

describe('deriveMetadataLanguage', () => {
    it('takes the browser locale when the server offers that language', () => {
        expect(deriveMetadataLanguage(['fr-BE'], SERVER_LANGUAGES, 'en')).toBe(
            'fr'
        );
        expect(deriveMetadataLanguage(['pt-BR'], SERVER_LANGUAGES, 'en')).toBe(
            'pt'
        );
        expect(deriveMetadataLanguage(['en-GB'], SERVER_LANGUAGES, 'en')).toBe(
            'en'
        );
    });

    it('walks the browser preference order and takes the first supported language', () => {
        expect(
            deriveMetadataLanguage(
                ['cy-GB', 'ga-IE', 'nl-BE', 'fr-BE'],
                SERVER_LANGUAGES,
                'en'
            )
        ).toBe('nl');
    });

    it('falls back to the server value when no stated locale is supported', () => {
        expect(
            deriveMetadataLanguage(['cy-GB', 'gd'], SERVER_LANGUAGES, 'en')
        ).toBe('en');
    });

    it('falls back to English when the server has nothing to fall back to', () => {
        expect(deriveMetadataLanguage(['cy-GB'], SERVER_LANGUAGES, '')).toBe(
            DEFAULT_METADATA_LANGUAGE
        );
        expect(deriveMetadataLanguage(['cy-GB'], SERVER_LANGUAGES, null)).toBe(
            DEFAULT_METADATA_LANGUAGE
        );
        expect(deriveMetadataLanguage([], [], undefined)).toBe(
            DEFAULT_METADATA_LANGUAGE
        );
    });

    it('preserves an explicit existing value on a resumed or upgraded setup', () => {
        // The operator already answered `de` in a previous, abandoned run. A French browser must
        // not silently overwrite it.
        expect(deriveMetadataLanguage(['fr-BE'], SERVER_LANGUAGES, 'de')).toBe(
            'de'
        );
        // Even a language this server no longer lists is preserved rather than cleared.
        expect(deriveMetadataLanguage(['fr-BE'], SERVER_LANGUAGES, 'sv')).toBe(
            'sv'
        );
    });

    it('never returns a language the server did not offer', () => {
        expect(deriveMetadataLanguage(['ja-JP'], ['en', 'fr'], 'en')).toBe(
            'en'
        );
    });

    it('ignores unusable entries in the locale list instead of throwing', () => {
        expect(
            deriveMetadataLanguage(
                ['not a locale', '', null, undefined, 'fr-BE'],
                SERVER_LANGUAGES,
                'en'
            )
        ).toBe('fr');
    });

    it('resolves deterministically on an engine without Intl.Locale', () => {
        const intl = Intl as unknown as { Locale?: typeof Intl.Locale };
        const original = intl.Locale;
        try {
            // Deliberately removing the API the happy path uses.
            delete intl.Locale;
            expect(
                deriveMetadataLanguage(['fr-BE'], SERVER_LANGUAGES, 'en')
            ).toBe('fr');
            expect(
                deriveMetadataLanguage(['pt-BR'], SERVER_LANGUAGES, 'en')
            ).toBe('pt');
            expect(
                deriveMetadataLanguage(['not a locale'], SERVER_LANGUAGES, 'en')
            ).toBe('en');
        } finally {
            intl.Locale = original;
        }
    });
});

describe('browserLocales', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reads the stated preference order', () => {
        vi.stubGlobal('navigator', {
            languages: ['fr-BE', 'nl-BE'],
            language: 'fr-BE'
        });
        expect(browserLocales()).toEqual(['fr-BE', 'nl-BE']);
    });

    it('falls back to the single language on engines without navigator.languages', () => {
        vi.stubGlobal('navigator', { language: 'pt-BR' });
        expect(browserLocales()).toEqual(['pt-BR']);
    });

    it('returns nothing rather than throwing when the engine states no locale', () => {
        vi.stubGlobal('navigator', {});
        expect(browserLocales()).toEqual([]);
    });
});

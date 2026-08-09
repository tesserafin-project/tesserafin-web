import { describe, expect, it } from 'vitest';

import { deriveMetadataCountry } from './metadataCountry';

const SERVER_COUNTRIES = ['US', 'GB', 'FR', 'BR', 'DE', 'JP'];

describe('deriveMetadataCountry', () => {
    it('derives the region CLDR considers likely for the chosen language', () => {
        expect(deriveMetadataCountry('fr', SERVER_COUNTRIES)).toBe('FR');
        expect(deriveMetadataCountry('pt', SERVER_COUNTRIES)).toBe('BR');
        expect(deriveMetadataCountry('ja', SERVER_COUNTRIES)).toBe('JP');
    });

    it('honours an explicit region on the language tag', () => {
        expect(deriveMetadataCountry('en-GB', SERVER_COUNTRIES)).toBe('GB');
        expect(deriveMetadataCountry('en-US', SERVER_COUNTRIES)).toBe('US');
    });

    it('returns null when the server does not offer the derived region', () => {
        // `it` maximizes to `it-IT`, which this server has never heard of. Inventing the code would
        // hand the server a value it would reject or silently store as nonsense.
        expect(deriveMetadataCountry('it', SERVER_COUNTRIES)).toBeNull();
    });

    it('returns null rather than guessing for absent or unusable input', () => {
        expect(deriveMetadataCountry('', SERVER_COUNTRIES)).toBeNull();
        expect(deriveMetadataCountry(null, SERVER_COUNTRIES)).toBeNull();
        expect(deriveMetadataCountry(undefined, SERVER_COUNTRIES)).toBeNull();
        expect(
            deriveMetadataCountry('not a locale', SERVER_COUNTRIES)
        ).toBeNull();
    });

    it('never derives anything when the server offers no countries', () => {
        expect(deriveMetadataCountry('fr', [])).toBeNull();
    });
});

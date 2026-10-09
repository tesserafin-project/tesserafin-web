import { describe, expect, it } from 'vitest';

import { nameThisProduct } from './nameThisProduct';

describe('nameThisProduct()', () => {
    it('names Tesserafin in every string of an inherited dictionary', () => {
        expect(
            nameThisProduct({
                WelcomeToProject: 'Bienvenue dans Jellyfin !',
                MessageConfirmRestart:
                    'Are you sure you wish to restart Jellyfin?',
                Next: 'Next'
            })
        ).toEqual({
            WelcomeToProject: 'Bienvenue dans Tesserafin !',
            MessageConfirmRestart:
                'Are you sure you wish to restart Tesserafin?',
            Next: 'Next'
        });
    });

    it('leaves the sentence about upstream translation alone', () => {
        const upstream = {
            LabelDisplayLanguageHelp:
                'Translating Jellyfin is an ongoing project.'
        };
        expect(nameThisProduct(upstream)).toEqual(upstream);
    });

    it('passes non-string members of a JSON module through', () => {
        const nested = { a: 'Jellyfin' };
        expect(nameThisProduct({ default: nested })).toEqual({
            default: nested
        });
    });
});

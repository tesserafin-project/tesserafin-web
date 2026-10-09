import { describe, expect, it } from 'vitest';

import enUs from '../../strings/en-us.json';
import { nameThisProduct } from './nameThisProduct';

describe('nameThisProduct()', () => {
    it('names Tesserafin in the first-run wizard keys, in any locale', () => {
        expect(
            nameThisProduct({
                WelcomeToProject: 'Bienvenue dans Jellyfin !',
                UserProfilesIntro:
                    'Jellyfin includes support for user profiles.',
                WizardCompleted: 'Jellyfin hat begonnen, Jellyfin zu lesen.',
                Next: 'Next'
            })
        ).toEqual({
            WelcomeToProject: 'Bienvenue dans Tesserafin !',
            UserProfilesIntro: 'Tesserafin includes support for user profiles.',
            WizardCompleted: 'Tesserafin hat begonnen, Tesserafin zu lesen.',
            Next: 'Next'
        });
    });

    it('leaves every other key alone, whatever it says', () => {
        const untouched = {
            // About the upstream project.
            LabelDisplayLanguageHelp:
                'Translating Jellyfin is an ongoing project.',
            // A technical example and a URL.
            LabelAppNameExample: 'Example: Sickbeard, Jellyfin',
            SomeLink: 'https://jellyfin.org/docs/ for Jellyfin',
            // A placeholder string outside the first run.
            PleaseRestartServerName: 'Please restart Jellyfin on {0}.'
        };
        expect(nameThisProduct(untouched)).toEqual(untouched);
    });

    it('changes exactly the listed keys of the real en-us dictionary', () => {
        const before = enUs as Record<string, unknown>;
        const after = nameThisProduct(before);
        const changed = Object.keys(before).filter(
            (key) => before[key] !== after[key]
        );
        // WizardCompleted no longer names anything in en-us; it still does in other locales.
        expect(changed.sort()).toEqual([
            'UserProfilesIntro',
            'WelcomeToProject'
        ]);
        expect(after.WelcomeToProject).toBe('Welcome to Tesserafin!');
    });

    it('does not mutate the module it was given and passes non-strings through', () => {
        const nested = { a: 'Jellyfin' };
        const source = { default: nested, WelcomeToProject: 'Jellyfin' };
        expect(nameThisProduct(source)).toEqual({
            default: nested,
            WelcomeToProject: 'Tesserafin'
        });
        expect(source.WelcomeToProject).toBe('Jellyfin');
    });
});

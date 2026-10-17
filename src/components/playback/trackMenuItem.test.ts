import { describe, expect, it } from 'vitest';

import { languageName, trackMenuItem } from './trackMenuItem';

const FR: Record<string, string> = {
    MediaInfoDefault: 'Par défaut',
    MediaInfoForced: 'Forcé',
    MediaInfoExternal: 'Externe'
};
const translate = (key: string) => FR[key] ?? key;

describe('trackMenuItem', () => {
    it('leads with the language in the viewer locale and moves flags aside', () => {
        // The rig's real subtitle track: DisplayTitle "French - Default - SUBRIP".
        expect(
            trackMenuItem(
                {
                    Index: 4,
                    Language: 'fra',
                    Codec: 'subrip',
                    IsDefault: true,
                    DisplayTitle: 'French - Default - SUBRIP'
                },
                'fr',
                translate
            )
        ).toEqual({
            name: 'Français',
            secondaryText: 'SRT',
            asideText: 'Par défaut'
        });
    });

    it('keeps an author title that says more than the language', () => {
        expect(
            trackMenuItem(
                {
                    Index: 3,
                    Language: 'eng',
                    Title: 'English Commentary',
                    Codec: 'aac',
                    Channels: 1
                },
                'fr',
                translate
            )
        ).toEqual({ name: 'Anglais', secondaryText: 'English Commentary' });
    });

    it('drops a title that only repeats the language, and tells two tracks apart by format', () => {
        expect(
            trackMenuItem(
                {
                    Index: 2,
                    Language: 'fra',
                    Title: 'français',
                    Codec: 'ac3',
                    Channels: 6
                },
                'fr',
                translate
            )
        ).toEqual({ name: 'Français', secondaryText: 'AC3 5.1' });
    });

    it('joins several flags', () => {
        expect(
            trackMenuItem(
                {
                    Index: 0,
                    Language: 'deu',
                    Codec: 'subrip',
                    IsForced: true,
                    IsExternal: true
                },
                'fr',
                translate
            ).asideText
        ).toBe('Forcé · Externe');
    });

    it('falls back to the title, then the server string, when the language is unknown', () => {
        expect(
            trackMenuItem(
                {
                    Index: 1,
                    Language: 'und',
                    Title: 'Director',
                    Codec: 'aac',
                    Channels: 2
                },
                'fr',
                translate
            )
        ).toEqual({ name: 'Director', secondaryText: 'AAC 2.0' });
        expect(
            trackMenuItem(
                { Index: 1, DisplayTitle: 'Track 1' },
                'fr',
                translate
            )
        ).toEqual({ name: 'Track 1' });
    });

    it('never names undetermined or bogus codes', () => {
        expect(languageName('und', 'fr')).toBeUndefined();
        expect(languageName('', 'fr')).toBeUndefined();
        expect(languageName('not a code!', 'fr')).toBeUndefined();
        expect(languageName('eng', 'en-US')).toBe('English');
    });
});

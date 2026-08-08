import { describe, expect, it } from 'vitest';

import type { UserConfiguration } from 'lib/tesserafin-sdk/generated/models/user-configuration';

import {
    applyBrowsingPreference,
    ContentPackBrowsingPreference,
    DEFAULT_BROWSING_PREFERENCE,
    isContentPackFirst,
    resolveBrowsingPreference
} from './browsingPreference';

describe('resolveBrowsingPreference', () => {
    it('treats an absent value as media-family-first', () => {
        // #139 gate 5: every existing user has no value at all, and none of them may be prompted.
        // There is no third "unset" state to prompt about because unset already means something.
        expect(resolveBrowsingPreference({} as UserConfiguration)).toBe(
            ContentPackBrowsingPreference.MediaFamilyFirst
        );
        expect(resolveBrowsingPreference(undefined)).toBe(
            ContentPackBrowsingPreference.MediaFamilyFirst
        );
        expect(resolveBrowsingPreference(null)).toBe(
            ContentPackBrowsingPreference.MediaFamilyFirst
        );
    });

    it('treats an unrecognised value as media-family-first', () => {
        expect(
            resolveBrowsingPreference({
                ContentPackBrowsingPreference: 'SomethingElse'
            } as unknown as UserConfiguration)
        ).toBe(ContentPackBrowsingPreference.MediaFamilyFirst);
    });

    it('honours an explicit content-pack-first', () => {
        expect(
            resolveBrowsingPreference({
                ContentPackBrowsingPreference:
                    ContentPackBrowsingPreference.ContentPackFirst
            } as UserConfiguration)
        ).toBe(ContentPackBrowsingPreference.ContentPackFirst);
    });

    it('defaults to media-family-first', () => {
        expect(DEFAULT_BROWSING_PREFERENCE).toBe(
            ContentPackBrowsingPreference.MediaFamilyFirst
        );
    });
});

describe('isContentPackFirst', () => {
    it('is false unless the value is explicitly content-pack-first', () => {
        expect(isContentPackFirst(undefined)).toBe(false);
        expect(isContentPackFirst({} as UserConfiguration)).toBe(false);
        expect(
            isContentPackFirst({
                ContentPackBrowsingPreference:
                    ContentPackBrowsingPreference.MediaFamilyFirst
            } as UserConfiguration)
        ).toBe(false);
        expect(
            isContentPackFirst({
                ContentPackBrowsingPreference:
                    ContentPackBrowsingPreference.ContentPackFirst
            } as UserConfiguration)
        ).toBe(true);
    });
});

describe('applyBrowsingPreference', () => {
    it('changes exactly one key and preserves every other field', () => {
        const configuration = {
            AudioLanguagePreference: 'fra',
            SubtitleMode: 'Smart',
            DisplayMissingEpisodes: true,
            OrderedViews: ['a', 'b'],
            EnableNextEpisodeAutoPlay: false
        } as unknown as UserConfiguration;

        const next = applyBrowsingPreference(
            configuration,
            ContentPackBrowsingPreference.ContentPackFirst
        );

        expect(next).toEqual({
            ...configuration,
            ContentPackBrowsingPreference:
                ContentPackBrowsingPreference.ContentPackFirst
        });
        // The input is not mutated: the caller still holds the server's last answer.
        expect(configuration).not.toHaveProperty(
            'ContentPackBrowsingPreference'
        );
    });

    it('can move the arrangement back', () => {
        const configuration = {
            ContentPackBrowsingPreference:
                ContentPackBrowsingPreference.ContentPackFirst
        } as UserConfiguration;

        expect(
            applyBrowsingPreference(
                configuration,
                ContentPackBrowsingPreference.MediaFamilyFirst
            ).ContentPackBrowsingPreference
        ).toBe(ContentPackBrowsingPreference.MediaFamilyFirst);
    });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SUGGESTED_CONTENT_PACK_NAMES } from './suggestedPacks';

describe('SUGGESTED_CONTENT_PACK_NAMES', () => {
    it('is the contract §3.7 suggestion list', () => {
        expect(SUGGESTED_CONTENT_PACK_NAMES).toEqual([
            'Movies and series',
            'Music',
            'Photos and home video',
            'Sport',
            'Concerts',
            'Theatre and performances',
            'Podcasts',
            'Audiobooks',
            'Anime'
        ]);
    });

    it('is data — plain strings, no identity a code path could key on', () => {
        for (const name of SUGGESTED_CONTENT_PACK_NAMES) {
            expect(typeof name).toBe('string');
        }
    });

    /**
     * #139 gate 3, enforced structurally rather than by review.
     *
     * A substring sweep for the names themselves would be worthless — "Music", "Sport" and "Anime"
     * are ordinary words the product already uses for media families and home sections, and hits on
     * those prove nothing. What actually matters is reachability: if only the first-run step can see
     * the list, no other code path can branch on a member of it, and a pack the household typed
     * itself is indistinguishable from a seeded one everywhere else in the product.
     */
    it('is reachable from the first-run step and nowhere else', async () => {
        const { globSync } = await import('tinyglobby');
        const files = globSync(['src/**/*.{ts,tsx,js,jsx}'], {
            ignore: [
                'src/apps/modern/features/contentPacks/constants/suggestedPacks.ts',
                'src/apps/modern/features/contentPacks/constants/suggestedPacks.test.ts'
            ]
        });

        const importers = files.filter((file) =>
            /SUGGESTED_CONTENT_PACK_NAMES|constants\/suggestedPacks/.test(
                readFileSync(file, 'utf8')
            )
        );

        expect(importers).toEqual([
            'src/apps/wizard/controllers/packs/index.js'
        ]);
    });
});

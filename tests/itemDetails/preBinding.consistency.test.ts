/**
 * The guard on the pre-binding record.
 *
 * `tests/fixtures/item-details/pre-binding-composition.json` is what #129 Step 2 is judged against:
 * the Item Details composition as the MIGRATED route rendered it before any recipe was bound. A
 * record the change can regenerate proves nothing, so the checksum lives HERE, in source, and the
 * capture that writes the fixture is skipped unless `CAPTURE_PRE_BINDING=1`.
 *
 * To refresh the record you must run the capture AND edit {@link PRE_BINDING_SHA256} by hand. Both
 * show up in review. That is the entire mechanism, and it is the same one
 * `ledger.consistency.test.ts` uses to pin the P5 fixture.
 *
 * This file asserts the record's SHAPE and INTEGRITY only. Whether the bound route still reproduces
 * it is `itemDetails.recipe.test.tsx`'s job.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import legacyContract from '../fixtures/item-details/legacy-contract.json';
import { PRE_BINDING, PRE_BINDING_PATH } from './support/preBinding';

/**
 * SHA-256 of `pre-binding-composition.json` as captured from
 * `1486760c76150970fa8aab7d24d3919a6a7197fa` — origin/main, PR #136's merge commit, before the
 * first line of Step 2 was written.
 */
const PRE_BINDING_SHA256 =
    '668b261dabdc219e18c83175fb7db36b64d38acca96d4d150c2527dbc4df1fd8';

const START_SHA = '1486760c76150970fa8aab7d24d3919a6a7197fa';

describe('pre-binding composition record — integrity', () => {
    it('is byte-identical to the record captured at the start commit', () => {
        const actual = createHash('sha256')
            .update(readFileSync(PRE_BINDING_PATH))
            .digest('hex');

        expect(
            actual,
            'the pre-binding record changed. It is evidence from a commit that no longer '
                + 'exists in the working tree; regenerating it from the proposed head would make '
                + 'the equivalence proof circular.'
        ).toBe(PRE_BINDING_SHA256);
    });

    it('names the commit it was captured from', () => {
        expect(PRE_BINDING.startSha).toBe(START_SHA);
        expect(PRE_BINDING.boundAtCapture).toBe(false);
    });

    it('covers every equivalence class exactly once', () => {
        const ids = PRE_BINDING.classes.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.sort()).toEqual(
            legacyContract.classes.map((entry) => entry.id).sort()
        );
        expect(ids).toHaveLength(24);
    });

    it('records artwork, composition, headings, controls and focus for every class', () => {
        for (const entry of PRE_BINDING.classes) {
            expect(entry.sections.length, entry.id).toBeGreaterThan(0);
            expect(entry.slots.map((slot) => slot.section)).toEqual(
                entry.sections
            );
            // `MUST PRESERVE` #9, as the record states it: one poster, always.
            expect(entry.artwork.posterElement, entry.id).toBe(1);
            expect(typeof entry.focusTarget).toBe('string');
        }
    });

    it('records no backdrop for Person or Book, and one for every other class', () => {
        for (const entry of PRE_BINDING.classes) {
            const expected = ['person', 'book'].includes(entry.id) ? 0 : 1;
            expect(entry.artwork.backdropElement, entry.id).toBe(expected);
        }
    });

    /**
     * The gap Step 2 closes, stated as a fact rather than as prose.
     *
     * The platform default at capture time declared five sections in an order NO class rendered.
     * Keeping the captured declaration here is what makes "the default was corrected" auditable —
     * the P5 fixture holds the same values, and it is checksum-frozen, so neither can be edited to
     * make the correction look smaller than it was.
     */
    it('records the platform default as it stood before the binding', () => {
        expect(PRE_BINDING.platformDefaultAtCapture).toEqual(
            legacyContract.platformDefault
        );
        expect(PRE_BINDING.platformDefaultAtCapture.boundByRoute).toBe(false);
        expect(PRE_BINDING.platformDefaultAtCapture.sections).toEqual([
            'overview',
            'cast',
            'episodes',
            'related',
            'mediaInfo'
        ]);
    });

    it('lives where the capture writes it', () => {
        expect(PRE_BINDING_PATH).toBe(
            join(
                resolve(__dirname, '..', '..'),
                'tests',
                'fixtures',
                'item-details',
                'pre-binding-composition.json'
            )
        );
    });
});

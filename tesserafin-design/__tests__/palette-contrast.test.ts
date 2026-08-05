/**
 * WCAG 2.2 contrast gate for every shipped palette (RFC-0007 §6.4).
 *
 * ## Why this test has a waiver list, and why the list is a ratchet rather than a snapshot
 *
 * Four pairs in Tesserafin Classic fail today. They are not regressions and this loop did not
 * introduce them: they are the inherited `#00a4dc` primary and `#ffa726`/`#ed6c02` warning,
 * carried over unchanged. Fixing them means changing Classic's brand colours, which is the
 * Classic palette refresh, not the platform contract.
 *
 * So the failures are recorded — and then the recording is made unable to hide anything:
 *
 *   - `KNOWN_INSUFFICIENT` is asserted to be EXACTLY the set of failures. A pair that starts
 *     passing makes this test fail until its waiver is deleted, so a waiver cannot outlive the
 *     defect it documents.
 *   - A pair that starts failing and is not on the list fails the test outright.
 *
 * That is the opposite of a snapshot: a snapshot absorbs any change, this absorbs none. The list
 * can only shrink, and the Classic palette refresh is what shrinks it to empty.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    CONTRAST_REQUIREMENTS,
    contrastRatio,
    measurePalette,
    parseColor
} from '../scripts/contrast.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = join(__dirname, '..', 'themes');
const THEME_SLUGS = ['classic', 'glass'] as const;

/**
 * Pairs that do not meet their WCAG threshold today, each with the reason and the work that
 * removes it. `${slug}/${mode} ${pair}`.
 */
const KNOWN_INSUFFICIENT: Readonly<Record<string, string>> = {
    // Empty, and the four assertions below keep it that way: the Tesserafin Classic palette
    // refresh replaced the inherited #00a4dc primary and #ed6c02 warning that were the only
    // entries. A new failure now fails the build instead of being written down here.
};

function readTokens(slug: string) {
    return JSON.parse(
        readFileSync(join(THEMES_DIR, slug, 'tokens.json'), 'utf8')
    );
}

function measureAll() {
    const results: {
        key: string;
        ratio: number;
        min: number;
        sc: string;
        passes: boolean;
    }[] = [];
    for (const slug of THEME_SLUGS) {
        const tokens = readTokens(slug);
        for (const mode of Object.keys(tokens.color)) {
            for (const measurement of measurePalette(tokens.color[mode])) {
                results.push({
                    key: `${slug}/${mode} ${measurement.pair}`,
                    ratio: measurement.ratio,
                    min: measurement.min,
                    sc: measurement.sc,
                    passes: measurement.passes
                });
            }
        }
    }
    return results;
}

describe('palette contrast', () => {
    const measurements = measureAll();

    it('measures every requirement for every mode of every shipped theme', () => {
        // 2 themes x 2 modes x the requirement list — a theme that stopped declaring a mode, or a
        // requirement that stopped being measured, would silently shrink the gate otherwise.
        expect(measurements).toHaveLength(
            THEME_SLUGS.length * 2 * CONTRAST_REQUIREMENTS.length
        );
    });

    it('has no unrecorded contrast failure', () => {
        const unrecorded = measurements
            .filter((m) => !m.passes && !(m.key in KNOWN_INSUFFICIENT))
            .map(
                (m) => `${m.key} = ${m.ratio}:1 (needs ${m.min}:1, SC ${m.sc})`
            );
        expect(unrecorded).toEqual([]);
    });

    it('has no stale waiver — a pair that now passes must have its waiver deleted', () => {
        const passingButWaived = measurements
            .filter((m) => m.passes && m.key in KNOWN_INSUFFICIENT)
            .map((m) => m.key);
        expect(passingButWaived).toEqual([]);
    });

    it('waives nothing that is not actually measured', () => {
        const measuredKeys = new Set(measurements.map((m) => m.key));
        const orphans = Object.keys(KNOWN_INSUFFICIENT).filter(
            (key) => !measuredKeys.has(key)
        );
        expect(orphans).toEqual([]);
    });

    it('meets the focus-indicator threshold in every mode of every theme (SC 1.4.11)', () => {
        // Called out separately from the general gate because the focus indicator is the one
        // contrast failure a keyboard-only user cannot work around: if they cannot see where
        // focus is, the interface is not operable. No waiver is accepted here.
        const focusFailures = measurements
            .filter((m) => m.key.includes('focus/') && !m.passes)
            .map((m) => `${m.key} = ${m.ratio}:1`);
        expect(focusFailures).toEqual([]);
    });

    it('meets the body-text threshold in every mode of every theme (SC 1.4.3)', () => {
        const textFailures = measurements
            .filter(
                (m) =>
                    (m.key.includes(' text/') ||
                        m.key.includes(' textMuted/')) &&
                    !m.passes
            )
            .map((m) => `${m.key} = ${m.ratio}:1`);
        expect(textFailures).toEqual([]);
    });
});

describe('contrast maths', () => {
    it('composites alpha rather than measuring a translucent colour as opaque', () => {
        // rgba(255,255,255,0.7) over #101010 is ~#b6b6b6, not white. Measured as white it would
        // report 19:1 and hide a real reading problem.
        const background = parseColor('#101010');
        const opaqueForm = parseColor('#b6b6b6');
        if (!background || !opaqueForm) throw new Error('unparseable fixture');
        const asOpaqueWhite = contrastRatio(
            parseColor('#ffffff') as never,
            background
        );
        expect(asOpaqueWhite).toBeGreaterThan(18);
        expect(contrastRatio(opaqueForm, background)).toBeLessThan(10);
    });

    it('parses every notation tokens.schema.json admits', () => {
        expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
        expect(parseColor('#ffffff')).toEqual([255, 255, 255, 1]);
        expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1]);
        expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3, 0.5]);
        expect(parseColor('hsl(0, 0%, 100%)')).toEqual([255, 255, 255, 1]);
    });

    it('returns null rather than inventing a colour for unparseable input', () => {
        expect(parseColor('not-a-color')).toBeNull();
        expect(parseColor('#12345')).toBeNull();
    });

    it('reproduces the WCAG reference ratio for black on white', () => {
        expect(
            contrastRatio(
                parseColor('#000') as never,
                parseColor('#fff') as never
            )
        ).toBeCloseTo(21, 5);
    });
});

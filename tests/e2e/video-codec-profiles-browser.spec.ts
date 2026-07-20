import { expect, test } from '@playwright/test';

import {
    VIDEO_CODEC_PROFILE_PROBES,
    deriveCodecProfiles
} from '../../src/scripts/videoCodecProfiles';

/**
 * REAL `HTMLMediaElement.canPlayType`, REAL browser (issue #29, `Profiles` half).
 *
 * The vitest sibling (`src/scripts/videoCodecProfiles.test.ts`) proves the MAPPING - probe table in,
 * profile list out - with every answer hand-written. It cannot prove the strings themselves are the
 * ones a browser recognizes: jsdom's `canPlayType` returns `''` for everything, so a table full of
 * typos would pass it perfectly. This file closes that gap by asking a real Chromium the exact
 * strings in `VIDEO_CODEC_PROFILE_PROBES`, printing every raw answer, and deriving from those real
 * answers rather than from fixtures.
 *
 * NO SERVER, NO NAVIGATION. Unlike every other spec in this directory, nothing here talks to Reefin
 * - the assertions are about the browser's own decoder inventory, so the page stays on `about:blank`
 * and the run needs no `REEFIN_E2E_BASE_URL`. That is also why it is safe under the config's single
 * worker: it touches no shared server state.
 *
 * MEASURED, NOT ASSUMED - Playwright Chromium 149.0.7827.55 on Linux x86_64:
 *   - every H.264 row (`avc1.42001E`, `avc1.42E01E`, `avc1.4D401E`, `avc1.64001E`, `avc1.6E0033`,
 *     ...) answers `"probably"`;
 *   - `avc1.F4001E` (High 4:4:4 Predictive) answers `"maybe"` - Chromium cannot decode 4:4:4 H.264,
 *     which is the concrete reason `"maybe"` is treated as inconclusive. It is probed below as a
 *     negative control and is deliberately absent from the table;
 *   - AV1 `av01.0.*` answers `"probably"`;
 *   - HEVC answers `""` under HEADLESS Chromium but `"probably"` under HEADED Chromium (same
 *     build). Proprietary-decoder availability is a build/runtime property, not a table property,
 *     so this file asserts NOTHING about which HEVC answer is correct - it records whichever it
 *     gets. Asserting HEVC support either way would encode the harness's headless mode as a
 *     product fact.
 */

const NEGATIVE_CONTROLS = {
    /** Answers `"maybe"` on Chromium: a real, reproducible inconclusive result. */
    high444: 'video/mp4; codecs="avc1.F4001E"',
    /** Answers `""`: a string no browser can claim. */
    nonsense: 'video/mp4; codecs="totally.bogus.codec"',
    /** Answers `"maybe"`: the container alone proves no codec, let alone a profile. */
    containerOnly: 'video/mp4'
};

function allTableMimeTypes(): string[] {
    return Object.values(VIDEO_CODEC_PROFILE_PROBES).flatMap((specs) =>
        specs.flatMap((spec) => [...spec.mimeTypes])
    );
}

async function probeInBrowser(
    page: import('@playwright/test').Page,
    mimeTypes: string[]
): Promise<Record<string, string>> {
    return page.evaluate((types) => {
        const element = document.createElement('video');
        const out: Record<string, string> = {};
        for (const type of types) {
            out[type] = element.canPlayType(type);
        }
        return out;
    }, mimeTypes);
}

test.describe('videoCodecProfiles against a REAL canPlayType', () => {
    test('records the raw per-string answers and the profiles they derive', async ({
        page,
        browserName
    }) => {
        const mimeTypes = [
            ...allTableMimeTypes(),
            ...Object.values(NEGATIVE_CONTROLS)
        ];
        const answers = await probeInBrowser(page, mimeTypes);
        const version = page.context().browser()?.version() ?? 'unknown';
        const userAgent = await page.evaluate(() => navigator.userAgent);

        // The observations themselves are the deliverable: a run that goes green without printing
        // what the browser actually said would be worth very little.
        console.log(`[probe] ${browserName} ${version}`);
        console.log(`[probe] UA: ${userAgent}`);
        for (const [type, answer] of Object.entries(answers)) {
            console.log(`[probe] ${JSON.stringify(answer).padEnd(12)} ${type}`);
        }

        const derived: Record<string, string[]> = {};
        for (const codec of Object.keys(VIDEO_CODEC_PROFILE_PROBES)) {
            derived[codec] = deriveCodecProfiles(
                codec,
                (type) => answers[type] ?? '',
                {}
            );
        }
        console.log(`[probe] derived=${JSON.stringify(derived)}`);

        // Anti-vacuity: every table string must have been asked and answered with one of the three
        // specified values. A typo'd MIME string would still return '' here, so the checks below
        // (H.264 must be provable, negative controls must NOT be) are what actually catch that.
        for (const type of allTableMimeTypes()) {
            expect(
                answers[type],
                `no answer recorded for ${type}`
            ).toBeDefined();
            expect(['probably', 'maybe', ''], `answer for ${type}`).toContain(
                answers[type]
            );
        }
    });

    test('H.264 profiles are genuinely provable in this browser, from the table strings alone', async ({
        page
    }) => {
        const answers = await probeInBrowser(page, allTableMimeTypes());
        const profiles = deriveCodecProfiles(
            'h264',
            (type) => answers[type] ?? '',
            {}
        );
        console.log(`[probe] h264 profiles=${JSON.stringify(profiles)}`);

        // The load-bearing check on the table's spelling: every mainstream browser decodes H.264
        // Main and High, so if these strings were malformed they would answer '' and this fails.
        // Deliberately NOT asserted for HEVC (headless/headed divergence, see the file doc) nor as
        // an exact list (a future Chromium dropping a profile is news, not a test failure here).
        expect(profiles).toContain('main');
        expect(profiles).toContain('high');
        expect(profiles).toContain('constrained baseline');

        // Deterministic order, straight off a real browser's answers.
        expect(profiles).toEqual(
            [
                'constrained baseline',
                'baseline',
                'main',
                'high',
                'high 10'
            ].filter((p) => profiles.includes(p))
        );
        // Dedup, straight off a real browser's answers.
        expect(new Set(profiles).size).toBe(profiles.length);
    });

    test('an inconclusive real answer never becomes a claimed profile', async ({
        page
    }) => {
        const answers = await probeInBrowser(
            page,
            Object.values(NEGATIVE_CONTROLS)
        );
        console.log(`[probe] negative controls=${JSON.stringify(answers)}`);

        // The container-only string is the canonical 'maybe' and must stay out of any table row.
        expect(allTableMimeTypes()).not.toContain(
            NEGATIVE_CONTROLS.containerOnly
        );
        expect(allTableMimeTypes()).not.toContain(NEGATIVE_CONTROLS.high444);

        // Feed the real inconclusive/negative answers to the mapper as if they were a row's
        // evidence: nothing may come out.
        expect(
            deriveCodecProfiles(
                'h264',
                (type) =>
                    answers[NEGATIVE_CONTROLS.high444] ?? answers[type] ?? '',
                {}
            ),
            `high 4:4:4 answered ${JSON.stringify(answers[NEGATIVE_CONTROLS.high444])}; ` +
                'if that is "probably" this browser genuinely decodes it and this expectation needs revisiting'
        ).toEqual([]);

        expect(answers[NEGATIVE_CONTROLS.nonsense]).toBe('');
    });

    test('every codec in the table yields a deterministic, deduplicated list from the real browser', async ({
        page
    }) => {
        const answers = await probeInBrowser(page, allTableMimeTypes());
        const read = (type: string) => answers[type] ?? '';

        for (const codec of Object.keys(VIDEO_CODEC_PROFILE_PROBES)) {
            const first = deriveCodecProfiles(codec, read, {});
            const second = deriveCodecProfiles(codec, read, {});
            expect(second, `codec ${codec} is not deterministic`).toEqual(
                first
            );
            expect(
                new Set(first).size,
                `codec ${codec} emitted a duplicate`
            ).toBe(first.length);
        }

        // Codecs outside the closed table stay unrestricted no matter what this browser can decode.
        expect(deriveCodecProfiles('vp9', read, {})).toEqual([]);
        expect(deriveCodecProfiles('vp8', read, {})).toEqual([]);
    });
});

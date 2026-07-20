import { describe, expect, it } from 'vitest';

import type { CanPlayType } from './videoCodecProfiles';
import {
    VIDEO_CODEC_PROFILE_PROBES,
    deriveCodecProfiles
} from './videoCodecProfiles';

/**
 * PURE mapping tests for issue #29's `Profiles` half: a probe-result table in, an expected profile
 * list out. Nothing here touches a DOM - every `canPlayType` below is a lookup in an explicit
 * `Record<mimeString, 'probably' | 'maybe' | ''>`, so each case states, verbatim, which exact MIME
 * string answered what. The REAL browser side of the evidence lives in
 * `tests/e2e/video-codec-profiles-browser.spec.ts`, which runs these same strings through Chromium.
 */

/** A `canPlayType` whose answer for any string NOT named in `answers` is `''` (unsupported). This
 * default is what makes "a generic probe proves no particular profile" testable: a case that lists
 * only the generic H.264 gate string gets `''` for every profile-specific string. */
function table(answers: Record<string, string>): CanPlayType {
    return (type: string) => answers[type] ?? '';
}

const H264 = {
    constrainedBaseline: 'video/mp4; codecs="avc1.42E01E"',
    baseline: 'video/mp4; codecs="avc1.42001E"',
    main: 'video/mp4; codecs="avc1.4D401E"',
    mainAlt: 'video/mp4; codecs="avc1.4D001E"',
    high: 'video/mp4; codecs="avc1.64001E"',
    highAlt: 'video/mp4; codecs="avc1.640028"',
    high10: 'video/mp4; codecs="avc1.6E001E"',
    high10Alt: 'video/mp4; codecs="avc1.6E0033"'
} as const;

const HEVC = {
    mainHvc1: 'video/mp4; codecs="hvc1.1.4.L123"',
    mainHev1: 'video/mp4; codecs="hev1.1.4.L123"',
    mainHvc1Full: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
    mainHev1Full: 'video/mp4; codecs="hev1.1.6.L93.B0"',
    main10Hvc1: 'video/mp4; codecs="hvc1.2.4.L123"',
    main10Hev1: 'video/mp4; codecs="hev1.2.4.L123"',
    main10Hvc1Full: 'video/mp4; codecs="hvc1.2.4.L120.B0"',
    main10Hev1Full: 'video/mp4; codecs="hev1.2.4.L120.B0"'
} as const;

const AV1 = {
    main: 'video/mp4; codecs="av01.0.05M.08"',
    mainAlt: 'video/mp4; codecs="av01.0.15M.08"'
} as const;

describe('deriveCodecProfiles() - the closed table itself', () => {
    it('covers exactly h264, hevc and av1, and no other codec', () => {
        // A codec joining the table is a deliberate act (its profile spelling must first be
        // cross-checked against the server); this pins the closure so it cannot happen by drift.
        expect(Object.keys(VIDEO_CODEC_PROFILE_PROBES).sort()).toEqual([
            'av1',
            'h264',
            'hevc'
        ]);
    });

    it('names each profile at most once per codec, so the table cannot emit a duplicate', () => {
        for (const [codec, specs] of Object.entries(
            VIDEO_CODEC_PROFILE_PROBES
        )) {
            const names = specs.map((s) => s.profile);
            expect(new Set(names).size, `codec ${codec}`).toBe(names.length);
        }
    });

    it('gives every profile at least one fully qualified codecs= MIME string', () => {
        for (const [codec, specs] of Object.entries(
            VIDEO_CODEC_PROFILE_PROBES
        )) {
            for (const spec of specs) {
                expect(
                    spec.mimeTypes.length,
                    `${codec}/${spec.profile}`
                ).toBeGreaterThan(0);
                for (const mimeType of spec.mimeTypes) {
                    expect(mimeType, `${codec}/${spec.profile}`).toContain(
                        'codecs='
                    );
                }
            }
        }
    });

    it('uses the exact profile spellings the legacy DLNA path already sends to the server', () => {
        // browserDeviceProfile.js:1133/:1161 ('high|main|baseline|constrained baseline' + 'high 10'),
        // :1165/:1189 ('main'/'main 10'), :1232 ('main' for av1). Reefin's
        // ClientCapabilitiesMapper.cs:209 parses those same tokens into the same Profiles field,
        // and PlaybackEngine.cs:190 compares them by raw (case-insensitive) equality.
        expect(VIDEO_CODEC_PROFILE_PROBES.h264.map((s) => s.profile)).toEqual([
            'constrained baseline',
            'baseline',
            'main',
            'high',
            'high 10'
        ]);
        expect(VIDEO_CODEC_PROFILE_PROBES.hevc.map((s) => s.profile)).toEqual([
            'main',
            'main 10'
        ]);
        expect(VIDEO_CODEC_PROFILE_PROBES.av1.map((s) => s.profile)).toEqual([
            'main'
        ]);
    });
});

describe('deriveCodecProfiles() - no evidence yields []', () => {
    it.each([['h264'], ['hevc'], ['av1'], ['vp8'], ['vp9'], ['mpeg2video']])(
        'returns [] for %s when every probe answers "" ',
        (codec) => {
            expect(deriveCodecProfiles(codec, table({}))).toEqual([]);
        }
    );

    it('returns [] for a codec absent from the table even when everything probes "probably"', () => {
        const everything: CanPlayType = () => 'probably';
        // vp9 IS decodable by such a browser - the empty list says "no restriction expressed",
        // which is why the server keeps full latitude rather than being told vp9 is unplayable.
        expect(deriveCodecProfiles('vp9', everything)).toEqual([]);
        expect(deriveCodecProfiles('vp8', everything)).toEqual([]);
        expect(deriveCodecProfiles('theora', everything)).toEqual([]);
    });

    it('a generic H.264 probe proves no particular profile', () => {
        // 'video/mp4' with no codecs= is the classic "maybe" answer, and the container-only string
        // is not in any row anyway. Neither can promote a profile.
        expect(
            deriveCodecProfiles(
                'h264',
                table({
                    'video/mp4': 'maybe',
                    'video/mp4; codecs="avc1.42E01E, mp4a.40.2"': 'probably'
                })
            )
        ).toEqual([]);
    });
});

describe('deriveCodecProfiles() - "maybe" is inconclusive', () => {
    it('never emits a profile whose only evidence is "maybe"', () => {
        const answers: Record<string, string> = {};
        for (const spec of VIDEO_CODEC_PROFILE_PROBES.h264) {
            for (const mimeType of spec.mimeTypes) {
                answers[mimeType] = 'maybe';
            }
        }
        expect(deriveCodecProfiles('h264', table(answers))).toEqual([]);
    });

    it.each([['h264'], ['hevc'], ['av1']])(
        'emits nothing for %s when every one of its own strings answers "maybe"',
        (codec) => {
            const answers: Record<string, string> = {};
            for (const spec of VIDEO_CODEC_PROFILE_PROBES[codec]) {
                for (const mimeType of spec.mimeTypes) {
                    answers[mimeType] = 'maybe';
                }
            }
            expect(deriveCodecProfiles(codec, table(answers))).toEqual([]);
        }
    );

    it('drops only the "maybe" rows and keeps the "probably" ones in the same call', () => {
        expect(
            deriveCodecProfiles(
                'h264',
                table({
                    [H264.constrainedBaseline]: 'probably',
                    [H264.baseline]: 'maybe',
                    [H264.main]: 'probably',
                    [H264.high]: 'maybe',
                    [H264.high10]: ''
                })
            )
        ).toEqual(['constrained baseline', 'main']);
    });

    it('treats an unexpected canPlayType answer as no evidence', () => {
        // Defensive: only the literal 'probably' counts, so a hypothetical future/vendor answer
        // cannot be mistaken for proof.
        expect(
            deriveCodecProfiles(
                'h264',
                table({ [H264.high]: 'PROBABLY', [H264.main]: 'yes' })
            )
        ).toEqual([]);
    });
});

describe('deriveCodecProfiles() - "probably" emits, per codec', () => {
    it('emits every H.264 profile that probes probably, weakest first', () => {
        expect(
            deriveCodecProfiles(
                'h264',
                table({
                    [H264.constrainedBaseline]: 'probably',
                    [H264.baseline]: 'probably',
                    [H264.main]: 'probably',
                    [H264.high]: 'probably',
                    [H264.high10]: 'probably'
                })
            )
        ).toEqual([
            'constrained baseline',
            'baseline',
            'main',
            'high',
            'high 10'
        ]);
    });

    it('accepts either alternate MIME string for the H.264 rows that have two', () => {
        expect(
            deriveCodecProfiles(
                'h264',
                table({
                    [H264.mainAlt]: 'probably',
                    [H264.highAlt]: 'probably',
                    [H264.high10Alt]: 'probably'
                })
            )
        ).toEqual(['main', 'high', 'high 10']);
    });

    it('emits HEVC main/main 10 from the short hvc1 forms', () => {
        expect(
            deriveCodecProfiles(
                'hevc',
                table({
                    [HEVC.mainHvc1]: 'probably',
                    [HEVC.main10Hvc1]: 'probably'
                })
            )
        ).toEqual(['main', 'main 10']);
    });

    it('emits HEVC main/main 10 from the hev1 forms alone', () => {
        expect(
            deriveCodecProfiles(
                'hevc',
                table({
                    [HEVC.mainHev1]: 'probably',
                    [HEVC.main10Hev1]: 'probably'
                })
            )
        ).toEqual(['main', 'main 10']);
    });

    it('emits HEVC main 10 without main when only main 10 probes', () => {
        // Not hypothetical hygiene: the row order must not imply an implicit "lower profiles too".
        expect(
            deriveCodecProfiles(
                'hevc',
                table({ [HEVC.main10Hvc1Full]: 'probably' })
            )
        ).toEqual(['main 10']);
    });

    it('emits AV1 main from either of its two strings', () => {
        expect(
            deriveCodecProfiles('av1', table({ [AV1.main]: 'probably' }))
        ).toEqual(['main']);
        expect(
            deriveCodecProfiles('av1', table({ [AV1.mainAlt]: 'probably' }))
        ).toEqual(['main']);
    });

    it('does not emit AV1 High/Professional even when they probe probably', () => {
        // Measured true on Chromium 149. Left out because those spellings are not cross-checked
        // against the server - see videoCodecProfiles.ts's av1 comment.
        expect(
            deriveCodecProfiles(
                'av1',
                table({
                    'video/mp4; codecs="av01.1.05M.08"': 'probably',
                    'video/mp4; codecs="av01.2.05M.10"': 'probably'
                })
            )
        ).toEqual([]);
    });
});

describe('deriveCodecProfiles() - dedup and deterministic order', () => {
    it('emits one entry per profile even when all of its MIME aliases probe probably', () => {
        const allHevc: Record<string, string> = {};
        for (const mimeType of Object.values(HEVC)) {
            allHevc[mimeType] = 'probably';
        }
        const result = deriveCodecProfiles('hevc', table(allHevc));
        expect(result).toEqual(['main', 'main 10']);
        expect(new Set(result).size).toBe(result.length);
    });

    it('returns the same order regardless of the order probes are answered in', () => {
        const answers = {
            [H264.high10]: 'probably',
            [H264.baseline]: 'probably',
            [H264.high]: 'probably',
            [H264.constrainedBaseline]: 'probably',
            [H264.main]: 'probably'
        };
        const reversed = Object.fromEntries(
            Object.entries(answers).reverse()
        ) as Record<string, string>;
        const expected = [
            'constrained baseline',
            'baseline',
            'main',
            'high',
            'high 10'
        ];
        expect(deriveCodecProfiles('h264', table(answers))).toEqual(expected);
        expect(deriveCodecProfiles('h264', table(reversed))).toEqual(expected);
    });

    it('is idempotent across repeated calls with the same probe', () => {
        const probe = table({
            [H264.main]: 'probably',
            [H264.high]: 'probably'
        });
        const first = deriveCodecProfiles('h264', probe);
        expect(deriveCodecProfiles('h264', probe)).toEqual(first);
        expect(first).toEqual(['main', 'high']);
    });

    it('asks each MIME string at most once per derivation and never asks another codec’s', () => {
        const asked: string[] = [];
        deriveCodecProfiles('av1', (type) => {
            asked.push(type);
            return '';
        });
        expect(asked).toEqual([AV1.main, AV1.mainAlt]);
        expect(new Set(asked).size).toBe(asked.length);
    });

    it('stops probing a row as soon as one of its strings answers probably', () => {
        const asked: string[] = [];
        const result = deriveCodecProfiles('hevc', (type) => {
            asked.push(type);
            return type === HEVC.mainHvc1 ? 'probably' : '';
        });
        expect(result).toEqual(['main']);
        // `main`'s first string hit, so its three aliases were never asked.
        expect(asked).not.toContain(HEVC.mainHev1);
    });
});

describe('deriveCodecProfiles() - the one documented veto (H.264 High 10)', () => {
    const high10Probe = table({
        [H264.high]: 'probably',
        [H264.high10]: 'probably',
        [H264.high10Alt]: 'probably'
    });

    it('emits high 10 on a desktop non-Safari browser', () => {
        expect(
            deriveCodecProfiles('h264', high10Probe, { safari: false })
        ).toEqual(['high', 'high 10']);
    });

    it.each([
        ['safari', { safari: true }],
        ['iOS', { iOS: true }],
        ['legacy edge', { edge: true }],
        ['mobile', { mobile: true }]
    ])(
        'suppresses high 10 on %s despite a probably answer (browserDeviceProfile.js:1151-1162)',
        (_label, browser) => {
            expect(deriveCodecProfiles('h264', high10Probe, browser)).toEqual([
                'high'
            ]);
        }
    );

    it('vetoes nothing but high 10 - the other H.264 profiles survive on Safari', () => {
        expect(
            deriveCodecProfiles(
                'h264',
                table({
                    [H264.constrainedBaseline]: 'probably',
                    [H264.baseline]: 'probably',
                    [H264.main]: 'probably',
                    [H264.high]: 'probably',
                    [H264.high10]: 'probably'
                }),
                { safari: true, iOS: true, mobile: true }
            )
        ).toEqual(['constrained baseline', 'baseline', 'main', 'high']);
    });

    it('applies no veto to hevc or av1 on any browser family', () => {
        const browser = { safari: true, iOS: true, edge: true, mobile: true };
        expect(
            deriveCodecProfiles(
                'hevc',
                table({
                    [HEVC.mainHvc1]: 'probably',
                    [HEVC.main10Hvc1]: 'probably'
                }),
                browser
            )
        ).toEqual(['main', 'main 10']);
        expect(
            deriveCodecProfiles(
                'av1',
                table({ [AV1.main]: 'probably' }),
                browser
            )
        ).toEqual(['main']);
    });

    it('defaults to no veto when no browser signals are supplied', () => {
        expect(deriveCodecProfiles('h264', high10Probe)).toEqual([
            'high',
            'high 10'
        ]);
    });
});

describe('deriveCodecProfiles() - full probe-result matrix, table in / list out', () => {
    /** One row per realistic probe outcome. `answers` is the complete probe table; anything not
     * listed answers `''`. */
    const MATRIX: {
        name: string;
        codec: string;
        answers: Record<string, string>;
        browser?: Record<string, boolean>;
        expected: string[];
    }[] = [
        {
            name: 'nothing decodes at all',
            codec: 'h264',
            answers: {},
            expected: []
        },
        {
            name: 'only the constrained-baseline gate string hits',
            codec: 'h264',
            answers: { [H264.constrainedBaseline]: 'probably' },
            expected: ['constrained baseline']
        },
        {
            name: 'baseline probably, constrained baseline maybe',
            codec: 'h264',
            answers: {
                [H264.constrainedBaseline]: 'maybe',
                [H264.baseline]: 'probably'
            },
            expected: ['baseline']
        },
        {
            name: 'main and high, no baselines',
            codec: 'h264',
            answers: {
                [H264.main]: 'probably',
                [H264.high]: 'probably'
            },
            expected: ['main', 'high']
        },
        {
            name: 'high 10 alone, desktop',
            codec: 'h264',
            answers: { [H264.high10Alt]: 'probably' },
            expected: ['high 10']
        },
        {
            name: 'high 10 alone, mobile (vetoed to empty)',
            codec: 'h264',
            answers: { [H264.high10Alt]: 'probably' },
            browser: { mobile: true },
            expected: []
        },
        {
            name: 'every h264 string maybe',
            codec: 'h264',
            answers: Object.fromEntries(
                Object.values(H264).map((m) => [m, 'maybe'])
            ),
            expected: []
        },
        {
            name: 'every h264 string probably',
            codec: 'h264',
            answers: Object.fromEntries(
                Object.values(H264).map((m) => [m, 'probably'])
            ),
            expected: [
                'constrained baseline',
                'baseline',
                'main',
                'high',
                'high 10'
            ]
        },
        {
            name: 'hevc unsupported (Chromium headless reality)',
            codec: 'hevc',
            answers: Object.fromEntries(
                Object.values(HEVC).map((m) => [m, ''])
            ),
            expected: []
        },
        {
            name: 'hevc main only',
            codec: 'hevc',
            answers: { [HEVC.mainHvc1]: 'probably' },
            expected: ['main']
        },
        {
            name: 'hevc all aliases probably (dedup)',
            codec: 'hevc',
            answers: Object.fromEntries(
                Object.values(HEVC).map((m) => [m, 'probably'])
            ),
            expected: ['main', 'main 10']
        },
        {
            name: 'hevc main probably, main 10 maybe',
            codec: 'hevc',
            answers: {
                [HEVC.mainHvc1]: 'probably',
                [HEVC.main10Hvc1]: 'maybe',
                [HEVC.main10Hev1]: 'maybe'
            },
            expected: ['main']
        },
        {
            name: 'av1 main',
            codec: 'av1',
            answers: { [AV1.main]: 'probably', [AV1.mainAlt]: 'probably' },
            expected: ['main']
        },
        {
            name: 'av1 maybe only',
            codec: 'av1',
            answers: { [AV1.main]: 'maybe', [AV1.mainAlt]: 'maybe' },
            expected: []
        },
        {
            name: 'vp9 with everything probably (untabled codec)',
            codec: 'vp9',
            answers: { 'video/webm; codecs="vp09.00.10.08"': 'probably' },
            expected: []
        }
    ];

    it.each(MATRIX.map((row) => [row.name, row] as const))(
        '%s',
        (_name, row) => {
            expect(
                deriveCodecProfiles(row.codec, table(row.answers), row.browser)
            ).toEqual(row.expected);
        }
    );

    it('covers every probe answer kind across the matrix', () => {
        // Anti-vacuity for the matrix itself: it must exercise 'probably', 'maybe' and '' rather
        // than quietly degenerating into one of them.
        const kinds = new Set(
            MATRIX.flatMap((row) => Object.values(row.answers))
        );
        expect(kinds).toContain('probably');
        expect(kinds).toContain('maybe');
        expect(MATRIX.some((row) => row.expected.length === 0)).toBe(true);
        expect(MATRIX.some((row) => row.expected.length > 1)).toBe(true);
    });
});

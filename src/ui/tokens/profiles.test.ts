import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import officialClassic from './official.classic';
import officialGlass from './official.glass';
import {
    applyReducedMotion,
    CASCADE_OVERRIDES,
    getProfileAttribute,
    LOW_POWER_OVERRIDE,
    PROFILE_CASCADE,
    REDUCED_MOTION_OVERRIDE,
    REDUCED_TRANSPARENCY_OVERRIDE,
    REMOTE_OVERRIDE,
    type TesserafinTokensOverride,
    resolveProfileTokens,
    resolveTokensForProfiles
} from './profiles';
import type { TesserafinTokens } from './types';

/**
 * Behavioural spec for interaction-profile *resolution*
 * (`docs/tesserafin/design-glass-interaction-profiles.md`): the cascade order and the `reducedMotion`
 * orthogonality, pinned so neither can be quietly reordered.
 *
 * Scope note: these assertions are about the resolved token object only. That object was never the
 * broken half — a profile could always be resolved correctly and still not reach the page, because
 * nothing re-derived the `--rf-backdrop-filter-*` custom properties that Glass's CSS actually
 * reads. The projection onto custom properties is `./projectTokens.test.ts`, and the proof that it
 * moves a real browser's computed `backdrop-filter` is
 * `tests/e2e/glass-interaction-profiles.spec.ts`. An object-level assertion here is necessary and
 * not sufficient; treat it as such.
 *
 * `official.classic` is used as the base token set because these assertions are about the
 * resolution rather than about any one theme's values. Profiles are applied to Glass alone in the
 * app (`src/themes/useInteractionProfiles.ts` guards on the active theme id) — the partials are
 * emphatically not no-ops against Classic, which is exactly why that guard exists and is tested
 * against real computed styles.
 */
const base: TesserafinTokens = officialClassic;

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensSchema = JSON.parse(
    readFileSync(
        join(
            __dirname,
            '..',
            '..',
            '..',
            'tesserafin-design',
            'schema',
            'tokens.schema.json'
        ),
        'utf8'
    )
) as { properties: Record<string, unknown> };

describe('interaction profiles (dormant)', () => {
    describe('format: concrete deep-partials of the token set', () => {
        it('introduces no key outside tokens.schema.json top level', () => {
            const allowed = Object.keys(tokensSchema.properties);
            const overrides: TesserafinTokensOverride[] = [
                REMOTE_OVERRIDE,
                LOW_POWER_OVERRIDE,
                REDUCED_TRANSPARENCY_OVERRIDE,
                REDUCED_MOTION_OVERRIDE
            ];
            for (const override of overrides) {
                for (const key of Object.keys(override)) {
                    expect(allowed).toContain(key);
                }
            }
        });

        it('only overrides keys the base token set already defines', () => {
            const overrides: TesserafinTokensOverride[] = [
                REMOTE_OVERRIDE,
                LOW_POWER_OVERRIDE,
                REDUCED_TRANSPARENCY_OVERRIDE,
                REDUCED_MOTION_OVERRIDE
            ];
            const assertSubset = (
                partial: Record<string, unknown>,
                full: Record<string, unknown>,
                path: string
            ) => {
                for (const [key, value] of Object.entries(partial)) {
                    expect(full, `${path}.${key} is not a base token`).toEqual(
                        expect.objectContaining({ [key]: expect.anything() })
                    );
                    if (
                        value !== null &&
                        typeof value === 'object' &&
                        !Array.isArray(value)
                    ) {
                        assertSubset(
                            value as Record<string, unknown>,
                            full[key] as Record<string, unknown>,
                            `${path}.${key}`
                        );
                    }
                }
            };
            for (const override of overrides) {
                assertSubset(
                    override as Record<string, unknown>,
                    base as unknown as Record<string, unknown>,
                    'tokens'
                );
            }
        });
    });

    describe('cascade order: reducedTransparency > lowPower > remote', () => {
        it('declares the cascade in application order, weakest first', () => {
            expect(PROFILE_CASCADE).toEqual([
                'remote',
                'lowPower',
                'reducedTransparency'
            ]);
        });

        it('applies each profile alone', () => {
            expect(resolveProfileTokens(base, { remote: true }).blur).toEqual({
                sm: '6px',
                md: '10px',
                lg: '14px'
            });
            expect(resolveProfileTokens(base, { lowPower: true }).blur).toEqual(
                {
                    sm: '2px',
                    md: '4px',
                    lg: '6px'
                }
            );
            expect(
                resolveProfileTokens(base, { reducedTransparency: true }).blur
            ).toEqual({ sm: '0', md: '0', lg: '0' });
        });

        it('lets lowPower beat remote on the key they share', () => {
            expect(
                resolveProfileTokens(base, { remote: true, lowPower: true })
                    .blur.md
            ).toBe('4px');
        });

        it('lets reducedTransparency beat lowPower', () => {
            expect(
                resolveProfileTokens(base, {
                    lowPower: true,
                    reducedTransparency: true
                }).blur.md
            ).toBe('0');
        });

        // The invariant the mission states outright: reducedTransparency wins whenever active,
        // whatever else is on. Asserted over every subset containing it.
        it('lets reducedTransparency win over every combination', () => {
            const combos = [
                { reducedTransparency: true },
                { reducedTransparency: true, remote: true },
                { reducedTransparency: true, lowPower: true },
                { reducedTransparency: true, remote: true, lowPower: true },
                {
                    reducedTransparency: true,
                    remote: true,
                    lowPower: true,
                    reducedMotion: true
                }
            ];
            for (const active of combos) {
                const tokens = resolveTokensForProfiles(base, active);
                expect(tokens.blur).toEqual({ sm: '0', md: '0', lg: '0' });
                expect(tokens.color.dark.surface).toBe('#141a22');
            }
        });

        it('composites surfaces with no alpha channel', () => {
            const tokens = resolveProfileTokens(base, {
                reducedTransparency: true
            });
            for (const value of [
                tokens.color.dark.surface,
                tokens.color.dark.surfaceVariant,
                tokens.color.dark.textMuted,
                tokens.color.dark.divider
            ]) {
                expect(value).toMatch(/^#[0-9a-f]{6}$/);
            }
        });

        // Cumulative, not exclusive: a winning profile overrides key by key, it does not cancel
        // the others.
        it('keeps remote keys that the stronger profiles never touch', () => {
            const tokens = resolveProfileTokens(base, {
                remote: true,
                lowPower: true,
                reducedTransparency: true
            });
            expect(tokens.density).toBe('spacious');
            expect(tokens.typography.fontSize.md).toBe('1.125rem');
            expect(tokens.elevation.level3).toBe(
                '0 2px 6px rgba(0, 0, 0, 0.32)'
            );
        });

        it('leaves the base untouched when nothing is active', () => {
            expect(resolveTokensForProfiles(base, {})).toEqual(base);
        });

        it('does not mutate the base token set', () => {
            const before = JSON.stringify(base);
            resolveTokensForProfiles(base, {
                remote: true,
                lowPower: true,
                reducedTransparency: true,
                reducedMotion: true
            });
            expect(JSON.stringify(base)).toBe(before);
        });
    });

    describe('reducedMotion is orthogonal, not a cascade rank', () => {
        it('never appears in the cascade', () => {
            expect(PROFILE_CASCADE).not.toContain('reducedMotion');
            expect(Object.keys(CASCADE_OVERRIDES)).not.toContain(
                'reducedMotion'
            );
        });

        // The structural reason the two axes cannot collide: disjoint key sets.
        it('touches only motion, while no cascade profile touches motion', () => {
            expect(Object.keys(REDUCED_MOTION_OVERRIDE)).toEqual(['motion']);
            for (const override of Object.values(CASCADE_OVERRIDES)) {
                expect(Object.keys(override)).not.toContain('motion');
            }
        });

        it('applies fully alongside remote — both, not one', () => {
            const tokens = resolveTokensForProfiles(base, {
                remote: true,
                reducedMotion: true
            });
            expect(tokens.motion.duration).toEqual({
                fast: '0ms',
                normal: '0ms',
                slow: '0ms'
            });
            expect(tokens.blur.md).toBe('10px');
            expect(tokens.density).toBe('spacious');
        });

        it('applies fully alongside reducedTransparency — both, not one', () => {
            const tokens = resolveTokensForProfiles(base, {
                reducedTransparency: true,
                reducedMotion: true
            });
            expect(tokens.motion.duration.normal).toBe('0ms');
            expect(tokens.blur.md).toBe('0');
        });

        it('keeps easing curves so motion identity survives', () => {
            const tokens = applyReducedMotion(base, true);
            expect(tokens.motion.easing).toEqual(base.motion.easing);
        });

        it('is ignored by the cascade resolver itself', () => {
            expect(
                resolveProfileTokens(base, { reducedMotion: true }).motion
                    .duration
            ).toEqual(base.motion.duration);
        });
    });

    describe('data-rf-profile attribute', () => {
        it('publishes a single cascade winner', () => {
            expect(getProfileAttribute({ remote: true })).toBe('remote');
            expect(getProfileAttribute({ remote: true, lowPower: true })).toBe(
                'low-power'
            );
            expect(
                getProfileAttribute({
                    remote: true,
                    lowPower: true,
                    reducedTransparency: true
                })
            ).toBe('reduced-transparency');
        });

        it('is absent when no cascade profile is active', () => {
            expect(getProfileAttribute({})).toBeUndefined();
        });

        // reducedMotion gets its own attribute; folding it in here is exactly the error the design
        // forbids.
        it('never reports reducedMotion', () => {
            expect(
                getProfileAttribute({ reducedMotion: true })
            ).toBeUndefined();
            expect(
                getProfileAttribute({ remote: true, reducedMotion: true })
            ).toBe('remote');
        });
    });
});

describe('Reefin Glass light frosted mode: WCAG contrast', () => {
    /**
     * The light palette is authored for contrast over the *composited* frosted surface, not over an
     * assumed opaque one — Glass Light's `surface` is `rgba(255, 255, 255, 0.55)`, so what a reader
     * actually sees behind the text is that white blended over `background`. Checking a foreground
     * against the raw token would measure a color nothing ever paints.
     *
     * These assertions are the durable form of the arithmetic the palette was designed with; before
     * them, "contrast" was a claim in a comment.
     */

    type Rgb = [number, number, number, number];

    const parseColor = (value: string): Rgb => {
        const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
        if (hex) {
            const digits =
                hex[1].length === 3
                    ? hex[1]
                          .split('')
                          .map((d) => d + d)
                          .join('')
                    : hex[1];
            const n = Number.parseInt(digits, 16);
            return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
        }
        const rgba =
            /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(
                value
            );
        if (rgba) {
            return [
                Number(rgba[1]),
                Number(rgba[2]),
                Number(rgba[3]),
                rgba[4] === undefined ? 1 : Number(rgba[4])
            ];
        }
        throw new Error(`unsupported color notation: ${value}`);
    };

    /** Source-over compositing, i.e. what the browser paints for a translucent layer. */
    const composite = (foreground: Rgb, background: Rgb): Rgb => [
        foreground[0] * foreground[3] + background[0] * (1 - foreground[3]),
        foreground[1] * foreground[3] + background[1] * (1 - foreground[3]),
        foreground[2] * foreground[3] + background[2] * (1 - foreground[3]),
        1
    ];

    /** WCAG 2.x relative luminance. */
    const luminance = ([r, g, b]: Rgb): number => {
        const channel = (raw: number) => {
            const c = raw / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const contrastRatio = (a: Rgb, b: Rgb): number => {
        const [lighter, darker] = [luminance(a), luminance(b)].sort(
            (x, y) => y - x
        );
        return (lighter + 0.05) / (darker + 0.05);
    };

    const light = officialGlass.color.light;

    if (!light) {
        throw new Error(
            'Reefin Glass must declare a light color group (theme.json modes includes "light")'
        );
    }

    const background = parseColor(light.background);
    const surface = composite(parseColor(light.surface), background);
    const surfaceVariant = composite(
        parseColor(light.surfaceVariant),
        background
    );

    const FOREGROUNDS = [
        'text',
        'textMuted',
        'primary',
        'accent',
        'error',
        'warning',
        'success'
    ] as const;

    const SURFACES: ReadonlyArray<readonly [string, Rgb]> = [
        ['background', background],
        ['composited surface', surface],
        ['composited surfaceVariant', surfaceVariant]
    ];

    it('composites its translucent surfaces to the expected opaque colors', () => {
        // Pins the two values `REDUCED_TRANSPARENCY_OVERRIDE`'s light partial hardcodes, so the
        // opaque fallback cannot drift away from the frosted appearance it stands in for.
        const toHex = ([r, g, b]: Rgb) =>
            `#${[r, g, b]
                .map((v) => Math.round(v).toString(16).padStart(2, '0'))
                .join('')}`;

        expect(toHex(surface)).toBe('#f7f9fc');
        expect(toHex(surfaceVariant)).toBe('#e0e7f3');
        expect(REDUCED_TRANSPARENCY_OVERRIDE.color?.light?.surface).toBe(
            '#f7f9fc'
        );
        expect(REDUCED_TRANSPARENCY_OVERRIDE.color?.light?.surfaceVariant).toBe(
            '#e0e7f3'
        );
    });

    it.each(
        SURFACES.flatMap(([surfaceName, surfaceColor]) =>
            FOREGROUNDS.map(
                (foreground) => [foreground, surfaceName, surfaceColor] as const
            )
        )
    )(
        'renders %s on %s at WCAG AA or better',
        (foreground, _surfaceName, surfaceColor) => {
            const composited = composite(
                parseColor(light[foreground]),
                surfaceColor
            );
            expect(
                contrastRatio(composited, surfaceColor)
            ).toBeGreaterThanOrEqual(4.5);
        }
    );

    it('keeps onPrimary legible on primary', () => {
        expect(
            contrastRatio(
                parseColor(light.onPrimary),
                parseColor(light.primary)
            )
        ).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the opaque reduced-transparency textMuted as legible as the frosted one', () => {
        // The reduced-transparency profile must not trade contrast for opacity: it replaces a
        // translucent muted text color with a flat one, and the two must read identically.
        const frosted = contrastRatio(
            composite(parseColor(light.textMuted), surface),
            surface
        );
        const opaque = contrastRatio(
            parseColor(
                REDUCED_TRANSPARENCY_OVERRIDE.color?.light?.textMuted as string
            ),
            parseColor(
                REDUCED_TRANSPARENCY_OVERRIDE.color?.light?.surface as string
            )
        );

        expect(opaque).toBeGreaterThanOrEqual(4.5);
        expect(Math.abs(opaque - frosted)).toBeLessThan(0.05);
    });
});

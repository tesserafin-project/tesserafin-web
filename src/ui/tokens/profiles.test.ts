import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import officialClassic from './official.classic';
import {
    applyReducedMotion,
    CASCADE_OVERRIDES,
    getProfileAttribute,
    LOW_POWER_OVERRIDE,
    PROFILE_CASCADE,
    REDUCED_MOTION_OVERRIDE,
    REDUCED_TRANSPARENCY_OVERRIDE,
    REMOTE_OVERRIDE,
    type ReefinTokensOverride,
    resolveProfileTokens,
    resolveTokensForProfiles
} from './profiles';
import type { ReefinTokens } from './types';

/**
 * Behavioural spec for the dormant interaction profiles
 * (`docs/reefin/design-glass-interaction-profiles.md`). Nothing here activates a profile; these
 * assertions pin the cascade order and the `reducedMotion` orthogonality so a later activation
 * slice cannot quietly reorder them.
 *
 * `official.classic` is used as the base token set purely because it is the only theme on this
 * branch (Glass is PR #14). The assertions are about the *resolution*, not about Classic.
 */
const base: ReefinTokens = officialClassic;

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensSchema = JSON.parse(
    readFileSync(
        join(
            __dirname,
            '..',
            '..',
            '..',
            'reefin-design',
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
            const overrides: ReefinTokensOverride[] = [
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
            const overrides: ReefinTokensOverride[] = [
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

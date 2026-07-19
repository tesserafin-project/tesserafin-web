/**
 * Unit coverage for the token → custom-property projection (`./projectTokens.ts`).
 *
 * The load-bearing tests here are the ones that pin projected property **names** against the
 * generated stylesheet (`./official.glass.css`). A projection that writes `--rf-fontSize-md` or
 * `--rf-color-dark-surface` instead of the generated name is not an error anywhere — it is a
 * perfectly valid custom property that simply nothing reads. It would leave the whole bridge a
 * silent no-op while every object-level assertion still passed, which is precisely the class of
 * defect this module was written to remove. Reading the real generated file (rather than a
 * hand-copied list of names) means regenerating tokens cannot quietly invalidate these tests.
 *
 * The end-to-end claim — that these properties change the *computed* `backdrop-filter` of a real
 * Glass surface in a real browser — is not provable here and is not attempted; jsdom does not
 * implement `backdrop-filter` or custom-property substitution. See
 * `tests/e2e/glass-interaction-profiles.spec.ts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { officialGlassTokens } from './official.glass';
import {
    CASCADE_OVERRIDES,
    PROFILE_CASCADE,
    REDUCED_MOTION_OVERRIDE,
    resolveProfileOverride,
    resolveTokensForProfiles,
    type ActiveProfiles
} from './profiles';
import { applyCustomProperties, toCustomProperties } from './projectTokens';

const GLASS_CSS = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'official.glass.css'),
    'utf-8'
);

/** Every `--rf-*` property Reefin Glass's generated stylesheet actually declares. */
const GENERATED_PROPERTIES = new Set(
    [...GLASS_CSS.matchAll(/^\s*(--rf-[a-z0-9-]+):/gm)].map((match) => match[1])
);

describe('toCustomProperties', () => {
    it('has a non-empty set of generated properties to check against', () => {
        // Guards the guard: a regex that stopped matching would make every name test below
        // vacuously pass.
        expect(GENERATED_PROPERTIES.size).toBeGreaterThan(30);
        expect(GENERATED_PROPERTIES.has('--rf-backdrop-filter-md')).toBe(true);
    });

    it.each([...PROFILE_CASCADE, 'reducedMotion' as const])(
        'projects only property names Glass actually declares (%s)',
        (profile) => {
            const override =
                profile === 'reducedMotion'
                    ? REDUCED_MOTION_OVERRIDE
                    : CASCADE_OVERRIDES[profile];

            const names = Object.keys(toCustomProperties(override));

            expect(names.length).toBeGreaterThan(0);
            for (const name of names) {
                expect(GENERATED_PROPERTIES).toContain(name);
            }
        }
    );

    it('derives --rf-backdrop-filter-* alongside every --rf-blur-* it writes', () => {
        const projected = toCustomProperties(CASCADE_OVERRIDES.remote);

        expect(projected['--rf-blur-md']).toBe('10px');
        expect(projected['--rf-backdrop-filter-md']).toBe('blur(10px)');
        expect(projected['--rf-blur-sm']).toBe('6px');
        expect(projected['--rf-backdrop-filter-sm']).toBe('blur(6px)');
    });

    it('derives "none" — not "blur(0px)" — for reducedTransparency\'s zero blur', () => {
        // The distinction is the reason the derived property exists at all: `blur(0)` still
        // allocates a compositing layer, so a `reducedTransparency` user would keep paying the GPU
        // cost they asked to be rid of.
        const projected = toCustomProperties(
            CASCADE_OVERRIDES.reducedTransparency
        );

        expect(projected['--rf-blur-md']).toBe('0');
        expect(projected['--rf-backdrop-filter-md']).toBe('none');
        expect(projected['--rf-backdrop-filter-sm']).toBe('none');
        expect(projected['--rf-backdrop-filter-lg']).toBe('none');
    });

    it('flattens color.<mode> by dropping the mode segment', () => {
        const projected = toCustomProperties(
            CASCADE_OVERRIDES.reducedTransparency,
            'dark'
        );

        expect(projected['--rf-color-surface']).toBe('#141a22');
        expect(projected['--rf-color-surface-variant']).toBe('#1b232d');
        expect(projected['--rf-color-text-muted']).toBe('#b6c2cf');
        expect(projected).not.toHaveProperty('--rf-color-dark-surface');
    });

    it('projects nothing from color.<mode> when that mode is not active', () => {
        // Glass is dark-only; asking for light must not write dark's values under light's name.
        const projected = toCustomProperties(
            CASCADE_OVERRIDES.reducedTransparency,
            'light'
        );

        expect(projected).not.toHaveProperty('--rf-color-surface');
        expect(projected['--rf-backdrop-filter-md']).toBe('none');
    });

    it('camel-cases and digit-suffixes exactly as the generator does', () => {
        const projected = toCustomProperties({
            ...CASCADE_OVERRIDES.lowPower,
            ...CASCADE_OVERRIDES.remote
        });

        expect(projected['--rf-typography-font-size-md']).toBe('1.125rem');
        expect(projected['--rf-spacing-lg']).toBe('32px');
        expect(projected['--rf-density']).toBe('spacious');
        expect(
            toCustomProperties(CASCADE_OVERRIDES.lowPower)[
                '--rf-elevation-level2'
            ]
        ).toBe('0 1px 3px rgba(0, 0, 0, 0.28)');
    });

    it('projects reducedMotion durations without touching easing', () => {
        const projected = toCustomProperties(REDUCED_MOTION_OVERRIDE);

        expect(projected['--rf-motion-duration-fast']).toBe('0ms');
        expect(projected['--rf-motion-duration-slow']).toBe('0ms');
        expect(projected).not.toHaveProperty('--rf-motion-easing-standard');
    });
});

describe('resolveProfileOverride', () => {
    const ALL_STATES: ActiveProfiles[] = [
        { remote: true },
        { lowPower: true },
        { reducedTransparency: true },
        { remote: true, lowPower: true },
        { remote: true, reducedTransparency: true },
        { lowPower: true, reducedTransparency: true },
        { remote: true, lowPower: true, reducedTransparency: true },
        { remote: true, reducedMotion: true },
        {
            remote: true,
            lowPower: true,
            reducedTransparency: true,
            reducedMotion: true
        }
    ];

    it('is empty when no profile is active', () => {
        expect(resolveProfileOverride({})).toEqual({});
        expect(toCustomProperties(resolveProfileOverride({}))).toEqual({});
    });

    it.each(ALL_STATES)(
        'agrees key-for-key with resolveTokensForProfiles (%o)',
        (active) => {
            // The delta is projected instead of a fully resolved token set (to keep Glass's palette
            // out of the main bundle). That is only sound if applying the delta to a base yields
            // the same result as resolving against that base — asserted here rather than assumed,
            // since a divergence would make the page disagree with the object in a *second* way.
            const viaDelta = toCustomProperties(resolveProfileOverride(active));
            const resolved = resolveTokensForProfiles(
                officialGlassTokens,
                active
            );
            const viaFullResolution = toCustomProperties(resolved);

            for (const [name, value] of Object.entries(viaDelta)) {
                expect(viaFullResolution[name]).toBe(value);
            }
        }
    );

    it('is cumulative: remote + lowPower keeps remote density and takes lowPower blur', () => {
        const projected = toCustomProperties(
            resolveProfileOverride({ remote: true, lowPower: true })
        );

        expect(projected['--rf-density']).toBe('spacious');
        expect(projected['--rf-blur-md']).toBe('4px');
        expect(projected['--rf-backdrop-filter-md']).toBe('blur(4px)');
    });

    it('lets reducedTransparency win the blur over both weaker profiles', () => {
        const projected = toCustomProperties(
            resolveProfileOverride({
                remote: true,
                lowPower: true,
                reducedTransparency: true
            })
        );

        expect(projected['--rf-backdrop-filter-md']).toBe('none');
        expect(projected['--rf-color-surface']).toBe('#141a22');
        // …while still keeping what only the weaker profiles set.
        expect(projected['--rf-density']).toBe('spacious');
        expect(projected['--rf-elevation-level2']).toBe(
            '0 1px 3px rgba(0, 0, 0, 0.28)'
        );
    });

    it('applies the orthogonal motion axis alongside the cascade', () => {
        const projected = toCustomProperties(
            resolveProfileOverride({ remote: true, reducedMotion: true })
        );

        expect(projected['--rf-motion-duration-normal']).toBe('0ms');
        expect(projected['--rf-density']).toBe('spacious');
    });
});

describe('applyCustomProperties', () => {
    it('writes inline custom properties and restores the element exactly', () => {
        const element = document.createElement('div');
        // `cssText`, not `getAttribute('style')`: removing the last inline property leaves an empty
        // `style=""` attribute behind rather than unsetting the attribute, which is a DOM
        // serialization detail with no effect on the cascade. What has to be exact is the declared
        // content, and that is what `cssText` reports.
        const before = element.style.cssText;

        const restore = applyCustomProperties(element, {
            '--rf-blur-md': '4px',
            '--rf-backdrop-filter-md': 'blur(4px)'
        });

        expect(element.style.getPropertyValue('--rf-blur-md')).toBe('4px');
        expect(element.style.getPropertyValue('--rf-backdrop-filter-md')).toBe(
            'blur(4px)'
        );

        restore();

        expect(element.style.getPropertyValue('--rf-blur-md')).toBe('');
        expect(element.style.cssText).toBe(before);
    });

    it('restores a pre-existing inline value rather than removing it', () => {
        const element = document.createElement('div');
        element.style.setProperty('--rf-blur-md', '99px');

        applyCustomProperties(element, { '--rf-blur-md': '4px' })();

        expect(element.style.getPropertyValue('--rf-blur-md')).toBe('99px');
    });
});

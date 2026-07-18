/**
 * Interaction-profile token overrides (RFC-0005 §7.2, issue #18), specified in
 * `docs/reefin/design-glass-interaction-profiles.md`.
 *
 * **DORMANT — imported by its test only, and deliberately NOT re-exported from `src/ui/index.ts`.**
 * Re-exporting it would make it reachable from a webpack entry point and cost bundle bytes; as it
 * stands it costs 0. Nothing here sets `data-rf-profile`, and `src/themes/useAppTheme.ts` is
 * untouched. Activation is gated on **LANE B** (bundle margin, target 30 KiB — now measured at
 * 84.7 KiB / 86 737 B, so the numeric threshold is met) **and** **LANE E2E** (cross gate, blocked
 * on reefin#39, still closed). Both are required, so activation remains blocked.
 *
 * **Format decision (issue #18 item 1):** a profile override is a *concrete deep-partial* of
 * `tokens.schema.json`, not a semantic value (`"blur": "reduced"`). A semantic value needs a
 * per-theme resolution table that is neither published nor shared across renderers; a concrete
 * partial carries its own values. `theme.schema.json`'s `profileOverride` already says
 * "deep-partial of tokens.schema.json" — this confirms the schema rather than changing it.
 *
 * These partials target **Glass**'s tokens (PR #14, not on this branch). They are *not* no-ops
 * against Classic — `REDUCED_TRANSPARENCY_OVERRIDE` would repaint Classic's `#202020` surface to
 * `#141a22`, and `REMOTE_OVERRIDE` would give it a non-zero blur it does not want. Classic is used
 * as a base in the test only, as a vehicle for asserting the *resolution*. What keeps that from
 * mattering is not the values but the dormancy: nothing resolves a profile at runtime, on any
 * theme, until activation binds these to Glass.
 */

import type { ReefinTokens } from './types';

type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** A profile override: a deep-partial of the token set, never a new namespace. */
export type ReefinTokensOverride = DeepPartial<ReefinTokens>;

/**
 * Profiles that participate in the surface-composition cascade, **in application order — last
 * applied wins**, i.e. lowest to highest priority.
 *
 * `reducedMotion` is deliberately absent: it is an orthogonal axis (see `REDUCED_MOTION_OVERRIDE`),
 * and folding it in here would invent a conflict between two accessibility needs that cannot
 * actually collide.
 */
export const PROFILE_CASCADE = [
    'remote',
    'lowPower',
    'reducedTransparency'
] as const;

export type CascadeProfile = (typeof PROFILE_CASCADE)[number];

/** 3 metres, D-pad: cheaper blur, larger targets, larger type. */
export const REMOTE_OVERRIDE: ReefinTokensOverride = {
    blur: { sm: '6px', md: '10px', lg: '14px' },
    density: 'spacious',
    spacing: { md: '20px', lg: '32px', xl: '44px' },
    typography: {
        fontSize: { md: '1.125rem', lg: '1.375rem', xl: '1.75rem' }
    }
};

/**
 * Low battery / thermal throttling: near-zero (but non-zero) blur and flattened shadows — both are
 * per-frame GPU compositing costs. Touches neither `motion` (that is `reducedMotion`'s axis) nor
 * typography (that is `remote`'s).
 */
export const LOW_POWER_OVERRIDE: ReefinTokensOverride = {
    blur: { sm: '2px', md: '4px', lg: '6px' },
    elevation: {
        level2: '0 1px 3px rgba(0, 0, 0, 0.28)',
        level3: '0 2px 6px rgba(0, 0, 0, 0.32)'
    }
};

/**
 * Declared accessibility need — highest priority, never negotiable. Blur zero *and* opaque
 * surfaces: zero blur over a translucent surface shows the content underneath sharply, which is
 * worse than the blur. Alpha-free hex, so opacity is verifiable by inspection.
 */
export const REDUCED_TRANSPARENCY_OVERRIDE: ReefinTokensOverride = {
    blur: { sm: '0', md: '0', lg: '0' },
    color: {
        dark: {
            surface: '#141a22',
            surfaceVariant: '#1b232d',
            textMuted: '#b6c2cf',
            divider: '#2a343f'
        }
    }
};

export const CASCADE_OVERRIDES: Record<CascadeProfile, ReefinTokensOverride> = {
    remote: REMOTE_OVERRIDE,
    lowPower: LOW_POWER_OVERRIDE,
    reducedTransparency: REDUCED_TRANSPARENCY_OVERRIDE
};

/**
 * The orthogonal axis. Durations only — easing curves stay, since a zero-duration transition never
 * samples them and a future non-zero duration must recover the same motion identity.
 */
export const REDUCED_MOTION_OVERRIDE: ReefinTokensOverride = {
    motion: { duration: { fast: '0ms', normal: '0ms', slow: '0ms' } }
};

export interface ActiveProfiles {
    remote?: boolean;
    lowPower?: boolean;
    reducedTransparency?: boolean;
    /** Orthogonal — resolved separately, never through the cascade. */
    reducedMotion?: boolean;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Deep merge where `override`'s leaves win. Neither input is mutated. */
const deepMerge = <T>(base: T, override: unknown): T => {
    if (!isPlainObject(override)) {
        return override === undefined ? base : (override as T);
    }
    if (!isPlainObject(base)) {
        return override as T;
    }

    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
        result[key] = deepMerge(result[key], value);
    }
    return result as T;
};

/**
 * Applies the active cascade profiles to `base` in `PROFILE_CASCADE` order, last writer winning —
 * so `reducedTransparency` beats `lowPower` beats `remote` on any key they share, while keys only
 * one of them sets survive untouched. The merge is cumulative, not exclusive.
 *
 * `active.reducedMotion` is ignored here on purpose: use `applyReducedMotion`.
 */
export const resolveProfileTokens = (
    base: ReefinTokens,
    active: ActiveProfiles
): ReefinTokens =>
    PROFILE_CASCADE.reduce<ReefinTokens>(
        (tokens, profile) =>
            active[profile]
                ? deepMerge(tokens, CASCADE_OVERRIDES[profile])
                : tokens,
        base
    );

/** The orthogonal axis, applied independently of — and after — the cascade. */
export const applyReducedMotion = (
    tokens: ReefinTokens,
    reducedMotion: boolean | undefined
): ReefinTokens =>
    reducedMotion ? deepMerge(tokens, REDUCED_MOTION_OVERRIDE) : tokens;

/** Full resolution: cascade first, then the orthogonal motion axis. */
export const resolveTokensForProfiles = (
    base: ReefinTokens,
    active: ActiveProfiles
): ReefinTokens =>
    applyReducedMotion(
        resolveProfileTokens(base, active),
        active.reducedMotion
    );

/**
 * The single cascade winner, for `data-rf-profile` CSS scoping — a selector cannot arbitrate a
 * priority on its own, so exactly one name is published. `reducedMotion` never appears here; it
 * gets its own `data-rf-reduced-motion` attribute (two axes, two attributes).
 */
export const PROFILE_ATTRIBUTE_VALUE: Record<CascadeProfile, string> = {
    remote: 'remote',
    lowPower: 'low-power',
    reducedTransparency: 'reduced-transparency'
};

export const getProfileAttribute = (
    active: ActiveProfiles
): string | undefined => {
    for (const profile of [...PROFILE_CASCADE].reverse()) {
        if (active[profile]) {
            return PROFILE_ATTRIBUTE_VALUE[profile];
        }
    }
    return undefined;
};

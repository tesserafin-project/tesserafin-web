/**
 * Interaction-profile token overrides (RFC-0005 §7.2, issue #18), specified in
 * `docs/tesserafin/design-glass-interaction-profiles.md`.
 *
 * **LIVE.** These partials are resolved at runtime by `src/themes/useInteractionProfiles.ts` and
 * projected onto CSS custom properties by `./projectTokens.ts`, so an override is true in this
 * object *and* in the browser's computed styles. (It was previously dormant, gated on two lanes
 * that have since closed: Reefin Glass landed on `main` with PR #14, reefin#39 merged, and the
 * bundle margin target was met — see the git history of this comment.)
 *
 * **Bound to Glass only.** `useInteractionProfiles` projects nothing unless the active theme is
 * `official.glass`. That binding matters, because these partials are *not* no-ops against Classic
 * — `REDUCED_TRANSPARENCY_OVERRIDE` would repaint Classic's `#202020` surface to `#141a22`, and
 * `REMOTE_OVERRIDE` would give it a non-zero blur it does not want. Classic is used as a base in
 * the unit test only, as a vehicle for asserting the *resolution*; what keeps it safe in the app
 * is the theme guard, which `glass-interaction-profiles.spec.ts` asserts against real computed
 * styles rather than trusting.
 *
 * Since issue #18's G18b-1 slice Glass is selectable from the theme pickers (opt-in, badged
 * `experimental` in `src/themes/registry.ts` — never the default), in both its modes, so these
 * profiles are now reachable by ordinary use rather than only by applying Glass by id. The
 * Glass-only binding above is unchanged and is what still keeps them off Classic.
 *
 * **Format decision (issue #18 item 1):** a profile override is a *concrete deep-partial* of
 * `tokens.schema.json`, not a semantic value (`"blur": "reduced"`). A semantic value needs a
 * per-theme resolution table that is neither published nor shared across renderers; a concrete
 * partial carries its own values. `theme.schema.json`'s `profileOverride` already says
 * "deep-partial of tokens.schema.json" — this confirms the schema rather than changing it. The
 * runtime honors that decision literally: `projectTokens.ts` computes custom-property names from
 * token paths, so no profile-name → value table exists anywhere in the chain.
 */

import type { TesserafinTokens } from './types';

/**
 * `NonNullable` before the `object` test, because an *optional* token group would otherwise not
 * recurse: `TesserafinColorTokens['light']` is `TesserafinColorGroup | undefined`, and a union with
 * `undefined` does not extend `object`, so the naive form fell through to the non-partial branch
 * and demanded all 13 color keys from a partial that legitimately declares four.
 */
type DeepPartial<T> = {
    [K in keyof T]?: NonNullable<T[K]> extends object
        ? DeepPartial<NonNullable<T[K]>>
        : T[K];
};

/** A profile override: a deep-partial of the token set, never a new namespace. */
export type TesserafinTokensOverride = DeepPartial<TesserafinTokens>;

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
export const REMOTE_OVERRIDE: TesserafinTokensOverride = {
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
export const LOW_POWER_OVERRIDE: TesserafinTokensOverride = {
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
 *
 * **Both modes carry concrete values.** `projectTokens.ts#toCustomProperties` projects only the
 * *active* mode's `color` group, so a `dark`-only override would zero the blur under Glass Light
 * while leaving its surface translucent — precisely the "worse than the blur" state this override
 * exists to prevent, and an override true in this object and false in the computed styles. The
 * light values are not a `mode === 'light'` branch (that would be the per-theme resolution table
 * `docs/tesserafin/design-glass-interaction-profiles.md` §1 rejects): they are the same concrete
 * partial shape as `dark`, authored by compositing Glass Light's own translucent tokens over its
 * `background` so the opaque surface renders the color the frosted one already resolved to, at
 * identical contrast (6.38:1 for `textMuted`, either way).
 */
export const REDUCED_TRANSPARENCY_OVERRIDE: TesserafinTokensOverride = {
    blur: { sm: '0', md: '0', lg: '0' },
    color: {
        dark: {
            surface: '#141a22',
            surfaceVariant: '#1b232d',
            textMuted: '#b6c2cf',
            divider: '#2a343f'
        },
        light: {
            surface: '#f7f9fc',
            surfaceVariant: '#e0e7f3',
            textMuted: '#575c66',
            divider: '#d6d9dd'
        }
    }
};

export const CASCADE_OVERRIDES: Record<
    CascadeProfile,
    TesserafinTokensOverride
> = {
    remote: REMOTE_OVERRIDE,
    lowPower: LOW_POWER_OVERRIDE,
    reducedTransparency: REDUCED_TRANSPARENCY_OVERRIDE
};

/**
 * The orthogonal axis. Durations only — easing curves stay, since a zero-duration transition never
 * samples them and a future non-zero duration must recover the same motion identity.
 */
export const REDUCED_MOTION_OVERRIDE: TesserafinTokensOverride = {
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
    base: TesserafinTokens,
    active: ActiveProfiles
): TesserafinTokens =>
    PROFILE_CASCADE.reduce<TesserafinTokens>(
        (tokens, profile) =>
            active[profile]
                ? deepMerge(tokens, CASCADE_OVERRIDES[profile])
                : tokens,
        base
    );

/** The orthogonal axis, applied independently of — and after — the cascade. */
export const applyReducedMotion = (
    tokens: TesserafinTokens,
    reducedMotion: boolean | undefined
): TesserafinTokens =>
    reducedMotion ? deepMerge(tokens, REDUCED_MOTION_OVERRIDE) : tokens;

/** Full resolution: cascade first, then the orthogonal motion axis. */
export const resolveTokensForProfiles = (
    base: TesserafinTokens,
    active: ActiveProfiles
): TesserafinTokens =>
    applyReducedMotion(
        resolveProfileTokens(base, active),
        active.reducedMotion
    );

/**
 * The active profiles merged into a **single deep-partial**, in the same cumulative cascade order
 * as `resolveProfileTokens` and with the orthogonal motion axis folded in last.
 *
 * This is what the runtime actually projects, and it is deliberately *not*
 * `resolveTokensForProfiles(base, active)`. Two reasons, one of which is load-bearing:
 *
 *   - **Bundle.** Resolving against a base would require importing a theme's full token object.
 *     `useInteractionProfiles` runs on the main-bundle theme path, so importing
 *     `officialGlassTokens` there would drag Glass's entire palette out of its lazy chunk and into
 *     the main bundle — precisely the separation RFC-0005 §9.1 buys by making Glass a dynamic
 *     `import()`. A delta carries only the literals declared above.
 *   - **Restore fidelity.** Projecting a delta means deactivation only has to *remove* what it
 *     wrote, letting the stylesheet's build-time value re-emerge unchanged. Projecting a full
 *     resolved set would mean writing back a remembered copy of every token, which is exact only
 *     as long as the remembered copy is.
 *
 * The merge order is identical to `resolveProfileTokens`'s, so a delta applied to a base and a
 * resolution against that base agree key for key — `projectTokens.test.ts` pins that equivalence.
 */
export const resolveProfileOverride = (
    active: ActiveProfiles
): TesserafinTokensOverride => {
    const cascaded = PROFILE_CASCADE.reduce<TesserafinTokensOverride>(
        (override, profile) =>
            active[profile]
                ? deepMerge(override, CASCADE_OVERRIDES[profile])
                : override,
        {}
    );

    return active.reducedMotion
        ? deepMerge(cascaded, REDUCED_MOTION_OVERRIDE)
        : cascaded;
};

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

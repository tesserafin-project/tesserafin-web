/**
 * Runtime projection of a token override onto CSS custom properties (RFC-0005 §7.1, §7.2).
 *
 * ## Why this exists
 *
 * An interaction profile (`./profiles.ts`) is a concrete deep-partial of `ReefinTokens`. Resolving
 * it produces a new *TypeScript object* — and nothing else. The rendered page does not read that
 * object: every Reefin surface reads `--rf-*` custom properties that were emitted **at build time**
 * into `src/ui/tokens/<themeId>.css`. Without this module a profile override is true in the object
 * and false in the computed styles: `_glass-surface.scss` keeps painting the blur that was baked
 * into the stylesheet. This module is the bridge, and it is deliberately the *only* one.
 *
 * ## The derived-property rule
 *
 * `blur.<key>` is not projected alone. The generator emits **two** properties per blur key — the
 * primitive `--rf-blur-<key>` and the derived `--rf-backdrop-filter-<key>` — and consumer CSS reads
 * the derived one (see `src/ui/styles/_glass-surface.scss`, which explains why: `blur(0)` still
 * allocates a compositing layer where `none` does not). Projecting only the primitive would move
 * `--rf-blur-md` and leave `--rf-backdrop-filter-md` stale, which is the exact half-applied state
 * described above.
 *
 * So this module **re-derives** the derived property, through the very same function the generator
 * uses (`reefin-design/web/backdrop-filter.mjs`) rather than a second copy of the formula. One
 * formula, two call sites, no possibility of build-time and run-time disagreeing. This is the
 * chosen runtime authority: the projection regenerates every derived property it invalidates.
 *
 * ## Naming
 *
 * Property names are *computed* from the token path, never looked up in a table:
 * `spacing.md` → `--rf-spacing-md`, `typography.fontSize.lg` → `--rf-typography-font-size-lg`,
 * `blur.md` → `--rf-blur-md` (+ `--rf-backdrop-filter-md`). The one structural exception is
 * `color.<mode>.<key>`, whose mode segment is dropped — `color.dark.surfaceVariant` becomes
 * `--rf-color-surface-variant` — because the generator scopes modes by `[data-rf-mode]` selector
 * instead of by property name. This mirrors `reefin-design/scripts/generate-web-tokens.mjs`; the
 * `projectTokens.test.ts` suite pins the two against the generated CSS so they cannot drift.
 *
 * Because names are derived from paths, a profile cannot address a token that does not exist, and
 * there is no profile-name → value lookup anywhere in the chain: the partials carry their own
 * concrete values (see `docs/reefin/design-glass-interaction-profiles.md` §1).
 */

import { toBackdropFilter } from '../../../reefin-design/web/backdrop-filter.mjs';

import type { ReefinTokensOverride } from './profiles';

/** A projected custom property: the `--rf-*` name and the value to write. */
export type CustomProperties = Record<string, string>;

/** `surfaceVariant` → `surface-variant`; `level2` stays `level2` (digits are not word breaks). */
const kebab = (segment: string): string =>
    segment.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Flattens a token override into the `--rf-*` custom properties that carry it.
 *
 * @param override The deep-partial to project.
 * @param mode Which `color.<mode>` group to read. Only this group is projected — projecting the
 * inactive mode's colors would write properties the active `[data-rf-mode]` tier never reads, and
 * would silently repaint the page if the mode later changed.
 */
export const toCustomProperties = (
    override: ReefinTokensOverride,
    mode: 'dark' | 'light' = 'dark'
): CustomProperties => {
    const properties: CustomProperties = {};

    const walk = (node: unknown, path: readonly string[]): void => {
        if (isPlainObject(node)) {
            for (const [key, value] of Object.entries(node)) {
                walk(value, [...path, key]);
            }
            return;
        }
        if (node === undefined || node === null) {
            return;
        }

        // `color.<mode>.<key>`: keep only the active mode, and drop the mode segment — the
        // generator distinguishes modes by selector (`[data-rf-mode]`), not by property name.
        if (path[0] === 'color') {
            if (path[1] !== mode) {
                return;
            }
            properties[`--rf-color-${kebab(path[2])}`] = String(node);
            return;
        }

        properties[`--rf-${path.map(kebab).join('-')}`] = String(node);

        // The derived companion. `blur.<key>` invalidates `--rf-backdrop-filter-<key>`, so the
        // projection regenerates it from the same source of truth the generator used.
        if (path[0] === 'blur' && path.length === 2) {
            properties[`--rf-backdrop-filter-${path[1]}`] = toBackdropFilter(
                String(node)
            );
        }
    };

    walk(override, []);
    return properties;
};

/**
 * Writes `properties` as inline custom properties on `element` and returns a function restoring
 * the element to **exactly** its prior state.
 *
 * Restore fidelity is structural rather than remembered-by-value: the projection only ever writes
 * to the inline `style` attribute, which sits above the stylesheet tiers in the cascade, so
 * removing an inline property re-exposes whatever `src/ui/tokens/<themeId>.css` declared — the
 * build-time value, byte for byte, with no need to have captured it. A property that already had
 * an inline value (nothing in Reefin sets one today, but a host page could) is put back verbatim
 * instead of removed, so this holds either way.
 */
export const applyCustomProperties = (
    element: HTMLElement,
    properties: CustomProperties
): (() => void) => {
    const previous = new Map<string, string>();

    for (const [name, value] of Object.entries(properties)) {
        previous.set(name, element.style.getPropertyValue(name));
        element.style.setProperty(name, value);
    }

    return () => {
        for (const [name, priorValue] of previous) {
            if (priorValue === '') {
                element.style.removeProperty(name);
            } else {
                element.style.setProperty(name, priorValue);
            }
        }
    };
};

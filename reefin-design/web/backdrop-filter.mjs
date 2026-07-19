/**
 * The Web renderer's **single** `blur.<key>` → `backdrop-filter` derivation (RFC-0005 §7.1, §8.2).
 *
 * There is exactly one copy of this formula on purpose. It has two consumers, and they must never
 * disagree about what a given blur token means:
 *
 *   1. **Build time** — `reefin-design/scripts/generate-web-tokens.mjs` derives
 *      `--rf-backdrop-filter-<key>` alongside `--rf-blur-<key>` into `src/ui/tokens/<themeId>.css`.
 *   2. **Run time** — `src/ui/tokens/projectTokens.ts` re-derives `--rf-backdrop-filter-<key>`
 *      whenever an interaction profile (RFC-0005 §7.2) overrides `blur.<key>` on the active theme.
 *
 * Without (2) the runtime override is a half-truth: the profile's blur is real in the resolved
 * `ReefinTokens` object but the derived custom property still carries the value baked in at build
 * time, so `_glass-surface.scss` — which reads the *derived* property — keeps painting the old
 * blur. Re-deriving through this shared function is what makes the object and the computed style
 * agree. A second, separately-written formula on the runtime side would reintroduce the same class
 * of drift it is meant to remove, which is why this module exists rather than a duplicated literal.
 *
 * `backdrop-filter: blur(0)` is NOT equivalent to `backdrop-filter: none` — a zero-radius `blur()`
 * still creates a compositing layer and costs GPU work, `none` does not. That distinction is the
 * whole reason consumer CSS reads `--rf-backdrop-filter-<key>` instead of wrapping
 * `--rf-blur-<key>` in `blur()` itself: Reefin Classic (`blur: "0"` for every key) gets a real
 * no-op, Reefin Glass gets an actual `blur(<length>)`, and the `reducedTransparency` profile —
 * which drives Glass's blur to `"0"` at run time — gets the same real no-op rather than a
 * still-compositing `blur(0px)`.
 *
 * Plain `.mjs` with no dependencies so both a Node build script and the TypeScript/webpack runtime
 * bundle can consume the identical source file.
 *
 * @param {string} blurValue A raw `blur.<key>` length token (e.g. `"16px"`, `"0"`).
 * @returns {string} A ready-to-use `backdrop-filter` value (`"none"` or `"blur(<length>)"`).
 */
export function toBackdropFilter(blurValue) {
    return blurValue === '0' ? 'none' : `blur(${blurValue})`;
}

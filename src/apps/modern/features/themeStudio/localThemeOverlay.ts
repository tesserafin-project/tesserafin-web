/**
 * Applying a local draft to the running app (RFC-0007 §4.4).
 *
 * ## Why an overlay rather than a registry entry
 *
 * `src/themes/registry.ts` is the catalogue of themes Tesserafin Web *ships*: each entry names a
 * bundled or lazily-imported MUI colour scheme and a generated stylesheet that exists at build time.
 * A locally-authored draft has neither. Making the registry accept runtime entries would mean the
 * theme picker, the persisted `userSettings.theme()` value and the legacy `ThemeCss` path all had to
 * cope with an id that may vanish when the user deletes a draft — a large change to load-bearing
 * code, for an alpha.
 *
 * So a draft is applied as a **token overlay over the official theme it was derived from**: the base
 * theme stays active and provides structure, MUI wiring and any lazily-loaded colour scheme, and the
 * draft's `--rf-*` values are layered on top. The user's saved theme preference is untouched, so
 * clearing the overlay is complete and instant.
 *
 * ## Precedence, and why it is the right way round
 *
 * The overlay is a `<style>` element appended last in `<head>`, scoped to
 * `:root[data-rf-local-theme]`. Interaction profiles (`themes/useInteractionProfiles.ts`) write
 * their `--rf-*` overrides as INLINE styles on `<html>`, and inline styles beat any stylesheet — so
 * `reducedMotion` and `reducedTransparency` still win over whatever a draft sets.
 *
 * That is deliberate. Those two profiles exist because a user asked their operating system to reduce
 * motion or transparency, and a theme must not be able to override an accessibility preference
 * (RFC-0007 §6.1). Getting this precedence backwards would make every draft a way to defeat it.
 */

import {
    clearAppliedPresentation,
    saveAppliedPresentation
} from 'themes/platform/localPresentation';
import { toCustomProperties } from 'ui/tokens/projectTokens';

import type { ThemeDraft } from './draftFormat';

const STYLE_ELEMENT_ID = 'tesserafin-local-theme-overlay';
const ROOT_ATTRIBUTE = 'data-rf-local-theme';

/**
 * Builds the overlay stylesheet text for a draft. Pure, so it is testable without a DOM.
 *
 * Projection goes through `ui/tokens/projectTokens.ts`, the same function the interaction-profile
 * runtime uses, rather than a second flattener living here: the `--rf-*` naming rule, the
 * mode-segment elision and the derived `--rf-backdrop-filter-*` companions are decisions that must
 * hold identically in both paths, and two implementations of them would drift.
 */
export function buildOverlayCss(
    draft: ThemeDraft,
    mode: 'light' | 'dark'
): string {
    const declarations = Object.entries(toCustomProperties(draft.tokens, mode))
        .map(([name, value]) => `    ${name}: ${value};`)
        .join('\n');
    return `:root[${ROOT_ATTRIBUTE}="${draft.manifest.id}"] {\n${declarations}\n}\n`;
}

/**
 * Applies a draft to the live document. Explicit — nothing here runs as a side effect of editing.
 */
export function applyLocalThemeOverlay(
    draft: ThemeDraft,
    mode: 'light' | 'dark',
    doc: Document = document
): void {
    const style =
        (doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null) ??
        doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = buildOverlayCss(draft, mode);
    // Appended last so it wins over the generated theme stylesheet at equal specificity, and
    // re-appended on every apply so a later-loaded theme chunk cannot end up after it.
    doc.head.appendChild(style);
    doc.documentElement.setAttribute(ROOT_ATTRIBUTE, draft.manifest.id);
    // The draft's SEMANTIC choices, alongside its tokens. Without this an applied draft changed
    // colour and type but not surfaces, cards or navigation — the Studio's presentation controls
    // would have been preview-only, which is exactly the half-delivered state to avoid.
    saveAppliedPresentation(draft.manifest.presentation);
}

/** Removes the overlay completely. The base theme is left exactly as it was. */
export function clearLocalThemeOverlay(doc: Document = document): void {
    doc.getElementById(STYLE_ELEMENT_ID)?.remove();
    doc.documentElement.removeAttribute(ROOT_ATTRIBUTE);
    // Cleared together with the stylesheet, so the tokens and the presentation can never describe
    // different themes.
    clearAppliedPresentation();
}

/** The id currently overlaid, or `null`. */
export function getAppliedLocalThemeId(
    doc: Document = document
): string | null {
    return doc.documentElement.getAttribute(ROOT_ATTRIBUTE);
}

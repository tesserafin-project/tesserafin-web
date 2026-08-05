/**
 * The applied local theme's presentation, shared between the Theme Studio (which writes it) and the
 * app root (which reads it) — RFC-0007 §4.6.
 *
 * ## Why this is a separate, tiny record rather than "read the applied draft"
 *
 * The Studio already persists the whole applied draft, and the app root could read it back. It must
 * not: the draft format pulls in the manifest schema and the validator, and the app root is on the
 * main bundle path. That would move ~10 KB of JSON schema out of the Studio's lazy chunk and into
 * the main bundle to answer one question.
 *
 * So Apply writes a **presentation-only** record. It is small, it is the only part the renderer
 * needs, and both sides depend on this module rather than on each other — the Studio does not
 * import the app root, and the app root does not import the Studio.
 *
 * The value written has already been schema-validated as part of the draft, so the read side does
 * not re-validate the vocabulary. It does check the shape, because `localStorage` is editable by
 * hand and a malformed record must degrade to "no local presentation" rather than throw on boot.
 */

import type { ThemePresentation } from './contract';

const KEY = 'tesserafin.themeStudio.appliedPresentation';

/**
 * Subscribers notified when the applied presentation changes.
 *
 * Needed because Apply is imperative: `applyLocalThemeOverlay` mutates `document.head` and
 * `localStorage`, neither of which re-renders React, and the user's saved theme preference is
 * deliberately untouched — so `activeThemeId` does not change either. Without a signal the tokens
 * would change instantly and the presentation only on the next full page load, which is the
 * "preview-only" state this whole binding exists to remove.
 *
 * A module-level set rather than an event on `window`: the two sides are already coupled through
 * this module, and a DOM event would be a second, observable channel that anything could fire.
 */
const listeners = new Set<() => void>();

/** Subscribe to applied-presentation changes. Returns an unsubscribe function. */
export function subscribeAppliedPresentation(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function notify(): void {
    for (const listener of [...listeners]) listener();
}

/**
 * Snapshot identity for `useSyncExternalStore`, which compares snapshots with `Object.is`.
 * `loadAppliedPresentation` parses JSON and would return a NEW object every call, so using it
 * directly as the snapshot would re-render on every check forever. The cache is invalidated by
 * {@link notify}'s callers instead.
 */
let cachedRaw: string | null | undefined;
let cachedValue: ThemePresentation | null = null;

function storage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        // Private-browsing modes expose `localStorage` and throw on access.
        return null;
    }
}

/** Records the presentation of the draft the user just applied. */
export function saveAppliedPresentation(
    presentation: ThemePresentation | undefined
): void {
    const store = storage();
    if (!store) return;
    try {
        store.setItem(KEY, JSON.stringify(presentation ?? {}));
        cachedRaw = undefined;
        notify();
    } catch {
        // Quota. The overlay's tokens are what matter most; losing the presentation record
        // degrades to the theme's own presentation rather than breaking the apply.
    }
}

/** Forgets it. Called when the overlay is cleared, so the two can never disagree. */
export function clearAppliedPresentation(): void {
    storage()?.removeItem(KEY);
    cachedRaw = undefined;
    notify();
}

/**
 * The applied local presentation, or `null` when there is none — or when what is stored is not a
 * plain object, which is the only shape check worth doing here: every VALUE inside it was validated
 * against `theme.schema.json` before the draft could be applied, and `resolvePresentation` ignores
 * keys it does not know.
 */
export function loadAppliedPresentation(): ThemePresentation | null {
    const raw = storage()?.getItem(KEY) ?? null;
    if (raw === cachedRaw) return cachedValue;
    cachedRaw = raw;
    cachedValue = parse(raw);
    return cachedValue;
}

function parse(raw: string | null): ThemePresentation | null {
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            Array.isArray(parsed)
        ) {
            return null;
        }
        return parsed as ThemePresentation;
    } catch {
        return null;
    }
}

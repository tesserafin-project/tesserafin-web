/**
 * Draft creation and the edit history behind undo / redo / reset.
 *
 * The history is a past/present/future stack over whole draft revisions. That is affordable because
 * `setTokenValue` shares structure: two adjacent revisions differ by one leaf and one spine of
 * objects, not by a deep copy. A diff/patch history would be smaller still and would make "reset"
 * and "import" — which replace everything — the awkward cases instead of the trivial ones.
 */

import {
    type ThemeDraft,
    DRAFT_FORMAT_VERSION,
    DRAFT_KIND
} from './draftFormat';
import type { OfficialThemeSource } from './officialSources';
import { setTokenValue } from './tokenModel';

import type { ThemeManifest, ThemePresentation } from 'themes/platform';

/** Namespace every locally-authored theme lives in. Never `official.*`. */
export const LOCAL_THEME_NAMESPACE = 'local';

/**
 * Creates a draft as an immutable copy of an official theme.
 *
 * Three things are deliberately NOT copied:
 *
 *   - the **id**, which becomes `local.<slug>`. A draft that kept `official.classic` would collide
 *     with the shipped theme in every store that keys by id, including the user's saved preference.
 *   - the **author**, which becomes the person editing rather than the Tesserafin Project.
 *   - the **version**, which restarts at 0.1.0 — a derivative is not a continuation of the
 *     original's version line.
 *
 * `lineage.basedOn` records what it came from, so the provenance survives the id change.
 */
export function createDraft(
    source: OfficialThemeSource,
    name: string,
    author: string
): ThemeDraft {
    const slug =
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'draft';

    const manifest: ThemeManifest = {
        ...source.manifest,
        id: `${LOCAL_THEME_NAMESPACE}.${slug}`,
        version: '0.1.0',
        name,
        author,
        lineage: {
            basedOn: {
                id: source.manifest.id,
                version: source.manifest.version
            },
            remixable: true
        }
    };

    return {
        formatVersion: DRAFT_FORMAT_VERSION,
        kind: DRAFT_KIND,
        basedOn: {
            id: source.manifest.id,
            version: source.manifest.version,
            name: source.manifest.name
        },
        manifest,
        // Structural copy of the frozen official tokens. Every later edit replaces a branch rather
        // than writing into one, so the frozen source is never reached by an assignment.
        tokens: { ...source.tokens }
    };
}

export interface DraftHistory {
    past: readonly ThemeDraft[];
    present: ThemeDraft;
    future: readonly ThemeDraft[];
    /** The revision `reset` returns to: the draft exactly as created or imported. */
    origin: ThemeDraft;
}

export type DraftAction =
    | { type: 'set-token'; path: string; value: string | number }
    | { type: 'set-presentation'; presentation: ThemePresentation }
    | { type: 'set-name'; name: string }
    | { type: 'undo' }
    | { type: 'redo' }
    | { type: 'reset' }
    | { type: 'replace'; draft: ThemeDraft }
    | { type: 'discard' };

export function initHistory(draft: ThemeDraft): DraftHistory {
    return { past: [], present: draft, future: [], origin: draft };
}

/** Pushes a new present, discarding any redo branch — the standard linear-history rule. */
function commit(history: DraftHistory, next: ThemeDraft): DraftHistory {
    if (next === history.present) return history;
    return {
        past: [...history.past, history.present],
        present: next,
        future: [],
        origin: history.origin
    };
}

/**
 * `null` is a real state, not an absence to be guarded away: before the user picks an official
 * theme to start from there is no draft, and after discarding one there is none again. Modelling
 * that here keeps every caller from having to invent its own "no draft yet" flag.
 */
export function draftReducer(
    history: DraftHistory | null,
    action: DraftAction
): DraftHistory | null {
    if (action.type === 'replace') return initHistory(action.draft);
    if (action.type === 'discard') return null;
    if (!history) return null;

    switch (action.type) {
        case 'set-token': {
            const tokens = setTokenValue(
                history.present.tokens,
                action.path,
                action.value
            );
            return commit(history, { ...history.present, tokens });
        }

        case 'set-presentation':
            return commit(history, {
                ...history.present,
                manifest: {
                    ...history.present.manifest,
                    presentation: action.presentation
                }
            });

        case 'set-name':
            return commit(history, {
                ...history.present,
                manifest: { ...history.present.manifest, name: action.name }
            });

        case 'undo': {
            if (history.past.length === 0) return history;
            const previous = history.past[history.past.length - 1];
            return {
                past: history.past.slice(0, -1),
                present: previous,
                future: [history.present, ...history.future],
                origin: history.origin
            };
        }

        case 'redo': {
            if (history.future.length === 0) return history;
            const [next, ...rest] = history.future;
            return {
                past: [...history.past, history.present],
                present: next,
                future: rest,
                origin: history.origin
            };
        }

        case 'reset':
            // Reset is an undoable edit, not a history wipe: a mis-clicked reset would otherwise
            // destroy work with no way back, which is the one thing an undo stack exists to prevent.
            return commit(history, history.origin);

        default:
            return history;
    }
}

export const canUndo = (history: DraftHistory) => history.past.length > 0;
export const canRedo = (history: DraftHistory) => history.future.length > 0;
export const isDirty = (history: DraftHistory) =>
    history.present !== history.origin;

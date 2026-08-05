/**
 * Local persistence for drafts and for the applied overlay.
 *
 * `localStorage` and nothing else. No account, no server call, no sync — RFC-0007 and the Theme
 * Studio brief both require that creating, previewing, importing and exporting a local theme work
 * with no Tesserafin account and no server connection at all.
 *
 * Everything read back from storage goes through the same validator an imported file does. Stored
 * data is not trustworthy input: it can be edited by hand, written by an older build, or truncated
 * by a full quota. A read that cannot be validated returns `null` and the caller starts clean —
 * corrupt storage must never be able to stop the Studio from opening.
 */

import { parseDraft, serialiseDraft, type ThemeDraft } from './draftFormat';

const DRAFT_KEY = 'tesserafin.themeStudio.draft';
const APPLIED_KEY = 'tesserafin.themeStudio.applied';

function safeStorage(): Storage | null {
    try {
        // Private-browsing modes expose `localStorage` and throw on access. Probing here means the
        // Studio degrades to "edits are not kept" rather than failing to render.
        const probe = '__tesserafin_probe__';
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
        return window.localStorage;
    } catch {
        return null;
    }
}

function read(key: string): ThemeDraft | null {
    const storage = safeStorage();
    if (!storage) return null;
    const raw = storage.getItem(key);
    if (!raw) return null;
    const result = parseDraft(raw);
    if (!result.valid) {
        // Drop it rather than leaving a file that fails on every load. The user loses an
        // unrecoverable draft either way; keeping it would only make the failure permanent.
        storage.removeItem(key);
        return null;
    }
    return result.draft;
}

function write(key: string, draft: ThemeDraft): boolean {
    const storage = safeStorage();
    if (!storage) return false;
    try {
        storage.setItem(key, serialiseDraft(draft));
        return true;
    } catch {
        // Quota exceeded. Reported to the caller so the UI can say persistence failed instead of
        // silently promising the draft is kept.
        return false;
    }
}

export const loadDraft = () => read(DRAFT_KEY);
export const saveDraft = (draft: ThemeDraft) => write(DRAFT_KEY, draft);

export function clearDraft(): void {
    safeStorage()?.removeItem(DRAFT_KEY);
}

export const loadAppliedDraft = () => read(APPLIED_KEY);
export const saveAppliedDraft = (draft: ThemeDraft) =>
    write(APPLIED_KEY, draft);

export function clearAppliedDraft(): void {
    safeStorage()?.removeItem(APPLIED_KEY);
}

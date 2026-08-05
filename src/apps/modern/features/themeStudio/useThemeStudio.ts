/**
 * The Theme Studio's state: one draft, its edit history, its validation, and the explicit apply.
 *
 * Kept out of the components so the whole model is testable without rendering anything — the parts
 * most likely to be wrong (history semantics, import recovery, apply/revert) are the parts a DOM
 * test proves least directly.
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import {
    resolvePresentation,
    type ThemeValidationIssue
} from 'themes/platform';
import { validateManifest } from 'themes/platform';
import { validateTokens } from 'themes/platform/validateTokens';

import { parseDraft, serialiseDraft, type ThemeDraft } from './draftFormat';
import {
    canRedo,
    canUndo,
    createDraft,
    draftReducer,
    initHistory,
    isDirty,
    type DraftHistory
} from './draftState';
import {
    clearAppliedDraft,
    clearDraft,
    loadAppliedDraft,
    loadDraft,
    saveAppliedDraft,
    saveDraft
} from './draftStorage';
import {
    applyLocalThemeOverlay,
    clearLocalThemeOverlay
} from './localThemeOverlay';
import { getOfficialSource, OFFICIAL_SOURCES } from './officialSources';

export interface StudioState {
    draft: ThemeDraft | null;
    issues: readonly ThemeValidationIssue[];
    /** Capability resolution for the current draft — drives the preview and the fallback notice. */
    resolution: ReturnType<typeof resolvePresentation> | null;
    canUndo: boolean;
    canRedo: boolean;
    dirty: boolean;
    appliedThemeId: string | null;
    /** Set when the last storage write failed (quota, private browsing). */
    persistenceFailed: boolean;
    /** Set when the last import was rejected; cleared by the next successful action. */
    importIssues: readonly ThemeValidationIssue[];
}

export function useThemeStudio(mode: 'light' | 'dark') {
    const [history, dispatch] = useReducer(
        draftReducer,
        null,
        // Restored from storage if there is a valid draft there, otherwise no draft yet and the
        // Studio shows its "start from an official theme" step. `loadDraft` re-validates, so a
        // hand-edited or truncated entry lands here as `null` rather than as a broken draft.
        (): DraftHistory | null => {
            const stored = loadDraft();
            return stored ? initHistory(stored) : null;
        }
    );

    const [appliedThemeId, setAppliedThemeId] = useState<string | null>(null);
    const [persistenceFailed, setPersistenceFailed] = useState(false);
    const [importIssues, setImportIssues] = useState<
        readonly ThemeValidationIssue[]
    >([]);

    const draft = history?.present ?? null;

    // Re-apply a previously applied draft on mount, so Apply survives a reload the way a theme
    // preference does. Explicit at the time it was chosen; restoring it is not a second decision.
    useEffect(() => {
        const applied = loadAppliedDraft();
        if (!applied) return;
        applyLocalThemeOverlay(applied, mode);
        setAppliedThemeId(applied.manifest.id);
    }, [mode]);

    useEffect(() => {
        if (!draft) return;
        setPersistenceFailed(!saveDraft(draft));
    }, [draft]);

    const issues = useMemo<readonly ThemeValidationIssue[]>(() => {
        if (!draft) return [];
        const manifestResult = validateManifest(draft.manifest);
        return [
            ...(manifestResult.valid ? [] : manifestResult.issues),
            ...validateTokens(draft.tokens)
        ];
    }, [draft]);

    const resolution = useMemo(
        () => (draft ? resolvePresentation(draft.manifest) : null),
        [draft]
    );

    const start = useCallback(
        (sourceId: string, name: string, author: string) => {
            const source = getOfficialSource(sourceId);
            if (!source) return;
            setImportIssues([]);
            dispatch({
                type: 'replace',
                draft: createDraft(source, name, author)
            });
        },
        []
    );

    const importDraft = useCallback((rawText: string) => {
        const result = parseDraft(rawText);
        if (!result.valid) {
            // The existing draft is untouched. A rejected import must not be able to destroy work.
            setImportIssues(result.issues);
            return false;
        }
        setImportIssues([]);
        dispatch({ type: 'replace', draft: result.draft });
        return true;
    }, []);

    const exportDraft = useCallback(() => {
        if (!draft) return null;
        return serialiseDraft(draft);
    }, [draft]);

    const apply = useCallback(() => {
        // Guarded rather than merely discouraged: applying a draft that fails validation would put
        // values the contract rejects onto the live document.
        if (!draft || issues.length > 0) return false;
        applyLocalThemeOverlay(draft, mode);
        saveAppliedDraft(draft);
        setAppliedThemeId(draft.manifest.id);
        return true;
    }, [draft, issues, mode]);

    const revert = useCallback(() => {
        clearLocalThemeOverlay();
        clearAppliedDraft();
        setAppliedThemeId(null);
    }, []);

    const discard = useCallback(() => {
        clearDraft();
        setImportIssues([]);
        dispatch({ type: 'discard' });
    }, []);

    return {
        sources: OFFICIAL_SOURCES,
        state: {
            draft,
            issues,
            resolution,
            canUndo: history ? canUndo(history) : false,
            canRedo: history ? canRedo(history) : false,
            dirty: history ? isDirty(history) : false,
            appliedThemeId,
            persistenceFailed,
            importIssues
        } satisfies StudioState,
        dispatch,
        start,
        importDraft,
        exportDraft,
        apply,
        revert,
        discard
    };
}

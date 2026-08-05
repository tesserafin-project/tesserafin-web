import { describe, expect, it } from 'vitest';

import { serialiseDraft, parseDraft } from './draftFormat';
import {
    canRedo,
    canUndo,
    createDraft,
    draftReducer,
    initHistory,
    isDirty
} from './draftState';
import { OFFICIAL_SOURCES, getOfficialSource } from './officialSources';
import { getTokenValue } from './tokenModel';

/** Narrowed at the boundary, so every use below is typed rather than repeatedly guarded. */
function requireSource(id: string) {
    const source = getOfficialSource(id);
    if (!source) throw new Error(`${id} must be a startable source`);
    return source;
}

const classic = requireSource('official.classic');

function newDraft() {
    return createDraft(classic, 'My theme', 'Local author');
}

describe('official sources', () => {
    it('offers exactly the two official themes', () => {
        expect(OFFICIAL_SOURCES.map((s) => s.id)).toEqual([
            'official.classic',
            'official.glass'
        ]);
    });

    it('exposes them frozen, so an edit cannot reach the shipped theme', () => {
        expect(Object.isFrozen(classic.tokens)).toBe(true);
        expect(Object.isFrozen(classic.tokens.color.dark)).toBe(true);
    });

    it('carries the Tesserafin display names', () => {
        expect(OFFICIAL_SOURCES.map((s) => s.name)).toEqual([
            'Tesserafin Classic',
            'Tesserafin Glass'
        ]);
    });
});

describe('createDraft', () => {
    it('copies the tokens rather than referencing the official object', () => {
        const draft = newDraft();
        expect(draft.tokens).not.toBe(classic.tokens);
        expect(draft.tokens.color.dark.primary).toBe(
            classic.tokens.color.dark.primary
        );
    });

    it('never keeps the official id', () => {
        expect(newDraft().manifest.id).toBe('local.my-theme');
    });

    it('restarts versioning and records what it derives from', () => {
        const draft = newDraft();
        expect(draft.manifest.version).toBe('0.1.0');
        expect(draft.manifest.lineage?.basedOn).toEqual({
            id: 'official.classic',
            version: classic.manifest.version
        });
        expect(draft.basedOn.name).toBe('Tesserafin Classic');
    });

    it('produces a manifest the platform validator accepts', () => {
        const round = parseDraft(serialiseDraft(newDraft()));
        expect(round.issues).toEqual([]);
        expect(round.valid).toBe(true);
    });

    it('falls back to a usable slug for a name with no usable characters', () => {
        expect(createDraft(classic, '???', 'a').manifest.id).toBe(
            'local.draft'
        );
    });
});

describe('editing does not mutate the official theme', () => {
    it('leaves the frozen source untouched after a token edit', () => {
        const before = classic.tokens.color.dark.primary;
        const history = draftReducer(initHistory(newDraft()), {
            type: 'set-token',
            path: 'color.dark.primary',
            value: '#ff0000'
        });
        expect(
            getTokenValue(history!.present.tokens, 'color.dark.primary')
        ).toBe('#ff0000');
        expect(classic.tokens.color.dark.primary).toBe(before);
    });
});

describe('undo / redo / reset', () => {
    const edit = (path: string, value: string) =>
        ({ type: 'set-token', path, value }) as const;

    it('undoes and redoes a single edit', () => {
        let history = initHistory(newDraft());
        const original = getTokenValue(history.present.tokens, 'spacing.md');

        history = draftReducer(history, edit('spacing.md', '32px'))!;
        expect(canUndo(history)).toBe(true);
        expect(canRedo(history)).toBe(false);

        history = draftReducer(history, { type: 'undo' })!;
        expect(getTokenValue(history.present.tokens, 'spacing.md')).toBe(
            original
        );
        expect(canRedo(history)).toBe(true);

        history = draftReducer(history, { type: 'redo' })!;
        expect(getTokenValue(history.present.tokens, 'spacing.md')).toBe(
            '32px'
        );
    });

    it('discards the redo branch once a new edit lands on an undone state', () => {
        let history = initHistory(newDraft());
        history = draftReducer(history, edit('spacing.md', '32px'))!;
        history = draftReducer(history, { type: 'undo' })!;
        history = draftReducer(history, edit('spacing.md', '48px'))!;
        expect(canRedo(history)).toBe(false);
        expect(getTokenValue(history.present.tokens, 'spacing.md')).toBe(
            '48px'
        );
    });

    it('is a no-op at the ends of the history', () => {
        const history = initHistory(newDraft());
        expect(draftReducer(history, { type: 'undo' })).toBe(history);
        expect(draftReducer(history, { type: 'redo' })).toBe(history);
    });

    it('resets to the origin and the reset is itself undoable', () => {
        let history = initHistory(newDraft());
        const original = getTokenValue(history.present.tokens, 'spacing.md');

        history = draftReducer(history, edit('spacing.md', '32px'))!;
        history = draftReducer(history, edit('spacing.lg', '64px'))!;
        history = draftReducer(history, { type: 'reset' })!;

        expect(getTokenValue(history.present.tokens, 'spacing.md')).toBe(
            original
        );
        expect(isDirty(history)).toBe(false);

        // A mis-clicked reset must not destroy work.
        history = draftReducer(history, { type: 'undo' })!;
        expect(getTokenValue(history.present.tokens, 'spacing.lg')).toBe(
            '64px'
        );
    });

    it('replaces the reset target on import', () => {
        const imported = createDraft(classic, 'Imported', 'Someone else');
        let history = initHistory(newDraft());
        history = draftReducer(history, edit('spacing.md', '32px'))!;
        history = draftReducer(history, { type: 'replace', draft: imported })!;

        expect(canUndo(history)).toBe(false);
        history = draftReducer(history, edit('spacing.md', '2px'))!;
        history = draftReducer(history, { type: 'reset' })!;
        expect(history.present.manifest.name).toBe('Imported');
    });

    it('models "no draft" as a real state', () => {
        expect(draftReducer(null, { type: 'undo' })).toBeNull();
        expect(
            draftReducer(initHistory(newDraft()), { type: 'discard' })
        ).toBeNull();
    });
});

describe('structural sharing', () => {
    it('reuses untouched branches, so history is cheap', () => {
        const history = draftReducer(initHistory(newDraft()), {
            type: 'set-token',
            path: 'color.dark.primary',
            value: '#123456'
        })!;
        const previous = history.past[0];
        // `spacing` was not on the edited path, so the revision reuses the very same object;
        // `color` was, so it is a fresh one. That is what keeps a long undo stack affordable.
        expect(history.present.tokens.spacing).toBe(previous.tokens.spacing);
        expect(history.present.tokens.color).not.toBe(previous.tokens.color);
    });
});

/**
 * The local theme draft format, and the only place a draft is turned into text or read back from it
 * (RFC-0007 §4, §6.3).
 *
 * A draft is a **theme package plus the provenance of the official theme it was copied from**. The
 * manifest and tokens inside it are the real v2 contract, unchanged and unwrapped — so exporting a
 * draft produces something the platform validator accepts, not a Studio-private dialect that would
 * have to be converted before it could ever be published.
 *
 * `formatVersion` is the DRAFT ENVELOPE's version, distinct from the manifest's `contractVersion`.
 * They move independently: the envelope can gain a field (a thumbnail, an editor cursor) without
 * touching the theme contract, and the contract can go to v3 without invalidating every saved draft.
 */

import {
    type ThemeManifest,
    type ThemeValidationIssue,
    assertNoExecutableSurface,
    validateManifest
} from 'themes/platform';
import { validateTokens } from 'themes/platform/validateTokens';
import type { TesserafinTokens } from 'ui/tokens/types';

export const DRAFT_FORMAT_VERSION = 1;
export const DRAFT_KIND = 'tesserafin-theme-draft';

export interface ThemeDraft {
    formatVersion: typeof DRAFT_FORMAT_VERSION;
    kind: typeof DRAFT_KIND;
    /**
     * The official theme this draft was copied from. Recorded so the Studio can say what a draft
     * descends from and so an Apply knows which base theme's stylesheet it is overlaying — the
     * draft is a token overlay, not a registry entry (see `applyLocalTheme.ts`).
     */
    basedOn: {
        id: string;
        version: string;
        name: string;
    };
    manifest: ThemeManifest;
    tokens: TesserafinTokens;
}

export type DraftValidation =
    | { valid: true; draft: ThemeDraft; issues: readonly [] }
    | { valid: false; draft: null; issues: readonly ThemeValidationIssue[] };

/** Serialises a draft for export. Stable key order, so re-exporting an unchanged draft is a no-op diff. */
export function serialiseDraft(draft: ThemeDraft): string {
    return `${JSON.stringify(
        {
            formatVersion: draft.formatVersion,
            kind: draft.kind,
            basedOn: draft.basedOn,
            manifest: draft.manifest,
            tokens: draft.tokens
        },
        null,
        4
    )}\n`;
}

/**
 * Parses and validates an imported draft.
 *
 * Every failure mode of an untrusted file returns an issue list; nothing throws, and nothing is
 * partially accepted. The caller keeps whatever draft it already had.
 */
export function parseDraft(rawText: string): DraftValidation {
    const executableIssues = assertNoExecutableSurface(rawText);
    if (executableIssues.length > 0) {
        return { valid: false, draft: null, issues: executableIssues };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch (error) {
        return {
            valid: false,
            draft: null,
            issues: [
                {
                    code: 'malformed-json',
                    message: `This file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
                }
            ]
        };
    }

    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
    ) {
        return {
            valid: false,
            draft: null,
            issues: [
                {
                    code: 'not-an-object',
                    message:
                        'A theme draft must be a JSON object. This file is not one.'
                }
            ]
        };
    }

    const envelope = parsed as Record<string, unknown>;

    if (envelope.kind !== DRAFT_KIND) {
        return {
            valid: false,
            draft: null,
            issues: [
                {
                    code: 'schema-violation',
                    path: '$.kind',
                    message:
                        'This file is not a Tesserafin theme draft. A draft declares `"kind": "tesserafin-theme-draft"`.'
                }
            ]
        };
    }

    if (envelope.formatVersion !== DRAFT_FORMAT_VERSION) {
        return {
            valid: false,
            draft: null,
            issues: [
                {
                    code: 'unsupported-contract-version',
                    path: '$.formatVersion',
                    message: `This draft uses format version ${JSON.stringify(envelope.formatVersion)}, and this Theme Studio reads version ${DRAFT_FORMAT_VERSION}.`
                }
            ]
        };
    }

    const issues: ThemeValidationIssue[] = [];

    const basedOnIssue = validateBasedOn(envelope.basedOn);
    if (basedOnIssue) issues.push(basedOnIssue);

    const manifestResult = validateManifest(envelope.manifest);
    if (!manifestResult.valid) issues.push(...manifestResult.issues);

    issues.push(...validateTokens(envelope.tokens));

    if (issues.length > 0) {
        return { valid: false, draft: null, issues };
    }

    return {
        valid: true,
        draft: envelope as unknown as ThemeDraft,
        issues: []
    };
}

function validateBasedOn(value: unknown): ThemeValidationIssue | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {
            code: 'schema-violation',
            path: '$.basedOn',
            message:
                'A draft must record the official theme it was copied from, as `basedOn: { id, version, name }`.'
        };
    }
    const record = value as Record<string, unknown>;
    const missing = ['id', 'version', 'name'].filter(
        (key) => typeof record[key] !== 'string' || record[key] === ''
    );
    if (missing.length > 0) {
        return {
            code: 'schema-violation',
            path: '$.basedOn',
            message: `\`basedOn\` is missing: ${missing.join(', ')}.`
        };
    }
    return null;
}

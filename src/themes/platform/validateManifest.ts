/**
 * Theme package validation (RFC-0007 §6.3).
 *
 * One validator, one schema. This module reads `tesserafin-design/schema/theme.schema.json`
 * directly and runs it through the same dependency-free validator the Node generator uses
 * (`tesserafin-design/scripts/validate-schema.mjs`), so an in-app import and
 * `npm run generate:tokens` cannot disagree about what a valid theme is. A second, hand-rolled
 * browser validator would be a second definition of "valid", and the two would drift.
 *
 * ## Why schema validation is the security boundary
 *
 * The manifest schema is a CLOSED vocabulary: every object sets `additionalProperties: false` and
 * every leaf is an enum, a bounded pattern or a token value. So a theme cannot carry a script, a
 * URL, a credential or an unknown key — not because we strip them, but because there is no key
 * they could arrive under and no value shape that could hold them. Validation rejects the whole
 * document; it never sanitises part of it and keeps going.
 *
 * {@link assertNoExecutableSurface} is defence in depth on top of that, not the primary control:
 * it re-checks the raw text for the shapes that would matter most if the schema were ever loosened
 * by accident, and it is cheap enough to be worth having twice.
 */

import { validate } from '../../../tesserafin-design/scripts/validate-schema.mjs';
import themeSchema from '../../../tesserafin-design/schema/theme.schema.json';
import { THEME_CONTRACT_VERSION, type ThemeManifest } from './contract';

export type ThemeValidationCode =
    | 'not-an-object'
    | 'malformed-json'
    | 'unsupported-contract-version'
    | 'schema-violation'
    | 'executable-surface'
    | 'incompatible-web-version';

export interface ThemeValidationIssue {
    code: ThemeValidationCode;
    /** Human-readable, shown verbatim in the Theme Studio. */
    message: string;
    /** JSON-pointer-ish path into the manifest, when the issue has one. */
    path?: string;
}

export type ThemeValidationResult =
    | { valid: true; manifest: ThemeManifest; issues: readonly [] }
    | { valid: false; manifest: null; issues: readonly ThemeValidationIssue[] };

/**
 * Token shapes that must never appear anywhere in a theme package, checked against the raw source
 * text rather than the parsed object so an obfuscated key name cannot hide behind parsing.
 *
 * This list intentionally does NOT try to be a general code detector — that would be a losing
 * game, and it is not the control that does the work. The schema's closure is. These are the few
 * shapes whose presence in a theme package is unambiguous evidence something is wrong.
 */
const EXECUTABLE_SURFACE_PATTERNS: readonly {
    pattern: RegExp;
    what: string;
}[] = [
    { pattern: /javascript\s*:/i, what: 'a javascript: URL' },
    { pattern: /\bdata\s*:\s*text\/html/i, what: 'a data: HTML URL' },
    { pattern: /https?\s*:\/\//i, what: 'a network URL' },
    { pattern: /<\s*script\b/i, what: 'a <script> element' },
    {
        pattern: /\bon(?:error|load|click)\s*=/i,
        what: 'an inline event handler'
    },
    { pattern: /\bimport\s*\(/, what: 'a dynamic import()' },
    { pattern: /\beval\s*\(/, what: 'an eval() call' },
    { pattern: /\bnew\s+Function\b/, what: 'a Function constructor' }
];

/**
 * Defence in depth over the schema's closure. Runs on the RAW package text, before parsing, so it
 * also covers anything a future schema change might accidentally admit.
 */
export function assertNoExecutableSurface(
    rawText: string
): ThemeValidationIssue[] {
    const issues: ThemeValidationIssue[] = [];
    for (const { pattern, what } of EXECUTABLE_SURFACE_PATTERNS) {
        if (pattern.test(rawText)) {
            issues.push({
                code: 'executable-surface',
                message: `A theme package may not contain ${what}. Themes are declarative: they describe presentation, they never execute or fetch anything.`
            });
        }
    }
    return issues;
}

/**
 * Validates an already-parsed manifest object.
 *
 * @param candidate Anything. This is an untrusted-input entry point; nothing about the argument is assumed.
 * @param appWebVersion When given, the manifest's `compatibility.web` range is checked against it.
 */
export function validateManifest(
    candidate: unknown,
    appWebVersion?: string
): ThemeValidationResult {
    if (
        typeof candidate !== 'object' ||
        candidate === null ||
        Array.isArray(candidate)
    ) {
        return {
            valid: false,
            manifest: null,
            issues: [
                {
                    code: 'not-an-object',
                    message:
                        'A theme manifest must be a JSON object. This file is not one.'
                }
            ]
        };
    }

    const record = candidate as Record<string, unknown>;

    // Checked before the schema so a v1 manifest gets "this is v1, migrate it" rather than an
    // opaque pile of schema violations caused by the version difference itself.
    if (record.contractVersion !== THEME_CONTRACT_VERSION) {
        return {
            valid: false,
            manifest: null,
            issues: [
                {
                    code: 'unsupported-contract-version',
                    path: '$.contractVersion',
                    message:
                        record.contractVersion === undefined
                            ? `This theme has no contractVersion, so it was written against the v1 contract (RFC-0005 §7.3). Tesserafin Web speaks contract v${THEME_CONTRACT_VERSION}; the theme needs migrating.`
                            : `This theme declares contract version ${JSON.stringify(record.contractVersion)}, and Tesserafin Web speaks contract v${THEME_CONTRACT_VERSION}.`
                }
            ]
        };
    }

    const schemaErrors: string[] = validate(themeSchema, candidate);
    if (schemaErrors.length > 0) {
        return {
            valid: false,
            manifest: null,
            issues: schemaErrors.map((error) => ({
                code: 'schema-violation' as const,
                path: error.split(':')[0],
                message: error
            }))
        };
    }

    const manifest = candidate as unknown as ThemeManifest;

    if (appWebVersion && manifest.compatibility.web) {
        if (!satisfiesLooseRange(appWebVersion, manifest.compatibility.web)) {
            return {
                valid: false,
                manifest: null,
                issues: [
                    {
                        code: 'incompatible-web-version',
                        path: '$.compatibility.web',
                        message: `This theme targets Tesserafin Web ${manifest.compatibility.web}, and this is ${appWebVersion}.`
                    }
                ]
            };
        }
    }

    return { valid: true, manifest, issues: [] };
}

/**
 * Parses and validates a raw theme package, the way an import does.
 *
 * Every failure mode of an untrusted file is a returned issue, never a throw: malformed JSON, a
 * non-object document, a v1 manifest, a schema violation, an executable surface. The Theme Studio
 * shows the issues and keeps the user's existing draft untouched.
 */
export function validateThemePackage(
    rawText: string,
    appWebVersion?: string
): ThemeValidationResult {
    const executableIssues = assertNoExecutableSurface(rawText);
    if (executableIssues.length > 0) {
        return { valid: false, manifest: null, issues: executableIssues };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch (error) {
        return {
            valid: false,
            manifest: null,
            issues: [
                {
                    code: 'malformed-json',
                    message: `This file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
                }
            ]
        };
    }

    return validateManifest(parsed, appWebVersion);
}

/**
 * Minimal loose-range check for the range grammar `theme.schema.json#/$defs/semverRange` accepts
 * (`>=13.0`, `^1.0.0`, `~1.2.0`, a bare version, or `x`/`*` wildcards).
 *
 * Deliberately not a semver library: the grammar is small, bounded by the schema pattern, and
 * adding a dependency for it would fail the same "no new dependency without absolute necessity"
 * gate that keeps `validate-schema.mjs` hand-written. An unparseable range is treated as
 * compatible rather than as a rejection — refusing a theme because *our* range parser was too
 * simple would be the wrong failure direction.
 */
export function satisfiesLooseRange(version: string, range: string): boolean {
    const parts = range.split(/\s*(?:\|\||-)\s*/).filter(Boolean);
    if (parts.length > 1) {
        return parts.some((part) => satisfiesLooseRange(version, part));
    }

    const match = /^(>=|<=|>|<|\^|~)?(.+)$/.exec(range.trim());
    if (!match) return true;

    const [, operator = '', bound] = match;
    const target = parseLooseVersion(bound);
    const actual = parseLooseVersion(version);
    if (!target || !actual) return true;

    const comparison = compareLoose(actual, target);

    switch (operator) {
        case '>=':
            return comparison >= 0;
        case '>':
            return comparison > 0;
        case '<=':
            return comparison <= 0;
        case '<':
            return comparison < 0;
        case '^':
            return comparison >= 0 && actual[0] === target[0];
        case '~':
            return (
                comparison >= 0 &&
                actual[0] === target[0] &&
                actual[1] === target[1]
            );
        default:
            return comparison === 0;
    }
}

function parseLooseVersion(value: string): [number, number, number] | null {
    const segments = value.trim().split('.');
    const numbers = segments
        .slice(0, 3)
        .map((segment) =>
            segment === 'x' || segment === '*'
                ? 0
                : Number.parseInt(segment, 10)
        );
    if (numbers.some((n) => Number.isNaN(n))) return null;
    return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
}

function compareLoose(
    a: [number, number, number],
    b: [number, number, number]
): number {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

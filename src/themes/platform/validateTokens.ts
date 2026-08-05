/**
 * Token-document validation, the manifest validator's counterpart (RFC-0007 §4.4).
 *
 * Same principle as `validateManifest.ts`: read `tokens.schema.json` and run it through the same
 * dependency-free validator `npm run generate:tokens` uses, so an in-app edit and the generator
 * cannot disagree about what a valid token set is.
 *
 * Also exposes the per-leaf constraints as reusable predicates. The Theme Studio validates a single
 * field as the user types, and doing that by re-validating the whole document on every keystroke
 * would report the *document's* errors rather than *this field's* — which is the difference between
 * "3 problems somewhere" and "this length needs a unit".
 */

import tokensSchema from '../../../tesserafin-design/schema/tokens.schema.json';
import { validate } from '../../../tesserafin-design/scripts/validate-schema.mjs';
import type { ThemeValidationIssue } from './validateManifest';

const defs = tokensSchema.$defs as Record<string, { pattern?: string }>;

/** The three leaf value types the token vocabulary is built from. */
export type TokenLeafKind = 'color' | 'length' | 'duration' | 'weight' | 'free';

const COLOR_PATTERN = new RegExp(defs.colorValue.pattern as string);
const LENGTH_PATTERN = new RegExp(defs.cssLength.pattern as string);
const DURATION_PATTERN = new RegExp(defs.cssDuration.pattern as string);

/**
 * Validates one leaf value against the constraint its kind carries, returning a message a person
 * can act on rather than a schema fragment.
 *
 * @returns `null` when the value is acceptable.
 */
export function explainTokenValue(
    kind: TokenLeafKind,
    value: string | number
): string | null {
    switch (kind) {
        case 'color':
            return COLOR_PATTERN.test(String(value))
                ? null
                : 'Use a hex colour (#rgb, #rrggbb, #rrggbbaa) or an rgb()/rgba()/hsl()/hsla() value.';
        case 'length':
            return LENGTH_PATTERN.test(String(value))
                ? null
                : 'Use a length with a unit (px, em, rem or %), or the bare "0".';
        case 'duration':
            return DURATION_PATTERN.test(String(value))
                ? null
                : 'Use a duration with a unit, e.g. "150ms" or "0.3s".';
        case 'weight': {
            const weight = Number(value);
            return Number.isInteger(weight) && weight >= 100 && weight <= 900
                ? null
                : 'Use a font weight between 100 and 900.';
        }
        default:
            return String(value).length > 0 ? null : 'This cannot be empty.';
    }
}

/** Validates a complete token document against `tokens.schema.json`. */
export function validateTokens(candidate: unknown): ThemeValidationIssue[] {
    if (
        typeof candidate !== 'object' ||
        candidate === null ||
        Array.isArray(candidate)
    ) {
        return [
            {
                code: 'not-an-object',
                message: 'A token set must be a JSON object. This is not one.'
            }
        ];
    }

    return (validate(tokensSchema, candidate) as string[]).map((error) => ({
        code: 'schema-violation' as const,
        path: error.split(':')[0],
        message: error
    }));
}

/**
 * The editable shape of a token set, as a flat list of paths with their leaf kind.
 *
 * Derived from the token document rather than hard-coded, so a token added to
 * `tokens.schema.json` shows up in the editor without anyone remembering to add a form field.
 * The only hard-coded part is the KIND of each group — which constraint a leaf carries — because
 * that is exactly the thing the schema expresses as a `$ref` and cannot be inferred from a value
 * that happens to look like a length.
 */

import type { TokenLeafKind } from 'themes/platform/validateTokens';
import type { TesserafinTokens } from 'ui/tokens/types';

export interface TokenField {
    /** Dotted path into the token document, e.g. `color.dark.primary`. */
    path: string;
    /** Group heading the editor renders this under. */
    group: string;
    /** Leaf label within the group. */
    label: string;
    kind: TokenLeafKind;
    value: string | number;
}

/** Which constraint applies to the leaves of each top-level token group. */
const GROUP_KIND: Record<string, TokenLeafKind> = {
    color: 'color',
    'typography.fontSize': 'length',
    'typography.fontWeight': 'weight',
    'typography.fontFamily': 'free',
    'shape.radius': 'length',
    spacing: 'length',
    // Elevation values are CSS box-shadows on Web and a level on other renderers, so the only
    // universal constraint is "a non-empty string" — the schema says the same.
    elevation: 'free',
    'motion.duration': 'duration',
    'motion.easing': 'free',
    density: 'free',
    blur: 'length'
};

const GROUP_LABEL: Record<string, string> = {
    'color.dark': 'Colour — dark',
    'color.light': 'Colour — light',
    'typography.fontFamily': 'Typography — families',
    'typography.fontSize': 'Typography — sizes',
    'typography.fontWeight': 'Typography — weights',
    'shape.radius': 'Shape — radii',
    spacing: 'Spacing',
    elevation: 'Elevation',
    'motion.duration': 'Motion — durations',
    'motion.easing': 'Motion — easings',
    density: 'Density',
    blur: 'Blur'
};

function kindForPath(path: string): TokenLeafKind {
    // Longest declared prefix wins, so `typography.fontSize` beats a bare `typography`.
    const match = Object.keys(GROUP_KIND)
        .filter((prefix) => path === prefix || path.startsWith(`${prefix}.`))
        .sort((a, b) => b.length - a.length)[0];
    return match ? GROUP_KIND[match] : 'free';
}

function groupForPath(path: string): string {
    const match = Object.keys(GROUP_LABEL)
        .filter((prefix) => path === prefix || path.startsWith(`${prefix}.`))
        .sort((a, b) => b.length - a.length)[0];
    return match ? GROUP_LABEL[match] : 'Other';
}

/** Flattens a token document into the editor's field list, in document order. */
export function toTokenFields(tokens: TesserafinTokens): TokenField[] {
    const fields: TokenField[] = [];

    const walk = (node: unknown, path: string) => {
        if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
            for (const [key, value] of Object.entries(node)) {
                walk(value, path ? `${path}.${key}` : key);
            }
            return;
        }
        if (typeof node !== 'string' && typeof node !== 'number') return;
        fields.push({
            path,
            group: groupForPath(path),
            label: path.split('.').pop() ?? path,
            kind: kindForPath(path),
            value: node
        });
    };

    walk(tokens, '');
    return fields;
}

/**
 * Returns a copy of `tokens` with one leaf replaced.
 *
 * Structurally shared down the untouched branches and freshly cloned along the changed one, so the
 * undo history can hold every revision without holding a full deep copy of each.
 */
export function setTokenValue(
    tokens: TesserafinTokens,
    path: string,
    value: string | number
): TesserafinTokens {
    const segments = path.split('.');

    const replace = (node: unknown, depth: number): unknown => {
        if (depth === segments.length) return value;
        const key = segments[depth];
        const record = node as Record<string, unknown>;
        return { ...record, [key]: replace(record?.[key], depth + 1) };
    };

    return replace(tokens, 0) as TesserafinTokens;
}

/** Reads a leaf by dotted path, or `undefined` if the path does not resolve. */
export function getTokenValue(
    tokens: TesserafinTokens,
    path: string
): string | number | undefined {
    let node: unknown = tokens;
    for (const segment of path.split('.')) {
        if (node === null || typeof node !== 'object') return undefined;
        node = (node as Record<string, unknown>)[segment];
    }
    return typeof node === 'string' || typeof node === 'number'
        ? node
        : undefined;
}

#!/usr/bin/env node
/**
 * Web token generator (RFC-0005 §3.2, §11 W13.6).
 *
 * Reads every theme directory under `tesserafin-design/themes/<id>/` (a `theme.json` + `tokens.json`
 * pair, RFC-0005 §7.3), validates both against `tesserafin-design/schema/*.schema.json`, and emits the
 * Web renderer's output into `src/ui/tokens/`:
 *
 *   - `src/ui/tokens/<themeId>.css` — `--rf-*` custom properties, scoped by `[data-rf-theme]` /
 *     `[data-rf-mode]` attributes (see the header comment of the generated file for the exact
 *     scoping rule).
 *   - `src/ui/tokens/<themeId>.ts` — the same tokens as a typed `TesserafinTokens` object
 *     (`src/ui/tokens/types.ts`), for MUI theme wiring.
 *
 * This script is deterministic: given the same `theme.json`/`tokens.json` inputs, it produces
 * byte-identical output on every run (fixed key order, no timestamps, no environment-dependent
 * data). Re-running it after nothing changed produces zero diff.
 *
 * Usage:
 *   node tesserafin-design/scripts/generate-web-tokens.mjs
 *   npm run generate:tokens
 */
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toBackdropFilter } from '../web/backdrop-filter.mjs';
import { assertValid } from './validate-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESSERAFIN_DESIGN_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(TESSERAFIN_DESIGN_DIR, '..');
const THEMES_DIR = join(TESSERAFIN_DESIGN_DIR, 'themes');
const SCHEMA_DIR = join(TESSERAFIN_DESIGN_DIR, 'schema');
const OUTPUT_DIR = join(REPO_ROOT, 'src', 'ui', 'tokens');

const COLOR_KEYS = [
    'background',
    'surface',
    'surfaceVariant',
    'text',
    'textMuted',
    'primary',
    'onPrimary',
    'accent',
    'error',
    'warning',
    'success',
    'focus',
    'divider'
];
const FONT_SIZE_KEYS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
const FONT_WEIGHT_KEYS = ['regular', 'medium', 'bold'];
const RADIUS_KEYS = ['sm', 'md', 'lg', 'full'];
const SPACING_KEYS = ['xs', 'sm', 'md', 'lg', 'xl'];
const ELEVATION_KEYS = ['level0', 'level1', 'level2', 'level3'];
const DURATION_KEYS = ['fast', 'normal', 'slow'];
const EASING_KEYS = ['standard', 'decelerate', 'accelerate'];
const BLUR_KEYS = ['sm', 'md', 'lg'];

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function toKebabCase(key) {
    return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function toCamelCase(id) {
    return id
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part, index) =>
            index === 0
                ? part.toLowerCase()
                : part[0].toUpperCase() + part.slice(1).toLowerCase()
        )
        .join('');
}

function cssVarLine(name, value) {
    return `    --rf-${name}: ${value};`;
}

function colorVarLines(colorGroup) {
    return COLOR_KEYS.map((key) =>
        cssVarLine(`color-${toKebabCase(key)}`, colorGroup[key])
    );
}

function sharedVarLines(tokens) {
    const lines = [];
    lines.push(
        cssVarLine(
            'typography-font-family-base',
            tokens.typography.fontFamily.base
        )
    );
    if (tokens.typography.fontFamily.mono) {
        lines.push(
            cssVarLine(
                'typography-font-family-mono',
                tokens.typography.fontFamily.mono
            )
        );
    }
    for (const key of FONT_SIZE_KEYS) {
        lines.push(
            cssVarLine(
                `typography-font-size-${key}`,
                tokens.typography.fontSize[key]
            )
        );
    }
    for (const key of FONT_WEIGHT_KEYS) {
        lines.push(
            cssVarLine(
                `typography-font-weight-${key}`,
                tokens.typography.fontWeight[key]
            )
        );
    }
    for (const key of RADIUS_KEYS) {
        lines.push(cssVarLine(`shape-radius-${key}`, tokens.shape.radius[key]));
    }
    for (const key of SPACING_KEYS) {
        lines.push(cssVarLine(`spacing-${key}`, tokens.spacing[key]));
    }
    for (const key of ELEVATION_KEYS) {
        lines.push(cssVarLine(`elevation-${key}`, tokens.elevation[key]));
    }
    for (const key of DURATION_KEYS) {
        lines.push(
            cssVarLine(`motion-duration-${key}`, tokens.motion.duration[key])
        );
    }
    for (const key of EASING_KEYS) {
        lines.push(
            cssVarLine(`motion-easing-${key}`, tokens.motion.easing[key])
        );
    }
    lines.push(cssVarLine('density', tokens.density));
    for (const key of BLUR_KEYS) {
        lines.push(cssVarLine(`blur-${key}`, tokens.blur[key]));
        lines.push(
            cssVarLine(
                `backdrop-filter-${key}`,
                toBackdropFilter(tokens.blur[key])
            )
        );
    }
    return lines;
}

/**
 * Scoping rule (documented here and repeated in the generated file's header comment):
 *
 *   - `[data-rf-theme="<id>"]` is the base tier: every mode-independent token (typography, shape,
 *     spacing, elevation, motion, density, blur), plus the color tokens for the DARK mode. Dark is
 *     the app-wide default mode (see `RootAppRouter.tsx`'s `defaultMode`), so it needs no extra
 *     `[data-rf-mode]` qualifier to apply — it wins by being the only color declaration unless a
 *     mode override matches too.
 *   - `[data-rf-theme="<id>"][data-rf-mode="<mode>"]` overrides the color tokens for every mode
 *     other than dark (in practice: light). Same selector specificity as the base tier plus one
 *     more attribute — it always wins over the base tier for the properties it redeclares, by CSS
 *     cascade order (it is emitted after the base tier in the same file).
 *
 * A theme that does not provide "dark" in `modes` falls back to its first listed mode as the base
 * tier; every other mode still gets an explicit `[data-rf-mode]` override block.
 */
function generateCss(themeId, theme, tokens) {
    const baseMode = theme.modes.includes('dark') ? 'dark' : theme.modes[0];
    const overrideModes = theme.modes.filter((mode) => mode !== baseMode);

    const header = `/**
 * GENERATED — do not edit by hand.
 * Source: tesserafin-design/themes/${themeSlugFromId(themeId)}/{theme,tokens}.json
 * Regenerate: npm run generate:tokens
 *
 * Scoping:
 *   - [data-rf-theme="${themeId}"] — base tier: mode-independent tokens plus the "${baseMode}"
 *     mode color tokens (the app-wide default mode).
 *   - [data-rf-theme="${themeId}"][data-rf-mode="<mode>"] — color token overrides for every other
 *     mode, layered on top of the base tier via CSS cascade order.
 */`;

    const blocks = [header, ''];

    const baseLines = [
        ...sharedVarLines(tokens),
        ...colorVarLines(tokens.color[baseMode])
    ];
    blocks.push(`[data-rf-theme="${themeId}"] {`, ...baseLines, '}');

    for (const mode of overrideModes) {
        blocks.push(
            '',
            `[data-rf-theme="${themeId}"][data-rf-mode="${mode}"] {`,
            ...colorVarLines(tokens.color[mode]),
            '}'
        );
    }

    return `${blocks.join('\n')}\n`;
}

function jsonLiteral(value, indentLevel) {
    const pad = '    '.repeat(indentLevel);
    const childPad = '    '.repeat(indentLevel + 1);

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const items = value.map(
            (item) => `${childPad}${jsonLiteral(item, indentLevel + 1)}`
        );
        return `[\n${items.join(',\n')}\n${pad}]`;
    }

    if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        const entries = keys.map(
            (key) =>
                `${childPad}${key}: ${jsonLiteral(value[key], indentLevel + 1)}`
        );
        return `{\n${entries.join(',\n')}\n${pad}}`;
    }

    if (typeof value === 'string') {
        return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }

    return String(value);
}

function generateTs(themeId, tokens) {
    const constName = `${toCamelCase(themeId)}Tokens`;
    const header = `/**
 * GENERATED — do not edit by hand.
 * Source: tesserafin-design/themes/${themeSlugFromId(themeId)}/{theme,tokens}.json
 * Regenerate: npm run generate:tokens
 */
import type { TesserafinTokens } from './types';
`;
    const body = `export const ${constName}: TesserafinTokens = ${jsonLiteral(tokens, 0)};

export default ${constName};
`;
    return `${header}\n${body}`;
}

function themeSlugFromId(themeId) {
    // Directory name under tesserafin-design/themes/, independent of the manifest's dotted "id".
    return themeDirById.get(themeId) ?? themeId;
}

const themeDirById = new Map();

function loadSchemas() {
    return {
        themeSchema: readJson(join(SCHEMA_DIR, 'theme.schema.json')),
        tokensSchema: readJson(join(SCHEMA_DIR, 'tokens.schema.json'))
    };
}

function discoverThemeDirs() {
    if (!existsSync(THEMES_DIR)) return [];
    return readdirSync(THEMES_DIR)
        .filter((entry) => statSync(join(THEMES_DIR, entry)).isDirectory())
        .sort();
}

function main() {
    const { themeSchema, tokensSchema } = loadSchemas();
    const themeDirs = discoverThemeDirs();

    if (themeDirs.length === 0) {
        console.error(
            `[generate:tokens] FAIL: no theme directories found under ${THEMES_DIR}`
        );
        process.exitCode = 1;
        return;
    }

    mkdirSync(OUTPUT_DIR, { recursive: true });

    const generated = [];

    for (const dirName of themeDirs) {
        const themeDir = join(THEMES_DIR, dirName);
        const themePath = join(themeDir, 'theme.json');
        const tokensPath = join(themeDir, 'tokens.json');

        if (!existsSync(themePath) || !existsSync(tokensPath)) {
            console.error(
                `[generate:tokens] FAIL: ${dirName} is missing theme.json or tokens.json`
            );
            process.exitCode = 1;
            return;
        }

        const theme = readJson(themePath);
        const tokens = readJson(tokensPath);

        try {
            assertValid(themeSchema, theme, `${dirName}/theme.json`);
            assertValid(tokensSchema, tokens, `${dirName}/tokens.json`);
        } catch (err) {
            console.error(`[generate:tokens] FAIL:\n${err.message}`);
            process.exitCode = 1;
            return;
        }

        themeDirById.set(theme.id, dirName);

        const cssPath = join(OUTPUT_DIR, `${theme.id}.css`);
        const tsPath = join(OUTPUT_DIR, `${theme.id}.ts`);

        writeFileSync(cssPath, generateCss(theme.id, theme, tokens));
        writeFileSync(tsPath, generateTs(theme.id, tokens));

        generated.push(theme.id);
        console.log(
            `[generate:tokens] OK: ${dirName} -> ${theme.id} (${cssPath.replace(REPO_ROOT + '/', '')}, ${tsPath.replace(REPO_ROOT + '/', '')})`
        );
    }

    console.log(
        `[generate:tokens] PASS. Generated ${generated.length} theme(s): ${generated.join(', ')}`
    );
}

main();

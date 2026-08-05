#!/usr/bin/env node
/**
 * Materialises the two token sets the capture harness compares.
 *
 *   after  — the working tree's `tesserafin-design/themes/classic/tokens.json`
 *   before — the SAME file at the merge-base with `origin/main`
 *
 * Read out of git rather than restated as a literal. A hand-copied "before" would be a claim about
 * what the palette used to be, and it would go stale the moment anything else changed it; reading
 * the merge-base means "before" is exactly what a reviewer would see on the base branch.
 *
 * Both are also validated against `tokens.schema.json` before being written, so a capture can never
 * be taken of a token set the platform would reject.
 *
 * Usage: node tests/captures/prepare-tokens.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertValid } from '../../tesserafin-design/scripts/validate-schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = join(HERE, 'dist', '__tokens__');

const TOKENS_PATH = 'tesserafin-design/themes/classic/tokens.json';
const MANIFEST_PATH = 'tesserafin-design/themes/classic/theme.json';

function git(args) {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
}

function readJson(path) {
    return JSON.parse(readFileSync(join(REPO, path), 'utf8'));
}

function baseRef() {
    // The merge-base, not `origin/main` itself: on a branch that is behind main, `origin/main`
    // would include unrelated later changes and the "before" capture would not be this PR's before.
    try {
        return git(['merge-base', 'HEAD', 'origin/main']).trim();
    } catch {
        // No origin/main (a fresh clone, a detached CI checkout): fall back to HEAD's parent, and
        // say so rather than silently comparing a palette against itself.
        console.warn(
            '[captures] no origin/main; falling back to HEAD~1 for the "before" tokens'
        );
        return git(['rev-parse', 'HEAD~1']).trim();
    }
}

function main() {
    const tokensSchema = readJson(
        'tesserafin-design/schema/tokens.schema.json'
    );
    const themeSchema = readJson('tesserafin-design/schema/theme.schema.json');

    const base = baseRef();
    const after = readJson(TOKENS_PATH);
    const before = JSON.parse(git(['show', `${base}:${TOKENS_PATH}`]));
    const manifest = readJson(MANIFEST_PATH);

    assertValid(tokensSchema, after, 'classic/tokens.json (after)');
    assertValid(
        tokensSchema,
        before,
        `classic/tokens.json (before, ${base.slice(0, 10)})`
    );
    assertValid(themeSchema, manifest, 'classic/theme.json');

    mkdirSync(OUT, { recursive: true });
    writeFileSync(
        join(OUT, 'classic.after.json'),
        `${JSON.stringify(after, null, 4)}\n`
    );
    writeFileSync(
        join(OUT, 'classic.before.json'),
        `${JSON.stringify(before, null, 4)}\n`
    );
    writeFileSync(
        join(OUT, 'classic.manifest.json'),
        `${JSON.stringify(manifest, null, 4)}\n`
    );

    const changed =
        JSON.stringify(before) !== JSON.stringify(after)
            ? 'differ'
            : 'are IDENTICAL — the capture would compare a palette against itself';
    console.log(
        `[captures] before = ${base.slice(0, 10)}:${TOKENS_PATH}; the two token sets ${changed}.`
    );
}

main();

#!/usr/bin/env node
/**
 * Freshness gate for the generated `--rf-*` web tokens (`src/ui/tokens/`), added for W13.6
 * "Design system v1".
 *
 * Regenerates `src/ui/tokens/` from the versioned theme sources
 * (`reefin-design/themes/<id>/theme.json` + `tokens.json`) via
 * `npm run generate:tokens` (reefin-design/scripts/generate-web-tokens.mjs) and fails
 * (non-zero exit) if:
 *   - `src/ui/tokens/` has pending changes before the check even starts (ambiguous result -
 *     can't tell whether a subsequent diff comes from regeneration or from pre-existing edits);
 *   - regeneration itself fails;
 *   - regenerating from the committed theme sources produces any change under `src/ui/tokens/` -
 *     via `git status --porcelain` rather than `git diff --stat`, so both modified *and* newly
 *     created (untracked) files count as a diff, not just changes to files git already tracks
 *     (generated tokens are stale, run `npm run generate:tokens` and commit).
 *
 * The generator (reefin-design/scripts/generate-web-tokens.mjs) is deterministic by design
 * (fixed key order, no timestamps, no environment-dependent data) - re-running it against
 * unchanged theme sources must produce byte-identical output.
 *
 * Usage:
 *   node scripts/verify-tokens-fresh.mjs
 *   npm run verify:tokens-fresh
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TOKENS_RELATIVE = 'src/ui/tokens';

function git(args) {
    return execFileSync('git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf-8'
    });
}

function fail(message) {
    console.error(`[verify:tokens-fresh] FAIL: ${message}`);
    process.exitCode = 1;
}

function main() {
    const preStatus = git([
        'status',
        '--porcelain',
        '--',
        TOKENS_RELATIVE
    ]).trim();
    if (preStatus.length > 0) {
        fail(
            `${TOKENS_RELATIVE} has uncommitted changes before the check even starts - commit, ` +
                'stash, or `git checkout` them first so a diff below can only mean "regeneration ' +
                'produced different output":\n' +
                preStatus
        );
        return;
    }

    console.log(
        '[verify:tokens-fresh] Regenerating web tokens from reefin-design/themes/*...'
    );
    try {
        execFileSync(
            'node',
            ['reefin-design/scripts/generate-web-tokens.mjs'],
            {
                cwd: REPO_ROOT,
                stdio: 'inherit'
            }
        );
    } catch (err) {
        fail(`regeneration itself failed: ${err.message}`);
        return;
    }

    const diff = git(['status', '--porcelain', '--', TOKENS_RELATIVE]).trim();

    if (diff.length > 0) {
        fail(
            `generated tokens are stale, run npm run generate:tokens and commit the result:\n${diff}`
        );
        return;
    }

    console.log(
        `[verify:tokens-fresh] ${TOKENS_RELATIVE} matches a fresh regeneration from ` +
            'reefin-design/themes/*.'
    );
    console.log('[verify:tokens-fresh] PASS.');
}

main();

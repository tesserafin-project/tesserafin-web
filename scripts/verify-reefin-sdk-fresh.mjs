#!/usr/bin/env node
/**
 * Freshness gate for the generated Reefin SDK (`src/lib/reefin-sdk/generated/` +
 * `src/lib/reefin-sdk/spec/openapi.json`), added for W13.1 "Clôture des fondations".
 *
 * Regenerates the SDK strictly from the spec *already versioned in this repo*
 * (`src/lib/reefin-sdk/spec/openapi.json`, committed) - not from a sibling `../reefin` checkout,
 * not from a running dev server - by forcing `REEFIN_OPENAPI_SPEC` to that pinned file. This is
 * deliberate: `npm run generate:reefin-sdk` (scripts/generate-reefin-sdk.mjs) prefers a live
 * server/sibling-checkout spec when available, which is the right default for *updating* the
 * spec, but the wrong thing to regenerate *against* here - this check must be reproducible on any
 * machine (CI or local) regardless of what else happens to be checked out next to this repo.
 *
 * Fails (non-zero exit) if:
 *   - the SDK working tree has pending changes before the check even starts (ambiguous result -
 *     can't tell whether a subsequent diff comes from regeneration or from pre-existing edits);
 *   - regenerating from the pinned spec produces a diff on `generated/` or `spec/openapi.json`
 *     (source of truth drifted from what's committed - re-run `npm run generate:reefin-sdk` and
 *     commit the result);
 *   - `spec/version.json` does not have an explicit, non-null spec version recorded.
 *
 * `spec/version.json`'s `generatedAt` (always) and `source` (points at whatever resolved the
 * spec) fields are expected to change on every regeneration by construction - they are not part
 * of the freshness comparison, and this script resets the file to its committed content
 * afterwards either way so a clean run leaves a clean working tree.
 *
 * Local Docker equivalent (see src/lib/reefin-sdk/README.md and
 * docs/reefin/design-reefin-api-layer.md - CI quota is currently exhausted, this is the offline
 * substitute):
 *
 *   docker run --rm -v "$PWD":/workspace -w /workspace node:24-bookworm bash -c "
 *     apt-get update && apt-get install -y --no-install-recommends default-jre-headless &&
 *     npm ci --no-audit &&
 *     npm run verify:reefin-sdk-fresh
 *   "
 *
 * (openapi-generator-cli needs a JVM - node:24-bookworm doesn't ship one, hence the apt-get step.)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SDK_RELATIVE = 'src/lib/reefin-sdk';
const GENERATED_RELATIVE = `${SDK_RELATIVE}/generated`;
const PINNED_SPEC_RELATIVE = `${SDK_RELATIVE}/spec/openapi.json`;
const VERSION_JSON_RELATIVE = `${SDK_RELATIVE}/spec/version.json`;
const VERSION_JSON_PATH = join(REPO_ROOT, VERSION_JSON_RELATIVE);

const REQUIRED_EXPLICIT_VERSION_FIELDS = [
    'version',
    'xReefinVersion',
    'serverVersion',
    'webAppVersion'
];

function git(args) {
    return execFileSync('git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf-8'
    });
}

function fail(message) {
    console.error(`[verify:reefin-sdk-fresh] FAIL: ${message}`);
    process.exitCode = 1;
}

function main() {
    const preStatus = git(['status', '--porcelain', '--', SDK_RELATIVE]).trim();
    if (preStatus.length > 0) {
        fail(
            `${SDK_RELATIVE} has uncommitted changes before the check even starts - commit, ` +
                'stash, or `git checkout` them first so a diff below can only mean "regeneration ' +
                'produced different output":\n' +
                preStatus
        );
        return;
    }

    console.log(
        '[verify:reefin-sdk-fresh] Regenerating from the pinned spec ' +
            `(${PINNED_SPEC_RELATIVE}), ignoring any sibling reefin checkout or dev server...`
    );
    try {
        execFileSync('node', ['scripts/generate-reefin-sdk.mjs'], {
            cwd: REPO_ROOT,
            stdio: 'inherit',
            env: {
                ...process.env,
                REEFIN_OPENAPI_SPEC: PINNED_SPEC_RELATIVE
            }
        });
    } catch (err) {
        fail(`regeneration itself failed: ${err.message}`);
        return;
    }

    const diff = git([
        'diff',
        '--stat',
        '--',
        GENERATED_RELATIVE,
        PINNED_SPEC_RELATIVE
    ]).trim();

    // version.json's generatedAt/source churn is expected on every run (see header comment) -
    // reset it now that regeneration is done, independent of whether the check above passes, so
    // this script never leaves the working tree dirty as a side effect of merely running it.
    git(['checkout', '--', VERSION_JSON_RELATIVE]);

    if (diff.length > 0) {
        fail(
            'regenerating the SDK from the pinned spec produced a diff - the committed ' +
                'generated/ (or the pinned spec copy) is stale. Run `npm run generate:reefin-sdk` ' +
                'and commit the result:\n' +
                diff
        );
        return;
    }
    console.log(
        '[verify:reefin-sdk-fresh] generated/ and spec/openapi.json match a fresh regeneration ' +
            'from the pinned spec.'
    );

    const version = JSON.parse(readFileSync(VERSION_JSON_PATH, 'utf-8'));
    const missing = REQUIRED_EXPLICIT_VERSION_FIELDS.filter(
        (field) => !version[field]
    );
    if (missing.length > 0) {
        fail(
            `${VERSION_JSON_RELATIVE} is missing explicit value(s) for: ${missing.join(', ')} - ` +
                'the spec version must always be recorded explicitly, never left null/implicit.'
        );
        return;
    }
    console.log(
        `[verify:reefin-sdk-fresh] spec/version.json has explicit versions ` +
            `(server ${version.serverVersion}, reefin-web ${version.webAppVersion}).`
    );
    if (version.versionSkewNote) {
        console.log(
            `[verify:reefin-sdk-fresh] NOTE: ${version.versionSkewNote}`
        );
    }

    console.log('[verify:reefin-sdk-fresh] PASS.');
}

main();

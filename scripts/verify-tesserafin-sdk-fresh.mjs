#!/usr/bin/env node
/**
 * Freshness gate for the generated Reefin SDK (`src/lib/tesserafin-sdk/generated/` +
 * `src/lib/tesserafin-sdk/spec/openapi.json`), added for W13.1 "Clôture des fondations".
 *
 * Regenerates the SDK strictly from the spec *already versioned in this repo*
 * (`src/lib/tesserafin-sdk/spec/openapi.json`, committed) - not from a sibling `../reefin` checkout,
 * not from a running dev server - by forcing `TESSERAFIN_OPENAPI_SPEC` to that pinned file. This is
 * deliberate: `npm run generate:tesserafin-sdk` (scripts/generate-tesserafin-sdk.mjs) prefers a live
 * server/sibling-checkout spec when available, which is the right default for *updating* the
 * spec, but the wrong thing to regenerate *against* here - this check must be reproducible on any
 * machine (CI or local) regardless of what else happens to be checked out next to this repo.
 *
 * Fails (non-zero exit) if:
 *   - the SDK working tree has pending changes before the check even starts (ambiguous result -
 *     can't tell whether a subsequent diff comes from regeneration or from pre-existing edits);
 *   - regeneration itself fails (e.g. openapi-generator-cli errors out);
 *   - regenerating from the pinned spec produces any change under `generated/` or
 *     `spec/openapi.json` - via `git status --porcelain` rather than `git diff --stat`, so both
 *     modified *and* newly created (untracked) files count as a diff, not just changes to files
 *     git already tracks (source of truth drifted from what's committed - re-run
 *     `npm run generate:tesserafin-sdk` and commit the result);
 *   - `spec/version.json` does not have an explicit, non-null spec version recorded;
 *   - `spec/version.json` does not record the *provenance* of the pinned bytes (`sourceCommit`,
 *     `specSha256`), or `specSha256` does not match the pinned spec on disk;
 *   - a `reefin` server checkout IS reachable and the pinned spec does not match the canonical
 *     contract at `sourceCommit` (real drift - see checkProvenance() below for why the
 *     reproducibility check alone could never catch this, and did not).
 *
 * `spec/version.json`'s `generatedAt` (always) and `source` (points at whatever resolved the
 * spec) fields are expected to change on every regeneration by construction - they are not part
 * of the freshness comparison, and this script resets the file to its committed content in a
 * `finally` block that runs right after the generation attempt regardless of whether it succeeded
 * or threw, so a clean run (and even a run where the generator itself fails) never leaves the
 * working tree dirty as a side effect of merely running it.
 *
 * Local Docker equivalent (see src/lib/tesserafin-sdk/README.md and
 * docs/tesserafin/design-tesserafin-api-layer.md - CI quota is currently exhausted, this is the offline
 * substitute):
 *
 *   docker run --rm -v "$PWD":/workspace -w /workspace node:24-bookworm bash -c "
 *     apt-get update && apt-get install -y --no-install-recommends default-jre-headless &&
 *     npm ci --no-audit &&
 *     npm run verify:tesserafin-sdk-fresh
 *   "
 *
 * (openapi-generator-cli needs a JVM - node:24-bookworm doesn't ship one, hence the apt-get step.)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyTransforms,
    buildGeneratedManifest,
    findServerRepo,
    PROVENANCE_SCHEMA_VERSION,
    readCanonicalSpecFromGit,
    readGeneratorIdentity,
    serializeGeneratedManifest,
    SERVER_REPOSITORY,
    TRANSFORM_VERSION
} from './generate-tesserafin-sdk.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SDK_RELATIVE = 'src/lib/tesserafin-sdk';
const GENERATED_RELATIVE = `${SDK_RELATIVE}/generated`;
const PINNED_SPEC_RELATIVE = `${SDK_RELATIVE}/spec/openapi.json`;
const VERSION_JSON_RELATIVE = `${SDK_RELATIVE}/spec/version.json`;
const MANIFEST_RELATIVE = `${SDK_RELATIVE}/spec/generated-manifest.json`;
const VERSION_JSON_PATH = join(REPO_ROOT, VERSION_JSON_RELATIVE);
const MANIFEST_PATH = join(REPO_ROOT, MANIFEST_RELATIVE);

const REQUIRED_EXPLICIT_VERSION_FIELDS = [
    'version',
    'xTesserafinVersion',
    'serverVersion',
    'webAppVersion',
    // Provenance of the pinned spec bytes. `sourceCommit` being mandatory is what closes the
    // hole described in checkProvenance() below: the pin must name a commit of the server's
    // canonical contract, so "where did these bytes come from" always has an answer.
    'sourceCommit',
    'specSha256'
];

/**
 * Additional fields a schema-2 pin must carry, on top of the schema-1 set above (C4-LH, #246).
 *
 * Schema 2 stops using git ancestry as the compatibility predicate, so every one of these is
 * load-bearing rather than decorative: they are what replaces ancestry with content.
 */
const REQUIRED_V2_VERSION_FIELDS = [
    'sourceRepository',
    'canonicalSpecSha256',
    'transformVersion',
    'generator',
    'generatedManifestSha256',
    'generatedFileCount'
];

/**
 * The CLOSED key set of a schema-2 `version.json`.
 *
 * Unknown keys are rejected rather than ignored. A verifier that skips over metadata it does not
 * recognise cannot distinguish "a field that means nothing" from "a field a future, stricter
 * verifier would have refused", and the failure mode of guessing wrong is silent acceptance. A
 * closed set makes adding a field a deliberate, reviewed change to both verifiers — which is the
 * point, because both of them have to agree on what the metadata means.
 */
const ALLOWED_V2_VERSION_KEYS = new Set([
    'provenanceSchema',
    'title',
    'version',
    'xTesserafinVersion',
    'serverVersion',
    'webAppVersion',
    'versionSkewNote',
    'openapi',
    'pathCount',
    'schemaCount',
    'source',
    'sourceRepository',
    'sourceCommit',
    'sourceRef',
    'canonicalSpecSha256',
    'specSha256',
    'transformVersion',
    'generator',
    'generatedManifestSha256',
    'generatedFileCount',
    'generatedAt'
]);

const PINNED_SPEC_PATH = join(REPO_ROOT, PINNED_SPEC_RELATIVE);

/**
 * The drift check this gate was missing.
 *
 * The reproducibility check above only ever asks "does generated/ match a regeneration from the
 * spec pinned *in this repo*?". That is a real check, but it is entirely self-referential: if the
 * pinned spec itself drifts away from the server's canonical contract, both sides of the
 * comparison drift together and the gate stays green forever. It did exactly that - the mirror sat
 * at 395 schemas while the canonical contract had 401 (6 schemas and 2 paths missing), and this
 * gate never noticed, because the spec was being resolved from an unversioned `bin/` build
 * artifact with no provenance at all (see the HISTORY note in generate-tesserafin-sdk.mjs).
 *
 * So verify provenance in two layers:
 *
 *   1. ALWAYS, offline: `specSha256` must match the actual bytes of the pinned spec, and
 *      `sourceCommit` must be present and SHA-shaped. This alone makes the old failure mode
 *      impossible to commit - a `bin/` artifact cannot produce a commit SHA.
 *   2. WHEN a `reefin` server checkout is reachable: re-read `openapi/openapi.json` at
 *      `sourceCommit`, apply the generator's own transforms, and require it to equal the pinned
 *      spec byte for byte. A mismatch is FATAL - that is real drift.
 *
 * Layer 2 is skipped, loudly, when no server checkout is present (web CI runs without one). That
 * is a deliberate, narrow concession: the check degrades to layer 1 rather than to nothing, and it
 * announces the degradation instead of printing a green PASS that means less than it appears to.
 *
 * `sourceCommit` being behind `origin/master` is reported but NOT fatal: pinning an older contract
 * on purpose is legitimate (it is how a pre-existing-drift baseline is separated from a
 * contract change), and making it fatal would force unrelated contract bumps into every PR.
 */
/**
 * Which provenance protocol this pin speaks. Anything other than a version both this script and
 * the server's `ci/verify-sdk-provenance.sh` implement is a hard failure, never a "treat it as the
 * newest one I know" guess: a pin written by a future, stricter schema must not be validated by
 * today's looser rules.
 *
 * @returns {1 | 2 | null} null means "rejected, already reported"
 */
function resolveSchema(version) {
    const raw = version.provenanceSchema;
    if (raw === undefined || raw === null) {
        // Schema 1 predates the field and is identified by its absence. It keeps its original
        // ancestry-based semantics on the server side; nothing here relaxes for it.
        return 1;
    }
    if (raw === PROVENANCE_SCHEMA_VERSION) {
        return 2;
    }
    fail(
        `${VERSION_JSON_RELATIVE} records provenanceSchema ${JSON.stringify(raw)}, which this ` +
            `verifier does not implement (it implements 1 and ${PROVENANCE_SCHEMA_VERSION}). ` +
            'An unrecognised provenance schema is refused rather than assumed compatible.'
    );
    return null;
}

/** Structural validation of a schema-2 pin: closed key set, required fields, field shapes. */
function checkV2Metadata(version) {
    const unknown = Object.keys(version).filter(
        (key) => !ALLOWED_V2_VERSION_KEYS.has(key)
    );
    if (unknown.length > 0) {
        fail(
            `${VERSION_JSON_RELATIVE} contains key(s) this verifier does not know: ` +
                `${unknown.join(', ')}. Schema ${PROVENANCE_SCHEMA_VERSION} has a closed key ` +
                'set - an unrecognised field is rejected, not ignored, because a field this ' +
                'verifier skips is a field it cannot enforce.'
        );
        return false;
    }

    const missing = REQUIRED_V2_VERSION_FIELDS.filter(
        (field) => version[field] === undefined || version[field] === null
    );
    if (missing.length > 0) {
        fail(
            `${VERSION_JSON_RELATIVE} declares provenanceSchema ${PROVENANCE_SCHEMA_VERSION} but ` +
                `is missing: ${missing.join(', ')}. These fields are what replaces git ancestry ` +
                'as the compatibility predicate; a pin without them cannot be verified by content.'
        );
        return false;
    }

    if (version.sourceRepository !== SERVER_REPOSITORY) {
        fail(
            `${VERSION_JSON_RELATIVE} names sourceRepository "${version.sourceRepository}"; the ` +
                `only server repository this SDK may be generated from is "${SERVER_REPOSITORY}".`
        );
        return false;
    }
    if (!/^[0-9a-f]{64}$/.test(version.canonicalSpecSha256)) {
        fail(
            `${VERSION_JSON_RELATIVE} records canonicalSpecSha256 ` +
                `"${version.canonicalSpecSha256}", which is not a 64-character sha256 digest.`
        );
        return false;
    }
    if (version.transformVersion !== TRANSFORM_VERSION) {
        fail(
            `${VERSION_JSON_RELATIVE} records transformVersion ${version.transformVersion} but ` +
                `this repository applies transform pipeline ${TRANSFORM_VERSION}. The pinned ` +
                'mirror was produced by a different canonical-to-mirror transformation, so ' +
                'comparing it against the canonical contract would compare the wrong bytes.'
        );
        return false;
    }
    if (!/^[0-9a-f]{64}$/.test(version.generatedManifestSha256)) {
        fail(
            `${VERSION_JSON_RELATIVE} records generatedManifestSha256 ` +
                `"${version.generatedManifestSha256}", which is not a 64-character sha256 digest.`
        );
        return false;
    }
    return true;
}

/**
 * The generator that produced `generated/` must be the generator this repository pins.
 *
 * `generatorVersion` (openapitools.json) is the jar that actually decides the emitted TypeScript;
 * `cliVersion` (package.json) is the npm wrapper that fetches it. Drift in either means the
 * committed tree and a fresh regeneration are not guaranteed to agree, which would make the
 * regeneration proof below meaningless rather than merely stale.
 */
function checkGeneratorIdentity(version) {
    const expected = readGeneratorIdentity(REPO_ROOT);
    const recorded = version.generator;
    if (typeof recorded !== 'object' || recorded === null) {
        fail(`${VERSION_JSON_RELATIVE} records no generator object.`);
        return false;
    }
    const recordedKeys = Object.keys(recorded).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (recordedKeys.join(',') !== expectedKeys.join(',')) {
        fail(
            `${VERSION_JSON_RELATIVE} generator has keys [${recordedKeys.join(', ')}], expected ` +
                `exactly [${expectedKeys.join(', ')}].`
        );
        return false;
    }
    for (const key of expectedKeys) {
        if (recorded[key] !== expected[key]) {
            fail(
                `${VERSION_JSON_RELATIVE} records generator.${key} "${recorded[key]}" but this ` +
                    `repository pins "${expected[key]}" (package.json / openapitools.json). ` +
                    'Regenerate the SDK with the pinned generator and commit the result.'
            );
            return false;
        }
    }
    console.log(
        `[verify:tesserafin-sdk-fresh] Generator identity matches the pin ` +
            `(${expected.name}, cli ${expected.cliVersion}, generator ${expected.generatorVersion}).`
    );
    return true;
}

/**
 * The generated tree, addressed by content.
 *
 * The regeneration check in main() proves that every file the generator produces matches what is
 * committed. It cannot prove the converse, because `generate-tesserafin-sdk.mjs` does not clear
 * `generated/` first: a file nobody generates is never removed, so regeneration leaves an injected
 * file untouched and `git status --porcelain` reports nothing. That is the hole this closes.
 *
 * Two independent bindings, neither of which trusts a written-down number:
 *   1. the manifest rebuilt from the files actually on disk must serialise to exactly the
 *      committed `generated-manifest.json` bytes;
 *   2. the sha256 of those committed bytes must equal `generatedManifestSha256` in version.json.
 */
function checkGeneratedManifest(version) {
    let committedText;
    try {
        committedText = readFileSync(MANIFEST_PATH, 'utf-8');
    } catch {
        fail(
            `${MANIFEST_RELATIVE} is missing. A schema-${PROVENANCE_SCHEMA_VERSION} pin must ` +
                'carry a manifest of every generated file. Run `npm run generate:tesserafin-sdk`.'
        );
        return false;
    }

    const rebuiltText = serializeGeneratedManifest(buildGeneratedManifest());
    if (rebuiltText !== committedText) {
        const rebuilt = JSON.parse(rebuiltText);
        const committed = JSON.parse(committedText);
        const rebuiltByPath = new Map(
            rebuilt.files.map((f) => [f.path, f.sha256])
        );
        const committedByPath = new Map(
            committed.files.map((f) => [f.path, f.sha256])
        );
        const extra = [...rebuiltByPath.keys()].filter(
            (p) => !committedByPath.has(p)
        );
        const absent = [...committedByPath.keys()].filter(
            (p) => !rebuiltByPath.has(p)
        );
        const edited = [...rebuiltByPath.keys()].filter(
            (p) =>
                committedByPath.has(p) &&
                committedByPath.get(p) !== rebuiltByPath.get(p)
        );
        fail(
            `${MANIFEST_RELATIVE} does not describe the tree on disk: ` +
                `${extra.length} file(s) present but unlisted (${extra.slice(0, 5).join(', ') || 'none'}), ` +
                `${absent.length} listed but absent (${absent.slice(0, 5).join(', ') || 'none'}), ` +
                `${edited.length} with different bytes (${edited.slice(0, 5).join(', ') || 'none'}). ` +
                'Run `npm run generate:tesserafin-sdk` and commit the result.'
        );
        return false;
    }

    const actual = createHash('sha256')
        .update(committedText, 'utf-8')
        .digest('hex');
    if (actual !== version.generatedManifestSha256) {
        fail(
            `${MANIFEST_RELATIVE} hashes to ${actual} but ${VERSION_JSON_RELATIVE} records ` +
                `generatedManifestSha256 ${version.generatedManifestSha256} - one of the two was ` +
                'edited by hand instead of regenerated.'
        );
        return false;
    }

    const manifest = JSON.parse(committedText);
    if (manifest.fileCount !== manifest.files.length) {
        fail(
            `${MANIFEST_RELATIVE} declares fileCount ${manifest.fileCount} but lists ` +
                `${manifest.files.length} files.`
        );
        return false;
    }
    if (version.generatedFileCount !== manifest.fileCount) {
        fail(
            `${VERSION_JSON_RELATIVE} records generatedFileCount ${version.generatedFileCount} ` +
                `but ${MANIFEST_RELATIVE} lists ${manifest.fileCount} files.`
        );
        return false;
    }
    console.log(
        `[verify:tesserafin-sdk-fresh] Generated tree matches its manifest exactly ` +
            `(${manifest.fileCount} files, manifest sha256 ${actual}).`
    );
    return true;
}

function checkProvenance(version) {
    const pinnedText = readFileSync(PINNED_SPEC_PATH, 'utf-8');
    const actualSha = createHash('sha256')
        .update(pinnedText, 'utf-8')
        .digest('hex');
    if (actualSha !== version.specSha256) {
        fail(
            `${PINNED_SPEC_RELATIVE} does not match the specSha256 recorded in ` +
                `${VERSION_JSON_RELATIVE} (recorded ${version.specSha256}, actual ${actualSha}) - ` +
                'the pinned spec was edited by hand instead of regenerated. Re-run ' +
                '`npm run generate:tesserafin-sdk`.'
        );
        return false;
    }
    if (!/^[0-9a-f]{40}$/.test(version.sourceCommit)) {
        fail(
            `${VERSION_JSON_RELATIVE} records sourceCommit "${version.sourceCommit}", which is ` +
                'not a 40-character commit SHA. The pinned spec must be attributable to a commit ' +
                'of the reefin server contract (openapi/openapi.json).'
        );
        return false;
    }
    console.log(
        `[verify:tesserafin-sdk-fresh] Pinned spec sha256 matches, provenance = ` +
            `${version.sourceCommit} (${version.sourceRef ?? 'no ref recorded'}).`
    );

    const serverRepo = findServerRepo();
    if (!serverRepo) {
        console.warn(
            '[verify:tesserafin-sdk-fresh] WARNING: no reefin server checkout reachable, so the ' +
                'pinned spec could NOT be compared against the canonical contract at ' +
                `${version.sourceCommit}. Provenance is recorded but UNVERIFIED in this run - ` +
                'set $TESSERAFIN_SERVER_REPO to a reefin checkout to enable the full drift check.'
        );
        return true;
    }

    let canonical;
    try {
        canonical = readCanonicalSpecFromGit(serverRepo, version.sourceCommit);
    } catch (err) {
        fail(
            `could not read openapi/openapi.json at ${version.sourceCommit} from ${serverRepo}: ` +
                `${err.message}. The recorded provenance does not resolve in the server repo ` +
                '(fetch it, or re-pin against a commit that exists).'
        );
        return false;
    }

    // Schema 2 records a digest of the RAW canonical bytes, so recompute it here from the bytes
    // git actually holds at `sourceCommit` and require the recorded value to match. This is what
    // makes the recorded digest evidence rather than an assertion - and it is the digest the
    // server's gate compares against its own canonical contract, so if it were ever accepted
    // without recomputation the whole content-addressed chain would rest on a written-down number.
    if (version.provenanceSchema === PROVENANCE_SCHEMA_VERSION) {
        const actualCanonicalSha = createHash('sha256')
            .update(canonical.text, 'utf-8')
            .digest('hex');
        if (actualCanonicalSha !== version.canonicalSpecSha256) {
            fail(
                `the canonical contract at ${version.sourceCommit} hashes to ` +
                    `${actualCanonicalSha}, but ${VERSION_JSON_RELATIVE} records ` +
                    `canonicalSpecSha256 ${version.canonicalSpecSha256}. The recorded content ` +
                    'address does not describe the commit it names.'
            );
            return false;
        }
        console.log(
            '[verify:tesserafin-sdk-fresh] Recorded canonicalSpecSha256 recomputed from the ' +
                `bytes at ${version.sourceCommit}: ${actualCanonicalSha}.`
        );
    }

    // Must stay in lockstep with generate-tesserafin-sdk.mjs's main(): same transforms, same
    // order. `applyTransforms` is that single definition, and `transformVersion` names it.
    const spec = applyTransforms(JSON.parse(canonical.text));
    const expected = JSON.stringify(spec, null, 2) + '\n';
    if (expected !== pinnedText) {
        const a = JSON.parse(expected).components?.schemas ?? {};
        const b = JSON.parse(pinnedText).components?.schemas ?? {};
        const missing = Object.keys(a).filter((k) => !(k in b));
        const extra = Object.keys(b).filter((k) => !(k in a));
        fail(
            `${PINNED_SPEC_RELATIVE} has DRIFTED from the canonical contract at ` +
                `${version.sourceCommit}: canonical has ${Object.keys(a).length} schemas, the ` +
                `pinned mirror has ${Object.keys(b).length} ` +
                `(${missing.length} missing: ${missing.slice(0, 10).join(', ') || 'none'}; ` +
                `${extra.length} unexpected: ${extra.slice(0, 10).join(', ') || 'none'}). ` +
                'Re-run `npm run generate:tesserafin-sdk` and commit the result.'
        );
        return false;
    }
    console.log(
        '[verify:tesserafin-sdk-fresh] Pinned spec matches the canonical contract at ' +
            `${version.sourceCommit} exactly.`
    );

    try {
        const master = execFileSync(
            'git',
            ['rev-parse', 'origin/master^{commit}'],
            {
                cwd: serverRepo,
                encoding: 'utf-8'
            }
        ).trim();
        if (master !== version.sourceCommit) {
            const behind = execFileSync(
                'git',
                ['rev-list', '--count', `${version.sourceCommit}..${master}`],
                { cwd: serverRepo, encoding: 'utf-8' }
            ).trim();
            console.log(
                `[verify:tesserafin-sdk-fresh] NOTE: pinned contract is ${behind} commit(s) behind ` +
                    `origin/master (${master}). Not a failure - re-pin when you intend to adopt it.`
            );
        }
    } catch {
        // origin/master may not exist in a shallow/partial checkout; the note is informational.
    }
    return true;
}

function git(args) {
    return execFileSync('git', args, {
        cwd: REPO_ROOT,
        encoding: 'utf-8'
    });
}

function fail(message) {
    console.error(`[verify:tesserafin-sdk-fresh] FAIL: ${message}`);
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
        '[verify:tesserafin-sdk-fresh] Regenerating from the pinned spec ' +
            `(${PINNED_SPEC_RELATIVE}), ignoring any sibling reefin checkout or dev server...`
    );
    let generationError;
    try {
        execFileSync('node', ['scripts/generate-tesserafin-sdk.mjs'], {
            cwd: REPO_ROOT,
            stdio: 'inherit',
            env: {
                ...process.env,
                TESSERAFIN_OPENAPI_SPEC: PINNED_SPEC_RELATIVE
            }
        });
    } catch (err) {
        generationError = err;
    } finally {
        // version.json's generatedAt/source churn is expected on every run (see header comment) -
        // reset it now that the generation attempt is done, whether it succeeded or threw, so
        // this script never leaves the working tree dirty as a side effect of merely running it.
        git(['checkout', '--', VERSION_JSON_RELATIVE]);
    }

    if (generationError) {
        fail(`regeneration itself failed: ${generationError.message}`);
        return;
    }

    const diff = git([
        'status',
        '--porcelain',
        '--',
        GENERATED_RELATIVE,
        PINNED_SPEC_RELATIVE,
        // The manifest is a pure function of the generated tree, so it is part of the
        // reproducibility comparison rather than churn to be reset like version.json's timestamp.
        MANIFEST_RELATIVE
    ]).trim();

    if (diff.length > 0) {
        fail(
            'regenerating the SDK from the pinned spec produced a diff - the committed ' +
                'generated/ (or the pinned spec copy) is stale, or regeneration created new ' +
                'untracked files (also caught by `git status --porcelain`, unlike `git diff ' +
                '--stat`). Run `npm run generate:tesserafin-sdk` and commit the result:\n' +
                diff
        );
        return;
    }
    console.log(
        '[verify:tesserafin-sdk-fresh] generated/ and spec/openapi.json match a fresh regeneration ' +
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
        `[verify:tesserafin-sdk-fresh] spec/version.json has explicit versions ` +
            `(server ${version.serverVersion}, tesserafin-web ${version.webAppVersion}).`
    );
    if (version.versionSkewNote) {
        console.log(
            `[verify:tesserafin-sdk-fresh] NOTE: ${version.versionSkewNote}`
        );
    }

    const schema = resolveSchema(version);
    if (schema === null) {
        return;
    }
    console.log(
        `[verify:tesserafin-sdk-fresh] Provenance schema ${schema}` +
            (schema === 1 ? ' (legacy, ancestry-bound on the server side).' : '.')
    );

    if (schema === PROVENANCE_SCHEMA_VERSION) {
        if (!checkV2Metadata(version)) {
            return;
        }
        if (!checkGeneratorIdentity(version)) {
            return;
        }
        if (!checkGeneratedManifest(version)) {
            return;
        }
    }

    if (!checkProvenance(version)) {
        return;
    }

    console.log('[verify:tesserafin-sdk-fresh] PASS.');
}

main();

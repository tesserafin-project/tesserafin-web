#!/usr/bin/env node
/**
 * Generates the typed Reefin API client (`src/lib/tesserafin-sdk/generated/`) from the OpenAPI spec
 * exposed by the `reefin` server, using the same tool/template @jellyfin/sdk itself is built with
 * (openapi-generator-cli, generator `typescript-axios`).
 *
 * See docs/tesserafin/design-tesserafin-api-layer.md (§4.1, §8 PR1) for the design this implements, and
 * src/lib/tesserafin-sdk/README.md for day-to-day usage.
 *
 * Spec source resolution (first match wins):
 *   1. $TESSERAFIN_OPENAPI_SPEC        - explicit override, a local file path OR an http(s) URL
 *                                    (e.g. "http://localhost:8096/api-docs/openapi.json").
 *   2. The *canonical contract* committed in the `reefin` server repo at `openapi/openapi.json`,
 *      read straight out of git (`git show <ref>:openapi/openapi.json`, default ref
 *      `origin/master`) so the resolved bytes are attributable to an exact commit.
 *   3. A running dev server at $TESSERAFIN_DEV_SERVER_URL (default http://localhost:8096) -
 *      GET /api-docs/openapi.json.
 *   4. The last spec committed at src/lib/tesserafin-sdk/spec/openapi.json (regenerate-with-no-source
 *      fallback - keeps `npm run generate:tesserafin-sdk` runnable offline against the last known
 *      contract, e.g. to re-apply a template/config change without a server around).
 *
 * HISTORY - why (2) reads git rather than a build output. This script used to resolve the spec
 * from `../reefin/tests/Reefin.Server.Integration.Tests/bin/{Debug,Release}/net10.0/openapi.json`,
 * an *integration-test build artifact*. That artifact is only as fresh as the last local `dotnet
 * build`, is not committed anywhere, and carries no provenance whatsoever - so a mirror generated
 * from a months-old `bin/` tree was indistinguishable from one generated from the real contract.
 * That is exactly how the mirror silently drifted to 395 schemas against a canonical 401 (6 schemas
 * and 2 paths missing outright). Reading `openapi/openapi.json` out of git instead makes every
 * regeneration attributable to a commit SHA, which `verify:tesserafin-sdk-fresh` then enforces.
 *
 * Every resolved spec is copied to src/lib/tesserafin-sdk/spec/openapi.json and pinned in
 * src/lib/tesserafin-sdk/spec/version.json before generation, so the diff of a regeneration always
 * shows *both* the contract change and the generated-code change together in code review.
 * version.json additionally records the *provenance* of those bytes (`sourceCommit`, `sourceRef`,
 * `specSha256`) so the pin can be re-derived and re-checked by anyone later.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative as relativePath, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SDK_DIR = join(REPO_ROOT, 'src', 'lib', 'tesserafin-sdk');
const SPEC_DIR = join(SDK_DIR, 'spec');
const PINNED_SPEC_PATH = join(SPEC_DIR, 'openapi.json');
const PINNED_VERSION_PATH = join(SPEC_DIR, 'version.json');
const GENERATED_MANIFEST_PATH = join(SPEC_DIR, 'generated-manifest.json');
const GENERATED_DIR = join(SDK_DIR, 'generated');

/**
 * Provenance schema version recorded in `spec/version.json` (C4-LH, server #246).
 *
 * Schema 1 identified a generated SDK by the git commit its contract came from, and the server's
 * `ci/verify-sdk-provenance.sh` required that commit to be an ANCESTOR of the server commit under
 * test. On a branch with `required_linear_history` that is unsatisfiable for a contract change:
 * the only commit carrying the new bytes before the merge is on the PR branch, and every merge
 * method available on such a branch rewrites its SHA, so the pin is non-ancestral the moment it
 * lands.
 *
 * Schema 2 identifies a generated SDK by the CONTENT it was generated from. The generator below
 * consumes exactly one thing from the server — the canonical `openapi/openapi.json` bytes — so two
 * server commits carrying byte-identical locked canonical contracts produce a byte-identical
 * transport boundary regardless of what GitHub did to the commit identity. `sourceCommit` stays
 * mandatory audit evidence (it must exist, resolve, and its bytes and contract lock must both
 * match); it simply stops being the load-bearing compatibility predicate.
 *
 * That trade is only sound because schema 2 records strictly MORE than schema 1 did, and every
 * recorded digest is recomputed from bytes by both verifiers rather than trusted as written:
 * `sourceRepository`, `canonicalSpecSha256` (the raw server bytes), `transformVersion`,
 * `generator`, and `generatedManifestSha256` (every file under `generated/`).
 */
export const PROVENANCE_SCHEMA_VERSION = 2;

/**
 * Version of the transform pipeline applied between the canonical server contract and the pinned
 * mirror — `fixSchema` → `demoteMediaRanges` → `unwrapIdSchemas`, in that order (`applyTransforms`).
 *
 * Recorded so that "the pinned spec does not match the canonical contract" can be distinguished
 * from "the pinned spec was produced by a different transform pipeline". Bump it whenever the set
 * or the order of those transforms changes; a verifier that knows a different value must refuse
 * rather than silently compare against transforms the pin was never produced by.
 */
export const TRANSFORM_VERSION = 1;

/** The one server repository whose canonical contract this SDK may be generated from. */
export const SERVER_REPOSITORY = 'tesserafin-project/tesserafin';

/** Repository-relative root the generated-file manifest covers. Nothing under it is excluded. */
export const GENERATED_MANIFEST_ROOT = 'src/lib/tesserafin-sdk/generated';

/**
 * Template overrides for the `typescript-axios` generator (#226).
 *
 * openapi-generator resolves every template from this directory FIRST and falls back to its own
 * built-in copy for each file absent here, so only the one template that needs correcting is
 * vendored. `scripts/verify-openapi-templates.mjs` fails if the vendored copy differs from the
 * generator's built-in template by anything other than the single intended hunk, so the override
 * cannot silently drift as the pinned generator version moves.
 */
const TEMPLATE_DIR = join(__dirname, 'openapi-templates', 'typescript-axios');

/**
 * Path of the canonical contract *inside* the `reefin` server repo. This is the file the server
 * lane generates and commits (with its own drift gate on that side); it is the only spec source
 * this repo treats as authoritative.
 */
const CANONICAL_SPEC_PATH_IN_SERVER_REPO = 'openapi/openapi.json';

/**
 * Where to look for a `reefin` server checkout, in order. `$TESSERAFIN_SERVER_REPO` wins when set.
 * The relative candidates cover both a plain sibling checkout (`../reefin`, the layout the old
 * artifact-based resolution assumed) and this repo being used from a git worktree nested one level
 * deeper (e.g. `.wt-web/<branch>/`), where the sibling is two levels up instead.
 */
const SERVER_REPO_CANDIDATES = ['../reefin', '../../reefin', '../../../reefin'];

/** Git ref to read the canonical contract at. Override to pin an older/newer contract. */
const SPEC_REF = process.env.TESSERAFIN_SPEC_REF || 'origin/master';

const DEV_SERVER_URL =
    process.env.TESSERAFIN_DEV_SERVER_URL || 'http://localhost:8096';

/** @returns {string | null} absolute path to a reefin server checkout, or null if none found. */
export function findServerRepo() {
    const explicit = process.env.TESSERAFIN_SERVER_REPO;
    const candidates = explicit
        ? [explicit]
        : SERVER_REPO_CANDIDATES.map((c) => resolve(REPO_ROOT, c));
    for (const candidate of candidates) {
        const path = resolve(REPO_ROOT, candidate);
        if (existsSync(join(path, '.git'))) {
            return path;
        }
    }
    return null;
}

/**
 * Reads `openapi/openapi.json` at `ref` out of `repo` *via git*, never from the working tree - a
 * dirty working tree would otherwise reintroduce exactly the "unattributable bytes" problem the
 * `bin/` artifact had. Returns the bytes plus the resolved commit SHA.
 *
 * @param {string} repo @param {string} ref
 * @returns {{ text: string, commit: string }}
 */
export function readCanonicalSpecFromGit(repo, ref) {
    const commit = execFileSync('git', ['rev-parse', `${ref}^{commit}`], {
        cwd: repo,
        encoding: 'utf-8'
    }).trim();
    const text = execFileSync(
        'git',
        ['show', `${commit}:${CANONICAL_SPEC_PATH_IN_SERVER_REPO}`],
        { cwd: repo, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
    );
    return { text, commit };
}

/** @returns {Promise<{ text: string, source: string }>} */
async function resolveSpec() {
    const override = process.env.TESSERAFIN_OPENAPI_SPEC;
    if (override) {
        if (/^https?:\/\//.test(override)) {
            console.log(
                `[generate-tesserafin-sdk] Using TESSERAFIN_OPENAPI_SPEC (URL): ${override}`
            );
            return { text: await fetchText(override), source: override };
        }
        const path = resolve(REPO_ROOT, override);
        if (!existsSync(path)) {
            throw new Error(
                `TESSERAFIN_OPENAPI_SPEC points to a file that does not exist: ${path}`
            );
        }
        console.log(
            `[generate-tesserafin-sdk] Using TESSERAFIN_OPENAPI_SPEC (file): ${path}`
        );
        return { text: readFileSync(path, 'utf-8'), source: path };
    }

    const serverRepo = findServerRepo();
    if (serverRepo) {
        const { text, commit } = readCanonicalSpecFromGit(serverRepo, SPEC_REF);
        console.log(
            `[generate-tesserafin-sdk] Using canonical contract from ${serverRepo}: ` +
                `${CANONICAL_SPEC_PATH_IN_SERVER_REPO} @ ${SPEC_REF} (${commit})`
        );
        return {
            text,
            source: `${serverRepo}/${CANONICAL_SPEC_PATH_IN_SERVER_REPO}`,
            commit,
            ref: SPEC_REF
        };
    }
    console.log(
        '[generate-tesserafin-sdk] No reefin server checkout found ' +
            `(looked for ${SERVER_REPO_CANDIDATES.join(', ')} relative to this repo; ` +
            'set $TESSERAFIN_SERVER_REPO to override), trying dev server.'
    );

    const devUrl = `${DEV_SERVER_URL.replace(/\/$/, '')}/api-docs/openapi.json`;
    try {
        const text = await fetchText(devUrl, 1500);
        console.log(
            `[generate-tesserafin-sdk] Using running dev server: ${devUrl}`
        );
        return { text, source: devUrl };
    } catch {
        console.log(
            `[generate-tesserafin-sdk] No dev server reachable at ${devUrl}, trying pinned spec.`
        );
    }

    if (existsSync(PINNED_SPEC_PATH)) {
        console.log(
            `[generate-tesserafin-sdk] Using previously pinned spec: ${PINNED_SPEC_PATH}`
        );
        return {
            text: readFileSync(PINNED_SPEC_PATH, 'utf-8'),
            source: `${PINNED_SPEC_PATH} (pinned, stale)`
        };
    }

    throw new Error(
        'No OpenAPI spec source available. Provide one via:\n' +
            '  - TESSERAFIN_OPENAPI_SPEC=<path-or-url> npm run generate:tesserafin-sdk\n' +
            '  - a `reefin` server checkout at ../reefin with a built openapi.json test artifact\n' +
            '  - a running dev server (default http://localhost:8096, override with TESSERAFIN_DEV_SERVER_URL)\n' +
            'See src/lib/tesserafin-sdk/README.md.'
    );
}

/** @param {string} url @param {number} [timeoutMs] @returns {Promise<string>} */
async function fetchText(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            throw new Error(`GET ${url} -> HTTP ${res.status}`);
        }
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Reefin's OpenAPI spec (Swashbuckle-generated, same generator stack Jellyfin upstream uses) emits
 * a redundant shape for enum-typed parameters/properties: both an inline `enum` array AND an
 * `allOf: [{ $ref }]` pointing at the named enum schema, on the same node. openapi-generator-cli's
 * typescript-axios template (7.11.0) mishandles that specific combination - it tries to import each
 * enum *value* as if it were a type name (`import type { 'Drop' } from '../models'`), which is not
 * valid TypeScript. 257 parameters in the current spec hit this. Dropping the inline `enum` and
 * keeping the `$ref` (which already carries the same enum) resolves it without touching generator
 * output - mirrors what @jellyfin/sdk's own `fix-schema` script does for its (very similar,
 * Swashbuckle-originated) spec quirks.
 */
export function fixSchema(node) {
    if (Array.isArray(node)) {
        for (const item of node) {
            fixSchema(item);
        }
        return;
    }
    if (node && typeof node === 'object') {
        if (
            Array.isArray(node.enum) &&
            Array.isArray(node.allOf) &&
            node.allOf.length === 1 &&
            typeof node.allOf[0] === 'object' &&
            node.allOf[0].$ref
        ) {
            delete node.enum;
        }
        for (const value of Object.values(node)) {
            fixSchema(value);
        }
    }
}

/**
 * Reefin uses strongly-typed ID wrappers server-side (e.g. `PlaybackSessionId`, a struct/record
 * around a single `Guid`/`string` `Value`) with a custom JSON/route converter that serializes them
 * as a plain string on the wire - but Swashbuckle's schema reflection doesn't know about that
 * converter, so it describes the *C# type shape* instead: `{ type: 'object', properties: { Value:
 * {...} } }`. That's wrong for how the value actually travels (confirmed by reading the generated
 * `getPlaybackSession`/`exportFixture` parameter creators: `id` is interpolated straight into the
 * URL path via `String(id)`, which would stringify an object as `"[object Object]"`). Unwrapping
 * every single-`Value`-property object schema in `components.schemas` to that property's own
 * schema fixes every `$ref` site at once (4 in the current spec, all route path parameters) without
 * having to special-case `PlaybackSessionId` by name - any future single-field ID wrapper the
 * server adds gets the same treatment automatically.
 */
/**
 * openapi-generator's typescript-axios template emits the **first** key of a `requestBody.content`
 * map as the literal request `Content-Type` header. It does not prefer a concrete media type, it
 * just takes whatever comes first.
 *
 * ASP.NET Core's JSON input formatter advertises three equivalent media types for every
 * `[FromBody]` JSON endpoint: `application/json`, `text/json`, and `application/*+json`. The order
 * they appear in was previously incidental (the old, unversioned `bin/` artifact happened to emit
 * `application/json` first); the canonical `openapi/openapi.json` is generated deterministically
 * with its keys **sorted**, which puts `application/*+json` first on all 77 JSON-body operations.
 * Regenerating straight from the canonical contract therefore made the client start sending
 * `Content-Type: application/*+json` on every one of them.
 *
 * That is wrong on the wire: `application/*+json` is a media *range*, valid in an `Accept` header
 * or a `consumes` list, but not a legal `Content-Type` for an actual request entity (RFC 9110
 * §8.3 - `Content-Type` names one concrete media type). It is a generator defect, in the same
 * family as the two transforms above, so it is fixed here rather than in the server contract.
 *
 * The fix targets the defect rather than the symptom: within each `requestBody.content`, demote
 * every media-*range* key (one containing `*`) below the concrete ones, preserving relative order
 * otherwise - and only when a concrete alternative actually exists. Bodies whose *only* option is
 * a range (this spec has 4 `image/*` upload endpoints) are left exactly as they are, since there
 * is nothing concrete to promote and inventing one would be a lie about the contract.
 */
export function demoteMediaRanges(node) {
    if (Array.isArray(node)) {
        for (const item of node) {
            demoteMediaRanges(item);
        }
        return;
    }
    if (!node || typeof node !== 'object') {
        return;
    }
    const content = node.requestBody?.content;
    if (content && typeof content === 'object') {
        const keys = Object.keys(content);
        const concrete = keys.filter((k) => !k.includes('*'));
        const ranges = keys.filter((k) => k.includes('*'));
        if (concrete.length > 0 && ranges.length > 0) {
            const reordered = {};
            for (const key of [...concrete, ...ranges]) {
                reordered[key] = content[key];
            }
            node.requestBody.content = reordered;
        }
    }
    for (const value of Object.values(node)) {
        demoteMediaRanges(value);
    }
}

/**
 * Detects a server contract that describes an opaque identifier with its CLR shape — an object
 * carrying a single `Value` member — instead of the scalar the wire actually carries.
 *
 * HISTORY, AND WHY THIS NO LONGER REWRITES ANYTHING. This function used to silently unwrap such
 * a schema so the generated client would take a scalar. That worked, and that was the problem:
 * it made a real server-side contract defect invisible on this side. Issue #226 is exactly that
 * defect — `PlaybackSessionId` was described as `{ Value: uuid }` while the model binder accepted
 * only the scalar, so every request an honest generator could build from the contract was answered
 * HTTP 400 — and it went unnoticed here for as long as this transform quietly papered over it.
 *
 * The server fixed the contract (server PR #227): the canonical document now describes the scalar
 * directly, and this transform matches nothing. Rather than delete it and lose the detector along
 * with the workaround, it is kept and INVERTED. It normalizes nothing; it refuses.
 *
 * If a future contract reintroduces an ID-object, generation stops with the schema named, and the
 * fix belongs in the server contract — not in a quiet rewrite here.
 *
 * Note the deliberately narrow predicate: a single property named exactly `Value`. This contract
 * carries around thirty legitimate single-property DTOs (`PingRequestDto`, `SeekRequestDto`,
 * `QuickConnectDto`, …) whose sole property is named something else; none of them is an opaque
 * identifier and none is affected.
 *
 * @returns {string[]} the offending schema names — always empty on a healthy contract.
 * @throws {Error} if the contract describes any ID-object.
 */
export function unwrapIdSchemas(spec) {
    const schemas = (spec.components || {}).schemas || {};
    const offenders = [];
    for (const [name, schema] of Object.entries(schemas)) {
        const properties =
            schema && typeof schema === 'object'
                ? schema.properties
                : undefined;
        if (
            schema?.type === 'object' &&
            properties &&
            Object.keys(properties).length === 1 &&
            Object.keys(properties)[0] === 'Value'
        ) {
            offenders.push(name);
        }
    }

    if (offenders.length > 0) {
        throw new Error(
            `the canonical contract describes ${offenders.length} opaque identifier(s) with a CLR ` +
                `object shape instead of the scalar the wire carries: ${offenders.join(', ')}.\n` +
                'This is a server-side contract defect of exactly the kind issue #226 fixed, and it ' +
                'is NOT corrected here: a generated client that quietly reshapes the contract hides ' +
                'the defect from everyone downstream who does not use this generator.\n' +
                'Fix the description on the server (see server PR #227 for the pattern: a Swashbuckle ' +
                '`MapType` for the identifier type), regenerate the contract, then re-pin here.'
        );
    }

    console.log(
        '[generate-tesserafin-sdk] ID-object check: 0 schema(s) describe an identifier as ' +
            '{ Value: ... }; nothing to correct.'
    );
    return offenders;
}

/**
 * The typescript-axios template unconditionally emits a `/* eslint-disable *\/` line in the
 * header of every generated file (right after `/* tslint:disable *\/`), regardless of
 * `--additional-properties`/`--global-property` flags - there is no generator switch to suppress
 * it. This repo has had no ESLint since RFC-0002 step 5 (`chore: remove ESLint in favor of
 * Biome`); Biome does not read this pragma, so it is a dead comment here. It was stripped from the
 * tree when ESLint was removed (the `tslint:disable` line was left alone - tslint is unrelated to
 * ESLint/Biome and its removal is out of scope here), but the generator still re-adds the eslint
 * line on every regeneration - without this, `npm run generate:tesserafin-sdk` would never be
 * idempotent and `verify:tesserafin-sdk-fresh` (see scripts/verify-tesserafin-sdk-fresh.mjs) would
 * permanently report a stale SDK. Strip it back out post-generation instead.
 */
function stripEslintDisableHeaders(dir) {
    let stripped = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            stripped += stripEslintDisableHeaders(entryPath);
            continue;
        }
        if (!entry.name.endsWith('.ts')) {
            continue;
        }
        const text = readFileSync(entryPath, 'utf-8');
        // Only touch the line if it appears in the leading header (first 5 lines) - never do a
        // blind whole-file replace, in case some future template emits this text elsewhere.
        const lines = text.split('\n');
        const headerWindow = 5;
        const lineIndex = lines
            .slice(0, headerWindow)
            .findIndex((line) => line === '/* eslint-disable */');
        if (lineIndex !== -1) {
            lines.splice(lineIndex, 1);
            writeFileSync(entryPath, lines.join('\n'), 'utf-8');
            stripped++;
        }
    }
    return stripped;
}

/**
 * Explicit version bookkeeping: the spec is generated by (and versioned against) the `reefin`
 * *server*, which does not necessarily move in lockstep with `tesserafin-web` (this package).
 * Surfacing both, plus a computed skew note, makes a stale spec visible in version.json itself
 * rather than requiring readers to cross-reference package.json. Current known skew (see
 * docs/tesserafin/design-tesserafin-api-layer.md): the pinned spec comes from a 12.0.0 server while
 * tesserafin-web is 13.0.0 - tracked for resolution in W14.1, not something this script should paper
 * over by inventing a newer spec.
 */
function computeVersionSkew(info) {
    const webAppVersion = JSON.parse(
        readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')
    ).version;
    const serverVersion = info['x-tesserafin-version'] ?? info.version ?? null;
    const versionSkewNote =
        serverVersion && webAppVersion && serverVersion !== webAppVersion
            ? `Spec pinned at server ${serverVersion}; tesserafin-web is ${webAppVersion}. Upgrade tracked for W14.1.`
            : null;
    return { webAppVersion, serverVersion, versionSkewNote };
}

// Suffix `resolveSpec()` appends to the pinned-spec fallback source (see its final branch) -
// stripped off before normalizing the path and re-appended after, so it survives untouched.
const PINNED_STALE_SUFFIX = ' (pinned, stale)';

/**
 * `source` (as returned by `resolveSpec()`) is either an http(s) URL (left verbatim) or an
 * absolute local filesystem path (every local branch of `resolveSpec()` goes through `resolve()`).
 * An absolute path is machine-specific (e.g. `/home/alex/Repos/tesserafin-web/...`) and pollutes the
 * committed `version.json` with information about whoever last regenerated the SDK. Normalize it
 * to a path relative to `REPO_ROOT` when possible; if it falls outside the repo (e.g. a sibling
 * `../reefin` checkout), keep it path-shaped but replace a home-directory prefix with `~` so it's
 * at least not tied to a specific username/absolute layout.
 */
function normalizeSourcePath(source) {
    if (/^https?:\/\//.test(source)) {
        return source;
    }
    const isStale = source.endsWith(PINNED_STALE_SUFFIX);
    const path = isStale
        ? source.slice(0, -PINNED_STALE_SUFFIX.length)
        : source;

    const rel = relativePath(REPO_ROOT, path);
    let normalized;
    if (!rel.startsWith('..')) {
        normalized = rel;
    } else {
        const home = homedir();
        normalized = path.startsWith(home)
            ? `~${path.slice(home.length)}`
            : path;
    }
    return isStale ? `${normalized}${PINNED_STALE_SUFFIX}` : normalized;
}

/**
 * Provenance carry-forward for the sources that have no commit of their own (the
 * `TESSERAFIN_OPENAPI_SPEC`-points-at-the-pinned-file path `verify:tesserafin-sdk-fresh` uses, and the
 * offline pinned fallback). Re-pinning byte-identical content must not *erase* the commit the
 * bytes originally came from - but re-pinning *different* content must not inherit it either, or
 * the recorded provenance would be a lie. So: carry forward only on an exact byte match.
 *
 * `canonicalSpecSha256` and `sourceRepository` carry forward under the same rule and for the same
 * reason: regenerating from the pinned mirror never sees the raw canonical bytes, so it cannot
 * recompute that digest, and dropping it would make every `verify:tesserafin-sdk-fresh` run
 * silently downgrade a schema-2 pin to an unusable one. The byte-equality precondition is what
 * keeps that from being an inheritance of someone else's provenance.
 *
 * @param {string} nextSpecText
 * @returns {{sourceCommit: string|null, sourceRef: string|null,
 *            canonicalSpecSha256: string|null, sourceRepository: string|null}}
 */
function carryForwardProvenance(nextSpecText) {
    const none = {
        sourceCommit: null,
        sourceRef: null,
        canonicalSpecSha256: null,
        sourceRepository: null
    };
    if (!existsSync(PINNED_VERSION_PATH) || !existsSync(PINNED_SPEC_PATH)) {
        return none;
    }
    const previousSpec = readFileSync(PINNED_SPEC_PATH, 'utf-8');
    if (previousSpec !== nextSpecText) {
        return none;
    }
    const previous = JSON.parse(readFileSync(PINNED_VERSION_PATH, 'utf-8'));
    return {
        sourceCommit: previous.sourceCommit ?? null,
        sourceRef: previous.sourceRef ?? null,
        canonicalSpecSha256: previous.canonicalSpecSha256 ?? null,
        sourceRepository: previous.sourceRepository ?? null
    };
}

/**
 * The canonical-contract → pinned-mirror transform pipeline, in one place.
 *
 * `verify-tesserafin-sdk-fresh.mjs` and the server's provenance gate both have to apply the EXACT
 * same transforms in the EXACT same order to decide whether the pinned mirror still corresponds to
 * the canonical contract. Three call sites each spelling out `fixSchema` → `demoteMediaRanges` →
 * `unwrapIdSchemas` is three chances for one of them to drift and start reporting phantom
 * differences — or, worse, to mask a real one. `TRANSFORM_VERSION` names this exact sequence.
 *
 * Mutates `spec` in place and returns it for convenience.
 *
 * @param {object} spec @returns {object}
 */
export function applyTransforms(spec) {
    fixSchema(spec);
    demoteMediaRanges(spec);
    unwrapIdSchemas(spec);
    return spec;
}

/** Byte-order comparison, so the manifest sorts identically on every platform and locale. */
function compareOrdinal(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Every file under `dir`, as POSIX-separated paths relative to it. Directories are not listed. */
function listFilesRecursively(dir, prefix = '') {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.push(...listFilesRecursively(join(dir, entry.name), rel));
        } else {
            out.push(rel);
        }
    }
    return out;
}

/**
 * A content address for the whole generated tree.
 *
 * WHY THIS EXISTS AND REGENERATION IS NOT ENOUGH. `verify:tesserafin-sdk-fresh` proves the tree by
 * regenerating it and requiring `git status --porcelain` to stay clean. That catches a modified or
 * a deleted file, but NOT an EXTRA one: `main()` below only `mkdirSync`s `generated/` before
 * running the generator, so a file nobody generates is never removed, regeneration leaves it
 * untouched, and `git status` has nothing to report. An injected file under `generated/` — which
 * `src/lib/tesserafin-sdk/index.ts` could then re-export — is exactly the kind of thing a
 * provenance gate is supposed to make impossible. It changes this manifest.
 *
 * COVERAGE, precisely: every file of any kind under `src/lib/tesserafin-sdk/generated/`,
 * recursively. Nothing is excluded — not dotfiles, not empty files, not files the generator
 * itself later removes in `cleanupGeneratedOutput()`. Each entry is the file's path relative to
 * that root (POSIX separators) and the sha256 of its exact bytes. Entries are sorted by path in
 * byte order. Nothing OUTSIDE that root is covered: the pinned spec has its own `specSha256`, and
 * the hand-written SDK surface (`client.ts`, `index.ts`, `versions.ts`) is reviewed source, not
 * generated output.
 *
 * @returns {{ provenanceSchema: number, root: string, algorithm: string, fileCount: number,
 *             files: Array<{ path: string, sha256: string }> }}
 */
export function buildGeneratedManifest() {
    const files = listFilesRecursively(GENERATED_DIR)
        .sort(compareOrdinal)
        .map((path) => ({
            path,
            sha256: createHash('sha256')
                .update(readFileSync(join(GENERATED_DIR, path)))
                .digest('hex')
        }));
    return {
        provenanceSchema: PROVENANCE_SCHEMA_VERSION,
        root: GENERATED_MANIFEST_ROOT,
        algorithm: 'sha256',
        fileCount: files.length,
        files
    };
}

/**
 * The manifest's committed byte representation. `generatedManifestSha256` in version.json covers
 * exactly these bytes, so a verifier rebuilds the manifest from the tree on disk, serialises it
 * through this function, and compares BOTH against the committed file and against the recorded
 * digest — two independent bindings, neither of which trusts a written-down number.
 *
 * @param {object} manifest @returns {string}
 */
export function serializeGeneratedManifest(manifest) {
    // biome formats committed JSON with 4-space indent; match it so a regeneration never trips
    // the formatter check on generated-manifest.json.
    return JSON.stringify(manifest, null, 4) + '\n';
}

/**
 * The generator this repo is pinned to, read from the two files that actually control it rather
 * than from anything a regeneration could restate. `cliVersion` is the npm wrapper pinned in
 * package.json; `generatorVersion` is the openapi-generator jar pinned in openapitools.json, which
 * is what actually decides the emitted TypeScript.
 *
 * @param {string} [repoRoot] @returns {{ name: string, cliVersion: string, generatorVersion: string }}
 */
export function readGeneratorIdentity(repoRoot = REPO_ROOT) {
    const pkg = JSON.parse(
        readFileSync(join(repoRoot, 'package.json'), 'utf-8')
    );
    const tools = JSON.parse(
        readFileSync(join(repoRoot, 'openapitools.json'), 'utf-8')
    );
    const cliVersion =
        pkg.devDependencies?.['@openapitools/openapi-generator-cli'] ??
        pkg.dependencies?.['@openapitools/openapi-generator-cli'] ??
        null;
    return {
        name: 'typescript-axios',
        cliVersion,
        generatorVersion: tools['generator-cli']?.version ?? null
    };
}

/**
 * Writes the pinned spec copy — and only that. The generator needs this file on disk to read it
 * as `--input-spec`; the provenance metadata deliberately does NOT get written here, because
 * `generatedManifestSha256` cannot be known until the generator has run. See
 * `writeProvenanceMetadata()`.
 *
 * @returns {{ info: object, specText: string, specSha256: string, provenance: object }}
 */
function pinSpec(spec, source, commit, ref, canonicalSpecSha256) {
    const info = spec.info || {};
    const specText = JSON.stringify(spec, null, 2) + '\n';
    const specSha256 = createHash('sha256')
        .update(specText, 'utf-8')
        .digest('hex');
    const provenance = commit
        ? {
              sourceCommit: commit,
              sourceRef: ref ?? null,
              canonicalSpecSha256: canonicalSpecSha256 ?? null,
              sourceRepository: SERVER_REPOSITORY
          }
        : carryForwardProvenance(specText);

    mkdirSync(SPEC_DIR, { recursive: true });
    writeFileSync(PINNED_SPEC_PATH, specText, 'utf-8');
    return { info, specText, specSha256, provenance, source };
}

/**
 * Writes `spec/version.json` and `spec/generated-manifest.json`, AFTER generation.
 *
 * The ordering matters and is the whole reason `pinSpec()` was split. `generatedManifestSha256`
 * addresses the generated tree, so it does not exist until the tree does; writing version.json
 * before generation and patching it afterwards would mean two writes of a security-relevant file,
 * and `verify:tesserafin-sdk-fresh` resets version.json in a `finally` block that would race the
 * second one. One write, after everything it describes exists.
 *
 * FIELD SEMANTICS. Compatibility-bearing: `provenanceSchema`, `sourceRepository`, `sourceCommit`,
 * `canonicalSpecSha256`, `specSha256`, `transformVersion`, `generator`, `generatedManifestSha256`.
 * Informational only, and explicitly excluded from every compatibility decision by both verifiers:
 * `generatedAt`, `source`, `sourceRef`, `title`, `pathCount`, `schemaCount`, `versionSkewNote`.
 *
 * `canonicalSpecSha256` covers the RAW `openapi/openapi.json` bytes as committed in the server
 * repository. `specSha256` covers the TRANSFORMED mirror written above. They are different
 * digests of different bytes, related by `applyTransforms` at `transformVersion`, and a verifier
 * that conflated them would accept a mirror produced by a different pipeline.
 */
function writeProvenanceMetadata(spec, pinned) {
    const { info, specSha256, provenance, source } = pinned;
    const { webAppVersion, serverVersion, versionSkewNote } =
        computeVersionSkew(info);

    const manifest = buildGeneratedManifest();
    const manifestText = serializeGeneratedManifest(manifest);
    writeFileSync(GENERATED_MANIFEST_PATH, manifestText, 'utf-8');
    const generatedManifestSha256 = createHash('sha256')
        .update(manifestText, 'utf-8')
        .digest('hex');

    writeFileSync(
        PINNED_VERSION_PATH,
        JSON.stringify(
            {
                provenanceSchema: PROVENANCE_SCHEMA_VERSION,
                title: info.title ?? null,
                version: info.version ?? null,
                xTesserafinVersion: info['x-tesserafin-version'] ?? null,
                serverVersion,
                webAppVersion,
                versionSkewNote,
                openapi: spec.openapi ?? null,
                pathCount: Object.keys(spec.paths || {}).length,
                schemaCount: Object.keys((spec.components || {}).schemas || {})
                    .length,
                source: normalizeSourcePath(source),
                // Provenance of the pinned bytes - enforced by verify:tesserafin-sdk-fresh, which
                // re-reads `sourceCommit` out of the server repo and re-compares when a checkout
                // is available. `specSha256` covers the pinned file itself so a hand-edit of
                // spec/openapi.json is caught even with no server repo around.
                sourceRepository: provenance.sourceRepository,
                sourceCommit: provenance.sourceCommit,
                sourceRef: provenance.sourceRef,
                canonicalSpecSha256: provenance.canonicalSpecSha256,
                specSha256,
                transformVersion: TRANSFORM_VERSION,
                generator: readGeneratorIdentity(),
                generatedManifestSha256,
                generatedFileCount: manifest.fileCount,
                generatedAt: new Date().toISOString()
            },
            null,
            // biome formats committed JSON with 4-space indent; match it so a
            // regeneration never trips the formatter check on version.json.
            4
        ) + '\n',
        'utf-8'
    );
}

function runGenerator() {
    console.log(
        '[generate-tesserafin-sdk] Running openapi-generator-cli (typescript-axios)...'
    );
    execFileSync(
        'npx',
        [
            '--yes',
            '@openapitools/openapi-generator-cli',
            'generate',
            '--input-spec',
            PINNED_SPEC_PATH,
            '--generator-name',
            'typescript-axios',
            // See TEMPLATE_DIR: overrides only, with built-in fallback per file.
            '--template-dir',
            TEMPLATE_DIR,
            '--output',
            GENERATED_DIR,
            '--additional-properties',
            [
                'supportsES6=true',
                'withInterfaces=true',
                'useSingleRequestParameter=false',
                'withSeparateModelsAndApi=true',
                'apiPackage=api',
                'modelPackage=models'
            ].join(','),
            '--global-property',
            'apiTests=false,modelTests=false,apiDocs=false,modelDocs=false'
        ],
        { cwd: REPO_ROOT, stdio: 'inherit' }
    );

    // Validate the vendored template override against the generator's own copy. This runs AFTER
    // the generator, on purpose: the pinned jar is downloaded lazily on first use, so before this
    // point it may simply not exist yet. Running it here makes the check impossible to skip -
    // every regeneration, including the one `verify:tesserafin-sdk-fresh` performs (and therefore
    // the server's SDK Provenance gate), has to satisfy it.
    execFileSync('node', [join(__dirname, 'verify-openapi-templates.mjs')], {
        cwd: REPO_ROOT,
        stdio: 'inherit'
    });
}

/** Removes generator boilerplate irrelevant to a committed-in-app SDK, and dead lint headers. */
function cleanupGeneratedOutput() {
    // Standalone-npm-package boilerplate the typescript-axios template always emits; irrelevant
    // here since generated/ is committed straight into this app rather than published on its own.
    for (const stale of [
        'git_push.sh',
        '.gitignore',
        '.npmignore',
        '.openapi-generator-ignore'
    ]) {
        rmSync(join(GENERATED_DIR, stale), { force: true });
    }

    const strippedCount = stripEslintDisableHeaders(GENERATED_DIR);
    if (strippedCount > 0) {
        console.log(
            `[generate-tesserafin-sdk] Stripped the generator's \`/* eslint-disable */\` header ` +
                `from ${strippedCount} generated file(s) (no ESLint in this repo - see comment ` +
                `above stripEslintDisableHeaders()).`
        );
    }
}

function main() {
    return resolveSpec().then(({ text, source, commit, ref }) => {
        // The RAW canonical bytes, hashed before any transform touches them - this is the digest
        // schema 2 uses as the SDK's compatibility identity, and it has to address what the server
        // committed, not what this script derived from it.
        const canonicalSpecSha256 = createHash('sha256')
            .update(text, 'utf-8')
            .digest('hex');

        const spec = applyTransforms(JSON.parse(text));

        const pinned = pinSpec(spec, source, commit, ref, canonicalSpecSha256);
        console.log(
            `[generate-tesserafin-sdk] Pinned spec: ${pinned.info.title} ${pinned.info.version} ` +
                `(${Object.keys(spec.paths || {}).length} paths, ` +
                `${Object.keys((spec.components || {}).schemas || {}).length} schemas)`
        );

        // Clear `generated/` first, so regeneration is a REPLACEMENT rather than an overlay.
        //
        // Without this, a file nobody generates is never removed: it survives every regeneration
        // untouched, `verify:tesserafin-sdk-fresh`'s `git status --porcelain` comparison has
        // nothing to report, and — once it is committed and listed in generated-manifest.json —
        // every content check agrees with it too, because the tree, the manifest and the recorded
        // digest are all self-consistent. Nothing downstream can distinguish "generated" from
        // "added by hand next to the generated files" after that point. Wiping first is what makes
        // `generated/` mean exactly the generator's output.
        rmSync(GENERATED_DIR, { recursive: true, force: true });
        mkdirSync(GENERATED_DIR, { recursive: true });
        runGenerator();
        cleanupGeneratedOutput();

        // Only now can the generated tree be addressed; see writeProvenanceMetadata().
        writeProvenanceMetadata(spec, pinned);

        console.log(
            '[generate-tesserafin-sdk] Done. Review the diff under src/lib/tesserafin-sdk/ before committing.'
        );
    });
}

// Only generate when run as a script. `verify:tesserafin-sdk-fresh` imports the helpers above
// (`findServerRepo`, `readCanonicalSpecFromGit`, `fixSchema`, `unwrapIdSchemas`) so that its
// drift comparison applies the *exact same* spec transforms this generator does - a second copy
// of `fixSchema`/`unwrapIdSchemas` living in the gate would be free to drift out of sync and
// would then report phantom differences (or, worse, mask real ones).
if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch((err) => {
        console.error(`[generate-tesserafin-sdk] ${err.message}`);
        process.exitCode = 1;
    });
}

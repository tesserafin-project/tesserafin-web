#!/usr/bin/env node
/**
 * Generates the typed Reefin API client (`src/lib/reefin-sdk/generated/`) from the OpenAPI spec
 * exposed by the `reefin` server, using the same tool/template @jellyfin/sdk itself is built with
 * (openapi-generator-cli, generator `typescript-axios`).
 *
 * See docs/reefin/design-reefin-api-layer.md (§4.1, §8 PR1) for the design this implements, and
 * src/lib/reefin-sdk/README.md for day-to-day usage.
 *
 * Spec source resolution (first match wins):
 *   1. $REEFIN_OPENAPI_SPEC        - explicit override, a local file path OR an http(s) URL
 *                                    (e.g. "http://localhost:8096/api-docs/openapi.json").
 *   2. The *canonical contract* committed in the `reefin` server repo at `openapi/openapi.json`,
 *      read straight out of git (`git show <ref>:openapi/openapi.json`, default ref
 *      `origin/master`) so the resolved bytes are attributable to an exact commit.
 *   3. A running dev server at $REEFIN_DEV_SERVER_URL (default http://localhost:8096) -
 *      GET /api-docs/openapi.json.
 *   4. The last spec committed at src/lib/reefin-sdk/spec/openapi.json (regenerate-with-no-source
 *      fallback - keeps `npm run generate:reefin-sdk` runnable offline against the last known
 *      contract, e.g. to re-apply a template/config change without a server around).
 *
 * HISTORY - why (2) reads git rather than a build output. This script used to resolve the spec
 * from `../reefin/tests/Reefin.Server.Integration.Tests/bin/{Debug,Release}/net10.0/openapi.json`,
 * an *integration-test build artifact*. That artifact is only as fresh as the last local `dotnet
 * build`, is not committed anywhere, and carries no provenance whatsoever - so a mirror generated
 * from a months-old `bin/` tree was indistinguishable from one generated from the real contract.
 * That is exactly how the mirror silently drifted to 395 schemas against a canonical 401 (6 schemas
 * and 2 paths missing outright). Reading `openapi/openapi.json` out of git instead makes every
 * regeneration attributable to a commit SHA, which `verify:reefin-sdk-fresh` then enforces.
 *
 * Every resolved spec is copied to src/lib/reefin-sdk/spec/openapi.json and pinned in
 * src/lib/reefin-sdk/spec/version.json before generation, so the diff of a regeneration always
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
const SDK_DIR = join(REPO_ROOT, 'src', 'lib', 'reefin-sdk');
const SPEC_DIR = join(SDK_DIR, 'spec');
const PINNED_SPEC_PATH = join(SPEC_DIR, 'openapi.json');
const PINNED_VERSION_PATH = join(SPEC_DIR, 'version.json');
const GENERATED_DIR = join(SDK_DIR, 'generated');

/**
 * Path of the canonical contract *inside* the `reefin` server repo. This is the file the server
 * lane generates and commits (with its own drift gate on that side); it is the only spec source
 * this repo treats as authoritative.
 */
const CANONICAL_SPEC_PATH_IN_SERVER_REPO = 'openapi/openapi.json';

/**
 * Where to look for a `reefin` server checkout, in order. `$REEFIN_SERVER_REPO` wins when set.
 * The relative candidates cover both a plain sibling checkout (`../reefin`, the layout the old
 * artifact-based resolution assumed) and this repo being used from a git worktree nested one level
 * deeper (e.g. `.wt-web/<branch>/`), where the sibling is two levels up instead.
 */
const SERVER_REPO_CANDIDATES = ['../reefin', '../../reefin', '../../../reefin'];

/** Git ref to read the canonical contract at. Override to pin an older/newer contract. */
const SPEC_REF = process.env.REEFIN_SPEC_REF || 'origin/master';

const DEV_SERVER_URL =
    process.env.REEFIN_DEV_SERVER_URL || 'http://localhost:8096';

/** @returns {string | null} absolute path to a reefin server checkout, or null if none found. */
export function findServerRepo() {
    const explicit = process.env.REEFIN_SERVER_REPO;
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
    const override = process.env.REEFIN_OPENAPI_SPEC;
    if (override) {
        if (/^https?:\/\//.test(override)) {
            console.log(
                `[generate-reefin-sdk] Using REEFIN_OPENAPI_SPEC (URL): ${override}`
            );
            return { text: await fetchText(override), source: override };
        }
        const path = resolve(REPO_ROOT, override);
        if (!existsSync(path)) {
            throw new Error(
                `REEFIN_OPENAPI_SPEC points to a file that does not exist: ${path}`
            );
        }
        console.log(
            `[generate-reefin-sdk] Using REEFIN_OPENAPI_SPEC (file): ${path}`
        );
        return { text: readFileSync(path, 'utf-8'), source: path };
    }

    const serverRepo = findServerRepo();
    if (serverRepo) {
        const { text, commit } = readCanonicalSpecFromGit(serverRepo, SPEC_REF);
        console.log(
            `[generate-reefin-sdk] Using canonical contract from ${serverRepo}: ` +
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
        '[generate-reefin-sdk] No reefin server checkout found ' +
            `(looked for ${SERVER_REPO_CANDIDATES.join(', ')} relative to this repo; ` +
            'set $REEFIN_SERVER_REPO to override), trying dev server.'
    );

    const devUrl = `${DEV_SERVER_URL.replace(/\/$/, '')}/api-docs/openapi.json`;
    try {
        const text = await fetchText(devUrl, 1500);
        console.log(
            `[generate-reefin-sdk] Using running dev server: ${devUrl}`
        );
        return { text, source: devUrl };
    } catch {
        console.log(
            `[generate-reefin-sdk] No dev server reachable at ${devUrl}, trying pinned spec.`
        );
    }

    if (existsSync(PINNED_SPEC_PATH)) {
        console.log(
            `[generate-reefin-sdk] Using previously pinned spec: ${PINNED_SPEC_PATH}`
        );
        return {
            text: readFileSync(PINNED_SPEC_PATH, 'utf-8'),
            source: `${PINNED_SPEC_PATH} (pinned, stale)`
        };
    }

    throw new Error(
        'No OpenAPI spec source available. Provide one via:\n' +
            '  - REEFIN_OPENAPI_SPEC=<path-or-url> npm run generate:reefin-sdk\n' +
            '  - a `reefin` server checkout at ../reefin with a built openapi.json test artifact\n' +
            '  - a running dev server (default http://localhost:8096, override with REEFIN_DEV_SERVER_URL)\n' +
            'See src/lib/reefin-sdk/README.md.'
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

export function unwrapIdSchemas(spec) {
    const schemas = (spec.components || {}).schemas || {};
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
            const description = schema.description;
            schemas[name] = {
                ...properties.Value,
                ...(description ? { description } : {})
            };
            console.log(
                `[generate-reefin-sdk] Unwrapped single-property ID schema: ${name}`
            );
        }
    }
}

/**
 * The typescript-axios template unconditionally emits a `/* eslint-disable *\/` line in the
 * header of every generated file (right after `/* tslint:disable *\/`), regardless of
 * `--additional-properties`/`--global-property` flags - there is no generator switch to suppress
 * it. This repo has had no ESLint since RFC-0002 step 5 (`chore: remove ESLint in favor of
 * Biome`); Biome does not read this pragma, so it is a dead comment here. It was stripped from the
 * tree when ESLint was removed (the `tslint:disable` line was left alone - tslint is unrelated to
 * ESLint/Biome and its removal is out of scope here), but the generator still re-adds the eslint
 * line on every regeneration - without this, `npm run generate:reefin-sdk` would never be
 * idempotent and `verify:reefin-sdk-fresh` (see scripts/verify-reefin-sdk-fresh.mjs) would
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
 * *server*, which does not necessarily move in lockstep with `reefin-web` (this package).
 * Surfacing both, plus a computed skew note, makes a stale spec visible in version.json itself
 * rather than requiring readers to cross-reference package.json. Current known skew (see
 * docs/reefin/design-reefin-api-layer.md): the pinned spec comes from a 12.0.0 server while
 * reefin-web is 13.0.0 - tracked for resolution in W14.1, not something this script should paper
 * over by inventing a newer spec.
 */
function computeVersionSkew(info) {
    const webAppVersion = JSON.parse(
        readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')
    ).version;
    const serverVersion = info['x-reefin-version'] ?? info.version ?? null;
    const versionSkewNote =
        serverVersion && webAppVersion && serverVersion !== webAppVersion
            ? `Spec pinned at server ${serverVersion}; reefin-web is ${webAppVersion}. Upgrade tracked for W14.1.`
            : null;
    return { webAppVersion, serverVersion, versionSkewNote };
}

// Suffix `resolveSpec()` appends to the pinned-spec fallback source (see its final branch) -
// stripped off before normalizing the path and re-appended after, so it survives untouched.
const PINNED_STALE_SUFFIX = ' (pinned, stale)';

/**
 * `source` (as returned by `resolveSpec()`) is either an http(s) URL (left verbatim) or an
 * absolute local filesystem path (every local branch of `resolveSpec()` goes through `resolve()`).
 * An absolute path is machine-specific (e.g. `/home/alex/Repos/reefin-web/...`) and pollutes the
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
 * `REEFIN_OPENAPI_SPEC`-points-at-the-pinned-file path `verify:reefin-sdk-fresh` uses, and the
 * offline pinned fallback). Re-pinning byte-identical content must not *erase* the commit the
 * bytes originally came from - but re-pinning *different* content must not inherit it either, or
 * the recorded provenance would be a lie. So: carry forward only on an exact byte match.
 *
 * @param {string} nextSpecText @returns {{sourceCommit: string|null, sourceRef: string|null}}
 */
function carryForwardProvenance(nextSpecText) {
    if (!existsSync(PINNED_VERSION_PATH) || !existsSync(PINNED_SPEC_PATH)) {
        return { sourceCommit: null, sourceRef: null };
    }
    const previousSpec = readFileSync(PINNED_SPEC_PATH, 'utf-8');
    if (previousSpec !== nextSpecText) {
        return { sourceCommit: null, sourceRef: null };
    }
    const previous = JSON.parse(readFileSync(PINNED_VERSION_PATH, 'utf-8'));
    return {
        sourceCommit: previous.sourceCommit ?? null,
        sourceRef: previous.sourceRef ?? null
    };
}

/** Writes the pinned spec copy and its version.json metadata; returns `spec.info` for logging. */
function pinSpec(spec, source, commit, ref) {
    const info = spec.info || {};
    const { webAppVersion, serverVersion, versionSkewNote } =
        computeVersionSkew(info);

    const specText = JSON.stringify(spec, null, 2) + '\n';
    const specSha256 = createHash('sha256')
        .update(specText, 'utf-8')
        .digest('hex');
    const provenance = commit
        ? { sourceCommit: commit, sourceRef: ref ?? null }
        : carryForwardProvenance(specText);

    mkdirSync(SPEC_DIR, { recursive: true });
    writeFileSync(PINNED_SPEC_PATH, specText, 'utf-8');
    writeFileSync(
        PINNED_VERSION_PATH,
        JSON.stringify(
            {
                title: info.title ?? null,
                version: info.version ?? null,
                xReefinVersion: info['x-reefin-version'] ?? null,
                serverVersion,
                webAppVersion,
                versionSkewNote,
                openapi: spec.openapi ?? null,
                pathCount: Object.keys(spec.paths || {}).length,
                schemaCount: Object.keys((spec.components || {}).schemas || {})
                    .length,
                source: normalizeSourcePath(source),
                // Provenance of the pinned bytes - enforced by verify:reefin-sdk-fresh, which
                // re-reads `sourceCommit` out of the server repo and re-compares when a checkout
                // is available. `specSha256` covers the pinned file itself so a hand-edit of
                // spec/openapi.json is caught even with no server repo around.
                sourceCommit: provenance.sourceCommit,
                sourceRef: provenance.sourceRef,
                specSha256,
                generatedAt: new Date().toISOString()
            },
            null,
            // biome formats committed JSON with 4-space indent; match it so a
            // regeneration never trips the formatter check on version.json.
            4
        ) + '\n',
        'utf-8'
    );
    return info;
}

function runGenerator() {
    console.log(
        '[generate-reefin-sdk] Running openapi-generator-cli (typescript-axios)...'
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
            `[generate-reefin-sdk] Stripped the generator's \`/* eslint-disable */\` header ` +
                `from ${strippedCount} generated file(s) (no ESLint in this repo - see comment ` +
                `above stripEslintDisableHeaders()).`
        );
    }
}

function main() {
    return resolveSpec().then(({ text, source, commit, ref }) => {
        const spec = JSON.parse(text);
        fixSchema(spec);
        demoteMediaRanges(spec);
        unwrapIdSchemas(spec);

        const info = pinSpec(spec, source, commit, ref);
        console.log(
            `[generate-reefin-sdk] Pinned spec: ${info.title} ${info.version} ` +
                `(${Object.keys(spec.paths || {}).length} paths, ` +
                `${Object.keys((spec.components || {}).schemas || {}).length} schemas)`
        );

        mkdirSync(GENERATED_DIR, { recursive: true });
        runGenerator();
        cleanupGeneratedOutput();

        console.log(
            '[generate-reefin-sdk] Done. Review the diff under src/lib/reefin-sdk/ before committing.'
        );
    });
}

// Only generate when run as a script. `verify:reefin-sdk-fresh` imports the helpers above
// (`findServerRepo`, `readCanonicalSpecFromGit`, `fixSchema`, `unwrapIdSchemas`) so that its
// drift comparison applies the *exact same* spec transforms this generator does - a second copy
// of `fixSchema`/`unwrapIdSchemas` living in the gate would be free to drift out of sync and
// would then report phantom differences (or, worse, mask real ones).
if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch((err) => {
        console.error(`[generate-reefin-sdk] ${err.message}`);
        process.exitCode = 1;
    });
}

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
 *   2. Local `reefin` server checkout, sibling to this repo (../reefin), looking for the
 *      integration test artifact that `OpenApiSpecTests.GetSpec_ReturnsCorrectResponse` writes out
 *      (Debug preferred over Release when both exist - freshness over build config).
 *   3. A running dev server at $REEFIN_DEV_SERVER_URL (default http://localhost:8096) -
 *      GET /api-docs/openapi.json.
 *   4. The last spec committed at src/lib/reefin-sdk/spec/openapi.json (regenerate-with-no-source
 *      fallback - keeps `npm run generate:reefin-sdk` runnable offline against the last known
 *      contract, e.g. to re-apply a template/config change without a server around).
 *
 * Every resolved spec is copied to src/lib/reefin-sdk/spec/openapi.json and pinned in
 * src/lib/reefin-sdk/spec/version.json before generation, so the diff of a regeneration always
 * shows *both* the contract change and the generated-code change together in code review.
 */

import { execFileSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SDK_DIR = join(REPO_ROOT, 'src', 'lib', 'reefin-sdk');
const SPEC_DIR = join(SDK_DIR, 'spec');
const PINNED_SPEC_PATH = join(SPEC_DIR, 'openapi.json');
const PINNED_VERSION_PATH = join(SPEC_DIR, 'version.json');
const GENERATED_DIR = join(SDK_DIR, 'generated');

const SIBLING_REEFIN_ARTIFACTS = [
    '../reefin/tests/Reefin.Server.Integration.Tests/bin/Debug/net10.0/openapi.json',
    '../reefin/tests/Reefin.Server.Integration.Tests/bin/Release/net10.0/openapi.json'
];

const DEV_SERVER_URL =
    process.env.REEFIN_DEV_SERVER_URL || 'http://localhost:8096';

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

    for (const relative of SIBLING_REEFIN_ARTIFACTS) {
        const path = resolve(REPO_ROOT, relative);
        if (existsSync(path)) {
            console.log(
                `[generate-reefin-sdk] Using local reefin build artifact: ${path}`
            );
            return { text: readFileSync(path, 'utf-8'), source: path };
        }
    }

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
function fixSchema(node) {
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
function unwrapIdSchemas(spec) {
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

function main() {
    return resolveSpec().then(({ text, source }) => {
        const spec = JSON.parse(text);
        fixSchema(spec);
        unwrapIdSchemas(spec);
        const info = spec.info || {};

        mkdirSync(SPEC_DIR, { recursive: true });
        writeFileSync(
            PINNED_SPEC_PATH,
            JSON.stringify(spec, null, 2) + '\n',
            'utf-8'
        );
        writeFileSync(
            PINNED_VERSION_PATH,
            JSON.stringify(
                {
                    title: info.title ?? null,
                    version: info.version ?? null,
                    xReefinVersion: info['x-reefin-version'] ?? null,
                    openapi: spec.openapi ?? null,
                    pathCount: Object.keys(spec.paths || {}).length,
                    schemaCount: Object.keys(
                        (spec.components || {}).schemas || {}
                    ).length,
                    source,
                    generatedAt: new Date().toISOString()
                },
                null,
                2
            ) + '\n',
            'utf-8'
        );

        console.log(
            `[generate-reefin-sdk] Pinned spec: ${info.title} ${info.version} ` +
                `(${Object.keys(spec.paths || {}).length} paths, ` +
                `${Object.keys((spec.components || {}).schemas || {}).length} schemas)`
        );

        mkdirSync(GENERATED_DIR, { recursive: true });

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

        console.log(
            '[generate-reefin-sdk] Done. Review the diff under src/lib/reefin-sdk/ before committing.'
        );
    });
}

main().catch((err) => {
    console.error(`[generate-reefin-sdk] ${err.message}`);
    process.exitCode = 1;
});

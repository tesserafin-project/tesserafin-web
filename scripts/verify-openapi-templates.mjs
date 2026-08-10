#!/usr/bin/env node
/**
 * Vendored-template drift gate (#226).
 *
 * `scripts/generate-tesserafin-sdk.mjs` passes `--template-dir` to openapi-generator so that one
 * template — `typescript-axios/apiInner.mustache` — can be corrected. openapi-generator resolves
 * each template from that directory first and falls back to its own built-in copy for every file
 * absent there, which keeps the override small but creates a new hazard: the vendored copy is a
 * FORK. As the pinned generator version moves, upstream fixes to that template would be silently
 * discarded, and nothing in an ordinary regeneration would say so.
 *
 * This gate removes that hazard. It extracts the built-in template out of the pinned generator
 * jar and requires the vendored copy to differ by EXACTLY the intended hunk — no more, no fewer,
 * no other line. A generator bump that changes this template fails here, loudly, with the
 * upstream diff to re-apply, instead of quietly reverting to upstream behaviour or quietly
 * dropping an upstream fix.
 *
 * Exit codes: 0 the override is exactly as declared, 1 it is not.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TEMPLATE_DIR = join(__dirname, 'openapi-templates', 'typescript-axios');

/**
 * The complete, declared difference between upstream and the vendored copy.
 *
 * `from` is the upstream line; `to` is what this repository emits instead. Every other line of
 * the template must be byte-identical to upstream. Expressed as data rather than as a diff file
 * so the intent is readable, and so an accidental second edit cannot hide inside diff context.
 */
const DECLARED_OVERRIDES = [
    {
        file: 'apiInner.mustache',
        reason:
            'OpenAPI `style: deepObject`, `explode: true` specifies `?name[key]=value`. The ' +
            'upstream template drops the parameter name and emits `?key=value`, which is not ' +
            'what the contract describes. See issue #226.',
        from: '                    localVarQueryParameter[key] = value;',
        to: '                    localVarQueryParameter[`{{baseName}}[${key}]`] = value;'
    }
];

function fail(message) {
    console.error(`[verify-openapi-templates] ${message}`);
    process.exit(1);
}

/** The generator version this repository pins, read from the single source that drives generation. */
function pinnedGeneratorVersion() {
    const configPath = join(REPO_ROOT, 'openapitools.json');
    if (!existsSync(configPath)) {
        fail(
            'openapitools.json is missing; cannot determine the pinned generator version.'
        );
    }
    const version = JSON.parse(readFileSync(configPath, 'utf-8'))?.[
        'generator-cli'
    ]?.version;
    if (!version) {
        fail('openapitools.json records no `generator-cli.version`.');
    }
    return version;
}

/** The generator jar for that exact version. Never a different one. */
function generatorJar(version) {
    const versionsDir = join(
        REPO_ROOT,
        'node_modules',
        '@openapitools',
        'openapi-generator-cli',
        'versions'
    );
    const jar = join(versionsDir, `${version}.jar`);
    if (existsSync(jar)) {
        return jar;
    }
    const available = existsSync(versionsDir)
        ? readdirSync(versionsDir).join(', ') || '(none)'
        : '(no versions directory)';
    fail(
        `the pinned generator jar ${version}.jar is not present under node_modules ` +
            `(found: ${available}). Run \`npm run generate:tesserafin-sdk\` once, or \`npm ci\`, ` +
            'so the generator is downloaded, then re-run this gate.'
    );
}

/** The built-in template, read straight out of the jar rather than from any cached copy. */
function upstreamTemplate(jar, file) {
    try {
        return execFileSync('unzip', ['-p', jar, `typescript-axios/${file}`], {
            encoding: 'utf-8',
            maxBuffer: 64 * 1024 * 1024
        });
    } catch (err) {
        fail(
            `cannot read typescript-axios/${file} out of ${jar}: ${err.message}`
        );
    }
}

const version = pinnedGeneratorVersion();
const jar = generatorJar(version);
console.log(`[verify-openapi-templates] generator ${version}`);
console.log(`[verify-openapi-templates] jar ${jar}`);

const vendored = readdirSync(TEMPLATE_DIR).filter((f) =>
    f.endsWith('.mustache')
);
const declaredFiles = DECLARED_OVERRIDES.map((o) => o.file);

// Every vendored template must be declared. A new template appearing in the override directory
// silently changes generated output, so it is a failure until it is written down here.
for (const file of vendored) {
    if (!declaredFiles.includes(file)) {
        fail(
            `${file} is vendored under scripts/openapi-templates/typescript-axios/ but is not ` +
                'declared in DECLARED_OVERRIDES. Every override must state what it changes and why.'
        );
    }
}
for (const file of declaredFiles) {
    if (!vendored.includes(file)) {
        fail(
            `${file} is declared as an override but is not present in ${TEMPLATE_DIR}.`
        );
    }
}

let failures = 0;

for (const override of DECLARED_OVERRIDES) {
    const upstream = upstreamTemplate(jar, override.file).split('\n');
    const local = readFileSync(
        join(TEMPLATE_DIR, override.file),
        'utf-8'
    ).split('\n');

    if (upstream.length !== local.length) {
        console.error(
            `[verify-openapi-templates] ${override.file}: the vendored copy has ${local.length} ` +
                `line(s) but the generator's own template has ${upstream.length}. The override ` +
                'must change lines in place, never add or remove them.'
        );
        failures += 1;
        continue;
    }

    const differing = [];
    for (let i = 0; i < upstream.length; i += 1) {
        if (upstream[i] !== local[i]) {
            differing.push(i);
        }
    }

    const upstreamHits = upstream.filter(
        (line) => line === override.from
    ).length;
    if (upstreamHits !== 1) {
        console.error(
            `[verify-openapi-templates] ${override.file}: expected exactly one upstream line ` +
                `\`${override.from.trim()}\`, found ${upstreamHits}. The generator changed this ` +
                'template; re-derive the override against the new upstream text.'
        );
        failures += 1;
        continue;
    }

    if (differing.length !== 1) {
        console.error(
            `[verify-openapi-templates] ${override.file}: expected exactly 1 changed line, found ` +
                `${differing.length}${differing.length ? ` (lines ${differing.map((i) => i + 1).join(', ')})` : ''}.`
        );
        for (const i of differing) {
            console.error(`    upstream ${i + 1}: ${upstream[i]}`);
            console.error(`    vendored ${i + 1}: ${local[i]}`);
        }
        failures += 1;
        continue;
    }

    const index = differing[0];
    if (upstream[index] !== override.from || local[index] !== override.to) {
        console.error(
            `[verify-openapi-templates] ${override.file}: the changed line is not the declared one.`
        );
        console.error(`    expected upstream: ${override.from}`);
        console.error(`    actual   upstream: ${upstream[index]}`);
        console.error(`    expected vendored: ${override.to}`);
        console.error(`    actual   vendored: ${local[index]}`);
        failures += 1;
        continue;
    }

    console.log(
        `[verify-openapi-templates] ${override.file}: exactly one declared override at line ${index + 1}. OK`
    );
    console.log(`    reason: ${override.reason}`);
}

if (failures > 0) {
    console.error(
        `[verify-openapi-templates] ${failures} template override(s) are not exactly as declared.`
    );
    process.exit(1);
}

console.log(
    '[verify-openapi-templates] every template override is exactly as declared.'
);

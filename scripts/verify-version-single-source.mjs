/**
 * Proves there is exactly ONE authoritative Tesserafin Web product version.
 *
 * `package.json#version` is that authority. Everything else either derives from it at build time
 * or is a committed copy that has to agree with it. This gate exists because the copies are the
 * dangerous part: a stale `docker-bake.hcl` default or a stale lockfile version does not fail any
 * build — it silently labels an image with a version the product no longer has.
 *
 * What is checked
 *   1. the authority is a SemVer *core* (MAJOR.MINOR.PATCH) — a product version, never a
 *      pre-release or build-metadata string;
 *   2. `package-lock.json` agrees, at both the root and the `packages[""]` entry;
 *   3. the `VERSION` fallback default in `docker-bake.hcl` agrees;
 *   4. the generated SDK provenance (`src/lib/tesserafin-sdk/spec/version.json#webAppVersion`)
 *      agrees;
 *   5. `docker/build-assets.sh` still DERIVES the version from `package.json` rather than
 *      carrying a literal of its own — this is what keeps the asset-image tags anchored to the
 *      authority.
 *
 * Why a shape check and not a `=== '1.0.0'` check: pinning the expected number here would create a
 * second authority, which is the exact failure mode the gate is meant to prevent.
 *
 * See tesserafin-project/tesserafin docs/versioning-policy.md for the epoch this anchors.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = '[verify:version-single-source]';

const failures = [];
const check = (label, actual, expected) => {
    if (actual === expected) {
        console.log(`${TAG} OK   ${label} = ${actual}`);
    } else {
        failures.push(
            `${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
        );
        console.log(
            `${TAG} FAIL ${label} = ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`
        );
    }
};

const readJson = (relativePath) =>
    JSON.parse(readFileSync(join(REPO_ROOT, relativePath), 'utf-8'));
const readText = (relativePath) =>
    readFileSync(join(REPO_ROOT, relativePath), 'utf-8');

// 1. the authority
const pkg = readJson('package.json');
const VERSION = pkg.version;
const SEMVER_CORE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (typeof VERSION !== 'string' || !SEMVER_CORE.test(VERSION)) {
    console.error(
        `${TAG} FAIL package.json#version is ${JSON.stringify(VERSION)}, which is not a ` +
            'MAJOR.MINOR.PATCH SemVer core'
    );
    process.exit(1);
}
console.log(`${TAG} authoritative product version: ${VERSION}  (package.json)`);

// 2. the lockfile, both places npm records it
const lock = readJson('package-lock.json');
check('package-lock.json#version', lock.version, VERSION);
check(
    'package-lock.json#packages[""].version',
    lock.packages?.['']?.version,
    VERSION
);

// 3. the bake fallback default. docker/build-assets.sh always passes VERSION explicitly, so a
//    stale default here never fails a build — it just produces a wrongly labelled image whenever
//    bake is invoked directly.
const bake = readText('docker-bake.hcl');
const bakeVersion = bake.match(
    /variable\s+"VERSION"\s*\{\s*default\s*=\s*"([^"]*)"/
)?.[1];
check('docker-bake.hcl variable "VERSION" default', bakeVersion, VERSION);

// 4. the committed SDK provenance copy
const sdkVersion = readJson('src/lib/tesserafin-sdk/spec/version.json');
check(
    'src/lib/tesserafin-sdk/spec/version.json#webAppVersion',
    sdkVersion.webAppVersion,
    VERSION
);

// 5. the asset-image tags must still be DERIVED, not declared
const buildAssets = readText('docker/build-assets.sh');
if (
    /VERSION="\$\(node -p "require\('\.\/package\.json'\)\.version"\)"/.test(
        buildAssets
    )
) {
    console.log(
        `${TAG} OK   docker/build-assets.sh derives VERSION from package.json`
    );
} else {
    failures.push(
        'docker/build-assets.sh no longer derives VERSION from package.json'
    );
    console.log(
        `${TAG} FAIL docker/build-assets.sh no longer derives VERSION from package.json`
    );
}
const literal = buildAssets.match(/^\s*VERSION=(?!"\$\()(.*)$/m);
if (literal) {
    failures.push(
        `docker/build-assets.sh declares a literal VERSION: ${literal[0].trim()}`
    );
    console.log(
        `${TAG} FAIL docker/build-assets.sh declares a literal VERSION: ${literal[0].trim()}`
    );
} else {
    console.log(
        `${TAG} OK   docker/build-assets.sh declares no literal VERSION of its own`
    );
}

if (failures.length > 0) {
    console.error(
        `\n${TAG} ${failures.length} surface(s) disagree with package.json#version=${VERSION}:`
    );
    for (const f of failures) {
        console.error(`  - ${f}`);
    }
    console.error(
        '\nThere must be exactly one authoritative product version. Update the disagreeing ' +
            'surface, or — if it is generated — regenerate it.'
    );
    process.exit(1);
}

console.log(
    `\n${TAG} PASS — one authoritative product version (${VERSION}), all copies agree.`
);

#!/usr/bin/env node
/*
 * #153-A1-R2 — no unconditional credential import may escape the start-up tier.
 *
 * WHY A SECOND GATE, WHEN THE DELIVERY BUDGET ALREADY HAS A BOUNDARY RULE
 *
 *   `webpack.delivery-budget.json` carries a `playback-credentials` entry in
 *   `protectedModulePatterns`, and `scripts/verify-delivery-budget.mjs` fails if a module matching
 *   it appears in a counted chunk. That is the MEASURED half, and it is worth having — but it reads
 *   webpack's per-chunk module list, and webpack's module concatenation can fold a module into a
 *   `ConcatenatedModule` whose members are not listed individually. A boundary that can be crossed
 *   without appearing in the list it is checked against is a boundary that reports PASS forever.
 *
 *   So the same property is asserted here at SOURCE level, where concatenation cannot reach: the
 *   broker, its installer and its identity helpers may be reached by a STATIC import only from
 *   inside `src/lib/playbackCredentials/`. Everywhere else must go through `brokerFor()`, whose
 *   `import()` is issued from `broker.ts` and is not requested until playback begins.
 *
 * WHY `bootModules` IS CHECKED HERE TOO
 *
 *   `bootModules` describes reality: an anchor is declared because that module really does issue an
 *   `import()` at start-up. #153-A1-R2 removed `./lib/playbackCredentials/boot.ts` from the list
 *   because the module itself is gone. This gate fails if a boot module ever reaches the credential
 *   runtime again — either by naming one of these modules directly, or by issuing an `import()` for
 *   it — because that is precisely the arrangement whose bytes belong in the start-up tier and
 *   whose absence from it would be a lie.
 *
 * WHAT COUNTS AS A STATIC IMPORT
 *
 *   `import x from '…'` and `export … from '…'`. NOT `import type` and NOT `import()`:
 *
 *     * a type-only import is erased by the compiler and delivers no bytes — `broker.ts` uses one
 *       deliberately so it can name `PlaybackCredentialBroker` in a signature for free;
 *     * `import()` is the mechanism this boundary exists to require.
 *
 * USAGE
 *
 *   node ci/verify-credential-startup-boundary.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = '[verify:credential-startup-boundary]';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(REPO_ROOT, 'src');

/** The modules that must not be reachable without an `import()`. */
const PROTECTED = ['PlaybackCredentialBroker', 'install', 'identity'];

/** The one directory allowed to import them statically. */
const OWNER_DIR = join('src', 'lib', 'playbackCredentials');

/** The module that is allowed to issue the `import()`. */
const LAZY_OWNER = join(OWNER_DIR, 'broker.ts');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const failures = [];
const fail = (message) => failures.push(message);

function collect(dir, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            collect(path, found);
            continue;
        }
        const dot = entry.name.lastIndexOf('.');
        if (dot > 0 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))) {
            found.push(path);
        }
    }
    return found;
}

if (!statSync(SRC, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(
        `${TAG} FAIL:\n  - ${SRC} is not a directory; nothing was scanned.`
    );
    process.exit(1);
}

const files = collect(SRC);
if (files.length === 0) {
    console.error(
        `${TAG} FAIL:\n  - no source files were found under src/. Refusing to report a boundary ` +
            'as clean when the tree it protects was never read.'
    );
    process.exit(1);
}

/**
 * A specifier that resolves to one of the protected modules, whatever route it took.
 *
 * Both spellings are in use in this tree: bare `lib/playbackCredentials/x` (webpack `resolve.modules`
 * includes `src`) and relative `./x` from inside the package.
 */
const PROTECTED_SPECIFIER = new RegExp(
    `(?:^|/)(?:lib/playbackCredentials/)?(${PROTECTED.join('|')})$`
);

// `import … from 'x'` / `export … from 'x'`, capturing the `type` modifier so it can be excluded.
const STATIC_IMPORT =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

let staticOwnerImports = 0;
let lazySites = 0;

for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    // Tests may import whatever they need: they are never delivered.
    if (/\.(test|spec)\.[jt]sx?$/.test(rel)) continue;
    const source = readFileSync(file, 'utf8');
    const insideOwner = rel.startsWith(`${OWNER_DIR}${sep}`);

    for (const match of source.matchAll(STATIC_IMPORT)) {
        const [, typeOnly, specifier] = match;
        if (!PROTECTED_SPECIFIER.test(specifier)) continue;
        // Erased at compile time; costs the graph nothing.
        if (typeOnly) continue;
        if (!insideOwner) {
            fail(
                `${rel} statically imports "${specifier}". The credential runtime must be reached ` +
                    `through brokerFor() in ${LAZY_OWNER}, or its bytes land in the start-up tier.`
            );
            continue;
        }
        staticOwnerImports += 1;
    }

    for (const match of source.matchAll(DYNAMIC_IMPORT)) {
        const specifier = match[1];
        if (!PROTECTED_SPECIFIER.test(specifier)) continue;
        if (rel !== LAZY_OWNER) {
            fail(
                `${rel} issues import("${specifier}"). Exactly one module may lazily reach the ` +
                    `credential runtime (${LAZY_OWNER}); a second import site is a second chunk edge ` +
                    'and a second thing to keep out of start-up.'
            );
            continue;
        }
        lazySites += 1;
    }
}

if (lazySites === 0) {
    fail(
        `${LAZY_OWNER} no longer issues an import() for the credential runtime. Either the runtime ` +
            'is reached some other way — which this gate has not seen — or brokerFor() is dead.'
    );
}

// ---------------------------------------------------------------- bootModules must not reach it
const budget = JSON.parse(
    readFileSync(join(REPO_ROOT, 'webpack.delivery-budget.json'), 'utf8')
);
for (const bootModule of budget.bootModules) {
    if (PROTECTED_SPECIFIER.test(bootModule.replace(/\.[jt]sx?$/, ''))) {
        fail(
            `webpack.delivery-budget.json declares "${bootModule}" as a boot module and it is part ` +
                'of the credential runtime. A boot module that reaches the broker puts its bytes in ' +
                'the start-up tier; that is the arrangement #153-A1-R2 removed.'
        );
    }
    const path = join(SRC, bootModule.replace(/^\.\//, ''));
    let source;
    try {
        source = readFileSync(path, 'utf8');
    } catch {
        fail(
            `webpack.delivery-budget.json declares boot module "${bootModule}" but ${relative(REPO_ROOT, path)} ` +
                'could not be read. A boot module that does not exist anchors nothing.'
        );
        continue;
    }
    for (const match of [
        ...source.matchAll(STATIC_IMPORT),
        ...source.matchAll(DYNAMIC_IMPORT)
    ]) {
        const specifier = match[2] ?? match[1];
        if (PROTECTED_SPECIFIER.test(specifier)) {
            fail(
                `boot module "${bootModule}" reaches "${specifier}". Its chunk would be counted in ` +
                    'the start-up tier; route it through brokerFor() instead.'
            );
        }
    }
}

// ---------------------------------------------------------------- the measured half must exist
const rule = budget.protectedModulePatterns?.find(
    (entry) => entry.id === 'playback-credentials'
);
if (!rule) {
    fail(
        'webpack.delivery-budget.json has no `playback-credentials` protectedModulePatterns rule. ' +
            'This gate is the source-level half of that boundary; without the measured half, a ' +
            'module reaching start-up by a route no import statement describes would go unseen.'
    );
} else {
    const regexp = new RegExp(rule.pattern);
    const unmatched = PROTECTED.filter(
        (name) => !regexp.test(`./lib/playbackCredentials/${name}`)
    );
    if (unmatched.length > 0) {
        fail(
            `the \`playback-credentials\` boundary pattern does not cover ${unmatched.join(', ')}. ` +
                'The two halves of this boundary must protect the same modules.'
        );
    }
}

if (failures.length > 0) {
    console.error(`${TAG} FAIL:`);
    for (const message of failures) console.error(`  - ${message}`);
    process.exit(1);
}

console.log(
    `${TAG} PASS: ${PROTECTED.length} credential module(s) are statically imported only inside ` +
        `${OWNER_DIR} (${staticOwnerImports} site(s)), reached lazily from ${LAZY_OWNER} only ` +
        `(${lazySites} site(s)), and named by no boot module.`
);

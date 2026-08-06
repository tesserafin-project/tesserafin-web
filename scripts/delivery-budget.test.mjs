#!/usr/bin/env node
/**
 * Deterministic controls for the aggregate delivery budget
 * (scripts/verify-delivery-budget.mjs, webpack.delivery-budget.json).
 *
 * A budget gate is only worth having if it is known to FAIL. Every case below takes the committed
 * fixture in scripts/fixtures/delivery-budget/ - which passes, and is small enough that the
 * expected verdict is obvious from reading it - mutates exactly one thing in a temporary copy,
 * and asserts the verifier's own exit status. This suite passing means the verifier refused; it
 * never means the verifier was not consulted.
 *
 * The mutations are the ways the gate could realistically be defeated or fooled:
 *   - a ceiling lowered below the measurement (raw, gzip, brotli, asset count);
 *   - protected authoring code appearing in a counted chunk;
 *   - an asset referenced twice being counted twice;
 *   - the stats file or the expected entrypoint going missing;
 *   - an asset classified as async while index.html loads it;
 *   - an unknown asset type slipping into the counted set unmeasured;
 *   - stats and dist disagreeing about a size (a stale measurement).
 *
 * No fixture is mutated in place: every case runs against a fresh temporary copy, so the
 * committed fixture stays green.
 *
 * Usage:
 *   node scripts/delivery-budget.test.mjs
 */
import { spawnSync } from 'node:child_process';
import {
    cpSync,
    mkdtempSync,
    rmSync,
    unlinkSync,
    writeFileSync
} from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERIFIER = join(REPO_ROOT, 'scripts', 'verify-delivery-budget.mjs');
const FIXTURE = join(REPO_ROOT, 'scripts', 'fixtures', 'delivery-budget');

const WORK = mkdtempSync(
    join(tmpdir(), 'tesserafin-delivery-budget-controls-')
);
process.on('exit', () => rmSync(WORK, { recursive: true, force: true }));

let passed = 0;
let failed = 0;

const ok = (message) => {
    console.log(`  PASS: ${message}`);
    passed += 1;
};
const bad = (message, detail) => {
    console.error(`  FAIL: ${message}`);
    if (detail) console.error(detail.replace(/^/gm, '        '));
    failed += 1;
};

let caseCounter = 0;

/** Fresh copy of the whole fixture, so one case can never leak into the next. */
function stage(name) {
    caseCounter += 1;
    const dir = join(WORK, `${caseCounter}-${name}`);
    cpSync(FIXTURE, dir, { recursive: true });
    return {
        dir,
        stats: join(dir, 'stats.json'),
        budget: join(dir, 'budget.json'),
        mainBudget: join(dir, 'main-budget.json'),
        // Named `emitted/`, not `dist/`: the repository's .gitignore excludes `dist` at any
        // depth, and a committed fixture that git refuses to track is not a fixture.
        dist: join(dir, 'emitted')
    };
}

function editJson(path, mutate) {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    mutate(value);
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

function verify(paths, extraArgs = []) {
    const result = spawnSync(
        process.execPath,
        [
            VERIFIER,
            '--budget',
            paths.budget,
            '--main-budget',
            paths.mainBudget,
            '--stats',
            paths.stats,
            '--dist',
            paths.dist,
            ...extraArgs
        ],
        { encoding: 'utf8' }
    );
    return {
        status: result.status,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`
    };
}

/**
 * @param {string} label What the mutation is.
 * @param {(paths: object) => void} mutate Applies it to a staged copy.
 * @param {string} expect Substring the failure message must contain, so a case cannot pass by
 *   failing for an unrelated reason.
 */
function expectRefusal(label, mutate, expect) {
    const paths = stage(label.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    mutate(paths);
    const { status, output } = verify(paths);
    if (status === 0) {
        bad(`${label} - verifier exited 0, it should have refused`, output);
        return;
    }
    if (!output.includes(expect)) {
        bad(
            `${label} - refused, but not for the expected reason ("${expect}")`,
            output
        );
        return;
    }
    ok(`${label} - refused (exit ${status})`);
}

function expectPass(label, mutate, assertOutput) {
    const paths = stage(label.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    if (mutate) mutate(paths);
    const { status, output } = verify(paths);
    if (status !== 0) {
        bad(
            `${label} - verifier exited ${status}, it should have passed`,
            output
        );
        return;
    }
    if (assertOutput) {
        const problem = assertOutput(output);
        if (problem) {
            bad(`${label} - passed, but ${problem}`, output);
            return;
        }
    }
    ok(`${label} - passed`);
}

console.log('\n[test:delivery-budget] GREEN - the unchanged fixture');

expectPass('unchanged fixture is within every ceiling', null, (output) =>
    output.includes('PASS.') ? null : 'no PASS verdict was printed'
);

// Break 4 in the loop's matrix. runtime.bundle.js already belongs to two injected entrypoints;
// naming it twice in index.html is the sharper version of the same trap. The measured totals must
// not move, which is what the exact-measurement fixture ceilings prove.
expectPass(
    'an asset referenced several times is counted once',
    (paths) => {
        editJson(paths.stats, (stats) => {
            stats.htmlInjected.js.push('runtime.bundle.js');
        });
    },
    (output) =>
        output.includes('assets                            4')
            ? null
            : 'the asset count moved'
);

console.log('\n[test:delivery-budget] RED - byte and count ceilings');

expectRefusal(
    'aggregate initial raw ceiling below the baseline',
    (paths) =>
        editJson(paths.budget, (budget) => {
            budget.budgets.initial.rawBytes -= 1;
        }),
    'initial.rawBytes'
);

expectRefusal(
    'aggregate initial gzip ceiling below the baseline',
    (paths) =>
        editJson(paths.budget, (budget) => {
            budget.budgets.initial.gzipBytes -= 1;
        }),
    'initial.gzipBytes'
);

expectRefusal(
    'aggregate initial brotli ceiling below the baseline',
    (paths) =>
        editJson(paths.budget, (budget) => {
            budget.budgets.initial.brotliBytes -= 1;
        }),
    'initial.brotliBytes'
);

expectRefusal(
    'start-up tier raw ceiling below the baseline',
    (paths) =>
        editJson(paths.budget, (budget) => {
            budget.budgets.startup.rawBytes -= 1;
        }),
    'startup.rawBytes'
);

// Break 7: one more asset, but a one-byte one, so every byte ceiling still holds. Only the count
// catches it - which is why the count is budgeted at all.
expectRefusal(
    'one extra initial asset, under every byte ceiling',
    (paths) => {
        writeFileSync(join(paths.dist, 'extra.bundle.js'), '\n');
        editJson(paths.stats, (stats) => {
            stats.htmlInjected.js.push('extra.bundle.js');
            stats.assets['extra.bundle.js'] = 1;
            stats.chunks.push({
                id: 'extra',
                names: ['extra'],
                initial: true,
                files: ['extra.bundle.js'],
                modules: []
            });
            stats.entrypoints['main.tesserafin'].chunkIds.push('extra');
            stats.entrypoints['main.tesserafin'].files.push('extra.bundle.js');
        });
        editJson(paths.budget, (budget) => {
            // Generous byte room, so the ONLY thing that can refuse is the count.
            budget.budgets.initial.rawBytes += 4096;
            budget.budgets.initial.rawJsBytes += 4096;
            budget.budgets.initial.gzipBytes += 4096;
            budget.budgets.initial.brotliBytes += 4096;
            budget.budgets.startup.rawBytes += 4096;
            budget.budgets.startup.gzipBytes += 4096;
            budget.budgets.startup.brotliBytes += 4096;
        });
    },
    'initial.assetCount'
);

console.log('\n[test:delivery-budget] RED - progressive-delivery boundaries');

// Break 3: the async-only Theme Studio module lands in the initial entrypoint chunk.
expectRefusal(
    'a Theme Studio module forced into the initial entrypoint',
    (paths) =>
        editJson(paths.stats, (stats) => {
            stats.chunks
                .find((chunk) => chunk.id === 'main')
                .modules.push(
                    './apps/modern/features/themeStudio/components/ThemeStudio.tsx'
                );
        }),
    'boundary "theme-studio"'
);

// Same defect one tier out: a boot-time `import()` is not a hiding place either.
expectRefusal(
    'a Theme Studio module hidden in a boot-time import() chunk',
    (paths) =>
        editJson(paths.stats, (stats) => {
            stats.chunks
                .find((chunk) => chunk.id === 'boot')
                .modules.push(
                    './apps/modern/routes/user/themeStudio/index.tsx'
                );
        }),
    'boundary "theme-studio"'
);

// A boundary can only be reported clean if it was actually inspected. (Mutating the service
// worker chunk rather than the main one keeps `./index.jsx` in the initial graph, so this case
// exercises the module-list check and not the boot-anchor check below it.)
expectRefusal(
    'a counted chunk whose module list was never recorded',
    (paths) =>
        editJson(paths.stats, (stats) => {
            delete stats.chunks.find((chunk) => chunk.id === 'sw').modules;
        }),
    'module list'
);

console.log(
    '\n[test:delivery-budget] RED - fail-closed on bad or missing input'
);

// Break 5, first half: the stats input is gone.
expectRefusal(
    'the delivery stats file is missing',
    (paths) => unlinkSync(paths.stats),
    'not found'
);

// Break 5, second half: the expected entrypoint is gone.
expectRefusal(
    'the expected entrypoint is missing from the build',
    (paths) =>
        editJson(paths.stats, (stats) => {
            delete stats.entrypoints['main.tesserafin'];
        }),
    'is missing from the build'
);

// Break 6: an asset index.html loads, declared async. (Again the service worker chunk, so the
// boot anchor stays intact and the classification check is the one under test.)
expectRefusal(
    'an initial asset reclassified as async',
    (paths) =>
        editJson(paths.stats, (stats) => {
            stats.chunks.find((chunk) => chunk.id === 'sw').initial = false;
        }),
    'inconsistent classification'
);

expectRefusal(
    'the same asset emitted by two chunks',
    (paths) =>
        editJson(paths.stats, (stats) => {
            stats.chunks
                .find((chunk) => chunk.id === 'runtime')
                .files.push('main.css');
        }),
    'ambiguous classification'
);

expectRefusal(
    'an unknown asset type inside the counted set',
    (paths) => {
        writeFileSync(join(paths.dist, 'boot.woff2'), 'x');
        editJson(paths.stats, (stats) => {
            stats.assets['boot.woff2'] = 1;
            stats.chunks
                .find((chunk) => chunk.id === 'boot')
                .files.push('boot.woff2');
            stats.chunkGroups
                .find((group) => group.chunkIds.includes('boot'))
                .files.push('boot.woff2');
        });
    },
    'not one this budget knows how to count'
);

expectRefusal(
    'index.html and the declared entrypoints disagree',
    (paths) =>
        editJson(paths.budget, (budget) => {
            budget.htmlEntrypoints = ['main.tesserafin'];
        }),
    'disagree about the initial delivery set'
);

expectRefusal(
    'stale stats - a recorded size that no longer matches dist',
    (paths) =>
        editJson(paths.stats, (stats) => {
            stats.assets['main.css'] += 1;
        }),
    'the stats file is stale'
);

expectRefusal(
    'an emitted asset missing from dist',
    (paths) => unlinkSync(join(paths.dist, 'main.css')),
    'could not be read from'
);

expectRefusal(
    'a declared boot module that is no longer in the initial graph',
    (paths) =>
        editJson(paths.budget, (budget) => {
            budget.bootModules = ['./renamed-entry.jsx'];
        }),
    'not in the initial graph'
);

expectRefusal(
    'a stats schema version the budget was not written against',
    (paths) =>
        editJson(paths.stats, (stats) => {
            stats.schemaVersion = 99;
        }),
    'schema version'
);

console.log(`\n[test:delivery-budget] ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);

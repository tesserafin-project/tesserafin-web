#!/usr/bin/env node
/**
 * Aggregate Web delivery budget - the gate that `verify:bundle-budget` is NOT.
 *
 * FOUR DIFFERENT QUESTIONS, FOUR DIFFERENT NUMBERS
 * ------------------------------------------------
 *   1. Individual bundle size  - "how big is main.tesserafin.bundle.js?"
 *      Owned by webpack.performance-budget.json + scripts/verify-bundle-budget.mjs. Still in
 *      force, unchanged, and still useful: it is the one number webpack itself enforces during
 *      `build:production`, so it cannot be skipped by forgetting to run a script.
 *   2. Total initial delivery  - "how many bytes does a cold visitor download before the app can
 *      start?" That is THIS file. It is not question 1: `splitChunks` fans the entrypoint out
 *      across two dozen assets, of which main.tesserafin.bundle.js is under a fifth, and
 *      webpack.prod.js deliberately disables the entrypoint-sum hint (`maxEntrypointSize:
 *      Number.MAX_SAFE_INTEGER`) so the other four fifths were unmeasured.
 *   3. Async route/feature weight - "what does opening Theme Studio cost?" Not budgeted by bytes
 *      here; governed by the progressive-delivery boundaries below, which assert that such code
 *      stays OUT of questions 1 and 2.
 *   4. Runtime performance - LCP, INP, playback-start latency. NOT measured here and not
 *      substitutable by any byte count. Bytes are an input to those metrics, not a proxy for
 *      them: this file can be green while the app feels slow, and a real regression in perceived
 *      performance must be caught by browser measurement, not by this gate.
 *
 * WHAT IS COUNTED
 * ---------------
 *   initial  - every script and stylesheet html-webpack-plugin injected into index.html, each
 *              emitted asset counted exactly once even when several entrypoints reference it
 *              (runtime.bundle.js is shared by `main.tesserafin` and `serviceworker`).
 *   startup  - `initial`, plus the assets of every async chunk group whose `import()` was issued
 *              by a declared boot module (webpack.delivery-budget.json `bootModules`). This tier
 *              exists so the budget cannot be dodged: moving an unconditional start-up import
 *              behind `import()` moves bytes from `initial` to `startup` and the total is
 *              unchanged. It is deliberately CONSERVATIVE - mutually exclusive browser branches
 *              (iOS styles, TV fonts, default fonts) are all counted, because which branch a
 *              given visitor takes is not a build-time fact.
 *
 * Ceilings live in webpack.delivery-budget.json and are only ever read here, never written. There
 * is no `--update-baseline`: raising a ceiling is an explicit edit to a reviewed file, with a
 * before/after explanation in the pull request. A verifier that can bless its own regression is
 * not a gate.
 */
import { constants, brotliCompressSync, gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const TAG = '[verify:delivery-budget]';

class BudgetError extends Error {}

function fail(message) {
    throw new BudgetError(message);
}

function parseArgs(argv) {
    const args = {
        budget: join(REPO_ROOT, 'webpack.delivery-budget.json'),
        // The individual main-bundle budget is NOT redefined here: it is read from its own file
        // so there is still exactly one number, shared with webpack.prod.js's `performance` block
        // and scripts/verify-bundle-budget.mjs.
        mainBudget: join(REPO_ROOT, 'webpack.performance-budget.json'),
        stats: join(REPO_ROOT, 'delivery-stats', 'stats.json'),
        dist: join(REPO_ROOT, 'dist'),
        // The tree the protected-module rules are checked against for staleness.
        src: join(REPO_ROOT, 'src'),
        reportJson: null,
        // `--report-only` prints the table and the JSON report but never sets a non-zero exit
        // code. It is the "what do we measure today" command, not a gate, and CI never uses it.
        reportOnly: false
    };
    const pending = [...argv];
    const nextValue = (flag) => {
        const value = pending.shift();
        if (value === undefined) fail(`${flag} needs a value`);
        return resolve(value);
    };
    while (pending.length > 0) {
        const arg = pending.shift();
        if (arg === '--report-only') {
            args.reportOnly = true;
        } else if (arg === '--budget') {
            args.budget = nextValue(arg);
        } else if (arg === '--main-budget') {
            args.mainBudget = nextValue(arg);
        } else if (arg === '--stats') {
            args.stats = nextValue(arg);
        } else if (arg === '--dist') {
            args.dist = nextValue(arg);
        } else if (arg === '--src') {
            args.src = nextValue(arg);
        } else if (arg === '--report-json') {
            args.reportJson = nextValue(arg);
        } else {
            fail(`unknown argument: ${arg}`);
        }
    }
    return args;
}

/**
 * One read, no `existsSync` guard in front of it.
 *
 * Checking for a file and then opening it is a check-then-use race (CodeQL js/file-system-race):
 * the answer can change between the two calls, and the guard buys nothing except a second failure
 * path that the error handling does not cover. Attempting the read and turning a failed one into
 * the intended fail-closed message is both correct and shorter.
 */
function readOrFail(path, message) {
    try {
        return readFileSync(path);
    } catch (err) {
        fail(`${message} (${err.code ?? err.message})`);
    }
}

function readJson(path, what) {
    const contents = readOrFail(
        path,
        `${what} not found or unreadable at ${path}. Run \`npm run build:production\` first ` +
            '(it emits the delivery stats as a side effect - see webpack.prod.js)'
    );
    try {
        return JSON.parse(contents.toString('utf8'));
    } catch (err) {
        fail(`${what} at ${path} is not valid JSON: ${err.message}`);
    }
}

/**
 * Fixed, documented compression parameters. Both are Node built-ins - no compression dependency
 * is added, and nothing compressed here is written to `dist/`; these are measurements, not
 * distribution artifacts.
 *
 *   gzip   - level 9 (maximum), all other zlib defaults.
 *   brotli - quality 11 (maximum), default window and mode. BROTLI_PARAM_SIZE_HINT is
 *            deliberately NOT set: it changes the output size, and deriving it from the input
 *            length would make the number depend on a parameter nobody reviews.
 *
 * Each asset is compressed SEPARATELY and the sizes are summed. Concatenating the assets first
 * would produce a smaller, dishonest number: they are delivered as separate HTTP responses, each
 * with its own compression context.
 */
function compressedSizes(buffer) {
    return {
        gzip: gzipSync(buffer, { level: 9 }).length,
        brotli: brotliCompressSync(buffer, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
        }).length
    };
}

function extensionOf(name) {
    const index = name.lastIndexOf('.');
    return index === -1 ? '' : name.slice(index);
}

/** Ceiling rule, applied identically to every byte metric: round the measurement UP to the next
 * whole KiB (1024 B). Asset counts take no margin at all - the measured count IS the ceiling.
 * This is the smallest explicit margin that keeps an unchanged baseline green while absorbing the
 * few bytes that move when `__COMMIT_SHA__` / `__JF_BUILD_VERSION__` differ between a local build
 * and a CI build (see webpack.common.js and .github/workflows/__package.yml). */
function ceilToKiB(bytes) {
    return Math.ceil(bytes / 1024) * 1024;
}

function kib(bytes) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
}

function buildFileIndex(stats) {
    const fileToChunks = new Map();
    for (const chunk of stats.chunks) {
        for (const file of chunk.files) {
            if (!fileToChunks.has(file)) fileToChunks.set(file, []);
            fileToChunks.get(file).push(chunk);
        }
    }
    return fileToChunks;
}

function measureAssets(names, stats, distDir) {
    const assets = [];
    for (const name of names) {
        const declaredSize = stats.assets[name];
        if (typeof declaredSize !== 'number') {
            fail(
                `asset "${name}" is referenced by the delivery graph but absent from the ` +
                    'recorded asset table - the stats file is inconsistent with itself.'
            );
        }
        const path = join(distDir, name);
        // Read first, ask questions after. An `existsSync` guard before the read is a
        // check-then-use race (CodeQL js/file-system-race): between the two calls the file can
        // disappear, and the script would then throw an unhandled ENOENT instead of the
        // fail-closed message it promises. Reading once and measuring the buffer it returned also
        // removes the second race - the size compared against the stats file is the size of the
        // bytes actually compressed, not of a stat taken a moment earlier.
        const buffer = readOrFail(
            path,
            `asset "${name}" is in the initial delivery set but could not be read from ` +
                `${distDir}. Build output and delivery stats disagree; refusing to report a size.`
        );
        const onDisk = buffer.length;
        if (onDisk !== declaredSize) {
            fail(
                `asset "${name}" is ${onDisk} bytes on disk but recorded as ${declaredSize} ` +
                    'bytes in the delivery stats - the stats file is stale.'
            );
        }
        assets.push({
            name,
            extension: extensionOf(name),
            raw: onDisk,
            ...compressedSizes(buffer)
        });
    }
    return assets.sort((a, b) => b.raw - a.raw || a.name.localeCompare(b.name));
}

function totals(assets) {
    return assets.reduce(
        (acc, asset) => ({
            raw: acc.raw + asset.raw,
            gzip: acc.gzip + asset.gzip,
            brotli: acc.brotli + asset.brotli,
            count: acc.count + 1
        }),
        { raw: 0, gzip: 0, brotli: 0, count: 0 }
    );
}

function computeInitialSet(stats, budget) {
    if (!stats.htmlInjected) {
        fail(
            'the delivery stats record no html-webpack-plugin injection. The initial delivery ' +
                'set is defined as what index.html loads; without it there is nothing to verify.'
        );
    }
    const injected = [
        ...(stats.htmlInjected.js || []),
        ...(stats.htmlInjected.css || [])
    ];
    if (injected.length === 0) {
        fail(
            'index.html injects no scripts or stylesheets - refusing to report an empty set.'
        );
    }
    // Counted once each, even though `runtime.bundle.js` is a member of two entrypoints.
    const unique = [...new Set(injected)].sort();

    // Cross-check against the declared entrypoints. If someone adds a chunk to index.html, or
    // removes one, the two views stop agreeing and this fails rather than quietly re-baselining.
    const declared = new Set();
    for (const name of budget.htmlEntrypoints) {
        const entrypoint = stats.entrypoints[name];
        if (!entrypoint) {
            fail(
                `expected entrypoint "${name}" is missing from the build. Either the entrypoint ` +
                    'was renamed or the stats file is from a different configuration.'
            );
        }
        for (const file of entrypoint.files) declared.add(file);
    }
    const onlyInHtml = unique.filter((name) => !declared.has(name));
    const onlyInEntrypoints = [...declared]
        .filter((name) => !unique.includes(name))
        .sort();
    if (onlyInHtml.length || onlyInEntrypoints.length) {
        fail(
            'index.html and the declared entrypoints disagree about the initial delivery set.\n' +
                `  injected but not in webpack.delivery-budget.json htmlEntrypoints: ${
                    onlyInHtml.join(', ') || '(none)'
                }\n` +
                `  in those entrypoints but not injected: ${
                    onlyInEntrypoints.join(', ') || '(none)'
                }\n` +
                '  Update webpack.delivery-budget.json `htmlEntrypoints` deliberately, in review.'
        );
    }
    return unique;
}

/** The start-up tier is anchored on named modules, so the anchor itself has to be real. A
 * `bootModules` entry that no longer exists in the initial graph - renamed entry, moved file -
 * would silently reduce the tier to the initial set and take the anti-bypass property with it. */
function assertBootModulesPresent(stats, budget) {
    const initialModules = new Set();
    for (const chunk of stats.chunks) {
        if (!chunk.initial || !Array.isArray(chunk.modules)) continue;
        for (const module of chunk.modules) initialModules.add(module);
    }
    const missing = budget.bootModules.filter(
        (module) => !initialModules.has(module)
    );
    if (missing.length > 0) {
        fail(
            `declared boot module(s) ${missing.join(', ')} are not in the initial graph. The ` +
                'start-up tier is anchored on them; an anchor that no longer exists would make ' +
                'the tier silently equal to the initial set. Update ' +
                'webpack.delivery-budget.json `bootModules` deliberately.'
        );
    }
}

function computeStartupSet(stats, budget, initialSet) {
    const boot = new Set(budget.bootModules);
    const initial = new Set(initialSet);
    const extra = new Set();
    const edges = [];
    for (const group of stats.chunkGroups) {
        if (group.isEntrypoint) continue;
        const matched = group.origins.filter((origin) =>
            boot.has(origin.module)
        );
        if (matched.length === 0) continue;
        const own = group.files.filter((file) => !initial.has(file));
        for (const file of own) extra.add(file);
        edges.push({
            requests: [
                ...new Set(matched.map((origin) => origin.request))
            ].sort(),
            files: own.sort()
        });
    }
    return {
        set: [...initial, ...extra].sort(),
        extra: [...extra].sort(),
        edges: edges.sort((a, b) =>
            a.requests.join(',').localeCompare(b.requests.join(','))
        )
    };
}

/** Every counted asset must map to exactly one chunk, and that chunk's `initial` flag must agree
 * with the tier the asset was counted in. An asset emitted by both an initial and an async chunk
 * is a classification the budget cannot reason about, so it is a hard failure rather than a
 * guess. */
function resolveChunks(names, fileToChunks, { expectInitial, tier }) {
    const chunks = new Map();
    for (const name of names) {
        const owners = fileToChunks.get(name);
        if (!owners || owners.length === 0) {
            fail(
                `asset "${name}" (${tier}) belongs to no chunk in the recorded graph.`
            );
        }
        if (owners.length > 1) {
            fail(
                `asset "${name}" (${tier}) is emitted by ${owners.length} chunks ` +
                    `(${owners.map((owner) => owner.id).join(', ')}) - ambiguous classification.`
            );
        }
        const [chunk] = owners;
        if (chunk.initial !== expectInitial) {
            fail(
                `asset "${name}" is counted as ${tier} but its chunk ${chunk.id} is marked ` +
                    `${chunk.initial ? 'initial' : 'async'} - inconsistent classification.`
            );
        }
        chunks.set(chunk.id, chunk);
    }
    return [...chunks.values()];
}

/**
 * Module identifiers as webpack's `requestShortener` writes them, and as this file's rules are
 * authored, always use `/`. A stats file produced by a plugin or a tool that kept the host's
 * separator would silently match nothing on Windows, which is the same failure as an inert rule and
 * just as invisible. Normalising here means the rules are written once, in POSIX form, and match on
 * either host.
 */
function normalizeIdentifier(identifier) {
    return String(identifier).replace(/\\/g, '/');
}

/**
 * A rule that matches nothing in the source tree is indistinguishable, in the build output, from a
 * rule that is doing its job: both report "absent from the start-up graph". That is exactly how a
 * boundary rots — a directory is renamed, the pattern stops matching anything at all, and the gate
 * goes on printing PASS for a protection that no longer exists.
 *
 * So every rule has to point at something. The check is deliberately against the SOURCE TREE rather
 * than against the emitted graph: the whole point of a protected module is that it is absent from
 * the graph the verifier inspects, so "matched no recorded module" cannot be the test.
 */
function collectSourcePaths(root) {
    const found = [];
    const walk = (dir, prefix) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries.sort((a, b) =>
            a.name.localeCompare(b.name)
        )) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
                continue;
            }
            const path = `${prefix}${entry.name}`;
            if (entry.isDirectory()) {
                walk(join(dir, entry.name), `${path}/`);
            } else {
                found.push(path);
            }
        }
    };
    walk(root, './');
    return found;
}

function checkRulesAreLive(budget, srcRoot) {
    const paths = collectSourcePaths(srcRoot);
    if (paths.length === 0) {
        fail(
            `no source files were found under ${srcRoot}, so the protected-module rules could not ` +
                'be checked for staleness. Refusing to report boundaries as clean when the tree ' +
                'they protect was never read (pass --src if the sources live elsewhere).'
        );
    }
    const stale = budget.protectedModulePatterns.filter((rule) => {
        const regexp = new RegExp(rule.pattern);
        return !paths.some((path) => regexp.test(path));
    });
    if (stale.length > 0) {
        fail(
            'protected-module rule(s) match nothing in the source tree, so they protect nothing ' +
                'and would report PASS forever:\n' +
                stale
                    .map(
                        (rule) =>
                            `  "${rule.id}": ${rule.pattern}\n` +
                            '      Either the paths it names were moved or renamed - update the ' +
                            'pattern - or the boundary is gone, in which case delete the rule ' +
                            'deliberately rather than leaving an inert one behind.'
                    )
                    .join('\n')
        );
    }
}

function checkBoundaries(budget, countedChunks) {
    const results = [];
    for (const rule of budget.protectedModulePatterns) {
        const regexp = new RegExp(rule.pattern);
        const violations = [];
        for (const chunk of countedChunks) {
            if (!Array.isArray(chunk.modules)) {
                fail(
                    `chunk ${chunk.id} is part of the counted delivery set but its module list ` +
                        'was not recorded. webpack.delivery-budget.json `bootModules` and the ' +
                        'DeliveryStatsPlugin options have drifted apart; refusing to report a ' +
                        'boundary as clean when it was never inspected.'
                );
            }
            for (const recorded of chunk.modules) {
                const module = normalizeIdentifier(recorded);
                if (regexp.test(module)) {
                    violations.push({
                        module,
                        chunkId: chunk.id,
                        chunkNames: chunk.names,
                        // The edge a reviewer needs: which emitted file carries the module.
                        files: chunk.files
                    });
                }
            }
        }
        results.push({
            id: rule.id,
            pattern: rule.pattern,
            reason: rule.reason,
            violations
        });
    }
    return results;
}

function compare(label, measured, ceiling, failures) {
    const ok = measured <= ceiling;
    const isCount = label.endsWith('assetCount');
    const unit = isCount ? 'asset(s)' : 'bytes';
    // What the documented rounding rule WOULD produce for this measurement. Printed as guidance
    // for whoever has to justify raising the ceiling; nothing here writes it anywhere.
    const ruleValue = isCount ? measured : ceilToKiB(measured);
    if (!ok) {
        failures.push(
            `${label}: ${measured} > ${ceiling} (over by ${measured - ceiling} ${unit}). ` +
                `The rounding rule would put this ceiling at ${ruleValue}.`
        );
    }
    return {
        label,
        measured,
        ceiling,
        ok,
        delta: measured - ceiling,
        ruleValue
    };
}

function run(argv) {
    const args = parseArgs(argv);
    const budget = readJson(args.budget, 'delivery budget');
    const mainBudget = readJson(args.mainBudget, 'main bundle budget');
    const stats = readJson(args.stats, 'delivery stats');

    if (stats.schemaVersion !== budget.statsSchemaVersion) {
        fail(
            `delivery stats schema version ${stats.schemaVersion} does not match the version ` +
                `the budget was written against (${budget.statsSchemaVersion}).`
        );
    }
    for (const key of ['chunks', 'chunkGroups']) {
        if (!Array.isArray(stats[key]))
            fail(`delivery stats is missing "${key}".`);
    }
    if (!stats.assets || !stats.entrypoints) {
        fail('delivery stats is missing "assets" or "entrypoints".');
    }

    const fileToChunks = buildFileIndex(stats);
    const initialNames = computeInitialSet(stats, budget);
    assertBootModulesPresent(stats, budget);
    const startup = computeStartupSet(stats, budget, initialNames);

    const counted = new Set(budget.countedAssetExtensions);
    for (const name of startup.set) {
        if (!counted.has(extensionOf(name))) {
            fail(
                `asset "${name}" is part of the start-up delivery set but its type ` +
                    `"${extensionOf(name)}" is not one this budget knows how to count ` +
                    `(${budget.countedAssetExtensions.join(', ')}). Classify it deliberately in ` +
                    'webpack.delivery-budget.json rather than letting it go unmeasured.'
            );
        }
    }

    const initialAssets = measureAssets(initialNames, stats, args.dist);
    const extraAssets = measureAssets(startup.extra, stats, args.dist);

    const initialChunks = resolveChunks(initialNames, fileToChunks, {
        expectInitial: true,
        tier: 'initial'
    });
    const startupChunks = resolveChunks(startup.extra, fileToChunks, {
        expectInitial: false,
        tier: 'startup-async'
    });
    checkRulesAreLive(budget, args.src);
    const boundaries = checkBoundaries(budget, [
        ...initialChunks,
        ...startupChunks
    ]);

    const initialJs = initialAssets.filter(
        (asset) => asset.extension === '.js'
    );
    const initialCss = initialAssets.filter(
        (asset) => asset.extension === '.css'
    );
    const initialTotals = totals(initialAssets);
    const startupTotals = totals([...initialAssets, ...extraAssets]);

    const mainAsset = initialAssets.find(
        (asset) => asset.name === mainBudget.mainBundleAsset
    );
    if (!mainAsset) {
        fail(
            `the individually budgeted asset "${mainBudget.mainBundleAsset}" is not in the ` +
                'initial delivery set - webpack.performance-budget.json and the emitted graph ' +
                'disagree.'
        );
    }

    const failures = [];
    const checks = [
        compare(
            'initial.rawJsBytes',
            totals(initialJs).raw,
            budget.budgets.initial.rawJsBytes,
            failures
        ),
        compare(
            'initial.rawCssBytes',
            totals(initialCss).raw,
            budget.budgets.initial.rawCssBytes,
            failures
        ),
        compare(
            'initial.rawBytes',
            initialTotals.raw,
            budget.budgets.initial.rawBytes,
            failures
        ),
        compare(
            'initial.gzipBytes',
            initialTotals.gzip,
            budget.budgets.initial.gzipBytes,
            failures
        ),
        compare(
            'initial.brotliBytes',
            initialTotals.brotli,
            budget.budgets.initial.brotliBytes,
            failures
        ),
        compare(
            'initial.assetCount',
            initialTotals.count,
            budget.budgets.initial.assetCount,
            failures
        ),
        compare(
            'startup.rawBytes',
            startupTotals.raw,
            budget.budgets.startup.rawBytes,
            failures
        ),
        compare(
            'startup.gzipBytes',
            startupTotals.gzip,
            budget.budgets.startup.gzipBytes,
            failures
        ),
        compare(
            'startup.brotliBytes',
            startupTotals.brotli,
            budget.budgets.startup.brotliBytes,
            failures
        ),
        compare(
            'startup.assetCount',
            startupTotals.count,
            budget.budgets.startup.assetCount,
            failures
        )
    ];

    for (const boundary of boundaries) {
        if (boundary.violations.length === 0) continue;
        const shown = boundary.violations
            .slice(0, 5)
            .map(
                (v) =>
                    `      ${v.module}  ->  chunk ${v.chunkId} [${v.files.join(', ')}]`
            )
            .join('\n');
        failures.push(
            `boundary "${boundary.id}": ${boundary.violations.length} module(s) reachable from ` +
                `the start-up delivery graph.\n${shown}`
        );
    }

    const report = {
        schemaVersion: 1,
        mainBundle: {
            asset: mainBudget.mainBundleAsset,
            raw: mainAsset.raw,
            gzip: mainAsset.gzip,
            brotli: mainAsset.brotli,
            ceiling: mainBudget.mainBundleBudgetBytes
        },
        initial: {
            rawJsBytes: totals(initialJs).raw,
            rawCssBytes: totals(initialCss).raw,
            ...initialTotals,
            assets: initialAssets
        },
        startup: {
            ...startupTotals,
            extraAssets,
            edges: startup.edges
        },
        boundaries: boundaries.map(({ id, pattern, reason, violations }) => ({
            id,
            pattern,
            reason,
            pass: violations.length === 0,
            violations
        })),
        checks,
        pass: failures.length === 0
    };

    printReport(report, budget);

    if (args.reportJson) {
        mkdirSync(dirname(args.reportJson), { recursive: true });
        writeFileSync(args.reportJson, JSON.stringify(report, null, 2) + '\n');
        console.log(`${TAG} JSON report written to ${args.reportJson}`);
    }

    if (failures.length > 0) {
        console.error(`\n${TAG} FAIL:`);
        for (const failure of failures) console.error(`  - ${failure}`);
        console.error(
            `\n${TAG} If the growth is intended, raise the ceiling in ` +
                `${budget.__source ?? 'webpack.delivery-budget.json'} in the same pull request, ` +
                'with the before/after numbers in the description. This command never rewrites ' +
                'it for you.'
        );
        return args.reportOnly ? 0 : 1;
    }

    console.log(`\n${TAG} PASS.`);
    return 0;
}

function row(label, value) {
    return `  ${label.padEnd(34)}${value}`;
}

function checkLine(check) {
    const status = check.ok ? 'PASS' : 'FAIL';
    const unit = check.label.endsWith('assetCount') ? '' : ' B';
    return row(
        check.label,
        `${String(check.measured).padStart(9)}${unit} / ${check.ceiling}${unit}  ` +
            `${status} (${check.delta > 0 ? '+' : ''}${check.delta})`
    );
}

function printReport(report, budget) {
    console.log(`\n${TAG} Aggregate Web delivery report`);
    console.log(
        '\n  --- individual bundle (webpack.performance-budget.json, unchanged) ---'
    );
    console.log(
        row(
            report.mainBundle.asset,
            `${report.mainBundle.raw} B (${kib(report.mainBundle.raw)}) / ` +
                `${report.mainBundle.ceiling} B`
        )
    );

    console.log('\n  --- initial delivery (what index.html loads) ---');
    console.log(row('assets', report.initial.count));
    console.log(
        row(
            'raw JS',
            `${report.initial.rawJsBytes} B (${kib(report.initial.rawJsBytes)})`
        )
    );
    console.log(
        row(
            'raw CSS',
            `${report.initial.rawCssBytes} B (${kib(report.initial.rawCssBytes)})`
        )
    );
    console.log(
        row('raw total', `${report.initial.raw} B (${kib(report.initial.raw)})`)
    );
    console.log(
        row(
            'gzip total',
            `${report.initial.gzip} B (${kib(report.initial.gzip)})`
        )
    );
    console.log(
        row(
            'brotli total',
            `${report.initial.brotli} B (${kib(report.initial.brotli)})`
        )
    );

    console.log('\n  --- start-up delivery (initial + boot-time import()) ---');
    console.log(row('assets', report.startup.count));
    console.log(
        row('raw total', `${report.startup.raw} B (${kib(report.startup.raw)})`)
    );
    console.log(
        row(
            'gzip total',
            `${report.startup.gzip} B (${kib(report.startup.gzip)})`
        )
    );
    console.log(
        row(
            'brotli total',
            `${report.startup.brotli} B (${kib(report.startup.brotli)})`
        )
    );

    console.log('\n  --- largest initial contributors ---');
    for (const asset of report.initial.assets.slice(0, 10)) {
        console.log(
            row(
                asset.name.slice(0, 33),
                `${String(asset.raw).padStart(9)} B raw / ${asset.gzip} B gzip`
            )
        );
    }

    if (report.startup.extraAssets.length > 0) {
        console.log(
            '\n  --- boot-time import() (counted in start-up, not in initial) ---'
        );
        for (const edge of report.startup.edges) {
            const bytes = edge.files.reduce((sum, file) => {
                const asset = report.startup.extraAssets.find(
                    (a) => a.name === file
                );
                return sum + (asset ? asset.raw : 0);
            }, 0);
            console.log(
                row(
                    edge.requests.join(', ').slice(0, 33),
                    `${String(bytes).padStart(9)} B raw`
                )
            );
        }
    }

    console.log('\n  --- progressive-delivery boundaries ---');
    for (const boundary of report.boundaries) {
        console.log(
            row(
                boundary.id,
                boundary.pass
                    ? 'PASS (absent from the start-up graph)'
                    : `FAIL (${boundary.violations.length} module(s) present)`
            )
        );
    }

    console.log('\n  --- budget checks ---');
    for (const check of report.checks) console.log(checkLine(check));
    void budget;
}

let exitCode = 0;
try {
    exitCode = run(process.argv.slice(2));
} catch (err) {
    if (err instanceof BudgetError) {
        console.error(`${TAG} FAIL: ${err.message}`);
        exitCode = 1;
    } else {
        throw err;
    }
}
process.exit(exitCode);

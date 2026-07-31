#!/usr/bin/env node
/**
 * Deterministic controls for the fail-closed npm dependency gate
 * (tesserafin-project/tesserafin#95, C2).
 *
 * The point of these controls is that a green "Dependency Audit" means
 * something. `npm audit` exits nonzero both when it found 32 high/critical
 * advisories and when it could not reach the registry at all - so every way the
 * gate could quietly pass, or quietly fail for the wrong reason, is pinned down
 * by a case here.
 *
 * Each RED case asserts the exit status of `scripts/dependency-audit.mjs`
 * itself, not of this script. This suite passing means the evaluator refused;
 * it never means the evaluator was not consulted.
 *
 *   0  CLEAN   1  POLICY VIOLATION   2  INDETERMINATE
 *
 * Two families of fixture:
 *
 *   synthetic  hand-written reports, one property per case, small enough that
 *              the expected verdict is obvious from reading the fixture.
 *   real       this repository's own `npm audit --json` output, produced live
 *              when `--no-live` is not passed. That is the control that
 *              matters most: it proves the evaluator agrees with reality on the
 *              exact report shape npm actually emits, rather than on the shape
 *              this file imagines.
 *
 * No fixture is written inside the repository, and no case introduces a real
 * vulnerable dependency.
 *
 * Usage:
 *   node scripts/dependency-audit.test.mjs [--no-live]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT = join(REPO_ROOT, 'scripts', 'dependency-audit.mjs');

const runLive = !process.argv.slice(2).includes('--no-live');
for (const arg of process.argv.slice(2)) {
    if (arg !== '--no-live') {
        console.error(`unknown argument: ${arg}`);
        process.exit(2);
    }
}

const WORK = mkdtempSync(
    join(tmpdir(), 'tesserafin-dependency-audit-controls-')
);
process.on('exit', () => rmSync(WORK, { recursive: true, force: true }));

let passed = 0;
let failed = 0;
let skipped = 0;
let lastOutput = '';

const ok = (message) => {
    console.log(`  PASS: ${message}`);
    passed += 1;
};
const bad = (message) => {
    console.error(`  FAIL: ${message}`);
    failed += 1;
};
const skip = (message) => {
    console.log(`  SKIP: ${message}`);
    skipped += 1;
};

// ── Fixture builders ──────────────────────────────────────────────────────

// Real GHSA identifiers use a restricted base32 alphabet (no a, b, d, e, i, k,
// l, n, o, s, t, u, y, z), and the evaluator matches that alphabet exactly - so
// the fixtures have to be identifiers that could really exist.
const GHSA_A = 'GHSA-cccc-cccc-cccc';
const GHSA_B = 'GHSA-mmmm-mmmm-mmmm';
const advisoryUrl = (id) => `https://github.com/advisories/${id}`;

let fixtureCounter = 0;
function writeFixture(name, body) {
    fixtureCounter += 1;
    const path = join(WORK, `${fixtureCounter}-${name}`);
    writeFileSync(
        path,
        typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`
    );
    return path;
}

/**
 * A finding as npm emits it. `advisories` produces the object `via` entries a
 * root vulnerability carries; `viaPackages` produces the string `via` entries
 * that mark a downstream effect of another vulnerable package.
 */
function finding({
    severity,
    direct = false,
    advisories = [],
    viaPackages = [],
    nodes = [],
    range = '<1.0.0'
}) {
    return {
        severity,
        isDirect: direct,
        via: [
            ...advisories.map((id) => ({
                source: 1,
                name: 'x',
                title: 'control fixture',
                url: advisoryUrl(id),
                severity
            })),
            ...viaPackages
        ],
        effects: [],
        range,
        nodes,
        fixAvailable: true
    };
}

function report(vulnerabilities, overrides = {}) {
    const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
    for (const entry of Object.values(vulnerabilities))
        counts[entry.severity] += 1;
    counts.total = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
        auditReportVersion: 2,
        vulnerabilities,
        metadata: {
            vulnerabilities: counts,
            dependencies: {
                prod: 10,
                dev: 20,
                optional: 1,
                peer: 0,
                peerOptional: 0,
                total: 31
            }
        },
        ...overrides
    };
}

// A structurally sound lockfile: the evaluator refuses to classify findings
// without one, because without it there is no evidence the audited graph is the
// graph this repository installs.
const GOOD_LOCKFILE = writeFixture('lockfile-good.json', {
    name: 'tesserafin-web',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
        '': { name: 'tesserafin-web', version: '1.0.0' },
        'node_modules/prod-package': { version: '1.0.0' },
        'node_modules/dev-package': { version: '1.0.0', dev: true },
        'node_modules/optional-package': { version: '1.0.0', optional: true }
    }
});

function waiver(overrides = {}) {
    return {
        ecosystem: 'npm',
        package: 'blocked-package',
        advisory: GHSA_A,
        severity: 'high',
        justification: 'control fixture',
        owner: 'tesserafin-maintainer',
        issue: 'https://github.com/tesserafin-project/tesserafin/issues/1',
        created: '2026-01-01',
        expires: '2099-01-01',
        ...overrides
    };
}

const waiverFile = (name, waivers) =>
    writeFixture(name, { version: 1, waivers });

// ── Assertion ─────────────────────────────────────────────────────────────

function expect(want, description, args) {
    const result = spawnSync(process.execPath, [AUDIT, ...args], {
        encoding: 'utf8',
        cwd: REPO_ROOT
    });
    lastOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const got = result.status;
    if (got === want) {
        ok(`${description} (exit ${got})`);
    } else {
        bad(`${description}: expected exit ${want}, got ${got}`);
        console.error(
            lastOutput
                .split('\n')
                .slice(-6)
                .map((line) => `        ${line}`)
                .join('\n')
        );
    }
}

/** Evaluate a report against the known-good lockfile. */
const expectReport = (want, description, reportPath, extra = []) =>
    expect(want, description, [
        '--report',
        reportPath,
        '--lockfile',
        GOOD_LOCKFILE,
        ...extra
    ]);

function assertOutput(pattern, description) {
    if (new RegExp(pattern, 'i').test(lastOutput)) ok(description);
    else bad(description);
}

// ══ ACCEPTED ══════════════════════════════════════════════════════════════

console.log('npm dependency gate controls');
console.log(`  fixture tree: ${WORK}`);
console.log();
console.log('Accepted (exit 0)');

const CLEAN = writeFixture('clean.json', report({}));
expectReport(0, 'a valid report with no findings', CLEAN);

const LOW_ONLY = writeFixture(
    'low-only.json',
    report({
        'low-package': finding({
            severity: 'low',
            advisories: [GHSA_A],
            nodes: ['node_modules/prod-package']
        })
    })
);
expectReport(0, 'a low finding is reported, not blocked', LOW_ONLY);
assertOutput('1 low', '  ...and the low finding is counted in the summary');

const MODERATE_ONLY = writeFixture(
    'moderate-only.json',
    report({
        'moderate-package': finding({
            severity: 'moderate',
            advisories: [GHSA_A],
            nodes: ['node_modules/dev-package']
        })
    })
);
expectReport(0, 'a moderate finding is reported, not blocked', MODERATE_ONLY);

const INFO_ONLY = writeFixture(
    'info-only.json',
    report({
        'info-package': finding({ severity: 'info', advisories: [GHSA_A] })
    })
);
expectReport(0, 'an info finding is reported, not blocked', INFO_ONLY);

const MIXED_HARMLESS = writeFixture(
    'mixed-harmless.json',
    report({
        'direct-package': finding({
            severity: 'low',
            direct: true,
            advisories: [GHSA_A],
            nodes: ['node_modules/prod-package']
        }),
        'transitive-package': finding({
            severity: 'moderate',
            advisories: [GHSA_B],
            nodes: ['node_modules/dev-package']
        })
    })
);
expectReport(
    0,
    'complete direct and transitive graphs with only low/moderate',
    MIXED_HARMLESS
);
assertOutput(
    'direct',
    '  ...and direct findings are distinguished from transitive'
);
assertOutput(
    'development',
    '  ...and development scope is distinguished from production'
);

const HIGH_ONE = writeFixture(
    'high-one.json',
    report({
        'blocked-package': finding({
            severity: 'high',
            direct: true,
            advisories: [GHSA_A],
            nodes: ['node_modules/prod-package']
        })
    })
);
expectReport(0, 'a high finding under an exact, unexpired waiver', HIGH_ONE, [
    '--waivers',
    waiverFile('waivers-valid.json', [waiver()])
]);

expectReport(0, 'an empty waiver set alongside a clean report', CLEAN, [
    '--waivers',
    waiverFile('waivers-empty.json', [])
]);

// A downstream effect entry carries no advisory of its own; it is covered only
// when every package it comes through is itself fully covered.
const HIGH_EFFECT = writeFixture(
    'high-effect.json',
    report({
        'blocked-package': finding({
            severity: 'high',
            advisories: [GHSA_A],
            nodes: ['node_modules/prod-package']
        }),
        'effect-package': finding({
            severity: 'high',
            viaPackages: ['blocked-package']
        })
    })
);
expectReport(0, 'a downstream effect of a fully waived package', HIGH_EFFECT, [
    '--waivers',
    waiverFile('waivers-valid-2.json', [waiver()])
]);

console.log();

// ══ POLICY VIOLATIONS ═════════════════════════════════════════════════════

console.log('Rejected as policy violations (exit 1)');

expectReport(1, 'one high direct dependency', HIGH_ONE);

const HIGH_TRANSITIVE = writeFixture(
    'high-transitive.json',
    report({
        'blocked-package': finding({ severity: 'high', advisories: [GHSA_A] })
    })
);
expectReport(1, 'one high transitive dependency', HIGH_TRANSITIVE);

const CRITICAL = writeFixture(
    'critical.json',
    report({
        'blocked-package': finding({
            severity: 'critical',
            advisories: [GHSA_A]
        })
    })
);
expectReport(1, 'one critical dependency', CRITICAL);

const MIXED_BLOCKING = writeFixture(
    'mixed-blocking.json',
    report({
        'critical-package': finding({
            severity: 'critical',
            direct: true,
            advisories: [GHSA_A]
        }),
        'high-package': finding({ severity: 'high', advisories: [GHSA_B] }),
        'moderate-package': finding({
            severity: 'moderate',
            advisories: [GHSA_A]
        }),
        'low-package': finding({ severity: 'low', advisories: [GHSA_B] })
    })
);
expectReport(1, 'multiple mixed findings', MIXED_BLOCKING);
assertOutput(
    '1 critical, 1 high, 1 moderate, 1 low',
    '  ...and every severity is counted, not only the blocking ones'
);

const TWO_HIGH = writeFixture(
    'two-high.json',
    report({
        'blocked-package': finding({ severity: 'high', advisories: [GHSA_A] }),
        'unwaived-package': finding({ severity: 'high', advisories: [GHSA_B] })
    })
);
expectReport(1, 'an unwaived finding beside a valid waiver', TWO_HIGH, [
    '--waivers',
    waiverFile('waivers-valid-3.json', [waiver()])
]);

expectReport(1, 'an expired waiver does not silence its finding', HIGH_ONE, [
    '--waivers',
    waiverFile('waivers-expired.json', [waiver({ expires: '2020-01-01' })])
]);
assertOutput('expired', '  ...and the summary says the waiver expired');

expectReport(1, 'a waiver for a different advisory', HIGH_ONE, [
    '--waivers',
    waiverFile('waivers-wrong-advisory.json', [waiver({ advisory: GHSA_B })])
]);

expectReport(1, 'a waiver for a different package', HIGH_ONE, [
    '--waivers',
    waiverFile('waivers-wrong-package.json', [
        waiver({ package: 'other-package' })
    ])
]);

expectReport(
    1,
    'a waiver whose severity does not match the finding',
    HIGH_ONE,
    [
        '--waivers',
        waiverFile('waivers-wrong-severity.json', [
            waiver({ severity: 'critical' })
        ])
    ]
);

expectReport(1, 'a waiver that matches no current finding is stale', CLEAN, [
    '--waivers',
    waiverFile('waivers-stale.json', [waiver({ package: 'vanished-package' })])
]);

// Partial coverage is not coverage: a finding carrying two advisories needs
// both waived.
const HIGH_TWO_ADVISORIES = writeFixture(
    'high-two-advisories.json',
    report({
        'blocked-package': finding({
            severity: 'high',
            advisories: [GHSA_A, GHSA_B]
        })
    })
);
expectReport(
    1,
    'a finding with two advisories and only one waived',
    HIGH_TWO_ADVISORIES,
    ['--waivers', waiverFile('waivers-partial.json', [waiver()])]
);

expectReport(1, 'a downstream effect whose root is unwaived', HIGH_EFFECT);

console.log();

// ══ INDETERMINATE ═════════════════════════════════════════════════════════

console.log('Rejected as indeterminate (exit 2)');

expectReport(2, 'a missing report', join(WORK, 'does-not-exist.json'));

expectReport(2, 'an empty report', writeFixture('empty.json', ''));

expectReport(
    2,
    'a malformed report',
    writeFixture('malformed.json', 'npm ERR! code ENOTFOUND\n')
);

expectReport(
    2,
    'a truncated report',
    writeFixture(
        'truncated.json',
        '{"auditReportVersion": 2, "vulnerabilities": {'
    )
);

expectReport(
    2,
    'a report that is a JSON array, not an object',
    writeFixture('array.json', [])
);

expectReport(
    2,
    'an unexpected report schema version',
    writeFixture('wrong-version.json', { ...report({}), auditReportVersion: 3 })
);

expectReport(
    2,
    'a report with no schema version at all',
    writeFixture('no-version.json', { vulnerabilities: {} })
);

// npm signals a registry failure in-band, with a document that is valid JSON
// and contains no findings whatsoever.
expectReport(
    2,
    'a registry failure reported in-band by npm',
    writeFixture('registry-error.json', {
        auditReportVersion: 2,
        error: {
            code: 'ENOTFOUND',
            summary:
                'request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed'
        }
    })
);

expectReport(
    2,
    'a report whose vulnerabilities field is missing',
    writeFixture('no-vulnerabilities.json', {
        auditReportVersion: 2,
        metadata: report({}).metadata
    })
);

expectReport(
    2,
    'a report with no metadata',
    writeFixture('no-metadata.json', {
        auditReportVersion: 2,
        vulnerabilities: {}
    })
);

for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    const broken = report({});
    delete broken.metadata.vulnerabilities[severity];
    expectReport(
        2,
        `a report whose metadata omits the "${severity}" count`,
        writeFixture(`no-${severity}-count.json`, broken)
    );
}

const zeroDeps = report({});
zeroDeps.metadata.dependencies.total = 0;
expectReport(
    2,
    'a report that inspected zero dependencies',
    writeFixture('zero-dependencies.json', zeroDeps)
);

const noDeps = report({});
delete noDeps.metadata.dependencies;
expectReport(
    2,
    'a report with no dependency counts',
    writeFixture('no-dependencies.json', noDeps)
);

const noSeverity = report({});
noSeverity.vulnerabilities['broken-package'] = {
    isDirect: false,
    via: [],
    range: '*',
    nodes: []
};
expectReport(
    2,
    'a finding with no severity',
    writeFixture('missing-severity.json', noSeverity)
);

const unknownSeverity = report({});
unknownSeverity.vulnerabilities['broken-package'] = {
    severity: 'catastrophic',
    isDirect: false,
    via: [],
    range: '*',
    nodes: []
};
expectReport(
    2,
    'a finding with an unrecognised severity',
    writeFixture('unknown-severity.json', unknownSeverity)
);

// A truncated document: the entry list and the metadata tally disagree, so one
// of the two halves is incomplete and neither can be trusted.
const inconsistent = report({
    'high-package': finding({ severity: 'high', advisories: [GHSA_A] })
});
inconsistent.metadata.vulnerabilities.high = 0;
expectReport(
    2,
    'a report whose metadata and entries disagree',
    writeFixture('inconsistent.json', inconsistent)
);

const nullEntry = report({});
nullEntry.vulnerabilities['broken-package'] = null;
expectReport(
    2,
    'a finding that is not an object',
    writeFixture('null-entry.json', nullEntry)
);

console.log();
console.log('Rejected as indeterminate — absent or unusable lockfile');

expect(2, 'an absent lockfile', [
    '--report',
    CLEAN,
    '--lockfile',
    join(WORK, 'no-lockfile.json')
]);
expect(2, 'a lockfile that is a directory, not a file', [
    '--report',
    CLEAN,
    '--lockfile',
    WORK
]);
expect(2, 'an empty lockfile', [
    '--report',
    CLEAN,
    '--lockfile',
    writeFixture('lockfile-empty.json', '')
]);
expect(2, 'a malformed lockfile', [
    '--report',
    CLEAN,
    '--lockfile',
    writeFixture('lockfile-malformed.json', 'not json\n')
]);
expect(2, 'a lockfile of an unexpected version', [
    '--report',
    CLEAN,
    '--lockfile',
    writeFixture('lockfile-v2.json', { lockfileVersion: 2, packages: {} })
]);
expect(2, 'a lockfile listing no packages', [
    '--report',
    CLEAN,
    '--lockfile',
    writeFixture('lockfile-no-packages.json', {
        lockfileVersion: 3,
        packages: { '': {} }
    })
]);

console.log();
console.log('Rejected as indeterminate — invalid arguments');

expect(2, 'no arguments at all', []);
expect(2, 'an unknown flag', [
    '--report',
    CLEAN,
    '--lockfile',
    GOOD_LOCKFILE,
    '--pretty-please'
]);
expect(2, 'a flag with no value', ['--report']);
expect(2, '--scan combined with --report', ['--scan', '--report', CLEAN]);
expect(2, '--work without --scan', [
    '--report',
    CLEAN,
    '--lockfile',
    GOOD_LOCKFILE,
    '--work',
    WORK
]);

console.log();
console.log('Rejected as indeterminate — structurally invalid waiver files');

const withWaivers = (name, body) =>
    expectReport(2, name, HIGH_ONE, ['--waivers', body]);

withWaivers('a waiver file that does not exist', join(WORK, 'no-waivers.json'));
withWaivers(
    'an empty waiver file',
    writeFixture('waivers-empty-file.json', '')
);
withWaivers(
    'a malformed waiver file',
    writeFixture('waivers-malformed.json', 'not json\n')
);
withWaivers(
    'a waiver file with an unexpected schema version',
    writeFixture('waivers-bad-version.json', { version: 7, waivers: [] })
);
withWaivers(
    'a waiver file with no waivers array',
    writeFixture('waivers-no-array.json', { version: 1 })
);

for (const field of [
    'ecosystem',
    'package',
    'advisory',
    'severity',
    'justification',
    'issue',
    'owner',
    'created',
    'expires'
]) {
    const incomplete = waiver();
    delete incomplete[field];
    withWaivers(
        `a waiver missing its "${field}"`,
        waiverFile(`waivers-no-${field}.json`, [incomplete])
    );
}

withWaivers(
    'a package-only wildcard waiver',
    waiverFile('waivers-wildcard.json', [waiver({ package: '*' })])
);
withWaivers(
    'a waiver with a malformed expiry date',
    waiverFile('waivers-bad-date.json', [waiver({ expires: 'next tuesday' })])
);
withWaivers(
    'a waiver whose date is not YYYY-MM-DD',
    waiverFile('waivers-loose-date.json', [waiver({ expires: '2099-1-1' })])
);
withWaivers(
    'duplicate waivers for the same package and advisory',
    waiverFile('waivers-duplicate.json', [
        waiver(),
        waiver({ expires: '2098-01-01' })
    ])
);
withWaivers(
    'a waiver without a real tracking-issue URL',
    waiverFile('waivers-no-issue.json', [
        waiver({ issue: 'we will file one later' })
    ])
);
withWaivers(
    'a waiver whose advisory is not a GHSA identifier',
    waiverFile('waivers-bad-advisory.json', [
        waiver({ advisory: 'CVE-2025-6965' })
    ])
);
withWaivers(
    'a waiver for another ecosystem',
    waiverFile('waivers-wrong-ecosystem.json', [waiver({ ecosystem: 'nuget' })])
);
withWaivers(
    'a waiver with an unknown severity',
    waiverFile('waivers-bad-severity.json', [
        waiver({ severity: 'catastrophic' })
    ])
);

console.log();

// ══ LIVE ══════════════════════════════════════════════════════════════════
//
// The synthetic cases above all assume this file guessed npm's report shape
// correctly. This one does not assume it.

console.log('Live control');

if (!runLive) {
    skip('live audit disabled by --no-live');
} else {
    let live = '';
    try {
        live = execFileSync('npm', ['audit', '--json'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            maxBuffer: 256 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (err) {
        live = typeof err.stdout === 'string' ? err.stdout : '';
    }

    if (!live) {
        bad('the live audit produced no report at all');
    } else {
        const LIVE_PATH = writeFixture('live.json', live);
        let parsed = null;
        try {
            parsed = JSON.parse(live);
        } catch {
            parsed = null;
        }

        if (!parsed || parsed.error) {
            bad(
                'the live audit did not return a usable report (registry unreachable?)'
            );
        } else {
            const total = parsed.metadata?.dependencies?.total ?? 0;
            if (total > 0)
                ok(
                    `the live audit proves ${total} dependencies were inspected`
                );
            else bad('the live audit proves nothing was inspected');

            const blocking =
                (parsed.metadata?.vulnerabilities?.high ?? 0) +
                (parsed.metadata?.vulnerabilities?.critical ?? 0);
            expect(
                blocking > 0 ? 1 : 0,
                `the live report is evaluated against the real lockfile`,
                ['--report', LIVE_PATH]
            );

            // Mutate the real report rather than a hand-written one: this is
            // the control that would catch the evaluator agreeing with a
            // fixture but not with npm.
            const mutated = JSON.parse(live);
            mutated.vulnerabilities = {
                'injected-package': finding({
                    severity: 'critical',
                    direct: true,
                    advisories: [GHSA_A]
                })
            };
            mutated.metadata.vulnerabilities = {
                info: 0,
                low: 0,
                moderate: 0,
                high: 0,
                critical: 1,
                total: 1
            };
            expectReport(
                1,
                'the real report, reduced to one injected critical, is refused',
                writeFixture('live-mutated.json', mutated)
            );

            const emptied = JSON.parse(live);
            emptied.vulnerabilities = {};
            emptied.metadata.vulnerabilities = {
                info: 0,
                low: 0,
                moderate: 0,
                high: 0,
                critical: 0,
                total: 0
            };
            expectReport(
                0,
                'the real report, emptied of findings, is accepted',
                writeFixture('live-emptied.json', emptied)
            );
        }
    }
}

console.log();
console.log(`  passed: ${passed}   failed: ${failed}   skipped: ${skipped}`);
process.exitCode = failed === 0 ? 0 : 1;

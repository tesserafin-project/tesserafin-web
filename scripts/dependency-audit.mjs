#!/usr/bin/env node
/**
 * Fail-closed npm dependency vulnerability gate - repository-local slice of
 * tesserafin-project/tesserafin#95 (C2).
 *
 * WHAT THIS IS NOT. It is not a vulnerability database and it is not a scanner.
 * It never decides whether a package is vulnerable; `npm audit` asks the
 * registry's advisory endpoint and answers that. No advisory identifier, no
 * severity and no affected range is hard-coded here - a file that had to be
 * edited whenever an advisory was published would be reporting yesterday's
 * world.
 *
 * WHAT THIS IS. It is the policy layer over `npm audit --json`, and the reason
 * it exists is that the scanner's exit status cannot carry the verdict. `npm
 * audit` exits nonzero both when it found vulnerabilities and when it could not
 * reach the registry at all, and in the second case what lands on stdout is an
 * `{"error": ...}` document rather than a report. Gating on `$?` conflates "we
 * found problems" with "we never looked"; gating on the report's *structure*
 * does not.
 *
 * So every verdict here is computed from the document: the five severity
 * buckets must all be present, the dependency count must be nonzero, every
 * entry's severity must be one this file recognises, and the per-entry counts
 * must reconcile with `metadata.vulnerabilities`. A report that fails any of
 * those was not a complete answer, and an incomplete answer is never "clean".
 *
 *   0  CLEAN            valid, complete report; no unresolved high/critical
 *   1  POLICY VIOLATION at least one unresolved high/critical finding, or a
 *                       waiver that does not hold up (expired, mismatched,
 *                       stale)
 *   2  INDETERMINATE    scanner/registry failure, invalid arguments, missing,
 *                       empty or malformed report, unexpected schema version,
 *                       zero packages inspected, missing or unknown severity,
 *                       inconsistent counts, absent lockfile, structurally
 *                       invalid waiver file, evaluator failure
 *
 * `info`, `low` and `moderate` findings are reported in full and never fail the
 * gate.
 *
 * The audit deliberately covers the *complete* lockfile - production,
 * development and optional dependencies alike. `--omit=dev` would hide the
 * build toolchain, which is exactly the surface that turns a compromised
 * dependency into a compromised published artifact.
 *
 * Usage:
 *   node scripts/dependency-audit.mjs --scan [--work DIR] [--waivers FILE] [--summary FILE]
 *   node scripts/dependency-audit.mjs --report FILE [--waivers FILE] [--summary FILE]
 *
 * `--scan` runs `npm audit --json` itself and then evaluates it; the `--report`
 * form evaluates a report produced earlier, which is what the deterministic
 * controls drive and what a workflow uses when the scan and the verdict are
 * separate steps.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT_CLEAN = 0;
const EXIT_POLICY = 1;
const EXIT_INDETERMINATE = 2;

/**
 * The `auditReportVersion` this evaluator understands. A future npm that bumps
 * it changes field meanings underneath us, so an unexpected value is refused
 * rather than parsed hopefully.
 */
const SUPPORTED_REPORT_VERSION = 2;

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCKFILE = join(REPO_ROOT, 'package-lock.json');

/** Thrown for every condition that must exit 2 rather than answer the question. */
class Indeterminate extends Error {}

function indeterminate(message) {
    throw new Indeterminate(message);
}

// ── Arguments ─────────────────────────────────────────────────────────────
//
// Every unknown flag, missing value and mode conflict is INDETERMINATE, not a
// usage exit: a workflow that mistypes a flag must go red, not silently pass.

function parseArgs(argv) {
    const options = {
        scan: false,
        report: '',
        waivers: '',
        summary: '',
        work: '',
        lockfile: LOCKFILE
    };
    const takesValue = {
        '--report': 'report',
        '--waivers': 'waivers',
        '--summary': 'summary',
        '--work': 'work',
        // Only the deterministic controls pass this; a workflow always audits
        // the lockfile that sits beside the manifest it is gating.
        '--lockfile': 'lockfile'
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--scan') {
            options.scan = true;
        } else if (arg in takesValue) {
            if (i + 1 >= argv.length) indeterminate(`${arg} requires a value`);
            options[takesValue[arg]] = argv[i + 1];
            i += 1;
        } else {
            indeterminate(`unknown argument: ${arg}`);
        }
    }

    if (options.scan && options.report)
        indeterminate('--scan cannot be combined with --report');
    if (!options.scan && !options.report)
        indeterminate('one of --scan or --report is required');
    if (!options.scan && options.work)
        indeterminate('--work is only meaningful with --scan');

    return options;
}

// ── Report acquisition and validation ─────────────────────────────────────

function readExactFile(label, path) {
    if (!path) indeterminate(`no ${label} path was given`);

    let stats;
    try {
        stats = statSync(path);
    } catch {
        indeterminate(`missing ${label}: ${path}`);
    }
    // An exact file, never a directory or a dangling symlink: a report that is
    // not a readable regular file cannot be evidence of anything.
    if (!stats.isFile())
        indeterminate(`${label} is not a regular file: ${path}`);
    if (stats.size === 0) indeterminate(`${label} is empty: ${path}`);

    try {
        return readFileSync(path, 'utf8');
    } catch (err) {
        indeterminate(`${label} is not readable: ${path} (${err.message})`);
    }
    return '';
}

function readJsonFile(label, path) {
    const raw = readExactFile(label, path);
    try {
        return JSON.parse(raw);
    } catch (err) {
        indeterminate(`${label} is not valid JSON: ${path} (${err.message})`);
    }
    return null;
}

function runScan(options) {
    const work = options.work || join(REPO_ROOT, 'dependency-audit-out');
    try {
        mkdirSync(work, { recursive: true });
    } catch (err) {
        indeterminate(
            `could not create the work directory ${work}: ${err.message}`
        );
    }
    const reportPath = join(work, 'npm-audit.json');

    // `npm audit` exits 1 when it finds anything, so a nonzero status is not an
    // error here - the document on stdout is what matters, and it is retained
    // either way.
    let stdout = '';
    try {
        stdout = execFileSync('npm', ['audit', '--json'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            maxBuffer: 256 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (err) {
        stdout = typeof err.stdout === 'string' ? err.stdout : '';
        if (!stdout) {
            indeterminate(`npm audit produced no report (${err.message})`);
        }
    }

    writeFileSync(reportPath, stdout);
    return reportPath;
}

function validateReport(report, path) {
    if (
        report === null ||
        typeof report !== 'object' ||
        Array.isArray(report)
    ) {
        indeterminate(`report is not a JSON object: ${path}`);
    }

    // npm signals registry and resolution failures in-band, with a document
    // that is perfectly valid JSON and contains no findings whatsoever.
    if ('error' in report) {
        const detail =
            report.error?.summary ||
            report.error?.code ||
            JSON.stringify(report.error);
        indeterminate(
            `npm audit reported an error instead of a report: ${detail}`
        );
    }

    if (report.auditReportVersion !== SUPPORTED_REPORT_VERSION) {
        indeterminate(
            `report schema version is ${JSON.stringify(report.auditReportVersion ?? null)}, ` +
                `expected ${SUPPORTED_REPORT_VERSION}: ${path}`
        );
    }

    if (
        typeof report.vulnerabilities !== 'object' ||
        report.vulnerabilities === null
    ) {
        indeterminate(`report has no vulnerabilities object: ${path}`);
    }

    const metadata = report.metadata;
    if (typeof metadata !== 'object' || metadata === null) {
        indeterminate(`report has no metadata: ${path}`);
    }

    const counts = metadata.vulnerabilities;
    if (typeof counts !== 'object' || counts === null) {
        indeterminate(`report metadata has no vulnerability counts: ${path}`);
    }
    // All five buckets, always. A report missing one is a report this evaluator
    // cannot reason about, and silently defaulting it to zero is precisely the
    // silent degradation this gate exists to prevent.
    for (const severity of SEVERITIES) {
        const value = counts[severity];
        if (!Number.isInteger(value) || value < 0) {
            indeterminate(
                `report metadata has no usable "${severity}" count: ${JSON.stringify(value ?? null)}`
            );
        }
    }

    const dependencies = metadata.dependencies;
    if (typeof dependencies !== 'object' || dependencies === null) {
        indeterminate(`report metadata has no dependency counts: ${path}`);
    }
    if (!Number.isInteger(dependencies.total) || dependencies.total <= 0) {
        // The check that separates "nothing is vulnerable" from "nothing was
        // looked at".
        indeterminate(
            `report inspected zero dependencies: ${JSON.stringify(dependencies.total ?? null)}`
        );
    }

    return { counts, dependencies };
}

/**
 * The lockfile is what makes a finding actionable: `npm audit` says which
 * package is affected, the lockfile says whether it reaches production. Its
 * absence is indeterminate rather than clean - without it there is no evidence
 * the audited graph is the graph this repository installs.
 */
function readLockfileScopes(lockfilePath) {
    const lock = readJsonFile('lockfile', lockfilePath);
    if (lock.lockfileVersion !== 3) {
        indeterminate(
            `unexpected lockfileVersion ${JSON.stringify(lock.lockfileVersion ?? null)}, expected 3`
        );
    }
    if (typeof lock.packages !== 'object' || lock.packages === null) {
        indeterminate('lockfile has no packages map');
    }
    const scopes = new Map();
    for (const [path, entry] of Object.entries(lock.packages)) {
        if (!path) continue;
        let scope = 'production';
        if (entry?.dev === true || entry?.devOptional === true)
            scope = 'development';
        else if (entry?.optional === true) scope = 'optional';
        scopes.set(path, scope);
    }
    if (scopes.size === 0) indeterminate('lockfile lists no packages');
    return scopes;
}

// ── Findings ──────────────────────────────────────────────────────────────

const ADVISORY_PATTERN =
    /GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}/i;

function advisoriesOf(entry) {
    const ids = new Set();
    for (const via of entry.via ?? []) {
        if (typeof via === 'string') continue;
        const match = ADVISORY_PATTERN.exec(via?.url ?? '');
        if (match) ids.add(match[0].toUpperCase());
    }
    return ids;
}

function collectFindings(report, scopes) {
    const entries = Object.entries(report.vulnerabilities);
    const findings = [];
    const observed = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));

    for (const [name, entry] of entries) {
        if (typeof entry !== 'object' || entry === null) {
            indeterminate(`the finding for "${name}" is not an object`);
        }
        const severity = entry.severity;
        if (typeof severity !== 'string' || severity.length === 0) {
            indeterminate(`the finding for "${name}" has no severity`);
        }
        if (!SEVERITIES.includes(severity)) {
            indeterminate(
                `the finding for "${name}" has an unknown severity: ${severity}`
            );
        }
        observed[severity] += 1;

        const nodes = Array.isArray(entry.nodes) ? entry.nodes : [];
        const scopeSet = new Set(
            nodes.map((node) => scopes.get(node)).filter(Boolean)
        );
        // Unknown-scope nodes are reported as production: over-reporting the
        // blast radius is the safe direction to be wrong in.
        const scope =
            scopeSet.size === 0 ? 'production' : [...scopeSet].sort().join('+');

        findings.push({
            name,
            severity,
            range: typeof entry.range === 'string' ? entry.range : '<absent>',
            direct: entry.isDirect === true,
            advisories: advisoriesOf(entry),
            viaPackages: (entry.via ?? []).filter((v) => typeof v === 'string'),
            titles: (entry.via ?? [])
                .filter((v) => typeof v === 'object' && v?.title)
                .map((v) => v.title),
            nodes,
            scope,
            fixAvailable: entry.fixAvailable
        });
    }

    // npm computes `metadata.vulnerabilities` itself. If our per-entry tally
    // disagrees, one of the two halves of the document is truncated and neither
    // can be trusted.
    const declared = report.metadata.vulnerabilities;
    for (const severity of SEVERITIES) {
        if (observed[severity] !== declared[severity]) {
            indeterminate(
                `report is internally inconsistent: metadata claims ${declared[severity]} ` +
                    `"${severity}" finding(s), the entries contain ${observed[severity]}`
            );
        }
    }

    return findings;
}

// ── Waivers ───────────────────────────────────────────────────────────────
//
// The waiver file is an integrity surface: a malformed one means the policy
// cannot be evaluated (2), while a waiver that simply does not hold up -
// expired, aimed at the wrong package, severity or advisory, or covering
// nothing at all - means the policy was violated (1). Nothing here can be
// implied, defaulted or inferred; every field is mandatory and exact.

const WAIVER_FIELDS = [
    'ecosystem',
    'package',
    'advisory',
    'severity',
    'justification',
    'issue',
    'owner',
    'created',
    'expires'
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/;

function loadWaivers(path) {
    if (!path) return [];

    const document = readJsonFile('waiver file', path);
    if (document.version !== 1) {
        indeterminate(
            `waiver file schema version is ${JSON.stringify(document.version ?? null)}, expected 1`
        );
    }
    if (!Array.isArray(document.waivers))
        indeterminate('waiver file has no waivers array');

    const seen = new Set();
    return document.waivers.map((waiver, index) => {
        if (typeof waiver !== 'object' || waiver === null)
            indeterminate(`waiver #${index} is not an object`);
        for (const field of WAIVER_FIELDS) {
            const value = waiver[field];
            if (typeof value !== 'string' || value.trim() === '') {
                indeterminate(
                    `waiver #${index} is missing a non-empty "${field}"`
                );
            }
        }
        if (waiver.ecosystem !== 'npm') {
            indeterminate(
                `waiver #${index} targets ecosystem "${waiver.ecosystem}"; this gate only evaluates "npm"`
            );
        }
        if (/[*?]/.test(waiver.package)) {
            indeterminate(
                `waiver #${index} uses a wildcard package pattern: ${waiver.package}`
            );
        }
        if (
            !ADVISORY_PATTERN.test(waiver.advisory) ||
            !waiver.advisory.toUpperCase().startsWith('GHSA-')
        ) {
            indeterminate(
                `waiver #${index} advisory must be a GHSA identifier, got: ${waiver.advisory}`
            );
        }
        if (!SEVERITIES.includes(waiver.severity)) {
            indeterminate(
                `waiver #${index} has an unknown severity: ${waiver.severity}`
            );
        }
        // A tracking issue is checked for shape only. Resolving it would make
        // the gate depend on GitHub's availability and on a token, which would
        // turn a network blip into a policy verdict.
        if (!ISSUE_URL.test(waiver.issue)) {
            indeterminate(
                `waiver #${index} issue must be a GitHub issue URL, got: ${waiver.issue}`
            );
        }
        for (const field of ['created', 'expires']) {
            const value = waiver[field];
            if (
                !ISO_DATE.test(value) ||
                Number.isNaN(Date.parse(`${value}T00:00:00Z`))
            ) {
                indeterminate(
                    `waiver #${index} has a malformed ${field} date: ${value}`
                );
            }
        }

        const key = `${waiver.ecosystem}|${waiver.package}|${waiver.advisory.toUpperCase()}`;
        if (seen.has(key))
            indeterminate(
                `duplicate waiver for ${waiver.package} ${waiver.advisory}`
            );
        seen.add(key);

        return {
            ...waiver,
            advisory: waiver.advisory.toUpperCase(),
            index,
            used: false
        };
    });
}

/**
 * Resolves whether one finding is fully covered.
 *
 * A finding carrying its own advisories is covered only when *every* one of
 * them has an exact, unexpired waiver naming the same package and severity. A
 * finding with no advisories of its own exists purely as the downstream effect
 * of another vulnerable package, so it is covered only when every package it
 * comes through is itself fully covered. Both readings refuse in the ambiguous
 * direction, and a cycle in the effect graph resolves to "not covered".
 */
function makeCoverage(findings, waivers, today) {
    const byName = new Map(findings.map((finding) => [finding.name, finding]));
    const cache = new Map();
    const expired = [];

    const matchFor = (finding, advisory) =>
        waivers.find(
            (waiver) =>
                waiver.package === finding.name &&
                waiver.severity === finding.severity &&
                waiver.advisory === advisory
        );

    const covered = (finding, stack) => {
        if (cache.has(finding.name)) return cache.get(finding.name);
        if (stack.has(finding.name)) return false;
        stack.add(finding.name);

        let result;
        if (finding.advisories.size > 0) {
            result = [...finding.advisories].every((advisory) => {
                const waiver = matchFor(finding, advisory);
                if (!waiver) return false;
                waiver.used = true;
                if (waiver.expires < today) {
                    expired.push({ finding, waiver });
                    return false;
                }
                return true;
            });
        } else if (finding.viaPackages.length > 0) {
            result = finding.viaPackages.every((name) => {
                const parent = byName.get(name);
                return parent ? covered(parent, stack) : false;
            });
        } else {
            result = false;
        }

        stack.delete(finding.name);
        cache.set(finding.name, result);
        return result;
    };

    return { covered: (finding) => covered(finding, new Set()), expired };
}

// ── Summary ───────────────────────────────────────────────────────────────

function renderSummary({
    label,
    counts,
    dependencies,
    findings,
    blocking,
    waived,
    stale,
    expired
}) {
    const lines = [];
    const push = (line = '') => lines.push(line);

    push(`## npm dependency audit — ${label}`);
    push();
    push('| | |');
    push('|---|---|');
    push(
        `| Dependencies inspected | ${dependencies.total} ` +
            `(${dependencies.prod ?? 0} production, ${dependencies.dev ?? 0} development, ` +
            `${dependencies.optional ?? 0} optional) |`
    );
    push(
        `| Findings | ${counts.critical} critical, ${counts.high} high, ` +
            `${counts.moderate} moderate, ${counts.low} low, ${counts.info} info |`
    );
    push(`| Blocking | ${blocking.length} |`);
    push(`| Waived | ${waived.length} |`);
    push(`| Stale waivers | ${stale.length} |`);
    push();

    if (blocking.length > 0) {
        push('### Blocking (high/critical, unresolved)');
        push();
        push(
            '| Severity | Package | Affected | Kind | Scope | Advisories | Remediation |'
        );
        push('|---|---|---|---|---|---|---|');
        for (const finding of blocking) {
            const advisories =
                finding.advisories.size > 0
                    ? [...finding.advisories].join(', ')
                    : `via ${finding.viaPackages.join(', ') || '(unknown)'}`;
            let remediation = 'none published';
            if (finding.fixAvailable === true)
                remediation = 'compatible upgrade available';
            else if (
                typeof finding.fixAvailable === 'object' &&
                finding.fixAvailable !== null
            ) {
                remediation =
                    `${finding.fixAvailable.name}@${finding.fixAvailable.version}` +
                    (finding.fixAvailable.isSemVerMajor
                        ? ' (breaking)'
                        : ' (compatible)');
            }
            push(
                `| ${finding.severity} | \`${finding.name}\` | ${finding.range} | ` +
                    `${finding.direct ? 'direct' : 'transitive'} | ${finding.scope} | ` +
                    `${advisories} | ${remediation} |`
            );
        }
        push();
    }

    if (expired.length > 0) {
        push('### Expired waivers');
        push();
        for (const { finding, waiver } of expired) {
            push(
                `- \`${finding.name}\` ${waiver.advisory} expired ${waiver.expires}`
            );
        }
        push();
    }

    if (waived.length > 0) {
        push('### Waived');
        push();
        for (const finding of waived) {
            push(
                `- ${finding.severity} \`${finding.name}\` ${[...finding.advisories].join(', ')}`
            );
        }
        push();
    }

    if (stale.length > 0) {
        push('### Stale waivers (match no current finding)');
        push();
        for (const waiver of stale)
            push(`- \`${waiver.package}\` ${waiver.advisory}`);
        push();
    }

    const informational = findings.filter(
        (finding) => !BLOCKING_SEVERITIES.has(finding.severity)
    );
    if (informational.length > 0) {
        push('### Reported, not blocking (info/low/moderate)');
        push();
        for (const finding of informational) {
            push(
                `- ${finding.severity} \`${finding.name}\` ${finding.range} ` +
                    `(${finding.direct ? 'direct' : 'transitive'}, ${finding.scope})`
            );
        }
        push();
    }

    return `${lines.join('\n')}\n`;
}

// ── Entry point ───────────────────────────────────────────────────────────

function main(argv) {
    const options = parseArgs(argv);
    const reportPath = options.scan ? runScan(options) : options.report;

    const report = readJsonFile('report', reportPath);
    const { counts, dependencies } = validateReport(report, reportPath);
    const scopes = readLockfileScopes(options.lockfile);
    const findings = collectFindings(report, scopes);
    const waivers = loadWaivers(options.waivers);

    const today = new Date().toISOString().slice(0, 10);
    const { covered, expired } = makeCoverage(findings, waivers, today);

    const blocking = [];
    const waived = [];
    for (const finding of findings) {
        if (!BLOCKING_SEVERITIES.has(finding.severity)) continue;
        if (covered(finding)) waived.push(finding);
        else blocking.push(finding);
    }

    // A waiver that matches nothing is a lie about the current graph - either
    // the finding was fixed and nobody removed the waiver, or it never applied.
    const stale = waivers.filter((waiver) => !waiver.used);

    const verdict =
        blocking.length > 0 || stale.length > 0 ? EXIT_POLICY : EXIT_CLEAN;
    const label = verdict === EXIT_CLEAN ? 'CLEAN' : 'POLICY VIOLATION';

    const summary = renderSummary({
        label,
        counts,
        dependencies,
        findings,
        blocking,
        waived,
        stale,
        expired
    });
    if (options.summary) writeFileSync(options.summary, summary);
    process.stdout.write(summary);
    process.stdout.write(`\ndependency-audit: ${label} (exit ${verdict})\n`);
    process.stdout.write(
        `dependency-audit: report retained at ${reportPath}\n`
    );

    return verdict;
}

try {
    process.exitCode = main(process.argv.slice(2));
} catch (err) {
    // Anything unexpected is a failure to answer the question, never a pass:
    // an evaluator that crashes has proven nothing about the dependency graph.
    const reason =
        err instanceof Indeterminate
            ? err.message
            : `evaluator failure: ${err.stack ?? err.message}`;
    process.stderr.write(`dependency-audit: INDETERMINATE: ${reason}\n`);
    process.exitCode = EXIT_INDETERMINATE;
}

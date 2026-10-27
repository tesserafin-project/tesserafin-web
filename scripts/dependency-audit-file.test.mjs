import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const AUDIT = fileURLToPath(new URL('./dependency-audit.mjs', import.meta.url));
const PROBE = fileURLToPath(
    new URL('./fixtures/dependency-audit/fs-read-probe.mjs', import.meta.url)
);
const ADVISORY = 'GHSA-cccc-cccc-cccc';
const LOCK = {
    lockfileVersion: 3,
    packages: { 'node_modules/blocked-package': { version: '1.0.0' } }
};
const EMPTY_WAIVERS = { version: 1, waivers: [] };
const VALID_WAIVERS = {
    version: 1,
    waivers: [
        {
            ecosystem: 'npm',
            package: 'blocked-package',
            advisory: ADVISORY,
            severity: 'high',
            justification: 'test fixture',
            owner: 'test-owner',
            issue: 'https://github.com/tesserafin-project/tesserafin/issues/185',
            created: '2026-01-01',
            expires: '2099-01-01'
        }
    ]
};

function report(high = false) {
    return {
        auditReportVersion: 2,
        vulnerabilities: high
            ? {
                  'blocked-package': {
                      severity: 'high',
                      isDirect: true,
                      via: [
                          { url: `https://github.com/advisories/${ADVISORY}` }
                      ],
                      nodes: ['node_modules/blocked-package']
                  }
              }
            : {},
        metadata: {
            vulnerabilities: {
                info: 0,
                low: 0,
                moderate: 0,
                high: high ? 1 : 0,
                critical: 0,
                total: high ? 1 : 0
            },
            dependencies: { total: 1 }
        }
    };
}

function fixture(t, high = false) {
    const cwd = mkdtempSync(join(tmpdir(), 'audit-file-control-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const paths = {
        report: join(cwd, 'report.json'),
        lock: join(cwd, 'lock.json'),
        waivers: join(cwd, 'waivers.json'),
        evidence: join(cwd, 'evidence.json'),
        replacement: join(cwd, 'replacement.json')
    };
    const write = (path, value) => writeFileSync(path, JSON.stringify(value));
    write(paths.report, report(high));
    write(paths.lock, LOCK);
    write(paths.waivers, EMPTY_WAIVERS);
    return { cwd, paths, write };
}

function run(f, target = f.paths.report, mode = 'observe') {
    const result = spawnSync(
        process.execPath,
        [
            '--import',
            PROBE,
            AUDIT,
            '--report',
            f.paths.report,
            '--lockfile',
            f.paths.lock,
            '--waivers',
            f.paths.waivers
        ],
        {
            encoding: 'utf8',
            timeout: 5000,
            env: {
                ...process.env,
                AUDIT_PROBE_TARGET: target,
                AUDIT_PROBE_MODE: mode,
                AUDIT_PROBE_REPLACEMENT: f.paths.replacement,
                AUDIT_PROBE_EVIDENCE: f.paths.evidence
            }
        }
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    const evidence = JSON.parse(readFileSync(f.paths.evidence, 'utf8'));
    assert.equal(evidence.active, 0, 'input descriptor leaked');
    assert.equal(
        evidence.closes,
        evidence.opens,
        'input descriptor not closed'
    );
    return { ...result, evidence };
}

test('a clean report remains clean and its input descriptor closes', (t) => {
    const result = run(fixture(t));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /dependency-audit: CLEAN \(exit 0\)/);
    assert.equal(result.evidence.opens, 1);
});

test('replacing a high report with a clean one cannot erase the finding', (t) => {
    const f = fixture(t, true);
    f.write(f.paths.replacement, report());
    const result = run(f, f.paths.report, 'replace');
    assert.equal(result.evidence.fired, true, 'replacement did not run');
    assert.deepEqual(
        JSON.parse(readFileSync(f.paths.report, 'utf8')),
        report()
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /POLICY VIOLATION/);
    assert.match(result.stdout, /blocked-package/);
});

test('replacing an invalid lockfile cannot validate a different graph', (t) => {
    const f = fixture(t);
    f.write(f.paths.lock, { ...LOCK, lockfileVersion: 2 });
    f.write(f.paths.replacement, LOCK);
    const result = run(f, f.paths.lock, 'replace');
    assert.equal(result.evidence.fired, true, 'replacement did not run');
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /unexpected lockfileVersion 2/);
});

test('replacing an empty waiver set cannot authorize a high finding', (t) => {
    const f = fixture(t, true);
    f.write(f.paths.replacement, VALID_WAIVERS);
    const result = run(f, f.paths.waivers, 'replace');
    assert.equal(result.evidence.fired, true, 'replacement did not run');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /POLICY VIOLATION/);
    assert.doesNotMatch(result.stdout, /COMPLIANT WITH TEMPORARY WAIVER/);
});

for (const mode of ['metadata-error', 'read-error']) {
    test(`${mode} is indeterminate and closes the opened input`, (t) => {
        const result = run(fixture(t), undefined, mode);
        assert.equal(result.evidence.fired, true, 'injected error did not run');
        assert.equal(result.status, 2, result.stdout + result.stderr);
        assert.match(result.stderr, /INDETERMINATE/);
        assert.match(result.stderr, /injected .* read failure/);
        assert.equal(result.evidence.opens, 1);
    });
}

test('an empty input is indeterminate without reading its contents', (t) => {
    const f = fixture(t);
    writeFileSync(f.paths.report, '');
    const result = run(f);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /report is empty/);
    assert.equal(result.evidence.reads, 0);
});

test('a directory is indeterminate without reading its contents', (t) => {
    const f = fixture(t);
    rmSync(f.paths.report);
    mkdirSync(f.paths.report);
    const result = run(f);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(result.evidence.reads, 0);
    assert.match(result.stderr, /INDETERMINATE/);
});

test('a missing input is indeterminate and opens no descriptor', (t) => {
    const f = fixture(t);
    rmSync(f.paths.report);
    const result = run(f);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(result.evidence.opens, 0);
    assert.match(result.stderr, /missing report/);
});

test('a live file symlink retains the existing report semantics', {
    skip: process.platform === 'win32' && 'symlink privileges not assumed'
}, (t) => {
    const f = fixture(t, true);
    f.write(f.paths.replacement, report(true));
    rmSync(f.paths.report);
    symlinkSync(f.paths.replacement, f.paths.report);
    const result = run(f);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /POLICY VIOLATION/);
});

test('a FIFO with no writer is rejected without blocking at open', {
    skip: process.platform === 'win32' && 'POSIX FIFO control'
}, (t) => {
    const f = fixture(t);
    rmSync(f.paths.report);
    execFileSync('mkfifo', [f.paths.report]);
    const result = run(f);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /not a regular file/);
    assert.equal(result.evidence.reads, 0);
});

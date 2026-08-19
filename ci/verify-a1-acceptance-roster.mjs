#!/usr/bin/env node
/*
 * #153-A1-R2 phase 1 — the acceptance roster gate.
 *
 * WHY THIS EXISTS
 *
 *   `tests/playbackCredential/baselineTrace.spec.ts` was a PRE-MIGRATION characterization probe
 *   sitting inside the acceptance directory. `playwright.credential.config.ts` resolves that whole
 *   directory, so the probe was aggregated into candidate acceptance and made the migrated suite
 *   permanently red. Marking it `skip`/`fixme`/`fail` would have been the other half of the same
 *   defect: a red result kept inside the suite while the suite reports green.
 *
 *   It now lives in `tests/playbackCredentialBaseline/` with its own config, so the acceptance
 *   suite cannot reach it by construction. This gate is what stops that arrangement decaying.
 *
 * WHAT IT ASSERTS, AND HOW EACH ONE FAILS
 *
 *   1. The acceptance suite resolves EXACTLY `ACCEPTANCE_ROSTER`. Both directions fail: a required
 *      spec deleted or renamed is `missing`, and any new file that appears is `unexpected`. A gate
 *      that only checked for extras would let someone delete a spec and go green by absence, which
 *      is the failure mode the whole #153-A1-R2 phase 1 exists to remove.
 *   2. `baselineTrace.spec.ts` is not in the resolved list.
 *   3. It is not in the acceptance directory AT ALL — the structural half. Assertion 2 alone would
 *      pass if the file were readmitted to the directory and then filtered out again by a
 *      `testIgnore` line, and a filter is one edit from being switched off.
 *   4. The acceptance config still points at the acceptance directory, so nobody satisfies 1-3 by
 *      repointing `testDir` at an empty folder.
 *   5. The probe is still EXECUTABLE through its own config, which resolves it and nothing else.
 *      Keeping it runnable is a requirement, not a courtesy: a probe nobody can run is deleted
 *      evidence.
 *   6. The probe is not neutralized with `test.skip` / `test.fixme` / `test.fail`, and no
 *      acceptance test is annotated skipped. The acceptance suite must finish with zero skipped.
 *
 * The roster is read from the REAL Playwright resolution (`--list --reporter=json`), not from a
 * glob of the directory: what the suite actually contains is the only thing worth asserting.
 *
 * USAGE
 *
 *   node ci/verify-a1-acceptance-roster.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = '[verify:a1-acceptance-roster]';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ACCEPTANCE_CONFIG = 'playwright.credential.config.ts';
const BASELINE_CONFIG = 'playwright.credentialBaseline.config.ts';
const ACCEPTANCE_DIR = join('tests', 'playbackCredential');
const BASELINE_DIR = join('tests', 'playbackCredentialBaseline');
const BASELINE_SPEC = 'baselineTrace.spec.ts';

/**
 * The exact spec files the post-migration acceptance suite must contain.
 *
 * Adding a spec to the directory without adding it here fails as `unexpected`; that is deliberate,
 * so the roster is a reviewed list rather than whatever happens to be on disk.
 */
const ACCEPTANCE_ROSTER = [
    'audioRevocation.spec.ts',
    'dependencyDisclosure.spec.ts',
    'directPlayRevocation.spec.ts',
    'disclosure.spec.ts',
    'libassFamilies.spec.ts',
    'longPlayback.spec.ts',
    'matrix.spec.ts',
    'migratedTrace.spec.ts',
    'reloginRuntime.spec.ts'
];

const failures = [];
const fail = (message) => failures.push(message);

/** Resolve one Playwright config to its spec files and per-test annotations. */
function resolveSuite(configFile) {
    let raw;
    try {
        raw = execFileSync(
            'npx',
            [
                'playwright',
                'test',
                '--config',
                configFile,
                '--list',
                '--reporter=json'
            ],
            {
                cwd: REPO_ROOT,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );
    } catch (error) {
        throw new Error(
            `${configFile} could not be listed by Playwright: ${error.message}`
        );
    }
    const report = JSON.parse(raw);
    const files = new Set();
    const skipped = [];
    const walk = (suite) => {
        for (const child of suite.suites ?? []) walk(child);
        for (const spec of suite.specs ?? []) {
            const file = suite.file ?? spec.file;
            if (file) files.add(file);
            for (const test of spec.tests ?? []) {
                // Playwright reports a `skip`/`fixme` annotation as an expected status of 'skipped'.
                if (test.expectedStatus === 'skipped') {
                    skipped.push(`${file} >> ${spec.title}`);
                }
            }
        }
    };
    for (const suite of report.suites ?? []) walk(suite);
    return { files: [...files].sort(), skipped };
}

// ---------------------------------------------------------------- 4. config still points at the
// acceptance directory (checked first: assertions 1-3 are meaningless if it does not)
const acceptanceConfigSource = readFileSync(
    join(REPO_ROOT, ACCEPTANCE_CONFIG),
    'utf8'
);
if (
    !acceptanceConfigSource.includes(
        `'./${ACCEPTANCE_DIR.replace(/\\/g, '/')}'`
    )
) {
    fail(
        `${ACCEPTANCE_CONFIG} no longer declares testDir './${ACCEPTANCE_DIR}'. The roster below ` +
            'would then be asserted against some other directory, which proves nothing.'
    );
}

// ---------------------------------------------------------------- 3. structural exclusion
if (existsSync(join(REPO_ROOT, ACCEPTANCE_DIR, BASELINE_SPEC))) {
    fail(
        `${join(ACCEPTANCE_DIR, BASELINE_SPEC)} exists. The pre-migration probe must live in ` +
            `${BASELINE_DIR}/ so that no filter edit can readmit it to the acceptance suite.`
    );
}
if (!existsSync(join(REPO_ROOT, BASELINE_DIR, BASELINE_SPEC))) {
    fail(
        `${join(BASELINE_DIR, BASELINE_SPEC)} is missing. The historical probe must stay ` +
            'executable; deleting it destroys the pre-migration measurement.'
    );
}

// ---------------------------------------------------------------- 6. not neutralized in source
if (existsSync(join(REPO_ROOT, BASELINE_DIR, BASELINE_SPEC))) {
    const probeSource = readFileSync(
        join(REPO_ROOT, BASELINE_DIR, BASELINE_SPEC),
        'utf8'
    );
    for (const annotation of ['test.skip(', 'test.fixme(', 'test.fail(']) {
        if (probeSource.includes(annotation)) {
            fail(
                `${BASELINE_SPEC} uses \`${annotation}\`. The probe must be allowed to fail ` +
                    'honestly when it is deliberately run; it must not be marked expected-failing.'
            );
        }
    }
}

// ---------------------------------------------------------------- 1 & 2. the resolved roster
const acceptance = resolveSuite(ACCEPTANCE_CONFIG);
const expected = [...ACCEPTANCE_ROSTER].sort();
const missing = expected.filter((name) => !acceptance.files.includes(name));
const unexpected = acceptance.files.filter((name) => !expected.includes(name));

if (missing.length > 0) {
    fail(
        `the acceptance suite is MISSING required spec(s): ${missing.join(', ')}. A required ` +
            'spec that stops being collected makes the suite green by absence.'
    );
}
if (unexpected.length > 0) {
    fail(
        `the acceptance suite collected UNDECLARED spec(s): ${unexpected.join(', ')}. Add them to ` +
            'ACCEPTANCE_ROSTER deliberately, in review, or move them out of the directory.'
    );
}
if (acceptance.files.includes(BASELINE_SPEC)) {
    fail(
        `${BASELINE_SPEC} entered the acceptance suite. It is a pre-migration probe and its result ` +
            'must never be aggregated into candidate acceptance.'
    );
}
if (acceptance.skipped.length > 0) {
    fail(
        `the acceptance suite declares skipped test(s): ${acceptance.skipped.join('; ')}. The A1 ` +
            'credential suite must finish with zero skipped.'
    );
}

// ---------------------------------------------------------------- 5. the probe is still runnable
if (!existsSync(join(REPO_ROOT, BASELINE_CONFIG))) {
    fail(`${BASELINE_CONFIG} is missing; the probe has no opt-in command.`);
} else {
    const baseline = resolveSuite(BASELINE_CONFIG);
    if (baseline.files.length !== 1 || baseline.files[0] !== BASELINE_SPEC) {
        fail(
            `${BASELINE_CONFIG} resolves [${baseline.files.join(', ')}]; it must resolve exactly ` +
                `[${BASELINE_SPEC}].`
        );
    }
    if (baseline.skipped.length > 0) {
        fail(
            `${BASELINE_SPEC} is annotated skipped. Run it or do not, but do not report a ` +
                'neutralized probe as a result.'
        );
    }
}

if (failures.length > 0) {
    console.error(`${TAG} FAIL:`);
    for (const message of failures) console.error(`  - ${message}`);
    process.exit(1);
}

console.log(
    `${TAG} PASS: acceptance suite resolves exactly ${expected.length} declared spec(s), ` +
        `0 skipped; ${BASELINE_SPEC} is outside the acceptance directory and runnable via ` +
        `${BASELINE_CONFIG}.`
);

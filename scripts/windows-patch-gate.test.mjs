import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
    mkdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
    attest,
    classify,
    CRITICAL_PATHS,
    expectedHead,
    relevant,
    REQUIRED_STEPS,
    verdict
} from '../ci/windows-patch-gate.mjs';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const steps = () =>
    Object.fromEntries(
        REQUIRED_STEPS.map((id) => [
            id,
            { outcome: 'success', conclusion: 'success' }
        ])
    );
const valid = () => ({
    classification: 'success',
    relevance: 'true',
    classifiedHead: HEAD,
    windows: 'success',
    completed: 'true',
    testedHead: HEAD,
    expected: HEAD
});

test('all lifecycle inputs are critical, including Node, npm and both postinstall scripts', () => {
    for (const path of CRITICAL_PATHS)
        assert.equal(relevant([path]), true, path);
    for (const path of [
        '.nvmrc',
        '.npmrc',
        '.gitattributes',
        'scripts/patch-jellyfin-sdk.mjs'
    ]) {
        assert.equal(relevant([path]), true);
    }
    assert.equal(
        relevant(['README.md', 'src/styles/site.scss', 'docs/.nvmrc.md']),
        false
    );
    assert.equal(relevant(['README.md', '.nvmrc']), true);
});

test('PRs select the head, never the synthetic merge SHA; non-PR runs select github.sha', () => {
    assert.equal(
        expectedHead(
            'pull_request',
            { pull_request: { head: { sha: HEAD } } },
            OTHER
        ),
        HEAD
    );
    assert.equal(expectedHead('workflow_dispatch', {}, OTHER), OTHER);
    for (const value of ['', undefined, 'main', `${HEAD};echo unsafe`]) {
        assert.throws(() => expectedHead('workflow_dispatch', {}, value));
    }
    assert.throws(() => expectedHead('pull_request', {}, HEAD));
});

test('only a complete successful Windows run on this head passes a relevant change', () => {
    assert.match(verdict(valid()), /executed and passed/);
    for (const windows of [
        'skipped',
        'failure',
        'cancelled',
        '',
        undefined,
        'neutral'
    ]) {
        assert.throws(() => verdict({ ...valid(), windows }), String(windows));
    }
    for (const patch of [
        { completed: '' },
        { completed: 'false' },
        { completed: true },
        { testedHead: '' },
        { testedHead: OTHER },
        { classifiedHead: OTHER },
        { relevance: '' },
        { relevance: undefined },
        { relevance: 'TRUE' },
        { classification: 'failure' },
        { classification: 'skipped' },
        { classification: 'cancelled' },
        { classification: undefined }
    ])
        assert.throws(() => verdict({ ...valid(), ...patch }));
});

test('irrelevant changes pass without Windows, but not without successful classification', () => {
    const input = {
        ...valid(),
        relevance: 'false',
        windows: 'skipped',
        completed: '',
        testedHead: ''
    };
    assert.match(verdict(input), /not allocated/);
    for (const windows of ['success', 'failure', 'cancelled', undefined]) {
        assert.throws(() => verdict({ ...input, windows }));
    }
    assert.throws(() => verdict({ ...input, classification: 'failure' }));
    assert.throws(() => verdict({ ...input, completed: 'true' }));
});

test('each mandatory Windows step must have actually succeeded; ignored failures are refused', () => {
    assert.deepEqual(attest(steps(), HEAD, HEAD), {
        completed: 'true',
        head: HEAD
    });
    assert.throws(() => attest(steps(), HEAD, OTHER));
    for (const id of REQUIRED_STEPS) {
        const missing = steps();
        delete missing[id];
        assert.throws(() => attest(missing, HEAD, HEAD), id);
        for (const outcome of ['skipped', 'failure', 'cancelled', undefined]) {
            const evidence = steps();
            evidence[id] = { outcome, conclusion: 'success' };
            assert.throws(
                () => attest(evidence, HEAD, HEAD),
                `${id}: ${outcome}`
            );
        }
        const evidence = steps();
        evidence[id].conclusion = 'skipped';
        assert.throws(() => attest(evidence, HEAD, HEAD));
    }
});

function repo(fn) {
    const cwd = mkdtempSync(join(tmpdir(), 'windows-patch-gate-'));
    const git = (...args) =>
        execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
    const write = (path, text) => {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), text);
    };
    const commit = () => {
        git('add', '-A');
        git('commit', '-qm', 'fixture');
        return git('rev-parse', 'HEAD');
    };
    try {
        git('init', '--quiet');
        git('config', 'user.name', 'Fixture');
        git('config', 'user.email', 'fixture@example.invalid');
        write('.nvmrc', '24\n');
        write('README.md', 'fixture\n');
        const base = commit();
        fn({ cwd, git, write, commit, base });
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}

const event = (base, head) => ({
    pull_request: { base: { sha: base }, head: { sha: head } }
});

test('real Git diff handles docs-only, deletions, renames and newline filenames', () => {
    repo(({ cwd, git, write, commit, base }) => {
        write('docs/unusual\nname.md', 'safe filename\n');
        let head = commit();
        assert.equal(
            classify('pull_request', event(base, head), OTHER, cwd).relevant,
            false
        );
        git('mv', '.nvmrc', 'docs/version\nname.txt');
        head = commit();
        assert.equal(
            classify('pull_request', event(base, head), OTHER, cwd).relevant,
            true
        );
        assert.equal(
            classify('pull_request', event(base, head), OTHER, cwd)
                .changedFiles,
            3
        );
        assert.throws(() =>
            classify('pull_request', event(base, OTHER), OTHER, cwd)
        );
    });
    repo(({ cwd, git, commit, base }) => {
        git('rm', '.nvmrc');
        const head = commit();
        assert.equal(
            classify('pull_request', event(base, head), OTHER, cwd).relevant,
            true
        );
    });
});

test('merge-base diff excludes unrelated upstream changes; manual runs require Windows', () => {
    repo(({ cwd, git, write, commit, base }) => {
        write('README.md', 'only the PR docs\n');
        const head = commit();
        git('checkout', '--detach', base);
        write('.nvmrc', '26\n');
        const upstream = commit();
        git('checkout', '--detach', head);
        assert.equal(
            classify('pull_request', event(upstream, head), OTHER, cwd)
                .relevant,
            false
        );
        assert.equal(
            classify('workflow_dispatch', {}, head, cwd).relevant,
            true
        );
        assert.equal(classify('push', {}, head, cwd).relevant, true);
    });
});

test('CLI emits exact outputs and exits nonzero when required evidence is missing', () => {
    repo(({ cwd, base }) => {
        const script = fileURLToPath(
            new URL('../ci/windows-patch-gate.mjs', import.meta.url)
        );
        const eventFile = join(cwd, 'event.json');
        const outputFile = join(cwd, 'outputs');
        writeFileSync(eventFile, JSON.stringify(event(base, base)));
        const env = {
            ...process.env,
            GITHUB_EVENT_PATH: eventFile,
            GITHUB_EVENT_NAME: 'pull_request',
            GITHUB_SHA: OTHER,
            GITHUB_OUTPUT: outputFile,
            CLASSIFICATION_RESULT: 'success',
            RELEVANT: 'true',
            CLASSIFIED_HEAD: base,
            WINDOWS_RESULT: 'skipped',
            WINDOWS_COMPLETED: '',
            TESTED_HEAD: ''
        };
        let result = spawnSync(process.execPath, [script, 'classify'], {
            cwd,
            env,
            encoding: 'utf8'
        });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
            readFileSync(outputFile, 'utf8'),
            `head=${base}\nrelevant=false\n`
        );
        result = spawnSync(process.execPath, [script, 'verdict'], {
            cwd,
            env,
            encoding: 'utf8'
        });
        assert.equal(result.status, 1);
        env.STEP_RESULTS = JSON.stringify(steps());
        result = spawnSync(process.execPath, [script, 'attest'], {
            cwd,
            env,
            encoding: 'utf8'
        });
        assert.equal(result.status, 0, result.stderr);
        assert.ok(
            readFileSync(outputFile, 'utf8').endsWith(
                `completed=true\nhead=${base}\n`
            )
        );
    });
});

test('workflow always emits a gate, has no PR path filter, and records all required steps', () => {
    const workflow = readFileSync(
        new URL(
            '../.github/workflows/ci-windows-dependency-patch.yml',
            import.meta.url
        ),
        'utf8'
    );
    assert.doesNotMatch(
        workflow.split('permissions:')[0],
        /^\s+paths(?:-ignore)?:/m
    );
    const gate = workflow.split('\n  gate:\n')[1];
    assert.match(gate, /name: Windows patch gate/);
    assert.match(gate, /if: \$\{\{ always\(\) \}\}/);
    assert.match(gate, /needs: \[classify, windows-patch\]/);
    assert.doesNotMatch(workflow, /continue-on-error:/);
    for (const id of REQUIRED_STEPS)
        assert.ok(workflow.includes(`id: ${id}\n`), id);
    assert.match(workflow, /STEP_RESULTS: \$\{\{ toJSON\(steps\) \}\}/);
    assert.match(
        workflow,
        /WINDOWS_COMPLETED: \$\{\{ needs.windows-patch.outputs.completed \}\}/
    );
});

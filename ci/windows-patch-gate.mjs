import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CRITICAL_PATHS = new Set([
    '.nvmrc',
    '.npmrc',
    '.gitattributes',
    'package.json',
    'package-lock.json',
    'scripts/patch-jellyfin-apiclient.mjs',
    'scripts/jellyfin-apiclient-patch.test.mjs',
    // Both run during postinstall; either can break npm ci on Windows.
    'scripts/patch-jellyfin-sdk.mjs',
    'scripts/jellyfin-sdk-patch.test.mjs',
    '.github/workflows/ci-windows-dependency-patch.yml',
    'ci/windows-patch-gate.mjs',
    'scripts/windows-patch-gate.test.mjs'
]);

export const REQUIRED_STEPS = [
    'checkout',
    'setup-node',
    'install',
    'digest',
    'sourcemap',
    'residue',
    'verify',
    'controls'
];

function sha(value) {
    if (!/^[a-f0-9]{40}$/.test(value ?? ''))
        throw new Error('Invalid commit SHA');
    return value;
}

export function expectedHead(eventName, event, githubSha) {
    return sha(
        eventName === 'pull_request' ? event.pull_request?.head?.sha : githubSha
    );
}

export function relevant(paths) {
    return paths.some((path) => CRITICAL_PATHS.has(path));
}

export function classify(eventName, event, githubSha, cwd) {
    const head = expectedHead(eventName, event, githubSha);
    const git = (...args) =>
        execFileSync('git', args, { cwd, encoding: 'utf8' });
    if (git('rev-parse', 'HEAD').trim() !== head)
        throw new Error('Checkout is not the expected head');
    // Manual/reusable non-PR runs prove the complete lifecycle, never opt out.
    if (eventName !== 'pull_request')
        return { head, relevant: true, changedFiles: null };
    const base = sha(event.pull_request?.base?.sha);
    // Full history supplies the merge base. --no-renames includes BOTH names of
    // a rename; NUL delimiters preserve spaces/newlines without shell expansion.
    const files = git(
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        `${base}...${head}`,
        '--'
    )
        .split('\0')
        .filter(Boolean);
    return { head, relevant: relevant(files), changedFiles: files.length };
}

export function attest(steps, expected, actual) {
    sha(expected);
    if (actual !== expected)
        throw new Error('Windows tested a different commit');
    for (const id of REQUIRED_STEPS) {
        if (
            steps[id]?.outcome !== 'success' ||
            steps[id]?.conclusion !== 'success'
        ) {
            throw new Error(`Windows step did not execute successfully: ${id}`);
        }
    }
    return { completed: 'true', head: expected };
}

export function verdict({
    classification,
    relevance,
    classifiedHead,
    windows,
    completed,
    testedHead,
    expected
}) {
    sha(expected);
    if (classification !== 'success' || classifiedHead !== expected) {
        throw new Error('Missing or unsuccessful classification for this head');
    }
    if (relevance === 'false') {
        if (windows !== 'skipped' || completed || testedHead) {
            throw new Error(
                'Unexpected Windows execution for an irrelevant change'
            );
        }
        return 'Not patch-critical; Windows was not allocated';
    }
    if (relevance !== 'true') throw new Error('Missing or invalid relevance');
    if (
        windows !== 'success' ||
        completed !== 'true' ||
        testedHead !== expected
    ) {
        throw new Error(
            'Required Windows lifecycle did not complete on this head'
        );
    }
    return 'Windows lifecycle executed and passed on the expected head';
}

function output(values) {
    if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GITHUB_OUTPUT');
    appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(values)
            .map(([key, value]) => `${key}=${value}\n`)
            .join('')
    );
}

function main() {
    const event = JSON.parse(
        readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
    );
    const expected = expectedHead(
        process.env.GITHUB_EVENT_NAME,
        event,
        process.env.GITHUB_SHA
    );
    switch (process.argv[2]) {
        case 'classify': {
            const result = classify(
                process.env.GITHUB_EVENT_NAME,
                event,
                process.env.GITHUB_SHA,
                process.cwd()
            );
            output({ head: result.head, relevant: String(result.relevant) });
            console.log(
                `Patch relevance: ${result.relevant}; changed files: ${result.changedFiles ?? 'full run'}`
            );
            break;
        }
        case 'attest': {
            const actual = execFileSync('git', ['rev-parse', 'HEAD'], {
                encoding: 'utf8'
            }).trim();
            output(
                attest(JSON.parse(process.env.STEP_RESULTS), expected, actual)
            );
            console.log('Every required Windows step executed successfully');
            break;
        }
        case 'verdict':
            console.log(
                verdict({
                    classification: process.env.CLASSIFICATION_RESULT,
                    relevance: process.env.RELEVANT,
                    classifiedHead: process.env.CLASSIFIED_HEAD,
                    windows: process.env.WINDOWS_RESULT,
                    completed: process.env.WINDOWS_COMPLETED,
                    testedHead: process.env.TESTED_HEAD,
                    expected
                })
            );
            break;
        default:
            throw new Error('Expected classify, attest or verdict');
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

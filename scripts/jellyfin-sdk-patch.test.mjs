#!/usr/bin/env node
/*
 * Controls for `scripts/patch-jellyfin-sdk.mjs` (#153-A1).
 *
 * Same shape as the jellyfin-apiclient controls: a staged fixture tree per case, the REAL patcher
 * run as a child process, and an assertion on what landed on disk. Nothing here mocks the patcher.
 *
 * OUTPUT SAFETY: no assertion prints package content. Failures name a fragment by index.
 */
import { spawnSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
    PACKAGE_NAME,
    PATCHED_SHA256,
    PRISTINE_SHA256,
    REQUIRED_VERSION,
    TARGET_RELATIVE,
    UNSAFE_FRAGMENTS,
    applyFragments
} from './patch-jellyfin-sdk.mjs';
import { sha256 } from './patch-jellyfin-apiclient.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PATCHER = join(HERE, 'patch-jellyfin-sdk.mjs');
const INSTALLED = join(REPO, 'node_modules', '@jellyfin', 'sdk');

const staged = [];
let failures = 0;

function check(label, assertions) {
    const problems = assertions.filter(Boolean);
    if (problems.length === 0) {
        process.stdout.write(`ok    ${label}\n`);
        return;
    }
    failures += 1;
    process.stdout.write(`FAIL  ${label}\n`);
    for (const problem of problems)
        process.stdout.write(`      - ${problem}\n`);
}

/**
 * The pristine file.
 *
 * The installed copy is patched by `postinstall`, so the pristine content is reconstructed by
 * inverting the transform — and then checked against the PINNED pristine hash, which is what makes
 * the reconstruction trustworthy rather than assumed.
 */
function pristineContent() {
    const installed = readFileSync(join(INSTALLED, TARGET_RELATIVE), 'utf8');
    if (sha256(installed) === PRISTINE_SHA256) return installed;
    let out = installed;
    for (const fragment of UNSAFE_FRAGMENTS) {
        out = out.split(fragment.safe).join(fragment.unsafe);
    }
    if (sha256(out) !== PRISTINE_SHA256) {
        throw new Error(
            'could not reconstruct pristine content from the installed package'
        );
    }
    return out;
}

const PRISTINE = pristineContent();

function stage({ content = PRISTINE, version = REQUIRED_VERSION } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'jf-sdk-patch-'));
    staged.push(root);
    const dir = join(root, 'node_modules', '@jellyfin', 'sdk');
    mkdirSync(join(dir, 'lib'), { recursive: true });
    // Copy the rest of the package so `resolvePackageDir` and the manifest read work as they do in
    // a real install, then overwrite the one file under test.
    cpSync(join(INSTALLED, 'package.json'), join(dir, 'package.json'));
    const manifest = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8')
    );
    manifest.version = version;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(join(dir, TARGET_RELATIVE), content, 'utf8');
    return root;
}

const targetPath = (root) =>
    join(root, 'node_modules', '@jellyfin', 'sdk', TARGET_RELATIVE);

function runPatcher(root, extra = []) {
    return spawnSync(process.execPath, [PATCHER, '--root', root, ...extra], {
        encoding: 'utf8'
    });
}

// ── 1. the happy path ────────────────────────────────────────────────────────────────────────
{
    const root = stage();
    const result = runPatcher(root);
    const after = readFileSync(targetPath(root), 'utf8');
    check('a pristine install is patched and matches the pinned patched hash', [
        result.status !== 0 &&
            `expected exit 0, got ${result.status}: ${result.stderr}`,
        sha256(after) !== PATCHED_SHA256 &&
            'the patched digest is not the pinned one',
        after.includes('AUTHORIZATION_PARAMETER]: this.accessToken') &&
            'a socket url still names the durable token',
        !after.includes('WebSocketService') &&
            'the WebSocketService construction is gone'
    ]);

    const second = runPatcher(root);
    check('a second run is idempotent and leaves the file byte-identical', [
        second.status !== 0 && `expected exit 0, got ${second.status}`,
        readFileSync(targetPath(root), 'utf8') !== after &&
            'the second run rewrote the file'
    ]);

    const verify = runPatcher(root, ['--verify']);
    check('--verify accepts an exactly-patched install', [
        verify.status !== 0 && `expected exit 0, got ${verify.status}`
    ]);
}

// ── 2. --verify refuses pristine, and never writes ───────────────────────────────────────────
{
    const root = stage();
    const before = readFileSync(targetPath(root), 'utf8');
    const result = runPatcher(root, ['--verify']);
    check('--verify refuses a pristine install and writes nothing', [
        result.status !== 1 && `expected exit 1, got ${result.status}`,
        !/did not run/.test(result.stderr) &&
            'the message did not say the transform had not run',
        readFileSync(targetPath(root), 'utf8') !== before &&
            'verification wrote to the file'
    ]);
}

// ── 3. every refusal, over BOTH anchors ──────────────────────────────────────────────────────
const refusals = [
    [
        'an unknown package version is refused',
        () => stage({ version: '0.0.0-unstable.209901010000' }),
        /pinned to /
    ],
    [
        'an unexpected pristine hash is refused',
        () => stage({ content: `${PRISTINE}\n/* local edit */\n` }),
        /matches neither the pinned pristine nor the pinned patched hash/
    ],
    ...UNSAFE_FRAGMENTS.flatMap((fragment, index) => [
        [
            `a missing unsafe fragment is refused (anchor #${index})`,
            () => stage({ content: PRISTINE.split(fragment.unsafe).join('') }),
            /matches neither the pinned pristine nor the pinned patched hash/
        ],
        [
            `a duplicated unsafe fragment is refused (anchor #${index})`,
            () =>
                stage({
                    content: PRISTINE.replace(
                        fragment.unsafe,
                        `${fragment.unsafe}${fragment.unsafe}`
                    )
                }),
            /matches neither the pinned pristine nor the pinned patched hash/
        ],
        [
            `partially patched content is refused (anchor #${index})`,
            () =>
                stage({
                    content: PRISTINE.split(fragment.unsafe).join(fragment.safe)
                }),
            /matches neither the pinned pristine nor the pinned patched hash/
        ]
    ])
];

for (const [label, make, expected] of refusals) {
    const root = make();
    const before = readFileSync(targetPath(root), 'utf8');
    const result = runPatcher(root);
    check(label, [
        result.status !== 1 && `expected exit 1, got ${result.status}`,
        !expected.test(result.stderr) &&
            `the message did not explain the refusal (${expected})`,
        readFileSync(targetPath(root), 'utf8') !== before &&
            'the patcher wrote to a file it had refused'
    ]);
}

// ── 4. symlink refusal ───────────────────────────────────────────────────────────────────────
{
    const real = stage();
    const root = mkdtempSync(join(tmpdir(), 'jf-sdk-escape-'));
    staged.push(root);
    mkdirSync(join(root, 'node_modules', '@jellyfin'), { recursive: true });
    symlinkSync(
        join(real, 'node_modules', '@jellyfin', 'sdk'),
        join(root, 'node_modules', '@jellyfin', 'sdk'),
        'dir'
    );
    const before = readFileSync(targetPath(real), 'utf8');
    const result = runPatcher(root);
    check('a symlinked package directory is refused, and nothing is written', [
        result.status !== 1 && `expected exit 1, got ${result.status}`,
        !/symlink/.test(result.stderr) &&
            'the message did not name the symlink',
        readFileSync(targetPath(real), 'utf8') !== before &&
            'the patcher wrote through the symlink'
    ]);
}

// ── 5. the transform is exactly what the pinned hash covers ──────────────────────────────────
{
    check('applyFragments alone reproduces the pinned patched hash', [
        sha256(applyFragments(PRISTINE)) !== PATCHED_SHA256 &&
            'the exported transform and the pinned hash disagree'
    ]);
    // Precisely: no replacement may put a credential into a URL. `this.accessToken` survives in
    // fragment #1 as the ternary CONDITION ("is there a session yet?"), which is not a url
    // credential - so the assertion is about `getUri(...)` arguments, not about the identifier
    // appearing anywhere at all. A blunter check fired on that condition and would have had to be
    // deleted rather than tightened, which is how a control becomes decorative.
    check('no replacement puts a credential into a socket url', [
        ...UNSAFE_FRAGMENTS.map((fragment, index) => {
            const uriCalls = fragment.safe.match(/getUri\([^)]*\)/gs) ?? [];
            const offending = uriCalls.filter((call) =>
                /accessToken|ApiKey|api_key|AUTHORIZATION_PARAMETER/.test(call)
            );
            return (
                offending.length > 0 &&
                `replacement #${index} still passes a credential to getUri()`
            );
        }),
        ...UNSAFE_FRAGMENTS.map(
            (fragment, index) =>
                /AUTHORIZATION_PARAMETER|ApiKey|api_key/.test(fragment.safe) &&
                `replacement #${index} still names the durable-token parameter`
        )
    ]);
}

// ── 6. no output can echo package content ────────────────────────────────────────────────────
{
    const root = stage({
        content: `${PRISTINE}\nconst canary = "SDKCANARY";\n`
    });
    const result = runPatcher(root);
    check('no patcher output can echo package content', [
        (result.stdout + result.stderr).includes('SDKCANARY') &&
            'the patcher echoed content from the package'
    ]);
}

// ── 7. no temporary artifact survives ────────────────────────────────────────────────────────
{
    const root = stage();
    runPatcher(root);
    check('no temporary artifact survives a successful run', [
        existsSync(`${targetPath(root)}.a1-tmp`) &&
            'the temporary file was left behind'
    ]);
}

// ── 8. the real installed package verifies as patched ────────────────────────────────────────
{
    const result = spawnSync(process.execPath, [PATCHER, '--verify'], {
        cwd: REPO,
        encoding: 'utf8'
    });
    check('the real installed package verifies as patched', [
        result.status !== 0 &&
            `expected exit 0 from the real tree, got ${result.status}: ${result.stderr}`
    ]);
}

for (const root of staged) rmSync(root, { recursive: true, force: true });

if (failures > 0) {
    process.stdout.write(`\n${failures} control(s) failed.\n`);
    process.exit(1);
}
process.stdout.write(`\n${PACKAGE_NAME} patch controls: all pass.\n`);

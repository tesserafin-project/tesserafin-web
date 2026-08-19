#!/usr/bin/env node
/*
 * Controls for `scripts/patch-jellyfin-sdk.mjs` (#153-A1, multi-target since #153-A1-R2).
 *
 * Same shape as the jellyfin-apiclient controls: a staged fixture tree per case, the REAL patcher
 * run as a child process, and an assertion on what landed on disk. Nothing here mocks the patcher.
 *
 * The transform now owns TWO files, so every refusal control asserts something the single-target
 * version could not: that a refusal on ONE target leaves the OTHER one byte-identical. A patcher
 * that wrote as it went would leave the package in a third state that neither pinned digest can
 * describe, and `--verify` would then be the only thing standing between that and a shipped build.
 *
 * OUTPUT SAFETY: no assertion prints package content. Failures name a target by id and a fragment
 * by index.
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
    REQUIRED_VERSION,
    TARGETS,
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
 * One target's pristine file.
 *
 * The installed copy is patched by `postinstall`, so the pristine content is reconstructed by
 * inverting that target's transform — and then checked against its PINNED pristine hash, which is
 * what makes the reconstruction trustworthy rather than assumed.
 */
function pristineContent(target) {
    const installed = readFileSync(join(INSTALLED, target.relative), 'utf8');
    if (sha256(installed) === target.pristineSha256) return installed;
    let out = installed;
    // Reverse order: the fragments are applied in order, and one replacement's output can contain
    // another's anchor.
    for (const fragment of [...target.fragments].reverse()) {
        out = out.split(fragment.safe).join(fragment.unsafe);
    }
    if (sha256(out) !== target.pristineSha256) {
        throw new Error(
            `could not reconstruct pristine content for target "${target.id}" from the installed package`
        );
    }
    return out;
}

/** id -> pristine content, read once. */
const PRISTINE = new Map(
    TARGETS.map((target) => [target.id, pristineContent(target)])
);

/**
 * Stage a fixture install.
 *
 * `overrides` replaces the content of individual targets by id; anything not named is staged
 * pristine, so a case that corrupts one file still exercises the other one's happy path.
 */
function stage({ overrides = {}, version = REQUIRED_VERSION } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'jf-sdk-patch-'));
    staged.push(root);
    const dir = join(root, 'node_modules', '@jellyfin', 'sdk');
    mkdirSync(dir, { recursive: true });
    // Copy the rest of the package so `resolvePackageDir` and the manifest read work as they do in
    // a real install, then write the files under test.
    cpSync(join(INSTALLED, 'package.json'), join(dir, 'package.json'));
    const manifest = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8')
    );
    manifest.version = version;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
    for (const target of TARGETS) {
        const path = join(dir, target.relative);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(
            path,
            overrides[target.id] ?? PRISTINE.get(target.id),
            'utf8'
        );
    }
    return root;
}

const targetPath = (root, target) =>
    join(root, 'node_modules', '@jellyfin', 'sdk', target.relative);

/** Every target's content, so a case can assert what a refusal did NOT touch. */
const snapshot = (root) =>
    new Map(
        TARGETS.map((target) => [
            target.id,
            readFileSync(targetPath(root, target), 'utf8')
        ])
    );

function unchangedSince(root, before) {
    const now = snapshot(root);
    return TARGETS.filter(
        (target) => now.get(target.id) !== before.get(target.id)
    ).map((target) => `target "${target.id}" was modified`);
}

function runPatcher(root, extra = []) {
    return spawnSync(process.execPath, [PATCHER, '--root', root, ...extra], {
        encoding: 'utf8'
    });
}

// ── 1. the happy path, over every target ─────────────────────────────────────────────────────
{
    const root = stage();
    const result = runPatcher(root);
    const after = snapshot(root);
    check('a pristine install patches every target to its pinned hash', [
        result.status !== 0 &&
            `expected exit 0, got ${result.status}: ${result.stderr}`,
        ...TARGETS.map(
            (target) =>
                sha256(after.get(target.id)) !== target.patchedSha256 &&
                `target "${target.id}" is not at its pinned patched digest`
        ),
        ...TARGETS.map(
            (target) =>
                after
                    .get(target.id)
                    .includes('AUTHORIZATION_PARAMETER]: this.accessToken') &&
                `target "${target.id}" still names the durable token in a socket url`
        )
    ]);

    const second = runPatcher(root);
    check('a second run is idempotent and leaves every file byte-identical', [
        second.status !== 0 && `expected exit 0, got ${second.status}`,
        ...unchangedSince(root, after)
    ]);

    const verify = runPatcher(root, ['--verify']);
    check('--verify accepts an exactly-patched install', [
        verify.status !== 0 && `expected exit 0, got ${verify.status}`
    ]);
}

// ── 2. --verify refuses pristine, and never writes ───────────────────────────────────────────
{
    const root = stage();
    const before = snapshot(root);
    const result = runPatcher(root, ['--verify']);
    check('--verify refuses a pristine install and writes nothing', [
        result.status !== 1 && `expected exit 1, got ${result.status}`,
        !/did not run/.test(result.stderr) &&
            'the message did not say the transform had not run',
        ...unchangedSince(root, before)
    ]);
}

// ── 3. a MIXED but recognised state converges, and does not rewrite what is already patched ──
for (const patchedFirst of TARGETS) {
    const others = TARGETS.filter((target) => target.id !== patchedFirst.id);
    const root = stage({
        overrides: {
            [patchedFirst.id]: applyFragments(
                patchedFirst,
                PRISTINE.get(patchedFirst.id)
            )
        }
    });
    const before = snapshot(root);
    const result = runPatcher(root);
    const after = snapshot(root);
    check(
        `a mixed state converges to fully patched (already patched: ${patchedFirst.id})`,
        [
            result.status !== 0 &&
                `expected exit 0, got ${result.status}: ${result.stderr}`,
            after.get(patchedFirst.id) !== before.get(patchedFirst.id) &&
                `the already-patched target "${patchedFirst.id}" was rewritten`,
            ...TARGETS.map(
                (target) =>
                    sha256(after.get(target.id)) !== target.patchedSha256 &&
                    `target "${target.id}" did not converge to its patched digest`
            ),
            !others.every((target) => result.stdout.includes(target.id)) &&
                'the log did not name the target(s) it rewrote'
        ]
    );

    // A mixed state is NOT patched, so --verify must still refuse it.
    const mixed = stage({
        overrides: {
            [patchedFirst.id]: applyFragments(
                patchedFirst,
                PRISTINE.get(patchedFirst.id)
            )
        }
    });
    const mixedBefore = snapshot(mixed);
    const verify = runPatcher(mixed, ['--verify']);
    check(`--verify refuses a mixed state (patched: ${patchedFirst.id})`, [
        verify.status !== 1 && `expected exit 1, got ${verify.status}`,
        ...unchangedSince(mixed, mixedBefore)
    ]);
}

// ── 4. every refusal, over every target and every anchor ─────────────────────────────────────
// Each case asserts BOTH that the patcher exits 1 with an explaining message AND that no target —
// including the healthy one — was written. "No file was modified" is the property that makes a
// two-file transform safe; a control that only checked the corrupted file would not see it break.
const UNRECOGNISED =
    /matches neither the pinned pristine nor the pinned patched hash/;

const refusals = [
    [
        'an unknown package version is refused',
        () => stage({ version: '0.0.0-unstable.209901010000' }),
        /pinned to /
    ],
    ...TARGETS.flatMap((target) => {
        const pristine = PRISTINE.get(target.id);
        return [
            [
                `an unexpected pristine hash is refused (${target.id})`,
                () =>
                    stage({
                        overrides: {
                            [target.id]: `${pristine}\n/* local edit */\n`
                        }
                    }),
                UNRECOGNISED
            ],
            [
                `a missing target file is refused (${target.id})`,
                () => {
                    const root = stage();
                    rmSync(targetPath(root, target));
                    return root;
                },
                /is missing/
            ],
            ...target.fragments.flatMap((fragment, index) => [
                [
                    `a missing unsafe fragment is refused (${target.id} anchor #${index})`,
                    () =>
                        stage({
                            overrides: {
                                [target.id]: pristine
                                    .split(fragment.unsafe)
                                    .join('')
                            }
                        }),
                    UNRECOGNISED
                ],
                [
                    `a duplicated unsafe fragment is refused (${target.id} anchor #${index})`,
                    () =>
                        stage({
                            overrides: {
                                [target.id]: pristine.replace(
                                    fragment.unsafe,
                                    `${fragment.unsafe}${fragment.unsafe}`
                                )
                            }
                        }),
                    UNRECOGNISED
                ],
                [
                    `partially patched content is refused (${target.id} anchor #${index})`,
                    () =>
                        stage({
                            overrides: {
                                [target.id]: pristine
                                    .split(fragment.unsafe)
                                    .join(fragment.safe)
                            }
                        }),
                    UNRECOGNISED
                ]
            ])
        ];
    })
];

for (const [label, make, expected] of refusals) {
    const root = make();
    // A deleted-file case has nothing to snapshot for that target, so only compare what exists.
    const before = new Map(
        TARGETS.filter((target) => existsSync(targetPath(root, target))).map(
            (target) => [
                target.id,
                readFileSync(targetPath(root, target), 'utf8')
            ]
        )
    );
    const result = runPatcher(root);
    check(label, [
        result.status !== 1 && `expected exit 1, got ${result.status}`,
        !expected.test(result.stderr) &&
            `the message did not explain the refusal (${expected})`,
        ...[...before.keys()]
            .filter(
                (id) =>
                    readFileSync(
                        targetPath(
                            root,
                            TARGETS.find((target) => target.id === id)
                        ),
                        'utf8'
                    ) !== before.get(id)
            )
            .map(
                (id) =>
                    `the patcher wrote to target "${id}" during a run it refused`
            )
    ]);
}

// ── 5. restoration is byte-identical ─────────────────────────────────────────────────────────
// Patch, roll every target back to pristine, patch again: the second result must equal the first
// byte for byte. A transform whose output depended on anything but its input would show up here.
{
    const root = stage();
    runPatcher(root);
    const first = snapshot(root);
    for (const target of TARGETS) {
        writeFileSync(
            targetPath(root, target),
            PRISTINE.get(target.id),
            'utf8'
        );
    }
    const result = runPatcher(root);
    const second = snapshot(root);
    check('restoring to pristine and re-patching is byte-identical', [
        result.status !== 0 && `expected exit 0, got ${result.status}`,
        ...TARGETS.map(
            (target) =>
                first.get(target.id) !== second.get(target.id) &&
                `target "${target.id}" differs between two patches of the same input`
        )
    ]);
}

// ── 6. symlink refusal ───────────────────────────────────────────────────────────────────────
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
    const before = snapshot(real);
    const result = runPatcher(root);
    check('a symlinked package directory is refused, and nothing is written', [
        result.status !== 1 && `expected exit 1, got ${result.status}`,
        !/symlink/.test(result.stderr) &&
            'the message did not name the symlink',
        ...unchangedSince(real, before)
    ]);
}

// ── 7. the transform is exactly what the pinned hashes cover ─────────────────────────────────
{
    check('applyFragments alone reproduces every pinned patched hash', [
        ...TARGETS.map(
            (target) =>
                sha256(applyFragments(target, PRISTINE.get(target.id))) !==
                    target.patchedSha256 &&
                `the exported transform and the pinned hash disagree for "${target.id}"`
        )
    ]);
    // Precisely: no replacement may put a credential into a URL. `this.accessToken` survives in
    // the subscribe fragment as the ternary CONDITION ("is there a session yet?"), which is not a
    // url credential - so the assertion is about `getUri(...)` arguments, not about the identifier
    // appearing anywhere at all. A blunter check fired on that condition and would have had to be
    // deleted rather than tightened, which is how a control becomes decorative.
    check('no replacement puts a credential into a socket url', [
        ...TARGETS.flatMap((target) =>
            target.fragments.map((fragment, index) => {
                const uriCalls = fragment.safe.match(/getUri\([^)]*\)/gs) ?? [];
                const offending = uriCalls.filter((call) =>
                    /accessToken|ApiKey|api_key|AUTHORIZATION_PARAMETER/.test(
                        call
                    )
                );
                return (
                    offending.length > 0 &&
                    `${target.id} replacement #${index} still passes a credential to getUri()`
                );
            })
        ),
        ...TARGETS.flatMap((target) =>
            target.fragments.map(
                (fragment, index) =>
                    /AUTHORIZATION_PARAMETER|ApiKey|api_key/.test(
                        fragment.safe
                    ) &&
                    `${target.id} replacement #${index} still names the durable-token parameter`
            )
        )
    ]);
    // The ticket must reach the socket as a query parameter on a COPY of the stored url. A
    // replacement that mutated `this.url` would replay a single-use ticket on every reconnect.
    const socket = TARGETS.find((target) => target.id === 'websocket-service');
    const initFragment = socket.fragments.find((fragment) =>
        fragment.safe.includes('webSocketTicket')
    );
    check('the ticket is applied to a copy, never to the stored url', [
        !initFragment && 'no replacement sets the webSocketTicket parameter',
        initFragment &&
            !/new URL\(this\.url\.toString\(\)\)/.test(initFragment.safe) &&
            'the replacement does not copy the stored url before adding the ticket',
        initFragment &&
            /this\.url\.searchParams/.test(initFragment.safe) &&
            'the replacement writes the ticket into the STORED url'
    ]);
}

// ── 8. no output can echo package content ────────────────────────────────────────────────────
for (const target of TARGETS) {
    const root = stage({
        overrides: {
            [target.id]: `${PRISTINE.get(target.id)}\nconst canary = "SDKCANARY";\n`
        }
    });
    const result = runPatcher(root);
    check(`no patcher output can echo package content (${target.id})`, [
        (result.stdout + result.stderr).includes('SDKCANARY') &&
            'the patcher echoed content from the package'
    ]);
}

// ── 9. no temporary artifact survives ────────────────────────────────────────────────────────
{
    const root = stage();
    runPatcher(root);
    check('no temporary artifact survives a successful run', [
        ...TARGETS.map(
            (target) =>
                existsSync(`${targetPath(root, target)}.a1-tmp`) &&
                `a temporary file was left behind for "${target.id}"`
        )
    ]);
}

// ── 10. the real installed package verifies as patched ───────────────────────────────────────
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

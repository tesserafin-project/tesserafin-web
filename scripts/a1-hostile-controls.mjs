#!/usr/bin/env node
/*
 * #153-A1 — hostile controls.
 *
 * Each control mutates ONE thing, runs the assertion that is supposed to notice, and restores the
 * tree byte-identically. A control that leaves the assertion GREEN is reported INERT, not passed:
 * an assertion nothing can break is decoration.
 *
 * PRECONDITIONS, checked before anything is touched:
 *   - the working tree is clean (mutations are `git checkout --`-restored, which DESTROYS
 *     uncommitted work; this has actually happened during #153-A1 and is not hypothetical);
 *   - every mutation's anchor resolves exactly once, so a silently non-applied mutation cannot be
 *     mistaken for a robust implementation.
 *
 * CLASSIFICATION
 *   RED    the assertion failed AND its output contains the expected marker — the control reached
 *          its named assertion.
 *   INERT  the assertion still passed. The mutation was applied but nothing noticed.
 *   ERROR  the assertion failed for a DIFFERENT reason than the marker names, or setup/restore
 *          failed. Not a result.
 *
 * Usage:
 *   node scripts/a1-hostile-controls.mjs            # run all
 *   node scripts/a1-hostile-controls.mjs --list     # verify anchors only, mutate nothing
 *   node scripts/a1-hostile-controls.mjs --only c07 # one control
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BROKER = 'src/lib/playbackCredentials/PlaybackCredentialBroker.ts';
const IDENTITY = 'src/lib/playbackCredentials/identity.ts';
const SOCKET = 'src/lib/playbackCredentials/TicketedWebSocketService.ts';
const BOOT = 'src/lib/playbackCredentials/boot.ts';
const PLAYBACK = 'src/components/playback/playbackmanager.js';
const PATCHER = 'scripts/patch-jellyfin-apiclient.mjs';
const GATE = 'ci/credential-transport-inventory.mjs';

/** The assertion commands, kept short so a control is a few seconds, not a few minutes. */
const UNIT = [
    'npx',
    'vitest',
    'run',
    '--config',
    'vite.config.ts',
    'src/lib/playbackCredentials'
];
const GATE_MIGRATED = [
    'node',
    'ci/credential-transport-inventory.mjs',
    '--phase',
    'migrated'
];
const PATCHER_TESTS = ['node', 'scripts/jellyfin-apiclient-patch.test.mjs'];
const PATCHER_VERIFY = [
    'node',
    'scripts/patch-jellyfin-apiclient.mjs',
    '--verify'
];

/**
 * `find` must appear EXACTLY once. `marker` is the substring the assertion output must contain for
 * the control to count as RED — the "named assertion" the issue asks for.
 */
const CONTROLS = [
    {
        id: 'c00',
        name: 'positive control — no mutation',
        file: null,
        assertion: UNIT,
        expect: 'GREEN'
    },
    {
        id: 'c01',
        name: 'restore ApiKey on one media url',
        file: PLAYBACK,
        find: 'playbackCapability: mediaCapability',
        replace: 'ApiKey: apiClient.accessToken()',
        assertion: GATE_MIGRATED,
        marker: 'no-durable-token-in-any-playback-url'
    },
    {
        id: 'c02',
        name: 'restore api_key on the WebSocket (drop the patcher transport fragment)',
        file: PATCHER,
        find: "        category: 'transport',",
        replace: "        category: 'DISABLED-transport',",
        assertion: PATCHER_TESTS,
        marker: '#153-A1: the socket url is no longer built with the durable token'
    },
    {
        id: 'c03',
        name: 'bypass capability minting',
        file: BROKER,
        find: 'const dto = await this.deps.mintCapability(request);',
        replace:
            "const dto = { CapabilityId: 'x', Value: 'x', IssuedAt: new Date().toISOString(), ExpiresAt: new Date(Date.now() + 9e5).toISOString() } as never;",
        assertion: UNIT,
        marker: 'resolves a capability before any url is built'
    },
    {
        id: 'c04',
        name: 'disable renewal',
        file: BROKER,
        find: '        this.scheduleRenewal(key, entry);\n        return {',
        replace: '        return {',
        assertion: UNIT,
        marker: 'renews once the final window is entered'
    },
    {
        id: 'c05',
        name: 'renew prematurely',
        file: BROKER,
        find: 'Math.max(0, remaining - RENEWAL_WINDOW_MS + RENEWAL_SKEW_MARGIN_MS)',
        replace: 'Math.max(0, remaining / 2)',
        assertion: UNIT,
        marker: 'does not renew before the final window'
    },
    {
        id: 'c06',
        name: 'fall back after renewal failure (silent re-mint)',
        file: BROKER,
        find: '            entry.failed = true;',
        replace:
            '            this.expire(key);\n            entry.failed = false;',
        assertion: UNIT,
        marker: 'fails closed when renewal is refused'
    },
    {
        id: 'c07',
        name: 'reuse a consumed ticket during reconnect',
        file: SOCKET,
        find: '            ticket = await this.deps.mintTicket();',
        replace:
            '            this.reusedTicket ??= await this.deps.mintTicket();\n            ticket = this.reusedTicket;',
        extraFind: '    private attempts = 0;',
        extraReplace:
            '    private attempts = 0;\n    private reusedTicket: string | undefined;',
        assertion: UNIT,
        marker: 'mints AGAIN on reconnect and never replays the first ticket'
    },
    ...[
        'serverId',
        'userId',
        'String(authority.sessionEpoch)',
        'deviceId',
        'playSessionId',
        'itemId',
        'mediaSourceId'
    ].map((dimension, index) => ({
        id: `c08${'abcdefg'[index]}`,
        name: `drop the ${dimension} cache dimension`,
        file: IDENTITY,
        find:
            dimension === 'String(authority.sessionEpoch)'
                ? '        field(String(authority.sessionEpoch)),\n'
                : `        field(authority.${dimension}),\n`,
        replace: '',
        assertion: UNIT,
        marker: 'every authority dimension is part of the key'
    })),
    {
        id: 'c08h',
        name: 'drop the scope-set cache dimension',
        file: IDENTITY,
        find: "        field(canonicalScopes(authority.scopes).join(','))\n",
        replace: "        field('')\n",
        assertion: UNIT,
        marker: 'every authority dimension is part of the key'
    },
    {
        id: 'c09',
        name: 'retain credentials after teardown',
        file: BROKER,
        find: '    dispose(): void {\n        this.discardAll();',
        replace: '    dispose(): void {\n        // MUTATION: keep everything.',
        assertion: UNIT,
        marker: 'dispose cancels every renewal and refuses further work'
    },
    {
        id: 'c10',
        name: 'broaden a scope',
        file: BROKER,
        find: "            scopes: ['Fonts'],",
        replace: "            scopes: ['Fonts', 'Media'],",
        assertion: UNIT,
        marker: 'each family mints its own minimum scope set'
    },
    {
        id: 'c11',
        name: 'lose the capability on a rewritten (HLS child-bearing) url',
        file: BROKER,
        find: "        params.set('playbackCapability', held.value);",
        replace: '        // MUTATION: never set the capability.',
        assertion: UNIT,
        marker: 'a rewritten url carries the capability and neither durable key'
    },
    {
        id: 'c12',
        name: 'bypass the patched dependency transform',
        file: BOOT,
        find: '        apiClient._sdk.webSocket = socket;',
        replace: '        // MUTATION: leave Api.webSocket to the sdk.',
        assertion: UNIT,
        marker: 'occupies Api.webSocket synchronously'
    },
    {
        id: 'c13',
        name: 'weaken the production-bundle durable-token gate',
        file: GATE,
        find: "        id: 'apiclient-openwebsocket',",
        replace:
            "        id: 'apiclient-openwebsocket-RENAMED', mustBeAbsent: null,",
        assertion: GATE_MIGRATED,
        marker: 'production-bundle'
    }
];

function git(args) {
    return spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
}

function digestOf(file) {
    return createHash('sha256')
        .update(readFileSync(join(REPO, file)))
        .digest('hex');
}

function treeClean() {
    return git(['status', '--porcelain']).stdout.trim() === '';
}

function run(command) {
    const [bin, ...args] = command;
    const result = spawnSync(bin, args, {
        cwd: REPO,
        encoding: 'utf8',
        timeout: 10 * 60 * 1000
    });
    return {
        status: result.status,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        timedOut: result.error?.code === 'ETIMEDOUT'
    };
}

function apply(control) {
    const pairs = [[control.find, control.replace]];
    if (control.extraFind)
        pairs.push([control.extraFind, control.extraReplace]);
    const before = readFileSync(join(REPO, control.file), 'utf8');
    let after = before;
    for (const [find, replace] of pairs) {
        const count = after.split(find).length - 1;
        if (count !== 1) {
            return {
                ok: false,
                why: `anchor resolved ${count} times, expected 1`
            };
        }
        after = after.replace(find, replace);
    }
    if (after === before) return { ok: false, why: 'mutation changed nothing' };
    writeFileSync(join(REPO, control.file), after, 'utf8');
    return { ok: true };
}

const argv = process.argv.slice(2);
const listOnly = argv.includes('--list');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

if (!treeClean()) {
    process.stderr.write(
        'REFUSING: the working tree is not clean. Every mutation is restored with ' +
            '`git checkout --`, which destroys uncommitted work. Commit first.\n'
    );
    process.exit(2);
}

// Anchors first, on the pristine tree: a mutation that never applied would otherwise be reported
// as a robust implementation.
let anchorProblems = 0;
for (const control of CONTROLS) {
    if (!control.file) continue;
    const content = readFileSync(join(REPO, control.file), 'utf8');
    for (const find of [control.find, control.extraFind].filter(Boolean)) {
        const count = content.split(find).length - 1;
        if (count !== 1) {
            anchorProblems += 1;
            process.stdout.write(
                `ANCHOR ${control.id} ${control.name}: resolved ${count} times in ${control.file}\n`
            );
        }
    }
}
if (anchorProblems > 0) {
    process.stderr.write(
        `\n${anchorProblems} anchor problem(s); nothing was mutated.\n`
    );
    process.exit(1);
}
process.stdout.write(
    `anchors: all ${CONTROLS.filter((c) => c.file).length} resolve exactly once\n\n`
);
if (listOnly) process.exit(0);

const results = [];
for (const control of CONTROLS) {
    if (only && control.id !== only) continue;

    if (!control.file) {
        const outcome = run(control.assertion);
        const green = outcome.status === 0;
        results.push({
            ...control,
            verdict: green ? 'GREEN' : 'ERROR',
            detail: green
                ? 'the assertion passes on the unmutated tree'
                : 'the assertion FAILS with no mutation — every RED below would be meaningless'
        });
        process.stdout.write(
            `${green ? 'GREEN' : 'ERROR'} ${control.id} ${control.name}\n`
        );
        if (!green) break;
        continue;
    }

    const digestBefore = digestOf(control.file);
    const applied = apply(control);
    if (!applied.ok) {
        results.push({ ...control, verdict: 'ERROR', detail: applied.why });
        process.stdout.write(
            `ERROR ${control.id} ${control.name}: ${applied.why}\n`
        );
        git(['checkout', '--', control.file]);
        continue;
    }

    const outcome = run(control.assertion);
    let verdict;
    let detail;
    if (outcome.timedOut) {
        verdict = 'HUNG';
        detail = 'the assertion did not finish inside ten minutes';
    } else if (outcome.status === 0) {
        verdict = 'INERT';
        detail = 'the mutation applied and the assertion still passed';
    } else if (outcome.output.includes(control.marker)) {
        verdict = 'RED';
        detail = control.marker;
    } else {
        verdict = 'ERROR';
        detail = `failed WITHOUT the named assertion (${control.marker})`;
    }

    // Restore, and prove the restore.
    git(['checkout', '--', control.file]);
    const restored = digestOf(control.file) === digestBefore && treeClean();
    if (!restored) {
        verdict = 'ERROR';
        detail = 'the tree did not restore byte-identically';
    }

    results.push({ ...control, verdict, detail });
    process.stdout.write(
        `${verdict.padEnd(5)} ${control.id} ${control.name} — ${detail}\n`
    );
}

const counts = results.reduce((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
}, {});
process.stdout.write(
    `\n${Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}\n`
);
writeFileSync(
    join(REPO, 'test-results', 'a1-hostile-controls.json'),
    `${JSON.stringify(
        {
            generatedFor: '#153-A1 phase 4',
            counts,
            controls: results.map((r) => ({
                id: r.id,
                name: r.name,
                file: r.file,
                assertion: r.assertion.join(' '),
                namedAssertion: r.marker ?? null,
                verdict: r.verdict,
                detail: r.detail
            }))
        },
        null,
        2
    )}\n`,
    'utf8'
);

const bad = results.filter((r) => r.verdict !== 'RED' && r.verdict !== 'GREEN');
process.exit(bad.length === 0 ? 0 : 1);

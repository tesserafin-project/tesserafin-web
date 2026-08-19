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
/*
 * #153-A1-R2: the socket implementation moved. `TicketedWebSocketService.ts` and `boot.ts` are
 * deleted — the shipped `@jellyfin/sdk` service is patched instead — so the socket controls now
 * mutate the PATCHER's fragment table, which is the only place that code exists. Their assertion
 * is `scripts/jellyfin-sdk-socket.test.mjs`, which rebuilds the module from those fragments for
 * exactly this reason: a control that mutated the fragments while the test read `node_modules`
 * would be inert.
 */
const SDK_PATCHER = 'scripts/patch-jellyfin-sdk.mjs';
const PLAYBACK = 'src/components/playback/playbackmanager.js';
const PATCHER = 'scripts/patch-jellyfin-apiclient.mjs';
const GATE = 'ci/credential-transport-inventory.mjs';
const ROSTER_GATE = 'ci/verify-a1-acceptance-roster.mjs';
const CONTRACT = 'tests/playbackCredential/support/familyContract.ts';
const DELETE_HELPER = 'src/scripts/deleteHelper.js';
const VIDEO_OSD = 'src/apps/legacy/controllers/playback/video/index.js';
const HTML_VIDEO = 'src/plugins/htmlVideoPlayer/plugin.js';

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
const SOCKET_TEST = ['node', 'scripts/jellyfin-sdk-socket.test.mjs'];
const PATCHER_VERIFY = [
    'node',
    'scripts/patch-jellyfin-apiclient.mjs',
    '--verify'
];
/** The WHOLE inventory, not one phase: the absence categories only run there. */
const GATE_FULL = ['node', 'ci/credential-transport-inventory.mjs'];
const ROSTER = ['node', 'ci/verify-a1-acceptance-roster.mjs'];
/** The bundle the browser controls assert against. */
const BUILD = ['npm', 'run', 'build:production'];
/**
 * Resolving the acceptance suite IMPORTS every spec, and every spec imports the family contract,
 * whose invariants run at import. So `--list` is a real assertion on the contract and costs a
 * second, where running the suite would cost twenty minutes.
 */
/**
 * Browser controls. These need the rig up (`TESSERAFIN_E2E_BASE_URL`), and they are the only way
 * to reopen a property that lives in a real playback: a capability's SCOPE BINDING is invisible to
 * every source-level gate, because the url looks identical either way.
 */
const ACCEPT = (spec) => [
    'npx',
    'playwright',
    'test',
    '--config',
    'playwright.credential.config.ts',
    spec
];

const CONTRACT_IMPORT = [
    'npx',
    'playwright',
    'test',
    '--config',
    'playwright.credential.config.ts',
    '--list'
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
        name: 'restore api_key on the WebSocket url',
        // Aimed at the code that actually BUILDS the socket url, which since #153-A1-R2 is the
        // patcher's fragment table. The socket test rebuilds the module from those fragments, so
        // this reaches a real assertion rather than an unchanged `node_modules` copy.
        file: SDK_PATCHER,
        find: "        target.searchParams.set('webSocketTicket', ticket);",
        replace: "        target.searchParams.set('api_key', ticket);",
        assertion: SOCKET_TEST,
        marker: 'the ticket reaches the socket url, and only the ticket'
    },
    {
        id: 'c02b',
        name: 'weaken the dependency patch pin',
        file: PATCHER,
        find: "    '68068867e336be4e97f345ec437afc30303e3ea306f059581837b5c94f885f60';",
        replace:
            "    '0000000000000000000000000000000000000000000000000000000000000000';",
        assertion: PATCHER_VERIFY,
        marker: 'matches neither the pinned pristine nor the pinned patched hash'
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
        file: SDK_PATCHER,
        find: '            ticket = this.ticketProvider ? await this.ticketProvider() : undefined;',
        replace:
            '            this.reused ??= this.ticketProvider ? await this.ticketProvider() : undefined;\n            ticket = this.reused;',
        assertion: SOCKET_TEST,
        marker: 'a reconnect mints a fresh ticket and never replays the first'
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
        name: 'connect without a ticket instead of failing closed',
        // The old shape of this control removed the boot shim's seam. There is no seam any more,
        // so the equivalent hostile edit is to remove the refusal: let a mintless attempt build a
        // socket anyway. That is precisely the fallback the whole transport exists to forbid.
        file: SDK_PATCHER,
        find: '            this.retry();\n            return;',
        replace: "            ticket = 'bypass';",
        assertion: SOCKET_TEST,
        marker: 'without a ticket provider it mints nothing and opens no socket'
    },
    {
        id: 'c14',
        name: 'restore a production producer of /Audio/{id}/stream',
        // The CONCATENATION shape, deliberately. The first version of the absence gate required
        // no quote between `Audio/` and `/stream`, so exactly this line passed it — the control
        // was run, came back green, and that is how the gate was found to be inert.
        file: DELETE_HELPER,
        find: "'Audio/' + item.Id + '/Lyrics'",
        replace: "'Audio/' + item.Id + '/stream'",
        assertion: GATE_FULL,
        marker: 'DIRECT AUDIO IS BACK'
    },
    {
        id: 'c15',
        name: 'drop a spec from the acceptance roster',
        file: ROSTER_GATE,
        find: "    'trickplay.spec.ts',\n",
        replace: '',
        assertion: ROSTER,
        // The gate's own words. Its header calls this case "unexpected"; the message it prints
        // says "UNDECLARED", and the marker has to match the output, not the prose.
        marker: 'UNDECLARED spec(s)'
    },
    {
        id: 'c16',
        name: 'demote a reached family back to unreached',
        // A family that is reached but declared unreached is the stale-excuse half of the
        // contract. The invariant runs at import, so resolving the suite is enough to reach it.
        file: CONTRACT,
        find: "        status: 'required',\n        owner: 'trickplay.spec.ts',",
        replace:
            "        status: 'unreached',\n        owner: 'trickplay.spec.ts',",
        assertion: CONTRACT_IMPORT,
        marker: 'declared unreached but names an owner'
    },
    {
        id: 'c17',
        rebuild: true,
        name: 'bind the item-less Fonts capability to the durable token instead',
        file: HTML_VIDEO,
        find: "const fallbackFontList = apiClient.getUrl('/FallbackFont/Fonts', {\n            playbackCapability: fontsCapability\n        });",
        replace:
            "const fallbackFontList = apiClient.getUrl('/FallbackFont/Fonts', {\n            ApiKey: apiClient.accessToken()\n        });",
        assertion: ACCEPT('libassFamilies'),
        marker: 'must carry a playbackCapability'
    },
    {
        id: 'c18',
        rebuild: true,
        name: 'drop the media-source binding from the Attachments capability',
        // The url is IDENTICAL either way: only the mint body names the media source, so no
        // source-level gate and no url assertion can see this. That is why the control exists.
        file: HTML_VIDEO,
        find: '                            this._currentPlayOptions?.mediaSource?.Id ?? null,\n                            playSessionId',
        replace:
            '                            null,\n                            playSessionId',
        assertion: ACCEPT('libassFamilies'),
        marker: 'the Attachments capability must be bound to its media source'
    },
    {
        id: 'c19',
        rebuild: true,
        name: 'drop the media-source binding from the Trickplay capability',
        file: VIDEO_OSD,
        find: '        ).trickplayValue(\n            item.Id,\n            mediaSourceId,',
        replace:
            '        ).trickplayValue(\n            item.Id,\n            null,',
        assertion: ACCEPT('trickplay'),
        marker: 'the Trickplay capability must be bound to its media source'
    },
    {
        id: 'c20',
        rebuild: true,
        name: 'unbind the universal-audio capability from its play session',
        // The revision this reopens filed the audio capability under the broker's own synthetic
        // id. Every url still looked correct; only the REPLAY after the stop can tell, because a
        // capability nobody revoked answers 200.
        file: PLAYBACK,
        find: '    const capability = await (await brokerFor(apiClient)).mediaValue(\n        item.Id,\n        null,\n        playSessionId\n    );',
        replace:
            "    const capability = await (await brokerFor(apiClient)).mediaValue(\n        item.Id,\n        null,\n        ''\n    );",
        assertion: ACCEPT('audioRevocation'),
        marker: 'must be refused with 401/403'
    },
    {
        id: 'c13',
        name: 'weaken the production-bundle durable-token gate',
        file: GATE,
        // Turn a must-be-ABSENT site into a merely permitted one. The first attempt inserted
        // a second `mustBeAbsent` key BEFORE the existing one and the later property won: the
        // mutation applied and changed nothing, which is exactly why it read INERT.
        find: "        mustBeAbsent: 'scripts/patch-jellyfin-apiclient.mjs',",
        replace: '        mustBeAbsent: null,',
        assertion: GATE_MIGRATED,
        marker: 'the exemption naming it is stale'
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

    // A control whose assertion drives a BROWSER asserts against `dist/`, not against `src/`.
    // Without this rebuild the mutation never reaches the page: measured, and all four
    // scope-binding controls came back INERT while the mutation was plainly applied on disk.
    if (control.rebuild) {
        const built = run(BUILD);
        if (built.status !== 0) {
            results.push({
                ...control,
                verdict: 'ERROR',
                detail: 'the production build failed under the mutation'
            });
            process.stdout.write(
                `ERROR ${control.id} ${control.name}: the production build failed under the mutation\n`
            );
            git(['checkout', '--', control.file]);
            continue;
        }
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

#!/usr/bin/env node
/*
 * Behavioural controls for the PATCHED `@jellyfin/sdk` WebSocket transport (#153-A1-R2).
 *
 * WHY THIS FILE REPLACES A TEST THAT USED TO EXIST
 *
 *   The first revision proved its socket properties against a first-party `TicketedWebSocketService`
 *   and against a boot shim that occupied `Api.webSocket`. Both are deleted: the shipped service is
 *   patched instead, so there is no seam to inject and no deferred import to race. The PROPERTIES
 *   those tests protected are not deleted with them — they are asserted here, against the real
 *   patched module, loaded from `node_modules` exactly as the application loads it.
 *
 *   `scripts/jellyfin-sdk-patch.test.mjs` proves the TRANSFORM (hashes, anchors, refusals). This
 *   file proves the BEHAVIOUR the transform produces. A patch that applied cleanly and connected
 *   without a ticket would pass that file and fail this one.
 *
 * WHAT IS FAKED, AND WHAT IS NOT
 *
 *   `WebSocket` and the axios instance are fakes; the service and the `Api` are the real patched
 *   modules. Nothing here mocks the code under test.
 *
 * OUTPUT SAFETY: the fake ticket and header values are literals invented here. No branch reads or
 * prints a real credential.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { TARGETS, applyFragments } from './patch-jellyfin-sdk.mjs';
import { sha256 } from './patch-jellyfin-apiclient.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PACKAGE = join(REPO, 'node_modules', '@jellyfin', 'sdk');

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

// ── the fake socket ──────────────────────────────────────────────────────────────────────────
const opened = [];
class FakeSocket {
    static last = null;
    static OPEN = 1;
    static CLOSED = 3;
    constructor(url) {
        opened.push(url);
        this.readyState = 0;
        this.listeners = {};
        FakeSocket.last = this;
    }
    addEventListener(type, handler) {
        this.listeners[type] ??= [];
        this.listeners[type].push(handler);
    }
    fire(type, event = { data: '{}' }) {
        for (const handler of this.listeners[type] ?? []) handler(event);
    }
    close() {
        this.fire('close');
    }
    send() {}
}
globalThis.WebSocket = FakeSocket;

/*
 * Load the service the PATCHER produces, not the file that happens to be installed.
 *
 * Why it matters: the socket implementation now lives in the patcher's fragment table and nowhere
 * else. A hostile control that mutates a fragment must change what this file measures — otherwise
 * every socket control is inert, asserting against a `node_modules` copy the mutation never
 * reached. So the module under test is rebuilt from the fragments, in memory, on every run.
 *
 * The link back to reality is the digest assertion below: the installed file must equal the pinned
 * patched hash, so "the fragments behave correctly" and "the fragments are what is installed" are
 * both asserted, separately.
 */
const socketTarget = TARGETS.find(
    (target) => target.id === 'websocket-service'
);
const installedPath = join(PACKAGE, socketTarget.relative);
const installed = readFileSync(installedPath, 'utf8');

function invert(fragments, content) {
    let out = content;
    for (const fragment of [...fragments].reverse()) {
        out = out.split(fragment.safe).join(fragment.unsafe);
    }
    return out;
}

/**
 * The COMMITTED fragment table, used only to invert the installed file back to pristine.
 *
 * Why not the working tree's: a deliberate-break control mutates a fragment, and inverting a file
 * that was patched with the ORIGINAL fragments using MUTATED ones cannot succeed. The test would
 * then die at setup and the control would be reported as ERROR — a mutation nobody measured —
 * instead of reopening the defect it was written to reopen. `scripts/a1-hostile-controls.mjs`
 * refuses to run on a dirty tree, so HEAD is always the unmutated reference.
 *
 * The probe below is still built from the WORKING TREE's fragments. That split is the whole point:
 * reconstruction stays trustworthy while the behaviour under test moves with the edit.
 */
async function committedFragments(target) {
    const shown = spawnSync(
        'git',
        ['show', `HEAD:scripts/${'patch-jellyfin-sdk.mjs'}`],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
    );
    if (shown.status !== 0 || !shown.stdout) return target.fragments;
    const dir = mkdtempSync(join(tmpdir(), 'a1-sdk-head-'));
    const path = join(dir, 'patch-jellyfin-sdk.mjs');
    // The committed patcher imports a sibling by relative path; point it at the real one.
    writeFileSync(
        path,
        shown.stdout.replace(
            "'./patch-jellyfin-apiclient.mjs'",
            JSON.stringify(
                pathToFileURL(
                    join(REPO, 'scripts', 'patch-jellyfin-apiclient.mjs')
                ).href
            )
        ),
        'utf8'
    );
    try {
        const head = await import(pathToFileURL(path).href);
        const match = head.TARGETS?.find((entry) => entry.id === target.id);
        return match?.fragments ?? target.fragments;
    } catch {
        return target.fragments;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

let pristine =
    sha256(installed) === socketTarget.pristineSha256
        ? installed
        : invert(await committedFragments(socketTarget), installed);
if (sha256(pristine) !== socketTarget.pristineSha256) {
    // Last resort: a tree whose HEAD predates this target at all.
    pristine = invert(socketTarget.fragments, installed);
}
if (sha256(pristine) !== socketTarget.pristineSha256) {
    process.stderr.write(
        'could not reconstruct the pristine websocket service; refusing to report a behaviour ' +
            'result measured against an unknown input.\n'
    );
    process.exit(1);
}

// Same directory, so the module's own relative imports resolve exactly as they do in production.
const probePath = join(dirname(installedPath), '.a1-socket-control.mjs');
writeFileSync(probePath, applyFragments(socketTarget, pristine), 'utf8');
let WebSocketService;
try {
    ({ WebSocketService } = await import(pathToFileURL(probePath).href));
} finally {
    rmSync(probePath, { force: true });
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
    await tick();
    await tick();
    await tick();
};
/** The reconnect backoff's first step is 1 s; give it room without coupling to the constant. */
const afterBackoff = async () => {
    await new Promise((r) => setTimeout(r, 1500));
    await settle();
};
const reset = () => {
    opened.length = 0;
};

const BASE = 'http://host:8096/socket';

// ── 1. no provider: zero mint, zero socket ───────────────────────────────────────────────────
{
    reset();
    const service = new WebSocketService(BASE);
    service.subscribe(['Sessions'], () => {});
    await settle();
    check('without a ticket provider it mints nothing and opens no socket', [
        opened.length !== 0 &&
            `a socket was opened without a ticket (${opened.length})`
    ]);
    service.disconnect();
}

// ── 2. no token: the provider refuses, and nothing connects ──────────────────────────────────
{
    reset();
    let mints = 0;
    const service = new WebSocketService(BASE, async () => {
        mints += 1;
        throw new Error('no session');
    });
    service.subscribe(['Sessions'], () => {});
    await settle();
    check('a refusing provider opens no socket, and does not fall back', [
        mints !== 1 && `expected exactly 1 mint attempt, got ${mints}`,
        opened.length !== 0 && 'a socket was opened after the mint was refused'
    ]);
    service.disconnect();
}

// ── 3. the happy path: ticket in the url, stored url untouched ───────────────────────────────
{
    reset();
    let issued = 0;
    const service = new WebSocketService(
        BASE,
        async () => `ticket-${++issued}`
    );
    const storedBefore = service.url.toString();
    service.subscribe(['Sessions'], () => {});
    await settle();
    const url = opened[0] ?? '';
    check('the ticket reaches the socket url, and only the ticket', [
        opened.length !== 1 && `expected 1 socket, got ${opened.length}`,
        !url.startsWith('ws://') &&
            'the url was not converted to the ws scheme',
        !/[?&]webSocketTicket=ticket-1(&|$)/.test(url) &&
            'the url does not carry the minted ticket',
        /ApiKey|api_key/i.test(url) &&
            'the url carries a durable-token parameter',
        service.url.toString() !== storedBefore && 'the stored url was mutated',
        /webSocketTicket/.test(service.url.toString()) &&
            'the ticket was written back into the STORED url, so a reconnect would replay it'
    ]);

    // ── 4. reconnect mints again, and never replays ──────────────────────────────────────────
    FakeSocket.last.fire('close');
    await afterBackoff();
    const second = opened[1] ?? '';
    check('a reconnect mints a fresh ticket and never replays the first', [
        opened.length !== 2 &&
            `expected a second physical attempt, got ${opened.length}`,
        !/webSocketTicket=ticket-2(&|$)/.test(second) &&
            'the reconnect did not use a newly minted ticket'
    ]);
    service.disconnect();
}

// ── 5. a failed mint must not kill auto-reconnect ────────────────────────────────────────────
{
    reset();
    let mints = 0;
    const service = new WebSocketService(BASE, async () => {
        mints += 1;
        if (mints === 1) throw new Error('refused');
        return 'ticket-after-retry';
    });
    service.subscribe(['Sessions'], () => {});
    await settle();
    const noneYet = opened.length;
    await afterBackoff();
    check('one refused mint fails closed but leaves auto-reconnect alive', [
        noneYet !== 0 && 'a socket was opened despite the refusal',
        opened.length !== 1 &&
            `expected the retry to connect once, got ${opened.length} socket(s) after ${mints} mint(s)`,
        !/webSocketTicket=ticket-after-retry$/.test(opened[0] ?? '') &&
            'the retry did not present the newly minted ticket'
    ]);
    service.disconnect();
}

// ── 6. concurrency: one mint, one socket ─────────────────────────────────────────────────────
{
    reset();
    let mints = 0;
    const service = new WebSocketService(BASE, async () => {
        mints += 1;
        await tick();
        return 'ticket-concurrent';
    });
    service.subscribe(['Sessions'], () => {});
    service.subscribe(['UserDataChanged'], () => {});
    await settle();
    check('two subscriptions racing the same connect mint exactly one ticket', [
        mints !== 1 && `expected 1 mint, got ${mints}`,
        opened.length !== 1 && `expected 1 socket, got ${opened.length}`
    ]);
    service.disconnect();
}

// ── 7. sign-out: nothing is minted afterwards ────────────────────────────────────────────────
{
    reset();
    let mints = 0;
    let token = 'first-session';
    const service = new WebSocketService(BASE, async () => {
        mints += 1;
        if (!token) throw new Error('no session');
        return `ticket-for-${token}`;
    });
    service.subscribe(['Sessions'], () => {});
    await settle();
    const mintsWhileSignedIn = mints;
    // Sign-out: `Api.update({ accessToken: '' })` calls exactly this.
    token = '';
    service.disconnect();
    await afterBackoff();
    check('after sign-out nothing mints and nothing reconnects', [
        mintsWhileSignedIn !== 1 &&
            `expected 1 mint while signed in, got ${mintsWhileSignedIn}`,
        mints !== mintsWhileSignedIn &&
            `a ticket was minted after sign-out (${mints - mintsWhileSignedIn} extra)`,
        opened.length !== 1 &&
            `a socket was opened after sign-out (${opened.length} total)`
    ]);

    // ── 8. the next sign-in on the SAME service uses the CURRENT authorization ───────────────
    reset();
    token = 'second-session';
    // Sign-in on an existing Api: `Api.update({ accessToken })` calls exactly this.
    service.updateUrl(BASE);
    await settle();
    check(
        'the next sign-in mints with the current authorization, not the old one',
        [
            opened.length !== 1 &&
                `expected exactly 1 socket after re-login, got ${opened.length}`,
            !/webSocketTicket=ticket-for-second-session$/.test(
                opened[0] ?? ''
            ) &&
                'the re-login socket did not carry a ticket minted for the NEW session',
            /first-session/.test(opened[0] ?? '') &&
                'the re-login socket carried a ticket minted for the session that ended'
        ]
    );
    service.disconnect();
}

// ── 9. a mint still in flight when the session ends is discarded unused ──────────────────────
{
    reset();
    let release;
    const service = new WebSocketService(BASE, async () => {
        await new Promise((r) => {
            release = r;
        });
        return 'ticket-in-flight';
    });
    service.subscribe(['Sessions'], () => {});
    await tick();
    service.disconnect();
    release?.();
    await settle();
    check('a ticket minted for a session that ended is never spent', [
        opened.length !== 0 &&
            'the in-flight mint opened a socket after disconnect'
    ]);
}

// ── 10. there is no seam left to inject, and no deferred import to race ──────────────────────
{
    const serverConnections = readFileSync(
        join(REPO, 'src', 'lib', 'jellyfin-apiclient', 'ServerConnections.js'),
        'utf8'
    );
    check('no first-party code assigns Api.webSocket any more', [
        /_sdk\s*\.\s*webSocket\s*=/.test(serverConnections) &&
            'ServerConnections still installs something onto _sdk.webSocket; the seam is back',
        /webSocket\s*=/.test(serverConnections) &&
            'ServerConnections assigns a webSocket field'
    ]);
}

// ── 11. what was measured is what is installed ───────────────────────────────────────────────
check('the installed service is exactly the transform that was measured', [
    sha256(installed) !== socketTarget.patchedSha256 &&
        'the installed websocket service does not match the pinned patched digest, so the ' +
            'behaviour proved above is not the behaviour that ships'
]);

if (failures > 0) {
    process.stdout.write(`\n${failures} control(s) failed.\n`);
    process.exit(1);
}
process.stdout.write('\npatched @jellyfin/sdk socket controls: all pass.\n');

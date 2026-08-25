#!/usr/bin/env node
/*
 * Rewrite `@jellyfin/sdk`'s WebSocket credential transport at install time (#153-A1).
 *
 * WHY A SECOND PATCHER EXISTS
 *
 *   `scripts/patch-jellyfin-apiclient.mjs` (#152, extended by #153-A1) covers ONE package. The
 *   #153-A1 phase-0 trace found a SECOND socket producer: the socket a real session actually opens
 *   carried `ApiKey`, not `api_key`, and `api_key` is the only credential `jellyfin-apiclient`
 *   writes. `@jellyfin/sdk`'s `Api.subscribe()` and `Api.update()` build
 *   `getUri('socket', { [AUTHORIZATION_PARAMETER]: this.accessToken })` — the durable session
 *   token, in a url — and `ServerConnections` binds `apiClient.subscribe` straight onto it.
 *
 * WHAT CHANGED IN #153-A1-R2, AND WHY IT IS TWO FILES NOW
 *
 *   The first revision diverted the socket instead of fixing it: a first-party
 *   `TicketedWebSocketService` occupied `Api.webSocket` before any subscriber ran, so the sdk's own
 *   service was never constructed. That bought a correct socket at the price of a duplicate
 *   WebSocket runtime — ~9.8 KB in its own start-up chunk, which the delivery budget cannot absorb
 *   and which no ceiling may be raised for.
 *
 *   So the shipped service is now EXTENDED rather than replaced. `lib/websocket/websocket-service.js`
 *   learns an asynchronous ticket provider that is called once per PHYSICAL connection attempt —
 *   including every reconnect — and `lib/api.js` supplies one built from the `Api` it belongs to.
 *   The duplicate runtime is deleted. Nothing new is downloaded: both files are already inside
 *   `node_modules.@jellyfin.sdk.bundle.js`.
 *
 *   `initSocket()` is the single physical-connection site AND the reconnect site, which is what
 *   makes "one fresh ticket per attempt, never replayed" true by construction rather than true on
 *   the first attempt. A ticket is single-use and consumed by the server BEFORE the upgrade is
 *   accepted, so a ticket left in the STORED url would be refused on every retry and would look
 *   exactly like a flapping connection.
 *
 * THE TICKET ADAPTER, AND ITS LEASH
 *
 *   `lib/api.js` posts `/WebSocket/Tickets` directly rather than importing the generated
 *   `WebSocketTicketsApi`: pulling a generated client into the boot graph is precisely the chunk
 *   this change exists to remove. It is a minimal adapter, and it is CONTRACT-LOCKED —
 *   `ci/verify-websocket-ticket-contract.mjs` compares the method, the path, the absence of a body
 *   and of query parameters, and the reading of `Value`, against the generated client, and fails
 *   `validate:full` on any divergence. It builds no parallel DTO: it extracts `Value` and nothing
 *   else, and an absent or empty `Value` is a closed refusal.
 *
 *   The `Authorization` header is built ONLY by the `Api`'s own `authorizationHeader` getter — the
 *   same `MediaBrowser Client=…, Device=…, DeviceId=…, Version=…, Token=…` string, field for field,
 *   that the generated client sends. No credential is constructed here.
 *
 * WHAT IT DOES NOT TOUCH
 *
 *   `LibraryApi.getDownloadUrl()` (`/Items/{id}/Download?ApiKey=`) is deliberately left alone. That
 *   is a GENERAL-API route: `AuthorizationContext` reads `ApiKey` there by design, and a playback
 *   capability must never authenticate it, because `Policies.MediaDelivery` is the only policy that
 *   names the capability scheme. It is recorded as an exemption in
 *   `ci/credential-transport-inventory.mjs` rather than quietly rewritten here.
 *
 * BOUNDARY, AND HOW IT FAILS
 *
 *   Exactly `@jellyfin/sdk` at exactly the pinned version, exactly the files in TARGETS, each with
 *   its own pinned pristine and patched SHA-256 and its own fragment table, every fragment present
 *   exactly once. Any other state is a failure, never a silent skip.
 *
 *   MULTI-TARGET SAFETY. Nothing is written until EVERY target has been classified, every anchor
 *   verified and both outputs built in memory:
 *
 *     * one target in an unknown state  -> zero files modified, on any target;
 *     * one missing or ambiguous anchor -> zero files modified, on any target;
 *     * a mixed but RECOGNISED state (one pristine, one already patched) -> converges to fully
 *       patched, writing only what is still pristine. Running it again is a no-op. That state is
 *       normal, not suspicious: it is what an interrupted install, or this transform gaining a
 *       second target, leaves behind.
 *
 * USAGE
 *
 *   node scripts/patch-jellyfin-sdk.mjs           # patch (runs from `postinstall`)
 *   node scripts/patch-jellyfin-sdk.mjs --verify  # assert patched; NEVER writes
 *   node scripts/patch-jellyfin-sdk.mjs --root D  # operate on a fixture tree (test seam)
 *
 * OUTPUT SAFETY
 *
 *   No branch prints file content, a matched fragment's surroundings, or any value read from the
 *   package. Diagnostics name a target by its id and a fragment by its INDEX in that target's table.
 */
import {
    existsSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolvePackageDir, sha256 } from './patch-jellyfin-apiclient.mjs';

export const PACKAGE_NAME = '@jellyfin/sdk';
export const REQUIRED_VERSION =
    '0.0.0-unstable.202607090422+commit.9605b6332a2aa0b31c5288a7a95ebf750b8e685e';

/**
 * The ticket adapter `Api.subscribe()` hands to the service.
 *
 * Assembled line by line rather than as one template literal because the replacement itself
 * contains a template literal; keeping the two apart is what stops this file's own quoting from
 * silently changing the bytes that land in `node_modules`.
 */
const TICKET_ADAPTER = [
    'new WebSocketService(this.accessToken',
    '                ? this.getUri(WEBSOCKET_URL_PATH)',
    '                : undefined, async () => {',
    '                // #153-A1: the minimal ticket adapter. POST /WebSocket/Tickets, no body, no',
    "                // query, Authorization built ONLY by this Api's own header getter. Locked to",
    '                // the generated client by ci/verify-websocket-ticket-contract.mjs.',
    '                const response = await this.axiosInstance.post(`${this.basePath}/WebSocket/Tickets`, undefined, {',
    '                    headers: { Authorization: this.authorizationHeader }',
    '                });',
    '                const value = response.data?.Value;',
    '                if (!value) {',
    '                    // Closed refusal: no ticket, no socket. There is deliberately no',
    '                    // durable-token url to fall back to.',
    "                    throw new Error('[playbackCredentials] no websocket ticket');",
    '                }',
    '                return value;',
    '            })'
].join('\n');

/**
 * Every file this transform owns.
 *
 * `fragments[].unsafe` must appear EXACTLY ONCE in that target's pristine file. The two digests
 * pin both ends of the transform, so "some third state" cannot be mistaken for either.
 */
export const TARGETS = [
    {
        id: 'api',
        relative: join('lib', 'api.js'),
        pristineSha256:
            '13d7db30d8ec04880da9e140dc0769de871500ffab9b438973a78a013fafa330',
        patchedSha256:
            '4f571600ca8938920e1249cc9967b74d14cf253c7d163b1d0edb6aeadf3aa07f',
        fragments: [
            {
                note: 'Api.update() — armed the socket url on a basePath-only update, so a runtime with no authorization built a socket url and the next subscribe MINTED against it. Stock behaviour; measured on the rig as a POST /WebSocket/Tickets answering 401 before the first sign-in.',
                unsafe: `        if (data.basePath ||
            (data.accessToken && data.accessToken !== '')) {`,
                safe: `        // #153-A1: no authorization, no socket url. \`update({ basePath })\` armed the url
        // before any sign-in, so the first subscribe minted a ticket against an Api whose
        // \`accessToken\` was null and the server answered 401. The mint is fail-closed either
        // way, but a mint with no authorization must never be ATTEMPTED - and the same guard
        // covers the signed-OUT runtime, whose token has been cleared.
        if (this.accessToken
            && (data.basePath
                || (data.accessToken && data.accessToken !== ''))) {`
            },
            {
                note: 'Api.update() — reconnected an existing socket with the durable token in the url.',
                unsafe: `_a.updateUrl(this.getUri(WEBSOCKET_URL_PATH, {
                [AUTHORIZATION_PARAMETER]: this.accessToken
            }));`,
                safe: '_a.updateUrl(this.getUri(WEBSOCKET_URL_PATH));'
            },
            {
                note: 'Api.subscribe() — built the first socket with the durable token in the url; now supplies the ticket adapter instead.',
                unsafe: `new WebSocketService(this.accessToken
                ? this.getUri(WEBSOCKET_URL_PATH, {
                    [AUTHORIZATION_PARAMETER]: this.accessToken
                })
                : undefined)`,
                safe: TICKET_ADAPTER
            }
        ]
    },
    {
        id: 'websocket-service',
        relative: join('lib', 'websocket', 'websocket-service.js'),
        pristineSha256:
            '599421d27cff53866c6ee2b2e5e63d2e9ae4ac3e5113c7579b21a3e23640c26c',
        patchedSha256:
            'f4170201de6069868f8d78d3aae6e6bb26895615ff866d7c8aeacd718533f281',
        fragments: [
            {
                note: 'constructor body — hold the ticket provider and the connect-attempt state, and\n                 * emit retry() off the constructor closing brace. The new method is\n                 * defined HERE rather than behind its own anchor because an insert-before-X\n                 * fragment necessarily re-emits X, which would make the survived-the-transform\n                 * check unusable for it. This closing brace is a method boundary the transform\n                 * already owns.',
                unsafe: `        this.currentStatus = 'disconnected';
        if (uri) {
            this.url = buildWebSocketUrl(uri);
        }
    }`,
                safe: `        this.currentStatus = 'disconnected';
        // #153-A1: one fresh single-use ticket per PHYSICAL upgrade attempt. Absent provider
        // means no socket: there is deliberately no durable-token url to fall back to.
        // These three names are short because property names survive minification and this
        // patch's bytes are counted in the initial delivery tier.
        this.ticketProvider = ticketProvider;
        this.ticketGen = 0;
        this.minting = false;
        if (uri) {
            this.url = buildWebSocketUrl(uri);
        }
    }
    /** Re-arm a physical attempt. Mints again; never replays. Also the close handler's path. */
    retry() {
        if (this.autoReconnectDisabled || this.subscriptions.size === 0)
            return;
        if (this.reconnectionTimeout)
            return;
        this.reconnectionAttempts++;
        this.reconnectionTimeout = setTimeout(() => {
            this.reconnectionTimeout = undefined;
            this.initSocket();
        }, this.calculateBackoffDelay());
    }`
            },
            {
                note: 'constructor signature — accept the provider.',
                unsafe: '    constructor(uri) {',
                safe: '    constructor(uri, ticketProvider) {'
            },
            {
                note: 'initSocket() — mint a fresh ticket before every physical connection attempt.',
                unsafe: `    initSocket() {
        if (!this.url)
            return;
        this.socket = new WebSocket(this.url.toString());`,
                safe: `    async initSocket() {
        if (!this.url)
            return;
        // A subscribe racing the reconnect timer must not mint two tickets or open two sockets.
        // The guard and the generation bump run synchronously, before the first await, so a
        // caller that invokes this like the synchronous method it used to be is still safe.
        if (this.minting)
            return;
        const generation = ++this.ticketGen;
        this.minting = true;
        let ticket;
        try {
            ticket = this.ticketProvider ? await this.ticketProvider() : undefined;
        }
        catch {
            ticket = undefined;
        }
        this.minting = false;
        // Cancelled while minting (disconnect/updateUrl bumped the generation). Any ticket is
        // discarded unused rather than spent on a socket nobody asked for any more.
        if (generation !== this.ticketGen || this.autoReconnectDisabled)
            return;
        if (!ticket) {
            // Fail CLOSED, but stay alive: refusing this attempt must not kill auto-reconnect,
            // or one failed mint would end the session's socket permanently. There is
            // deliberately no durable-token url to fall back to.
            this.retry();
            return;
        }
        if (!this.url)
            return;
        // A COPY: the ticket must never be written back into the stored url, or the next
        // reconnect would replay a single-use ticket the server has already consumed.
        const target = new URL(this.url.toString());
        target.searchParams.set('webSocketTicket', ticket);
        this.socket = new WebSocket(target.toString());`
            },
            {
                note: 'close handler — reconnect through the ticketed scheduler instead of duplicating it.',
                unsafe: `            if (this.subscriptions.size > 0 && !this.autoReconnectDisabled) {
                this.reconnectionAttempts++;
                const delay = this.calculateBackoffDelay();
                this.reconnectionTimeout = setTimeout(() => this.initSocket(), delay);
            }`,
                safe: `            if (this.subscriptions.size > 0 && !this.autoReconnectDisabled) {
                this.retry();
            }`
            },
            {
                note: 'disconnect() — cancel any mint in flight.',
                unsafe: `        this.autoReconnectDisabled = true;
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.close();
        this.setStatus('disconnected');`,
                safe: `        this.autoReconnectDisabled = true;
        this.ticketGen++;
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.close();
        this.setStatus('disconnected');`
            },
            {
                note: 'updateUrl() — cancel any mint in flight before the url changes.',
                unsafe: `        this.autoReconnectDisabled = true;
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.close();
        this.socket = undefined;`,
                safe: `        this.autoReconnectDisabled = true;
        this.ticketGen++;
        (_a = this.socket) === null || _a === void 0 ? void 0 : _a.close();
        this.socket = undefined;`
            }
        ]
    }
];

class PatchError extends Error {}

function fail(message) {
    throw new PatchError(message);
}

/** One target's whole transform, so its patched digest covers exactly what lands on disk. */
export function applyFragments(target, content) {
    let out = content;
    for (const fragment of target.fragments) {
        out = out.split(fragment.unsafe).join(fragment.safe);
    }
    return out;
}

function assertFragments(target, content) {
    for (const [index, fragment] of target.fragments.entries()) {
        const count = content.split(fragment.unsafe).length - 1;
        if (count === 0) {
            fail(
                `${target.id}: fragment #${index} is absent from the pristine file — the package changed under its pinned hash`
            );
        }
        if (count > 1) {
            fail(
                `${target.id}: fragment #${index} appears ${count} times; the replacement would be ambiguous`
            );
        }
    }
}

function classify(target, content) {
    const digest = sha256(content);
    if (digest === target.pristineSha256) return 'pristine';
    if (digest === target.patchedSha256) return 'patched';
    return 'unknown';
}

export function run({
    root = process.cwd(),
    verify = false,
    log = console.log
} = {}) {
    const packageDir = resolvePackageDir(root, PACKAGE_NAME);
    if (!packageDir) {
        if (verify) {
            fail(`${PACKAGE_NAME} is not installed; nothing to verify`);
        }
        log(`${PACKAGE_NAME}: not installed; nothing to patch.`);
        return;
    }

    const manifest = JSON.parse(
        readFileSync(join(packageDir, 'package.json'), 'utf8')
    );
    if (manifest.version !== REQUIRED_VERSION) {
        fail(
            `${PACKAGE_NAME} is ${manifest.version}; this transform is pinned to ${REQUIRED_VERSION}. ` +
                'Re-inventory the new package rather than widening the pin.'
        );
    }

    // ---- phase 1: classify EVERY target and build EVERY output, writing nothing -----------------
    // A failure anywhere in this phase leaves the package exactly as it was found. That is the
    // whole reason the loop below does not write: a half-patched package is a third state, and the
    // digests deliberately cannot describe one.
    const planned = [];
    for (const target of TARGETS) {
        const path = join(packageDir, target.relative);
        if (!existsSync(path)) {
            fail(`${PACKAGE_NAME}: ${target.relative} is missing`);
        }
        const content = readFileSync(path, 'utf8');
        const state = classify(target, content);
        if (state === 'unknown') {
            fail(
                `${PACKAGE_NAME}: ${target.relative} matches neither the pinned pristine nor the ` +
                    'pinned patched hash; no file was modified'
            );
        }
        if (state === 'patched') {
            planned.push({ target, path, write: false });
            continue;
        }
        if (verify) {
            fail(
                `${PACKAGE_NAME}: ${target.relative} is pristine — the postinstall transform did not run`
            );
        }
        assertFragments(target, content);
        const patched = applyFragments(target, content);
        for (const [index, fragment] of target.fragments.entries()) {
            if (patched.includes(fragment.unsafe)) {
                fail(`${target.id}: fragment #${index} survived the transform`);
            }
        }
        if (sha256(patched) !== target.patchedSha256) {
            fail(
                `${PACKAGE_NAME}: the transform of ${target.relative} produced an unexpected ` +
                    'digest; refusing to write'
            );
        }
        planned.push({ target, path, write: true, patched });
    }

    const pending = planned.filter((entry) => entry.write);
    if (pending.length === 0) {
        log(
            `${PACKAGE_NAME}: already patched (${TARGETS.length} target(s) at their pinned patched hash).`
        );
        return;
    }

    // ---- phase 2: write, one atomic rename per target -------------------------------------------
    // Write through a temporary in the same directory, then rename: a reader never sees a half
    // written file, and a crash leaves either the pristine file or the complete patched one.
    // `wx` is an ATOMIC exclusive create: it fails if the path exists, symlink or not. An
    // `existsSync` guard in front of it adds nothing and is itself the check-then-use race CodeQL
    // flagged as `js/file-system-race` (high) — between the check and the write, anything can
    // appear at that path. The flag alone is the guarantee.
    //
    // `created` tracks whether THIS process made the file, so the cleanup can never remove one it
    // did not create.
    for (const entry of pending) {
        const temporary = `${entry.path}.a1-tmp`;
        let created = false;
        try {
            try {
                writeFileSync(temporary, entry.patched, {
                    encoding: 'utf8',
                    flag: 'wx'
                });
            } catch (error) {
                fail(
                    `${PACKAGE_NAME}: could not exclusively create ${entry.target.relative}.a1-tmp ` +
                        `(${error.code ?? 'unknown'}); refusing to write`
                );
            }
            created = true;
            renameSync(temporary, entry.path);
            created = false;
        } finally {
            if (created) rmSync(temporary, { force: true });
        }

        const written = readFileSync(entry.path, 'utf8');
        if (sha256(written) !== entry.target.patchedSha256) {
            fail(
                `${PACKAGE_NAME}: ${entry.target.relative} on disk does not match the pinned patched hash`
            );
        }
    }

    log(
        `${PACKAGE_NAME}: patched — ${pending.length} of ${TARGETS.length} target(s) rewritten ` +
            `(${pending.map((entry) => entry.target.id).join(', ')}).`
    );
}

/**
 * `file://${argv[1]}` never matches on Windows, so main() would silently never run and the process
 * would exit 0 having done nothing. `pathToFileURL` is what makes the comparison portable.
 */
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const argv = process.argv.slice(2);
    const rootIndex = argv.indexOf('--root');
    try {
        run({
            root: rootIndex === -1 ? process.cwd() : argv[rootIndex + 1],
            verify: argv.includes('--verify')
        });
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    }
}

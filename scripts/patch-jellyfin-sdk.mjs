#!/usr/bin/env node
/*
 * Remove `@jellyfin/sdk`'s durable-token WebSocket url construction at install time (#153-A1).
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
 *   #153's issue text describes one patcher for one package. This is an EXPANSION of that
 *   dependency boundary, stated here rather than folded silently into the existing script: a second
 *   package, a second pinned version, a second pristine/patched hash pair, its own anchors.
 *
 * WHY PATCH AT ALL, GIVEN THE RUNTIME ALREADY DIVERTS THE SOCKET
 *
 *   `src/lib/playbackCredentials/boot.ts` occupies `Api.webSocket` before any subscriber runs, so
 *   the sdk's own `WebSocketService` is never constructed and these two urls are never built. That
 *   is a behavioural guarantee, and a behavioural guarantee is exactly what a bypass removes. With
 *   the credential deleted from the source, a bypass produces a socket with NO credential — which
 *   the server refuses — instead of one silently carrying the durable token.
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
 *   Exactly `@jellyfin/sdk` at exactly the pinned version, exactly one file, whose pristine SHA-256
 *   is pinned below, rewriting exactly the fragments in UNSAFE_FRAGMENTS — each present exactly
 *   once. Any other state is a failure, never a silent skip. The three pinned identities
 *   (PRISTINE_SHA256, PATCHED_SHA256, the fragment table) make "some third state" impossible to
 *   mistake for either end of the transform.
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
 *   package. Diagnostics name a fragment by its INDEX in the table below.
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
export const TARGET_RELATIVE = join('lib', 'api.js');

export const PRISTINE_SHA256 =
    '13d7db30d8ec04880da9e140dc0769de871500ffab9b438973a78a013fafa330';
export const PATCHED_SHA256 =
    '566cd2be70d560f595050fc3c73746a797d1f3898fee319e092c44c2d36f870e';

/**
 * The two places `@jellyfin/sdk` puts the durable session token into a socket url.
 *
 * The replacement keeps the url and drops the credential, rather than deleting the call: the socket
 * path itself is not the defect, and a connection attempt that reaches the server with no
 * credential is refused there — which is the fail-closed behaviour this patch exists to produce.
 */
export const UNSAFE_FRAGMENTS = [
    {
        note: 'Api.update() — reconnects an existing socket with the durable token in the url.',
        unsafe: `_a.updateUrl(this.getUri(WEBSOCKET_URL_PATH, {
                [AUTHORIZATION_PARAMETER]: this.accessToken
            }));`,
        safe: '_a.updateUrl(this.getUri(WEBSOCKET_URL_PATH));'
    },
    {
        note: 'Api.subscribe() — builds the first socket with the durable token in the url.',
        unsafe: `new WebSocketService(this.accessToken
                ? this.getUri(WEBSOCKET_URL_PATH, {
                    [AUTHORIZATION_PARAMETER]: this.accessToken
                })
                : undefined)`,
        safe: `new WebSocketService(this.accessToken
                ? this.getUri(WEBSOCKET_URL_PATH)
                : undefined)`
    }
];

class PatchError extends Error {}

function fail(message) {
    throw new PatchError(message);
}

/** The whole transform, in one place, so PATCHED_SHA256 covers exactly what lands on disk. */
export function applyFragments(content) {
    let out = content;
    for (const fragment of UNSAFE_FRAGMENTS) {
        out = out.split(fragment.unsafe).join(fragment.safe);
    }
    return out;
}

function assertFragments(content) {
    for (const [index, fragment] of UNSAFE_FRAGMENTS.entries()) {
        const count = content.split(fragment.unsafe).length - 1;
        if (count === 0) {
            fail(
                `fragment #${index} is absent from the pristine file — the package changed under its pinned hash`
            );
        }
        if (count > 1) {
            fail(
                `fragment #${index} appears ${count} times; the replacement would be ambiguous`
            );
        }
    }
}

function classify(content) {
    const digest = sha256(content);
    if (digest === PRISTINE_SHA256) return 'pristine';
    if (digest === PATCHED_SHA256) return 'patched';
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

    const target = join(packageDir, TARGET_RELATIVE);
    if (!existsSync(target)) {
        fail(`${PACKAGE_NAME}: ${TARGET_RELATIVE} is missing`);
    }
    const content = readFileSync(target, 'utf8');
    const state = classify(content);

    if (state === 'patched') {
        log(
            `${PACKAGE_NAME}: already patched (${UNSAFE_FRAGMENTS.length} socket url fragment(s) rewritten).`
        );
        return;
    }
    if (state === 'unknown') {
        fail(
            `${PACKAGE_NAME}: ${TARGET_RELATIVE} matches neither the pinned pristine nor the pinned patched hash`
        );
    }
    if (verify) {
        fail(
            `${PACKAGE_NAME}: ${TARGET_RELATIVE} is pristine — the postinstall transform did not run`
        );
    }

    assertFragments(content);
    const patched = applyFragments(content);
    for (const [index, fragment] of UNSAFE_FRAGMENTS.entries()) {
        if (patched.includes(fragment.unsafe)) {
            fail(`fragment #${index} survived the transform`);
        }
    }
    const digest = sha256(patched);
    if (digest !== PATCHED_SHA256) {
        fail(
            `${PACKAGE_NAME}: the transform produced an unexpected digest; refusing to write`
        );
    }

    // Write through a temporary in the same directory, then rename: a reader never sees a half
    // written file, and a crash leaves either the pristine file or the complete patched one.
    const temporary = `${target}.a1-tmp`;
    if (existsSync(temporary)) {
        fail(
            `${PACKAGE_NAME}: ${TARGET_RELATIVE}.a1-tmp already exists; refusing to write`
        );
    }
    try {
        writeFileSync(temporary, patched, { encoding: 'utf8', flag: 'wx' });
        renameSync(temporary, target);
    } finally {
        if (existsSync(temporary)) rmSync(temporary, { force: true });
    }

    const written = readFileSync(target, 'utf8');
    if (sha256(written) !== PATCHED_SHA256) {
        fail(
            `${PACKAGE_NAME}: the file on disk does not match the pinned patched hash`
        );
    }
    log(
        `${PACKAGE_NAME}: patched — ${UNSAFE_FRAGMENTS.length} socket url fragment(s) rewritten.`
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

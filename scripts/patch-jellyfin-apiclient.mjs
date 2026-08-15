#!/usr/bin/env node
/*
 * Remove `jellyfin-apiclient`'s credential-bearing console statements at install time (#152).
 *
 * WHY THIS EXISTS
 *
 *   `jellyfin-apiclient@1.11.0` ships a prebuilt bundle that prints the session credential to the
 *   browser console. The clearest case is `openWebSocket`:
 *
 *       var e = this.accessToken();  url += "api_key=" + e;
 *       console.log("opening web socket with url: " + url);
 *
 *   That token is not media-scoped: the server accepts `ApiKey`/`api_key` from the query string on
 *   every endpoint and resolves it to the owning user's session, with no expiry applied. It fires on
 *   every sign-in, so the affected population is everyone who signed in. The package also prints the
 *   stored credentials JSON verbatim — `AccessToken` included — and eleven more full-url request,
 *   response, timeout and failure lines, each of which can carry the same parameter.
 *
 *   tesserafin-web #154 removed the equivalent first-party sinks and added an AST gate over `src/`.
 *   No edit under `src/` reaches a dependency's own bundled `console.log`, and `overrides` pins a
 *   version, it does not rewrite one. This patcher is the part that reaches it.
 *
 * WHY IT IS A REPOSITORY-OWNED SCRIPT AND NOT `patch-package`
 *
 *   A patching dependency is a new install-time supply-chain surface introduced to close a
 *   supply-chain disclosure. This script has no dependencies beyond Node's standard library, is
 *   about two hundred lines, and is reviewable in one sitting.
 *
 * THE BOUNDARY, AND HOW IT FAILS
 *
 *   It applies to EXACTLY `jellyfin-apiclient@1.11.0`, to exactly one file, whose pristine SHA-256
 *   is pinned below, and it rewrites exactly the fragments in UNSAFE_FRAGMENTS — each of which must
 *   be present exactly once. Any other state is a failure, never a silent skip:
 *
 *     - a different version, a different pristine hash, a missing or duplicated fragment, a
 *       partially patched file, a path that escapes the package root, or a resolved path that is a
 *       symlink → exit 1.
 *     - the exact pristine content → patched, then re-verified.
 *     - the exact patched content → success, unchanged (idempotent).
 *
 *   Three pinned identities make that closed: PRISTINE_SHA256, PATCHED_SHA256, and the fragment
 *   table. "Some third state" cannot be mistaken for either end of the transform.
 *
 * WHEN TO DELETE IT
 *
 *   When `jellyfin-apiclient` is replaced by the SDK-based client, OR when an upstream release is
 *   published whose bundle is independently verified to contain none of the fragments below. Bumping
 *   the version alone does NOT satisfy that: an unpinned version makes this script exit 1, which is
 *   the intended prompt to re-inventory the new bundle rather than to widen the pin.
 *
 * WHAT IT DOES NOT TOUCH
 *
 *   Ordinary non-url logging, and the server-ADDRESS lines (`getTryConnectPromise`, `Reconnect
 *   failed to`, `connectToAddress`, `tryReconnect`, `Setting server address to`). An origin the user
 *   typed or the server advertised carries no credential — the token does not exist until a
 *   connection succeeds — and which candidate failed is the whole diagnosis. That is the same
 *   classification `scripts/console-url-hygiene.allowlist.json` already applies to the first-party
 *   copies of those lines.
 *
 *   `console.log("unable to parse json content: " + e)` is retained deliberately: it prints a
 *   response body only when that body is not JSON, so it is not a url sink and not a credential sink
 *   on any parseable response. It is recorded here so the inventory is closed rather than truncated.
 *
 * USAGE
 *
 *   node scripts/patch-jellyfin-apiclient.mjs           # patch (runs from `postinstall`)
 *   node scripts/patch-jellyfin-apiclient.mjs --verify  # assert patched; NEVER writes
 *   node scripts/patch-jellyfin-apiclient.mjs --root D  # operate on a fixture tree (test seam)
 *
 *   `--verify` is the CI form: it fails on pristine content, which is what makes a skipped
 *   `postinstall` (`npm ci --ignore-scripts`) unable to produce a green build.
 *
 * OUTPUT SAFETY
 *
 *   No branch of this script prints file content, a matched fragment's surroundings, or any value
 *   read from the package. Diagnostics name a fragment by its INDEX in the table below.
 */
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const PACKAGE_NAME = 'jellyfin-apiclient';
export const REQUIRED_VERSION = '1.11.0';
export const TARGET_RELATIVE = join('dist', 'jellyfin-apiclient.js');
/** The published bundle's map embeds the pre-minification sources, unsafe strings and all. */
export const MAP_RELATIVE = join('dist', 'jellyfin-apiclient.js.map');

export const PRISTINE_SHA256 =
    'b39363f92f6946407d57623068699520e26bd9e784c93aabf9754544aad04832';
export const PATCHED_SHA256 =
    '49aef09f849a52bdcfb05129110c5d8cc2820e4e082451cb062062fac659948b';

/**
 * Every credential-capable console statement in the published bundle, with the sanitized form that
 * replaces it. Each `unsafe` string must appear EXACTLY ONCE in pristine content.
 *
 * `category` records what the statement could disclose. `url` means the value is a full request or
 * socket url, which can carry `ApiKey`/`api_key`; `credentials` means the value is the stored
 * credentials document itself.
 */
export const UNSAFE_FRAGMENTS = [
    {
        category: 'credentials',
        note: 'openWebSocket — the socket url built with `api_key=<accessToken()>`. This is #152.',
        unsafe: 'console.log("opening web socket with url: ".concat(t))',
        safe: 'console.log("opening web socket")'
    },
    {
        category: 'credentials',
        note: 'the credentials store read — prints the whole `jellyfin_credentials` document, `AccessToken` included.',
        unsafe: 'console.log("Stored JSON credentials: ".concat(r))',
        safe: 'console.log("loaded stored credentials")'
    },
    {
        category: 'url',
        note: 'fetchWithFailover — the request url.',
        unsafe: 'console.log("Requesting ".concat(e.url))',
        safe: 'console.log("Requesting")'
    },
    {
        category: 'url',
        note: 'BitrateTest — a `getUrl()` result, so query parameters included.',
        unsafe: 'console.log("Requesting ".concat(i))',
        safe: 'console.log("Requesting BitrateTest")'
    },
    {
        category: 'url',
        note: 'ajax without automatic networking — the request url.',
        unsafe: 'console.log("Requesting url without automatic networking: ".concat(e.url))',
        safe: 'console.log("Requesting without automatic networking")'
    },
    {
        category: 'url',
        note: 'the request failure branch — url plus the error. The error is kept.',
        unsafe: 'console.log("Request failed to ".concat(e.url," ").concat(n.toString()))',
        safe: 'console.log("Request failed: ".concat(n.toString()))'
    },
    {
        category: 'url',
        note: 'the request timeout branch — the request url.',
        unsafe: 'console.log("Request timed out to ".concat(e.url))',
        safe: 'console.log("Request timed out")'
    },
    {
        category: 'url',
        note: 'ConnectionManager request — the request url.',
        unsafe: 'console.log("ConnectionManager requesting url: ".concat(e.url))',
        safe: 'console.log("ConnectionManager requesting")'
    },
    {
        category: 'url',
        note: 'ConnectionManager response — status plus url. The status is kept.',
        unsafe: 'console.log("ConnectionManager response status: ".concat(t.status,", url: ").concat(e.url))',
        safe: 'console.log("ConnectionManager response status: ".concat(t.status))'
    },
    {
        category: 'url',
        note: 'ConnectionManager failure — the request url.',
        unsafe: 'console.log("ConnectionManager request failed to url: ".concat(e.url))',
        safe: 'console.log("ConnectionManager request failed")'
    },
    {
        category: 'url',
        note: 'fetchWithTimeout entry — timeout plus url. The timeout is kept.',
        unsafe: 'console.log("fetchWithTimeout: timeoutMs: ".concat(i,", url: ").concat(r))',
        safe: 'console.log("fetchWithTimeout: timeoutMs: ".concat(i))'
    },
    {
        category: 'url',
        note: 'fetchWithTimeout success — the request url.',
        unsafe: 'console.log("fetchWithTimeout: succeeded connecting to url: ".concat(r))',
        safe: 'console.log("fetchWithTimeout: succeeded connecting")'
    },
    {
        category: 'url',
        note: 'fetchWithTimeout timeout — the request url.',
        unsafe: 'console.log("fetchWithTimeout: timed out connecting to url: ".concat(r))',
        safe: 'console.log("fetchWithTimeout: timed out connecting")'
    }
];

export function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

class PatchError extends Error {}

/**
 * The package's own directory, refusing anything that resolves outside the root it was asked for.
 * `realpath` collapses symlinks first, so a link planted inside `node_modules` cannot redirect the
 * write to another tree.
 */
export function resolvePackageDir(root) {
    const expected = join(resolve(root), 'node_modules', PACKAGE_NAME);
    if (!existsSync(expected)) return null;
    if (lstatSync(expected).isSymbolicLink())
        throw new PatchError(
            `${PACKAGE_NAME} resolves through a symlink; refusing to patch`
        );
    const real = realpathSync(expected);
    const realRoot = realpathSync(resolve(root));
    const rel = relative(join(realRoot, 'node_modules'), real);
    if (rel !== PACKAGE_NAME)
        throw new PatchError(
            `${PACKAGE_NAME} resolves outside its own package root; refusing to patch`
        );
    return real;
}

function readVersion(packageDir) {
    const manifest = JSON.parse(
        readFileSync(join(packageDir, 'package.json'), 'utf8')
    );
    return manifest.version;
}

/** Replace the file through a temp sibling + rename, so no reader ever sees a half-written file. */
function writeAtomic(target, content) {
    const temporary = `${target}.s4d1.tmp`;
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o644 });
    renameSync(temporary, target);
}

/**
 * Classify the file we found. Exactly three answers are allowed; anything else is a hard failure,
 * which is what makes a partially patched or locally edited bundle impossible to mistake for done.
 */
function classify(content) {
    const digest = sha256(content);
    if (digest === PRISTINE_SHA256) return 'pristine';
    if (digest === PATCHED_SHA256) return 'patched';
    return 'unknown';
}

function assertFragments(content) {
    for (const [index, fragment] of UNSAFE_FRAGMENTS.entries()) {
        const count = content.split(fragment.unsafe).length - 1;
        if (count === 0)
            throw new PatchError(
                `fragment #${index} (${fragment.category}) is absent from the pristine bundle — the package changed under its pinned hash`
            );
        if (count > 1)
            throw new PatchError(
                `fragment #${index} (${fragment.category}) appears ${count} times; the replacement would be ambiguous`
            );
    }
}

/**
 * The whole transform, in one place, so the hash pinned as PATCHED_SHA256 covers exactly what lands
 * on disk. The trailing `sourceMappingURL` comment goes with the fragments: the map it points at is
 * deleted (it embeds the pre-minification sources, unsafe strings and all), and a bundle pointing at
 * a map that is not there is worse than one that does not claim to have a map.
 */
function applyFragments(content) {
    let out = content;
    for (const fragment of UNSAFE_FRAGMENTS)
        out = out.split(fragment.unsafe).join(fragment.safe);
    return out.replace(
        /\n?\/\/# sourceMappingURL=jellyfin-apiclient\.js\.map\s*$/,
        '\n'
    );
}

function assertClean(content, where) {
    const remaining = UNSAFE_FRAGMENTS.map((fragment, index) =>
        content.includes(fragment.unsafe) ? index : -1
    ).filter((index) => index !== -1);
    if (remaining.length)
        throw new PatchError(
            `${where} still contains unsafe fragment(s) #${remaining.join(', #')} after patching`
        );
}

export function run({
    root = process.cwd(),
    verify = false,
    log = console.log
} = {}) {
    const packageDir = resolvePackageDir(root);
    if (packageDir === null) {
        // `postinstall` also fires for anyone installing this repository as a dependency, where the
        // package may legitimately be absent. Patching nothing is correct there. VERIFYING nothing
        // never is: `--verify` is the gate, and a gate that passes on an empty tree is no gate.
        if (verify)
            throw new PatchError(
                `${PACKAGE_NAME} is not installed under ${root}; refusing to report a vacuous pass`
            );
        log(`${PACKAGE_NAME} is not installed; nothing to patch.`);
        return 'absent';
    }
    const version = readVersion(packageDir);
    if (version !== REQUIRED_VERSION)
        throw new PatchError(
            `${PACKAGE_NAME} is ${version}, but this patch is pinned to ${REQUIRED_VERSION}. ` +
                'Re-inventory the new bundle and re-pin, or delete this script if upstream fixed it.'
        );

    const target = join(packageDir, TARGET_RELATIVE);
    if (lstatSync(target).isSymbolicLink())
        throw new PatchError('the target file is a symlink; refusing to patch');

    const content = readFileSync(target, 'utf8');
    const state = classify(content);

    if (state === 'patched') {
        assertClean(content, 'the installed bundle');
        // The map embeds the pre-minification sources verbatim. A tree whose .js is patched but
        // whose map was restored still has every fragment on disk, and the .js hash cannot see it.
        if (existsSync(join(packageDir, MAP_RELATIVE)))
            throw new PatchError(
                'the bundle is patched but its source map is present again; the map carries the ' +
                    'pre-patch sources verbatim'
            );
        log(
            `${PACKAGE_NAME}@${version}: already patched (${UNSAFE_FRAGMENTS.length} sinks removed).`
        );
        return 'already-patched';
    }
    if (state === 'unknown')
        throw new PatchError(
            `the installed bundle matches neither the pinned pristine nor the pinned patched hash. ` +
                'Refusing to guess. Reinstall the dependency, or re-pin if the package genuinely changed.'
        );
    if (verify)
        throw new PatchError(
            'the installed bundle is PRISTINE — the credential sinks are present. ' +
                'The `postinstall` patch did not run (was `--ignore-scripts` used?).'
        );

    assertFragments(content);
    const patched = applyFragments(content);
    assertClean(patched, 'the patched output');
    writeAtomic(target, patched);

    const written = readFileSync(target, 'utf8');
    assertClean(written, 'the file on disk');
    const writtenDigest = sha256(written);
    if (writtenDigest !== PATCHED_SHA256)
        throw new PatchError(
            'the patched file does not match the pinned patched hash; the transform is not reproducible'
        );

    // The map embeds the pre-minification sources, so it still carries every fragment just removed.
    // Nothing here consumes a dependency map in a production build (`source-map-loader` is
    // development-only), and leaving it would make "no unsafe fragment remains in the installed
    // package" false. The pointer to it was already removed above, inside the hashed transform.
    rmSync(join(packageDir, MAP_RELATIVE), { force: true });

    log(
        `${PACKAGE_NAME}@${version}: patched — ${UNSAFE_FRAGMENTS.length} credential-capable console sink(s) removed.`
    );
    return 'patched';
}

function main(argv) {
    const options = { root: process.cwd(), verify: false };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--verify') options.verify = true;
        else if (argv[i] === '--root') {
            options.root = resolve(argv[i + 1]);
            i += 1;
        } else {
            console.error(`unknown argument: ${argv[i]}`);
            process.exit(2);
        }
    }
    try {
        run(options);
    } catch (error) {
        // Only this script's own messages are printed — never file content.
        console.error(
            `patch-jellyfin-apiclient: ${error instanceof PatchError ? error.message : 'unexpected failure'}`
        );
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`)
    main(process.argv.slice(2));

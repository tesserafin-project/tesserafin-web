#!/usr/bin/env node
/*
 * Remove `jellyfin-apiclient`'s credential-bearing console statements (#152) and its durable-token
 * WebSocket url construction (#153-A1), at install time.
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
import { createHash, randomBytes } from 'node:crypto';
import {
    closeSync,
    constants as fsConstants,
    existsSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    openSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    statSync,
    unlinkSync,
    writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * `O_NOFOLLOW` exists only where the platform's `fcntl.h` defines it — Node exports it inside
 * `#ifdef O_NOFOLLOW`, and Windows does not have it. `O_RDONLY` is unconditional and is 0, so the
 * obvious `O_RDONLY | fsConstants.O_NOFOLLOW` evaluates to `0 | undefined` === `0` there: a plain,
 * symlink-FOLLOWING open, with no error and no warning. Resolving it into an explicit `null` is what
 * stops a missing constant from being indistinguishable from "no extra flags".
 */
const NO_FOLLOW =
    typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : null;

export const PACKAGE_NAME = 'jellyfin-apiclient';
export const REQUIRED_VERSION = '1.11.0';
export const TARGET_RELATIVE = join('dist', 'jellyfin-apiclient.js');
/** The published bundle's map embeds the pre-minification sources, unsafe strings and all. */
export const MAP_RELATIVE = join('dist', 'jellyfin-apiclient.js.map');

export const PRISTINE_SHA256 =
    'b39363f92f6946407d57623068699520e26bd9e784c93aabf9754544aad04832';
export const PATCHED_SHA256 =
    '68068867e336be4e97f345ec437afc30303e3ea306f059581837b5c94f885f60';

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
        category: 'transport',
        note:
            '#153-A1. openWebSocket built the socket url with `?api_key=<accessToken()>` — the ' +
            'durable session token, in a url. This app never calls it: `lib/playbackCredentials/' +
            'boot.ts` occupies `Api.webSocket` before any subscriber runs, so every upgrade goes ' +
            'through the ticketed service instead, and this method has ZERO first-party callers. ' +
            'It is replaced by a refusal rather than by a ticketed url on purpose: a dead code ' +
            'path that quietly still works is how a bypass of the injection would fall back to ' +
            'the durable token without anything failing.',
        unsafe: 't+="?api_key=".concat(e),t+="&deviceId=".concat(this.deviceId()),',
        // Kept SHORT on purpose: the replacement lands in the initial delivery graph, whose
        // gzip ceiling had 17 bytes of headroom, and the long form put it 14 bytes over. The
        // issue number is the pointer; the full rationale is the note above, not the runtime
        // string.
        safe: '(function(){throw new Error("openWebSocket disabled: #153-A1")})(),'
    },
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
export function resolvePackageDir(root, packageName = PACKAGE_NAME) {
    const expected = join(
        resolve(root),
        'node_modules',
        ...packageName.split('/')
    );
    if (!existsSync(expected)) return null;
    if (lstatSync(expected).isSymbolicLink())
        throw new PatchError(
            `${packageName} resolves through a symlink; refusing to patch`
        );
    const real = realpathSync(expected);
    const realRoot = realpathSync(resolve(root));
    // `relative` yields the platform separator; the package name always uses `/`, so normalise
    // before comparing or a scoped package would never match on Windows.
    const rel = relative(join(realRoot, 'node_modules'), real)
        .split(sep)
        .join('/');
    if (rel !== packageName)
        throw new PatchError(
            `${packageName} resolves outside its own package root; refusing to patch`
        );
    return real;
}

function readVersion(packageDir) {
    const manifest = JSON.parse(
        readFileSync(join(packageDir, 'package.json'), 'utf8')
    );
    return manifest.version;
}

/**
 * Open the target once, prove what was opened, and hand back the descriptor.
 *
 * WHY THIS IS NOT JUST `open(O_NOFOLLOW)`
 *
 *   `O_NOFOLLOW` is the strongest form and is used wherever it exists: the refusal happens inside
 *   the open, so there is no window at all. It does not exist on Windows, and OR-ing an undefined
 *   constant silently produces a plain follow-the-symlink open (see NO_FOLLOW above). Failing every
 *   Windows install is not an acceptable answer either, so the guarantee is reconstructed from
 *   metadata instead — and the SAME checks run on both paths, so the two converge rather than one
 *   being a weaker cousin:
 *
 *     1. `fstat` the descriptor: it must be a regular file.
 *     2. `lstat` the pathname WITHOUT following it: it must be a regular file and not a symlink.
 *        This is the check that rejects a symlinked target where `O_NOFOLLOW` is unavailable.
 *     3. Compare identity: the object behind the descriptor must be the object the pathname names,
 *        so a swap between the open and the check cannot redirect anything.
 *
 *   Every read is then of the DESCRIPTOR, never of the pathname again.
 *
 * @param {string} target
 * @param {{ noFollow?: number | null }} [options] Test seam: pass `noFollow: null` to exercise the
 *   portable path on a host that does have `O_NOFOLLOW`. It is a parameter rather than an
 *   environment variable so nothing outside the process can weaken production execution.
 */
/**
 * The object behind the descriptor must be the object the pathname names, so that a swap between
 * the open and the check cannot redirect anything.
 *
 * Returns whether the STRONG basis (inode + device) was available. Where a filesystem reports no
 * inode the comparison falls back to size and modification time, which is CORROBORATION rather than
 * identity — for the file just opened it is nearly always trivially true. On such a host the
 * guarantee is carried by the caller's non-symlink `lstat`, not by this.
 */
function assertSameObject(viaDescriptor, viaPath) {
    const identified = viaDescriptor.ino !== 0n && viaPath.ino !== 0n;
    if (identified) {
        if (
            viaDescriptor.ino !== viaPath.ino ||
            viaDescriptor.dev !== viaPath.dev
        )
            throw new PatchError(
                'the target changed identity between opening and checking it; refusing to patch'
            );
        return true;
    }
    if (
        viaDescriptor.size !== viaPath.size ||
        viaDescriptor.mtimeNs !== viaPath.mtimeNs
    )
        throw new PatchError(
            'the target could not be corroborated between descriptor and path; refusing to patch'
        );
    return false;
}

export function openVerified(target, { noFollow = NO_FOLLOW } = {}) {
    const flags =
        noFollow === null
            ? fsConstants.O_RDONLY
            : fsConstants.O_RDONLY | noFollow;
    let fd;
    try {
        fd = openSync(target, flags);
    } catch (error) {
        if (error && (error.code === 'ELOOP' || error.code === 'EMLINK'))
            throw new PatchError(
                'the target file is a symlink; refusing to patch'
            );
        throw new PatchError('the target file could not be opened');
    }
    try {
        const viaDescriptor = fstatSync(fd, { bigint: true });
        const viaPath = lstatSync(target, { bigint: true });
        if (!viaDescriptor.isFile())
            throw new PatchError(
                'the opened target is not a regular file; refusing to patch'
            );
        // Unconditional, on BOTH paths: where O_NOFOLLOW applied this is redundant, and where it
        // was unavailable this IS the guarantee.
        if (viaPath.isSymbolicLink())
            throw new PatchError(
                'the target file is a symlink; refusing to patch'
            );
        if (!viaPath.isFile())
            throw new PatchError(
                'the target path is not a regular file; refusing to patch'
            );
        const identified = assertSameObject(viaDescriptor, viaPath);
        return { fd, mode: Number(viaDescriptor.mode) & 0o777, identified };
    } catch (error) {
        closeSync(fd);
        throw error;
    }
}

/** Read a verified target, always through the descriptor that was verified. */
export function readVerified(target, options) {
    const { fd } = openVerified(target, options);
    try {
        return readFileSync(fd, { encoding: 'utf8' });
    } finally {
        closeSync(fd);
    }
}

/**
 * Replace the target through an EXCLUSIVELY created temporary sibling, then rename.
 *
 * The previous form wrote a fixed name with plain `writeFileSync`, which was a write-anywhere
 * primitive: `writeFileSync` FOLLOWS a symlink already sitting at that path, and the name was
 * predictable, so anyone able to create one file in `dist/` could redirect an `npm ci` write to any
 * path the installing user could reach. Two changes close that:
 *
 *   - the name is unpredictable per invocation, so it cannot be pre-planted;
 *   - it is created with `wx` (`O_CREAT | O_EXCL | O_WRONLY`), which refuses with `EEXIST` if
 *     ANYTHING is already there — regular file, directory or symlink — and so never follows one.
 *
 * CLEANUP OWNERSHIP: the only path ever unlinked is the one this invocation exclusively created.
 * A pre-existing file whose name merely resembles a temporary of ours is never read, written or
 * deleted.
 */
function writeAtomicExclusive(target, content, mode) {
    const temporary = join(
        dirname(target),
        `.${basename(target)}.${randomBytes(12).toString('hex')}.tmp`
    );
    let fd;
    try {
        fd = openSync(temporary, 'wx', mode);
    } catch {
        throw new PatchError(
            'could not create an exclusive temporary file next to the target; refusing to patch'
        );
    }
    let ours = true;
    try {
        writeFileSync(fd, content, { encoding: 'utf8' });
        try {
            fsyncSync(fd);
        } catch {
            // Durability is not part of this contract, and some filesystems refuse fsync here. A
            // completed write followed by a rename is what is being promised.
        }
        closeSync(fd);
        fd = undefined;
        renameSync(temporary, target);
        // The bytes ARE the target now; no temporary of ours remains to clean up.
        ours = false;
    } finally {
        if (fd !== undefined) closeSync(fd);
        if (ours) {
            try {
                unlinkSync(temporary);
            } catch {
                // Best effort, and only ever this invocation's own exclusively created path.
            }
        }
    }
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
    log = console.log,
    // Test seam, mirrored from `openVerified`: `null` forces the portable descriptor/path identity
    // path on a host that does have `O_NOFOLLOW`, so the Windows branch is exercised everywhere.
    noFollow = NO_FOLLOW
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
    const opened = openVerified(target, { noFollow });
    let content;
    try {
        content = readFileSync(opened.fd, { encoding: 'utf8' });
    } finally {
        closeSync(opened.fd);
    }
    const state = classify(content);

    if (state === 'patched') {
        assertClean(content, 'the installed bundle');
        // The map embeds the pre-minification sources verbatim. A tree whose .js is patched but
        // whose map was restored still has every fragment on disk, and the .js hash cannot see it.
        if (
            statSync(join(packageDir, MAP_RELATIVE), {
                throwIfNoEntry: false
            }) !== undefined
        )
            throw new PatchError(
                'the bundle is patched but its source map is present again; the map carries the ' +
                    'pre-patch sources verbatim'
            );
        log(
            `${PACKAGE_NAME}@${version}: already patched (${UNSAFE_FRAGMENTS.length} fragment(s) rewritten).`
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
    writeAtomicExclusive(target, patched, opened.mode);

    const written = readVerified(target, { noFollow });
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
        `${PACKAGE_NAME}@${version}: patched — ${UNSAFE_FRAGMENTS.length} credential-capable fragment(s) rewritten ` +
            `(${UNSAFE_FRAGMENTS.filter((f) => f.category === 'transport').length} transport, ` +
            `${UNSAFE_FRAGMENTS.filter((f) => f.category !== 'transport').length} console).`
    );
    return 'patched';
}

function main(argv) {
    const options = { root: process.cwd(), verify: false };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--verify') options.verify = true;
        else if (argv[i] === '--no-o-nofollow') options.noFollow = null;
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

// `file://${process.argv[1]}` is a POSIX-only shortcut. On Windows argv[1] is
// `D:\\a\\...\\patch-jellyfin-apiclient.mjs` while `import.meta.url` is
// `file:///D:/a/.../patch-jellyfin-apiclient.mjs`, so the two are NEVER equal, `main()` never runs,
// and the script becomes a silent no-op that exits 0 with the credential sinks still in place.
// `pathToFileURL` applies the drive-letter and separator normalisation that makes the comparison
// mean the same thing on every platform.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main(process.argv.slice(2));

#!/usr/bin/env node
/**
 * Deterministic controls for scripts/patch-jellyfin-apiclient.mjs (#152).
 *
 * The patcher rewrites a dependency's shipped bundle at install time. That is only defensible if it
 * is FAIL-CLOSED: it must refuse every input it does not recognise rather than quietly leaving a
 * credential sink in place. Each case below builds a throwaway `node_modules/jellyfin-apiclient`
 * tree, runs the real patcher against it with `--root`, and asserts the verdict.
 *
 * The pristine fixture is the REAL installed bundle when one is available, so these controls run
 * against the actual published artifact rather than a hand-written imitation.
 *
 * NOTHING HERE PRINTS PACKAGE CONTENT. The synthetic credential below is a fixed non-token string
 * used only to prove it never reaches the patcher's own output.
 */
import { spawnSync } from 'node:child_process';
import { closeSync } from 'node:fs';
import {
    existsSync,
    lstatSync,
    readdirSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PATCHER = join(HERE, 'patch-jellyfin-apiclient.mjs');
const INSTALLED = join(REPO, 'node_modules', 'jellyfin-apiclient');

const {
    PRISTINE_SHA256,
    PATCHED_SHA256,
    REQUIRED_VERSION,
    UNSAFE_FRAGMENTS,
    openVerified,
    sha256
    // `import()` of a bare absolute path fails on Windows with ERR_UNSUPPORTED_ESM_URL_SCHEME —
    // `D:\\...` is read as the protocol `d:`. The ESM loader wants a file:// URL, which is exactly the
    // normalisation the patcher's own entry-point check needed.
} = await import(pathToFileURL(PATCHER).href);

/** The fixed, predictable temporary name the pre-repair patcher used. Nothing may touch it now. */
const RETIRED_TMP_NAME = 'jellyfin-apiclient.js.s4d1.tmp';

/** Every file left in the package's `dist/` — used to prove no temporary artifact survives. */
function distEntries(root) {
    return readdirSync(
        join(root, 'node_modules', 'jellyfin-apiclient', 'dist')
    ).sort();
}

const CANARY = 'S4D1-CONTROL-VALUE-NOT-A-REAL-TOKEN';

let failures = 0;
const staged = [];
process.on('exit', () => {
    for (const dir of staged) rmSync(dir, { recursive: true, force: true });
});

/**
 * The pristine bundle. Preferred source is the real install; if it is already patched (the normal
 * state after `npm ci`), the controls that need pristine bytes are skipped loudly rather than run
 * against a fake, because a fabricated "pristine" would not prove anything about the real package.
 */
function pristineSource() {
    const target = join(INSTALLED, 'dist', 'jellyfin-apiclient.js');
    if (!existsSync(target)) return null;
    const text = readFileSync(target, 'utf8');
    return sha256(text) === PRISTINE_SHA256 ? text : null;
}

/** Rebuild pristine content from the patched install by reversing the fragment table. */
function reconstructPristine() {
    const target = join(INSTALLED, 'dist', 'jellyfin-apiclient.js');
    if (!existsSync(target)) return null;
    let text = readFileSync(target, 'utf8');
    if (sha256(text) !== PATCHED_SHA256) return null;
    text = text.replace(
        /\n$/,
        '\n//# sourceMappingURL=jellyfin-apiclient.js.map'
    );
    for (const fragment of [...UNSAFE_FRAGMENTS].reverse())
        text = text.split(fragment.safe).join(fragment.unsafe);
    return sha256(text) === PRISTINE_SHA256 ? text : null;
}

const PRISTINE = pristineSource() ?? reconstructPristine();
if (PRISTINE === null) {
    console.error(
        'FAIL  the controls need the real jellyfin-apiclient bundle; run `npm ci` first'
    );
    process.exit(1);
}

function stage({
    version = REQUIRED_VERSION,
    content = PRISTINE,
    map = true
} = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'jf-apiclient-patch-'));
    staged.push(dir);
    const pkg = join(dir, 'node_modules', 'jellyfin-apiclient');
    mkdirSync(join(pkg, 'dist'), { recursive: true });
    writeFileSync(
        join(pkg, 'package.json'),
        JSON.stringify({ name: 'jellyfin-apiclient', version }, null, 2)
    );
    writeFileSync(join(pkg, 'dist', 'jellyfin-apiclient.js'), content);
    if (map)
        writeFileSync(
            join(pkg, 'dist', 'jellyfin-apiclient.js.map'),
            JSON.stringify({
                version: 3,
                sourcesContent: [PRISTINE.slice(0, 200)]
            })
        );
    return dir;
}

function runPatcher(root, extra = []) {
    return spawnSync(process.execPath, [PATCHER, '--root', root, ...extra], {
        encoding: 'utf8'
    });
}

function check(label, assertions) {
    const problems = assertions.filter(Boolean);
    if (problems.length) {
        failures++;
        console.error(
            `FAIL  ${label}\n${problems.map((p) => `      - ${p}`).join('\n')}`
        );
    } else {
        console.log(`ok    ${label}`);
    }
}

const patchedPath = (root) =>
    join(
        root,
        'node_modules',
        'jellyfin-apiclient',
        'dist',
        'jellyfin-apiclient.js'
    );

// ── 1. the happy path, against the real published bytes ──────────────────────────────────────
{
    const root = stage();
    const result = runPatcher(root);
    const after = readFileSync(patchedPath(root), 'utf8');
    check('a pristine install is patched and matches the pinned patched hash', [
        result.status !== 0 && `expected exit 0, got ${result.status}`,
        sha256(after) !== PATCHED_SHA256 &&
            'the result does not match PATCHED_SHA256',
        UNSAFE_FRAGMENTS.some((f) => after.includes(f.unsafe)) &&
            'an unsafe fragment survived',
        existsSync(
            join(
                root,
                'node_modules',
                'jellyfin-apiclient',
                'dist',
                'jellyfin-apiclient.js.map'
            )
        ) &&
            'the source map, which embeds the pre-patch sources, was left behind'
    ]);
}

// ── 2. idempotency, and the third-state rule ─────────────────────────────────────────────────
{
    const root = stage();
    runPatcher(root);
    const first = readFileSync(patchedPath(root), 'utf8');
    const second = runPatcher(root);
    const after = readFileSync(patchedPath(root), 'utf8');
    check('a second run is idempotent and leaves the file byte-identical', [
        second.status !== 0 && `expected exit 0, got ${second.status}`,
        after !== first && 'the second run changed the file'
    ]);
    const verify = runPatcher(root, ['--verify']);
    check('--verify accepts an exactly-patched install', [
        verify.status !== 0 && `expected exit 0, got ${verify.status}`
    ]);
}

// ── 3-8. every refusal ───────────────────────────────────────────────────────────────────────
//
// The fragment-shaped refusals run over TWO anchors, not one: the #153-A1 transport fragment and a
// #152 console fragment. Exercising only index 0 would have proven the refusal for whichever
// fragment happened to be first in the table, which is not the same statement.
const TRANSPORT_INDEX = UNSAFE_FRAGMENTS.findIndex(
    (f) => f.category === 'transport'
);
const CONSOLE_INDEX = UNSAFE_FRAGMENTS.findIndex(
    (f) => f.category !== 'transport'
);

const fragmentRefusals = [TRANSPORT_INDEX, CONSOLE_INDEX].flatMap((index) => {
    const fragment = UNSAFE_FRAGMENTS[index];
    const label = `${fragment.category} anchor #${index}`;
    return [
        [
            `a missing unsafe fragment is refused (${label})`,
            () => stage({ content: PRISTINE.split(fragment.unsafe).join('') }),
            /neither the pinned pristine nor the pinned patched hash/
        ],
        [
            `a duplicated unsafe fragment is refused (${label})`,
            () =>
                stage({
                    content: PRISTINE.replace(
                        fragment.unsafe,
                        `${fragment.unsafe}${fragment.unsafe}`
                    )
                }),
            /neither the pinned pristine nor the pinned patched hash/
        ],
        [
            `partially patched content is refused (${label})`,
            () =>
                stage({
                    content: PRISTINE.split(fragment.unsafe).join(fragment.safe)
                }),
            /neither the pinned pristine nor the pinned patched hash/
        ]
    ];
});

const refusals = [
    [
        'an unknown package version is refused',
        () => stage({ version: '1.12.0' }),
        /pinned to 1\.11\.0/
    ],
    [
        'an unexpected pristine hash is refused',
        () => stage({ content: `${PRISTINE}\n/* local edit */\n` }),
        /neither the pinned pristine nor the pinned patched hash/
    ],
    ...fragmentRefusals
];
for (const [label, make, expected] of refusals) {
    const root = make();
    const before = readFileSync(patchedPath(root), 'utf8');
    const result = runPatcher(root);
    const after = readFileSync(patchedPath(root), 'utf8');
    check(label, [
        result.status !== 1 && `expected exit 1, got ${result.status}`,
        !expected.test(result.stderr) &&
            `the message did not explain the refusal (${expected})`,
        after !== before && 'the patcher wrote to a file it had refused'
    ]);
}

// ── symlink / path escape ────────────────────────────────────────────────────────────────────
{
    const real = stage();
    const root = mkdtempSync(join(tmpdir(), 'jf-apiclient-escape-'));
    staged.push(root);
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(
        join(real, 'node_modules', 'jellyfin-apiclient'),
        join(root, 'node_modules', 'jellyfin-apiclient'),
        'dir'
    );
    const before = readFileSync(patchedPath(real), 'utf8');
    const result = runPatcher(root);
    check('a symlinked package directory is refused, and nothing is written', [
        result.status !== 1 && `expected exit 1, got ${result.status}`,
        !/symlink/.test(result.stderr) &&
            'the message did not name the symlink',
        readFileSync(patchedPath(real), 'utf8') !== before &&
            'the patcher followed the symlink and wrote through it'
    ]);
}

// ── a symlinked TARGET FILE, which is a different path from a symlinked directory ────────────
{
    const real = stage();
    const decoy = stage();
    const target = patchedPath(real);
    rmSync(target, { force: true });
    symlinkSync(patchedPath(decoy), target, 'file');
    const before = readFileSync(patchedPath(decoy), 'utf8');
    const result = runPatcher(real);
    check(
        'a symlinked target FILE is refused by the open itself, not by a prior check',
        [
            result.status !== 1 && `expected exit 1, got ${result.status}`,
            !/symlink/.test(result.stderr) &&
                'the message did not name the symlink',
            readFileSync(patchedPath(decoy), 'utf8') !== before &&
                'the patcher wrote through the symlink to its target'
        ]
    );
}

// ── 9-10. what the patched output must and must not contain ──────────────────────────────────
{
    const root = stage();
    runPatcher(root);
    const after = readFileSync(patchedPath(root), 'utf8');
    check('the patched output contains none of the closed unsafe inventory', [
        ...UNSAFE_FRAGMENTS.map(
            (f, i) =>
                after.includes(f.unsafe) && `unsafe fragment #${i} survived`
        )
    ]);
    check('the patched output preserves the module and its exports', [
        !after.includes('ApiClient:') && 'the ApiClient export is gone',
        !after.includes('ConnectionManager:') &&
            'the ConnectionManager export is gone',
        !after.includes('Credentials:') && 'the Credentials export is gone',
        !after.includes('Events:') && 'the Events export is gone',
        !after.includes('WebSocket') && 'the WebSocket code path is gone'
    ]);

    // #153-A1 changed BEHAVIOUR, not only logging, and this is where that is pinned. Before A1
    // this same block asserted the opposite - that `api_key=` survived - because #152 was a
    // logging-only patch. The inversion is the point.
    const transportFragments = UNSAFE_FRAGMENTS.filter(
        (f) => f.category === 'transport'
    );
    check('#153-A1: the socket url is no longer built with the durable token', [
        transportFragments.length !== 1 &&
            `expected exactly one transport fragment, found ${transportFragments.length}`,
        after.includes('"?api_key="') &&
            'openWebSocket still concatenates ?api_key= into the socket url',
        !after.includes(
            'openWebSocket disabled: #153-A1'
        ) && 'the refusal that replaced the credential construction is absent',
        // The ONE surviving `api_key` is the general-API download url builder, a route where
        // AuthorizationContext reads the key by design and a playback capability must never work.
        (after.match(/api_key/g) || []).length !== 1 &&
            `expected exactly one surviving api_key (the general-api download builder), found ${(after.match(/api_key/g) || []).length}`,
        !after.includes('"Items/".concat(e,"/Download")') &&
            'the surviving api_key is not the general-api download builder this exemption names'
    ]);
    // The sanitized replacements must be real constants, not the same url under a new prefix.
    check('the replacements interpolate no url', [
        ...UNSAFE_FRAGMENTS.map(
            (f, i) =>
                /\.concat\((e\.url|r|t)\)/.test(f.safe) &&
                `replacement #${i} still interpolates a url-valued variable`
        )
    ]);
}

// ── the portable path: O_NOFOLLOW unavailable, as on Windows ─────────────────────────────────
//
// `--root` plus `noFollow: null` drives the REAL lifecycle down the branch a Windows host takes.
// This is an explicit parameter, not a mocked `process.platform`, so what runs here is what runs
// there.
{
    const root = stage();
    const result = runPatcher(root, ['--no-o-nofollow']);
    const after = readFileSync(patchedPath(root), 'utf8');
    check(
        'with O_NOFOLLOW unavailable, a regular target still patches to the pinned digest',
        [
            result.status !== 0 && `expected exit 0, got ${result.status}`,
            sha256(after) !== PATCHED_SHA256 &&
                'the portable path produced different bytes from the O_NOFOLLOW path',
            UNSAFE_FRAGMENTS.some((f) => after.includes(f.unsafe)) &&
                'an unsafe fragment survived the portable path'
        ]
    );
}

{
    // The symlink refusal must survive the loss of O_NOFOLLOW. Without the unconditional `lstat`
    // check this is exactly where the guarantee used to evaporate.
    const real = stage();
    const decoy = stage();
    const sentinel = patchedPath(decoy);
    const before = readFileSync(sentinel, 'utf8');
    const target = patchedPath(real);
    rmSync(target, { force: true });
    symlinkSync(sentinel, target, 'file');
    const result = runPatcher(real, ['--no-o-nofollow']);
    check('with O_NOFOLLOW unavailable, a symlinked target is still refused', [
        result.status !== 1 && `expected exit 1, got ${result.status}`,
        !/symlink/.test(result.stderr) &&
            'the message did not name the symlink',
        readFileSync(sentinel, 'utf8') !== before &&
            'the sentinel outside the package was modified through the link'
    ]);
}

// ── the temporary file: exclusive creation, and cleanup that owns only what it made ──────────
{
    // The pre-repair patcher wrote a FIXED name with plain `writeFileSync`, which follows a symlink
    // already sitting there. Planting that exact name as a link to an external sentinel proves the
    // old behaviour is gone: the sentinel must be untouched, and so must the planted link.
    const root = stage();
    const outside = mkdtempSync(join(tmpdir(), 'jf-apiclient-sentinel-'));
    staged.push(outside);
    const sentinel = join(outside, 'sentinel.txt');
    writeFileSync(sentinel, 'SENTINEL MUST NOT CHANGE\n');
    const planted = join(
        root,
        'node_modules',
        'jellyfin-apiclient',
        'dist',
        RETIRED_TMP_NAME
    );
    symlinkSync(sentinel, planted, 'file');

    const result = runPatcher(root);
    const after = readFileSync(patchedPath(root), 'utf8');
    check(
        'a symlink planted at the retired temporary name is never followed, read or removed',
        [
            result.status !== 0 &&
                `the patch itself must still succeed, got exit ${result.status}`,
            sha256(after) !== PATCHED_SHA256 &&
                'the patch did not produce the pinned digest',
            readFileSync(sentinel, 'utf8') !== 'SENTINEL MUST NOT CHANGE\n' &&
                'the sentinel outside the package was written through the planted link',
            !existsSync(planted) &&
                'the planted path was consumed — cleanup must own only what it created',
            existsSync(planted) &&
                !lstatSync(planted).isSymbolicLink() &&
                'the planted symlink was replaced by a regular file'
        ]
    );
}

{
    // Same invariant for an ordinary file: a name that merely resembles a temporary of ours is not
    // ours, and must be neither overwritten nor deleted.
    const root = stage();
    const occupied = join(
        root,
        'node_modules',
        'jellyfin-apiclient',
        'dist',
        RETIRED_TMP_NAME
    );
    writeFileSync(occupied, 'NOT OURS\n');
    const result = runPatcher(root);
    check(
        'an ordinary file at the retired temporary name is neither overwritten nor deleted',
        [
            result.status !== 0 &&
                `the patch itself must still succeed, got exit ${result.status}`,
            !existsSync(occupied) && 'the pre-existing file was deleted',
            readFileSync(occupied, 'utf8') !== 'NOT OURS\n' &&
                'the pre-existing file was overwritten'
        ]
    );
}

{
    // No temporary artifact may survive a successful run, and a second run must add none.
    const root = stage();
    runPatcher(root);
    const afterFirst = distEntries(root);
    runPatcher(root);
    const afterSecond = distEntries(root);
    check('no temporary artifact survives, and a second run adds none', [
        afterFirst.some((e) => e.includes('.tmp')) &&
            `a temporary artifact survived: ${afterFirst.filter((e) => e.includes('.tmp')).length} entr(ies)`,
        afterSecond.join('|') !== afterFirst.join('|') &&
            'the second run changed the set of files in dist/',
        afterFirst.includes('jellyfin-apiclient.js.map') &&
            'the source map is still present'
    ]);
}

{
    // The identity protocol itself: a descriptor is returned, it is a regular file, and on this
    // host the strong (inode) branch is the one that engaged.
    const root = stage();
    const opened = openVerified(patchedPath(root), { noFollow: null });
    const isNumber = typeof opened.fd === 'number';
    closeSync(opened.fd);
    check(
        'openVerified returns a verified descriptor and reports its identity basis',
        [
            !isNumber && 'no descriptor was returned',
            typeof opened.identified !== 'boolean' &&
                'the identity basis was not reported'
        ]
    );
    console.log(
        `      note: identity basis on ${process.platform} = ${opened.identified ? 'inode+device' : 'corroboration only'}`
    );
}

// ── the CLI entry point must actually execute, on every platform ─────────────────────────────
//
// `import.meta.url === `file://${process.argv[1]}`` is POSIX-only: on Windows argv[1] carries a
// drive letter and backslashes while import.meta.url is a normalised file URL, so they never match
// and `main()` silently never runs. The script then exits 0 having patched nothing — which is how a
// credential sink ships while every check is green. Any invocation must SAY something.
{
    const root = mkdtempSync(join(tmpdir(), 'jf-apiclient-entry-'));
    staged.push(root);
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    const result = runPatcher(root);
    check(
        'the CLI entry point runs and reports, rather than exiting silently',
        [
            `${result.stdout}${result.stderr}`.trim() === '' &&
                'the patcher produced no output at all — `main()` did not run',
            result.status !== 0 && `expected exit 0, got ${result.status}`
        ]
    );
}

// ── 11. the patcher's own output can never carry a credential ────────────────────────────────
{
    const root = stage({
        content: PRISTINE.replace(
            'console.log("opening web socket with url: ".concat(t))',
            `console.log("opening web socket with url: ".concat("wss://h/s?api_key=${CANARY}"))`
        )
    });
    const result = runPatcher(root);
    const output = `${result.stdout}${result.stderr}`;
    check('no patcher output can echo package content', [
        result.status !== 1 &&
            `a modified bundle must be refused, got exit ${result.status}`,
        output.includes(CANARY) &&
            'the patcher echoed content from the package',
        output.includes('console.log(') &&
            'the patcher printed a source statement'
    ]);
}

// ── the absent-package split: benign for `postinstall`, fatal for `--verify` ──────────────────
{
    const root = mkdtempSync(join(tmpdir(), 'jf-apiclient-absent-'));
    staged.push(root);
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    const patch = runPatcher(root);
    const verify = runPatcher(root, ['--verify']);
    check(
        'an absent package is benign to patch but never a passing verification',
        [
            patch.status !== 0 &&
                `postinstall must not break an install, got ${patch.status}`,
            verify.status !== 1 &&
                `--verify must refuse a vacuous pass, got ${verify.status}`
        ]
    );
}

// ── the real install, as `npm ci` left it ────────────────────────────────────────────────────
{
    const result = spawnSync(process.execPath, [PATCHER, '--verify'], {
        cwd: REPO,
        encoding: 'utf8'
    });
    check('the real installed package verifies as patched', [
        result.status !== 0 &&
            `expected exit 0, got ${result.status} — did \`npm ci\` run its postinstall?`
    ]);
}

if (failures) {
    console.error(`\n${failures} control(s) failed.`);
    process.exit(1);
}
console.log('\njellyfin-apiclient patch controls: all pass.');

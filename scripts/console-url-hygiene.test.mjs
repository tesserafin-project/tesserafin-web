#!/usr/bin/env node
/**
 * Deterministic controls for the console-url hygiene gate
 * (scripts/verify-console-url-hygiene.mjs, scripts/console-url-hygiene.allowlist.json).
 *
 * A gate is only worth having if it is known to FAIL. Each case below builds a throwaway tree
 * containing exactly one source file, runs the real verifier against it with `--root`, and asserts
 * its exit status. This suite passing means the verifier refused the code it should refuse; it
 * never means the verifier was not consulted.
 *
 * The cases are the ways the disclosure could come back or the gate could be fooled:
 *   - the exact line #75 was opened about, `console.debug(`playing url: ${val}`)`, reintroduced;
 *   - the same value smuggled through a property, an element access, a `+` concatenation, or a
 *     later argument rather than the first;
 *   - a literal that is already a url, whatever the variable is called;
 *   - a message that merely says the word "url" — which must NOT fail, or the gate is a grep and
 *     will be disabled by the first person it annoys;
 *   - the endpoint-category replacement the fix uses — which must NOT fail, or there is no way to
 *     comply;
 *   - an allowlist entry that no longer matches, which must fail so the file cannot rot;
 *   - a dependency sink, which since #152 is FATAL exactly like a first-party one. Its two
 *     properties are still proven separately: that it fails the build, and that the diagnostic
 *     still names it as a dependency and points at the patcher — because that classification is
 *     what tells a maintainer which file to repair, and only stdout can show it.
 *
 * The last case runs against the REAL repository, so the committed allowlist is checked too.
 *
 * Usage:
 *   node scripts/console-url-hygiene.test.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const VERIFIER = join(HERE, 'verify-console-url-hygiene.mjs');

let failures = 0;
const staged = [];

process.on('exit', () => {
    for (const dir of staged) rmSync(dir, { recursive: true, force: true });
});

/**
 * A minimal tree the verifier can scan. It needs a git index, because the verifier enumerates
 * `git ls-files src` rather than walking the filesystem — that is how generated and ignored trees
 * stay out of the real scan, so the test has to honour it.
 */
function stage(files, allowlist) {
    const dir = mkdtempSync(join(tmpdir(), 'console-url-hygiene-'));
    staged.push(dir);
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    for (const [path, content] of Object.entries(files)) {
        const target = join(dir, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }
    if (allowlist) {
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        writeFileSync(
            join(dir, 'scripts/console-url-hygiene.allowlist.json'),
            JSON.stringify(allowlist, null, 4)
        );
    }
    execFileSync('git', ['add', '-A'], { cwd: dir });
    return dir;
}

function run(root) {
    return spawnSync(process.execPath, [VERIFIER, '--root', root], {
        encoding: 'utf8'
    });
}

function check(label, expectation, files, allowlist) {
    const result = run(stage(files, allowlist));
    const refused = result.status !== 0;
    const output = `${result.stdout}${result.stderr}`.trim();
    if (refused !== (expectation === 'refuse')) {
        failures++;
        console.error(
            `FAIL  ${label}\n      expected the gate to ${expectation}, exit status was ${result.status}\n${output.replace(/^/gm, '      ')}`
        );
        return;
    }
    console.log(`ok    ${label}`);
}

const refuse = (label, files, allowlist) =>
    check(label, 'refuse', files, allowlist);
const accept = (label, files, allowlist) =>
    check(label, 'accept', files, allowlist);

// ── The disclosure itself, and the shapes it could come back in ──────────────────────────────
refuse('the #75 line, reintroduced verbatim', {
    'src/plugins/htmlVideoPlayer/plugin.js':
        'export function setCurrentSrc(elem, options) {\n' +
        '    const val = options.url;\n' +
        '    console.debug(`playing url: ${val}`);\n' +
        '}\n'
});

refuse('the audio player form, string concatenation', {
    'src/plugins/htmlAudioPlayer/plugin.js':
        "const val = options.url;\nconsole.debug('playing url: ' + val);\n"
});

refuse('a property access, not a bare identifier', {
    'src/components/playback/playbackmanager.js':
        'console.error(`no player for ${item.Url}`);\n'
});

refuse('an element access', {
    'src/utils/probe.js': 'console.log(`trying ${urls[i]}`);\n'
});

refuse('a later argument, not the first', {
    'src/utils/probe.js': "console.warn('[probe] failed', requestUrl, err);\n"
});

refuse('a url-valued name behind an alias', {
    'src/utils/probe.js': 'console.debug({ streamUrl });\n'
});

refuse('a literal that is already a url', {
    'src/utils/probe.js':
        "console.debug('fetching http://127.0.0.1:8096/Videos/1/stream.mp4');\n"
});

refuse('a literal that is already a query string', {
    'src/utils/probe.js': "console.debug('?ApiKey=abc123&Static=true');\n"
});

refuse('a TSX source, so the parser is not JS-only', {
    'src/elements/Widget.tsx':
        'export const Widget = () => {\n' +
        '    console.error("[Widget] failed", href);\n' +
        '    return null;\n' +
        '};\n'
});

// ── What must stay legal, or the gate is unusable ────────────────────────────────────────────
accept('a message that merely mentions the word', {
    'src/apps/login.js':
        "console.warn('[LoginPage] unable to decode url param', err);\n"
});

accept('the endpoint-category replacement the fix uses', {
    'src/utils/fetch.js':
        'const endpoint = endpointCategory(request.url);\n' +
        'console.debug(`requesting ${method} endpoint: ${endpoint}`);\n'
});

accept('a status without a url', {
    'src/utils/fetch.js':
        'console.debug(`response status: ${response.status}`);\n'
});

accept('a non-console call that happens to take a url', {
    'src/utils/fetch.js': 'logger.debug(`playing url: ${val}`);\n'
});

// ── The allowlist is an exception mechanism, not a bypass ────────────────────────────────────
accept(
    'a violation with a justified exception',
    { 'src/utils/probe.js': "console.log('Reconnect failed to ' + url);\n" },
    {
        exceptions: [
            {
                file: 'src/utils/probe.js',
                expression: "'Reconnect failed to ' + url",
                class: 'server-address',
                reason: 'a server origin, no path and no query string'
            }
        ]
    }
);

refuse(
    'an exception for a different file does not apply',
    { 'src/utils/probe.js': "console.log('Reconnect failed to ' + url);\n" },
    {
        exceptions: [
            {
                file: 'src/utils/other.js',
                expression: "'Reconnect failed to ' + url",
                class: 'server-address',
                reason: 'a server origin, no path and no query string'
            }
        ]
    }
);

refuse(
    'a stale exception fails, so the file cannot rot',
    { 'src/utils/probe.js': "console.log('nothing to see here');\n" },
    {
        exceptions: [
            {
                file: 'src/utils/probe.js',
                expression: "'Reconnect failed to ' + url",
                class: 'server-address',
                reason: 'the code this covered is gone'
            }
        ]
    }
);

// ── The bundle mode: what we would actually ship ─────────────────────────────────────────────
//
// Minification renames variables but keeps string literals, so the retired sinks are searched for
// by their message prefix. These cases use a hand-written "dist" that stands in for a built one:
// the point is the verdict, and a real webpack build is the job of `npm run build:production`
// followed by `npm run verify:console-url-hygiene:bundle`.

function stageDist(files) {
    const dir = mkdtempSync(join(tmpdir(), 'console-url-hygiene-dist-'));
    staged.push(dir);
    for (const [path, content] of Object.entries(files)) {
        const target = join(dir, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }
    return dir;
}

function checkDist(label, expectation, files) {
    const dist = stageDist(files);
    const result = spawnSync(process.execPath, [VERIFIER, '--dist', dist], {
        encoding: 'utf8'
    });
    const expected = expectation === 'refuse' ? 1 : 0;
    if (result.status !== expected) {
        failures++;
        console.error(
            `FAIL  ${label}\n      expected exit ${expected}, got ${result.status}\n${`${result.stdout}${result.stderr}`.trim().replace(/^/gm, '      ')}`
        );
        return;
    }
    console.log(`ok    ${label}`);
}

checkDist('a minified bundle carrying the retired playback sink', 'refuse', {
    'main.abc123.bundle.js':
        'var e=t.url;console.debug("playing url: "+e),n(e);\n'
});

checkDist('a minified bundle carrying the retired fetch sink', 'refuse', {
    'runtime.def456.bundle.js': 'console.debug("requesting url: "+r.url);\n'
});

checkDist(
    'a minified bundle carrying the retired hls prefetch sink',
    'refuse',
    {
        'nested/chunk.789.bundle.js':
            'console.debug("prefetching hls playlist: "+u);\n'
    }
);

checkDist('a clean bundle, including the messages that were kept', 'accept', {
    'main.abc123.bundle.js':
        'console.debug("prefetching hls playlist"),' +
        'console.debug("requesting "+m+" endpoint: "+e),' +
        'console.debug("response status: "+s.status+", "+m+" endpoint: "+e);\n'
});

checkDist(
    'a DEPENDENCY bundle carrying the sink is FATAL too (#152)',
    'refuse',
    {
        // webpack's own name for a vendor chunk. `jellyfin-apiclient@1.11.0` really did this, on
        // sign-in and not on playback. It used to be reported and tolerated, because nothing under
        // `src/` could remove it; scripts/patch-jellyfin-apiclient.mjs removes it at install time,
        // so zero is reachable and anything else fails the build.
        'node_modules.jellyfin-apiclient.bundle.js':
            'console.log("opening web socket with url: ".concat(t));\n'
    }
);

for (const signature of [
    'requesting url: ',
    'connecting to url',
    'request failed to url',
    ', url: ',
    'playing url',
    'prefetching hls playlist: ',
    'requested media: http'
]) {
    checkDist(
        `a DEPENDENCY bundle carrying "${signature}" is fatal`,
        'refuse',
        {
            'node_modules.jellyfin-apiclient.bundle.js': `console.log("x${signature}y");\n`
        }
    );
}

checkDist('the same sink in one of OUR assets is still fatal', 'refuse', {
    'main.tesserafin.bundle.js':
        'console.log("opening web socket with url: ".concat(t));\n'
});

{
    // CLASSIFICATION is a different property from SEVERITY, and it still needs its own proof.
    //
    // Severity is now uniform — every hit is fatal — so an exit status can no longer tell a
    // dependency hit from a first-party one. What must survive is the DIAGNOSTIC: a maintainer who
    // sees a dependency hit has to repair the patcher, and one who sees a first-party hit has to
    // edit `src/`. If the wording stops distinguishing them, the gate still fails correctly but
    // sends every reader to the wrong file, so this control reads stdout/stderr rather than a code.
    //
    // The fixture carries a synthetic, non-functional stand-in for a credential in its url, and the
    // control asserts it appears NOWHERE in the verifier's output: the gate must name the asset and
    // the signature it matched, never the matching text.
    const CANARY = 'S4-CONTROL-VALUE-NOT-A-REAL-TOKEN';
    const label =
        'a DEPENDENCY hit is fatal AND still named as a dependency, without echoing the payload';
    const dist = stageDist({
        'node_modules.jellyfin-apiclient.bundle.js': `console.log("opening web socket with url: ".concat("wss://h/socket?api_key=${CANARY}"));\n`
    });
    const result = spawnSync(process.execPath, [VERIFIER, '--dist', dist], {
        encoding: 'utf8'
    });
    const output = `${result.stdout}${result.stderr}`;
    const problems = [];
    if (result.status !== 1)
        problems.push(
            `a dependency sink must now FAIL the build, but the exit status was ${result.status}`
        );
    if (
        !/node_modules\.jellyfin-apiclient\.bundle\.js: the shipped bundle carries a retired url sink — "opening web socket with url" \[DEPENDENCY\]/.test(
            output
        )
    )
        problems.push(
            'the diagnostic did not name the asset, the signature, and the DEPENDENCY classification'
        );
    if (!/1 first-party, 1 dependency|0 first-party, 1 dependency/.test(output))
        problems.push('the summary did not account for the hit by origin');
    if (!output.includes('scripts/patch-jellyfin-apiclient.mjs'))
        problems.push(
            'the diagnostic did not point a dependency hit at the patcher, which is its repair'
        );
    if (output.includes(CANARY))
        problems.push(
            'the verifier echoed the fixture credential back into its own output'
        );
    if (problems.length) {
        failures++;
        console.error(
            `FAIL  ${label}\n${problems.map((p) => `      - ${p}`).join('\n')}`
        );
    } else {
        console.log(`ok    ${label}`);
    }
}

{
    // An empty dist must not read as a pass: a gate that reports ok on nothing is worse than none.
    const empty = stageDist({ 'index.html': '<!doctype html>\n' });
    const result = spawnSync(process.execPath, [VERIFIER, '--dist', empty], {
        encoding: 'utf8'
    });
    if (result.status !== 2) {
        failures++;
        console.error(
            `FAIL  an empty dist is refused rather than passed\n      expected exit 2, got ${result.status}`
        );
    } else {
        console.log('ok    an empty dist is refused rather than passed');
    }
}

// ── And the real repository, allowlist included ──────────────────────────────────────────────
{
    const result = run(REPO);
    if (result.status !== 0) {
        failures++;
        console.error(
            `FAIL  the committed tree passes its own gate\n${`${result.stdout}${result.stderr}`.trim().replace(/^/gm, '      ')}`
        );
    } else {
        console.log('ok    the committed tree passes its own gate');
    }
}

if (failures) {
    console.error(`\n${failures} control(s) failed.`);
    process.exit(1);
}
console.log('\nconsole-url hygiene controls: all pass.');

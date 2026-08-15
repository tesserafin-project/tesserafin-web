#!/usr/bin/env node
/*
 * The console-url hygiene gate (tesserafin-web #75 / S4).
 *
 * WHAT THIS FORBIDS, AND WHY IT IS A SECURITY GATE AND NOT A STYLE GATE
 *
 *   `playbackmanager` builds playback urls with `ApiKey: apiClient.accessToken()`, and the server
 *   returns transcoding urls with the same parameter. The token so placed is not media-scoped: the
 *   server accepts `ApiKey` from the query string on every endpoint. So a url printed to the
 *   console is a full-privilege session credential printed to the console — which is what both
 *   HTML players did on every play, and what `utils/fetch` did on every request.
 *
 *   Deleting those specific lines does not keep them deleted. This gate is the part that does: it
 *   fails the build when a DIRECT `console.<method>(…)` call is handed a url-valued expression, so
 *   the next `console.debug(\`playing url: ${val}\`)` cannot land unnoticed.
 *
 * WHAT THIS GATE DOES AND DOES NOT PROVE
 *
 *   The enforced invariant is SYNTACTIC, and is deliberately stated as such. It covers a call whose
 *   callee is the property access `console.<method>`, and within that call's arguments it covers
 *   identifiers, property accesses, element accesses, template literals, `+` concatenations and any
 *   nesting of those — the exact rules are WHAT COUNTS AS A VIOLATION, below.
 *
 *   It is NOT an interprocedural data-flow analysis, and nothing in this repository should be read
 *   as claiming that it is. Three shapes are known to pass it. Each was measured, not assumed:
 *
 *     - a computed console access — `console['debug'](…)`, whose callee is an element access;
 *     - an aliased console — `const c = console; c.debug(…)`;
 *     - a url read into a differently-named local on an earlier line and then interpolated into a
 *       message whose prose does not announce a url: `const q = options.url;` followed by
 *       `console.debug(\`starting playback at ${q}\`)`.
 *
 *   That is the accepted boundary of a syntactic gate, not a defect papered over. The backstop for
 *   all three is the runtime disclosure suite, `tests/playbackCredential/**`, which drives the real
 *   modules and asserts on the console output they actually emit: every one of the three shapes
 *   above turns it red. Source gate and runtime suite are complementary, and neither on its own is
 *   the containment guarantee.
 *
 * WHAT COUNTS AS A VIOLATION
 *
 *   An argument to a direct `console.<method>(…)` call that either
 *
 *     (a) reads a url-valued name — `url`, `urls`, `uri`, `href`, `src`, `link`, in any casing,
 *         as an identifier, a property (`item.Url`), or an element access (`urls[i]`) — anywhere
 *         inside the expression, including through a template literal or a `+` concatenation; or
 *     (b) is a literal that already contains a url or a query string (`://`, or `?…=`).
 *
 *   A message that merely mentions the word — `console.warn('[LoginPage] unable to decode url
 *   param')` — is not a violation: nothing url-valued is read. That distinction is the whole
 *   difference between this gate and a `grep`, and it is why this walks a real AST.
 *
 * EXCEPTIONS
 *
 *   `scripts/console-url-hygiene.allowlist.json` holds them, keyed by file and by the normalized
 *   text of the offending argument, each with a written reason. An allowlist entry that no longer
 *   matches anything is itself a failure, so the file cannot rot into a blanket permission.
 *
 * USAGE
 *
 *   node scripts/verify-console-url-hygiene.mjs            # gate: exit 1 on an unlisted violation
 *   node scripts/verify-console-url-hygiene.mjs --json      # machine-readable findings
 *   node scripts/verify-console-url-hygiene.mjs --root DIR  # scan a different tree (test seam)
 *   node scripts/verify-console-url-hygiene.mjs --dist dist # check the BUILT bundle, see below
 *
 * THE BUNDLE MODE
 *
 *   `--dist` answers a different question from the AST scan: not "is the source clean" but "is the
 *   thing we ship clean". It searches every built script for the message prefixes of the sinks this
 *   work retired. Minification renames variables but preserves string literals, so
 *   `` `playing url: ${val}` `` still contains `playing url: ` in the shipped bundle — which makes
 *   this the production-bundle guard that needs no server, no media and no session.
 *
 *   EVERY HIT IS FATAL, WHOEVER WROTE IT (#152). This gate used to fail only on first-party assets
 *   and merely REPORT dependency ones, because `jellyfin-apiclient@1.11.0` shipped the same sinks —
 *   plus one this repository never had, `openWebSocket`'s
 *   `console.log("opening web socket with url: " + url)`, built with `api_key=<accessToken()>` — and
 *   nothing under `src/` could remove a dependency's bundled `console.log`. A gate that cannot be
 *   satisfied gets deleted, so it reported instead of failing.
 *
 *   `scripts/patch-jellyfin-apiclient.mjs` removed that constraint: the package's credential-capable
 *   statements are now rewritten at install time, so zero is reachable. The scan therefore requires
 *   ZERO across the whole shipped bundle. The first-party/dependency classification survives only in
 *   the diagnostic wording, because it changes the REPAIR — edit `src/`, or re-pin the patcher — and
 *   never whether the build may ship. There is no dependency exception left to widen.
 *
 *   One signature, `, url: `, is a deliberate BROAD tripwire rather than an anchored prefix: the
 *   two sinks it covers put the url after an interpolation (`…timeoutMs: ${ms}, url: ${url}`), so
 *   minification leaves no single anchored literal to match. It may fire on unrelated code. That
 *   is the intended trade — a false positive here costs a conversation, a false negative ships a
 *   credential.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';

const CONSOLE_METHODS = new Set([
    'debug',
    'log',
    'info',
    'warn',
    'error',
    'trace',
    'dir',
    'table',
    'group',
    'groupCollapsed'
]);

/**
 * Names whose VALUE is a url: the bare words, and anything ending in one of them, so
 * `hlsPlaylistUrl`, `requestUrl` and `streamUri` are caught without an enumeration to maintain.
 */
const URL_NAMES = /(^|[a-z0-9_])(url|uri|href|src|link)s?$/i;

/** A literal that already carries a url or a query string, whatever it is called. */
const LITERAL_URL = /:\/\/|\?[A-Za-z0-9_%.-]+=/;

/**
 * A message that ANNOUNCES a url right before interpolating one.
 *
 * This is the rule that catches the line #75 was opened about — `console.debug(`playing url:
 * ${val}`)` — where the value is called `val` and only the prose says what it is. Without it the
 * gate would be defeated by renaming a variable, which is not a security property.
 */
const URL_LABEL = /(^|[^a-z])(url|uri|href|src|link)s?\s*[:=]?\s*$/i;

const ALLOWLIST_PATH = 'scripts/console-url-hygiene.allowlist.json';

/**
 * The message prefixes of the sinks retired by #75 / S4, as they survive minification.
 *
 * Each one is the static part of a template literal or concatenation whose hole held a url. Their
 * presence in a built bundle means the disclosure shipped, whatever the source looks like now.
 */
const RETIRED_SINKS = [
    {
        signature: 'playing url',
        origin: 'htmlVideoPlayer / htmlAudioPlayer setCurrentSrc — the playback url, `ApiKey` and all'
    },
    {
        signature: 'prefetching hls playlist: ',
        origin: 'htmlVideoPlayer hls prefetch — the transcoding playlist url (the message without the url is kept)'
    },
    {
        signature: 'requesting url: ',
        origin: 'utils/fetch ajax — the request url with its query string'
    },
    {
        signature: 'connecting to url',
        origin: 'utils/fetch fetchWithTimeout — the request url on success and on timeout'
    },
    {
        signature: 'request failed to url',
        origin: 'utils/fetch ajax — the request url on the failure branch'
    },
    {
        signature: ', url: ',
        origin: 'utils/fetch — the trailing `url:` label of the timeout and response lines (BROAD: the url follows an interpolation, so there is no anchored prefix to match)'
    },
    {
        signature: 'requested media: http',
        origin: 'playbackmanager — `item.Url` when no player matched'
    },
    {
        signature: 'opening web socket with url',
        origin: 'jellyfin-apiclient openWebSocket — the socket url built with `api_key=<accessToken()>` (#152); removed at install time by scripts/patch-jellyfin-apiclient.mjs, so a hit means the patch did not run'
    }
];

/**
 * Vendor assets, by webpack's own naming (`node_modules.<package>.bundle.js`).
 *
 * A hit here is reported on every run but never fails the build: the code is a dependency's, no
 * edit in this repository removes it, and a gate that cannot be satisfied gets deleted.
 */
const VENDOR_ASSET = /(^|[\\/])node_modules\./;

function parseArgs(argv) {
    const options = { json: false, root: process.cwd(), dist: null };
    // An index walk, not `for…of`: `--root` consumes the argument after it.
    let i = 0;
    while (i < argv.length) {
        const argument = argv[i];
        if (argument === '--json') {
            options.json = true;
            i += 1;
        } else if (argument === '--dist') {
            options.dist = resolve(argv[i + 1]);
            i += 2;
        } else if (argument === '--root') {
            options.root = resolve(argv[i + 1]);
            i += 2;
        } else {
            console.error(`unknown argument: ${argument}`);
            process.exit(2);
        }
    }
    return options;
}

/** Every source file under `src/`, from git so generated and ignored trees stay out. */
function sourceFiles(root) {
    const out = execFileSync('git', ['ls-files', 'src'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
    });
    return out
        .split('\n')
        .filter((file) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(file))
        .sort();
}

function scriptKind(file) {
    if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (file.endsWith('.ts')) return ts.ScriptKind.TS;
    if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
    return ts.ScriptKind.JS;
}

/** Collapse whitespace so an entry survives reformatting; the expression itself is the key. */
function normalize(text) {
    return text.replace(/\s+/g, ' ').trim();
}

/** Does this expression READ something url-valued, at any depth? */
function readsUrlValue(node) {
    let found = false;
    const walk = (n) => {
        if (found) return;
        if (ts.isPropertyAccessExpression(n)) {
            if (URL_NAMES.test(n.name.text)) {
                found = true;
                return;
            }
        } else if (ts.isElementAccessExpression(n)) {
            // `urls[i]` — the url-ness is in the object, not the index.
            if (
                ts.isIdentifier(n.expression) &&
                URL_NAMES.test(n.expression.text)
            ) {
                found = true;
                return;
            }
        } else if (ts.isIdentifier(n)) {
            if (URL_NAMES.test(n.text)) {
                found = true;
                return;
            }
        } else if (
            ts.isStringLiteral(n) ||
            ts.isNoSubstitutionTemplateLiteral(n) ||
            ts.isTemplateHead(n) ||
            ts.isTemplateMiddle(n) ||
            ts.isTemplateTail(n)
        ) {
            if (LITERAL_URL.test(n.text)) {
                found = true;
                return;
            }
        } else if (ts.isTemplateExpression(n)) {
            // `…url: ${anything}` — the prose names what the hole holds.
            let preceding = n.head.text;
            for (const span of n.templateSpans) {
                if (URL_LABEL.test(preceding)) {
                    found = true;
                    return;
                }
                preceding = span.literal.text;
            }
        } else if (
            ts.isBinaryExpression(n) &&
            n.operatorToken.kind === ts.SyntaxKind.PlusToken
        ) {
            // `'playing url: ' + val` — the concatenated form of the same announcement.
            const left = n.left;
            const leftText =
                ts.isStringLiteral(left) ||
                ts.isNoSubstitutionTemplateLiteral(left)
                    ? left.text
                    : null;
            if (leftText !== null && URL_LABEL.test(leftText)) {
                found = true;
                return;
            }
        }
        ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
}

function findViolations(root) {
    const violations = [];
    for (const file of sourceFiles(root)) {
        const absolute = join(root, file);
        const text = readFileSync(absolute, 'utf8');
        if (!text.includes('console.')) continue;
        const sourceFile = ts.createSourceFile(
            file,
            text,
            ts.ScriptTarget.Latest,
            true,
            scriptKind(file)
        );
        const walk = (node) => {
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                ts.isIdentifier(node.expression.expression) &&
                node.expression.expression.text === 'console' &&
                CONSOLE_METHODS.has(node.expression.name.text)
            ) {
                for (const argument of node.arguments) {
                    if (!readsUrlValue(argument)) continue;
                    const { line } = sourceFile.getLineAndCharacterOfPosition(
                        argument.getStart(sourceFile)
                    );
                    violations.push({
                        file,
                        line: line + 1,
                        method: node.expression.name.text,
                        expression: normalize(argument.getText(sourceFile))
                    });
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(sourceFile);
    }
    return violations;
}

function loadAllowlist(root) {
    const path = join(root, ALLOWLIST_PATH);
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const entries = Array.isArray(parsed) ? parsed : parsed.exceptions;
    if (!Array.isArray(entries))
        throw new Error(`${ALLOWLIST_PATH}: expected an array of exceptions`);
    for (const entry of entries) {
        if (!entry.file || !entry.expression || !entry.reason)
            throw new Error(
                `${ALLOWLIST_PATH}: every exception needs file, expression and reason`
            );
    }
    return entries;
}

/** Every built script under a dist tree. `.map` files are skipped: they mirror the source. */
function bundleScripts(dist) {
    const out = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const path = join(dir, entry);
            if (statSync(path).isDirectory()) walk(path);
            else if (/\.(js|mjs|cjs)$/.test(entry)) out.push(path);
        }
    };
    walk(dist);
    return out.sort();
}

/** The retired sinks, searched for in the bundle we would actually ship. */
function scanBundle(dist) {
    const found = [];
    for (const script of bundleScripts(dist)) {
        const asset = relative(dist, script);
        const text = readFileSync(script, 'utf8');
        for (const sink of RETIRED_SINKS) {
            if (text.includes(sink.signature))
                found.push({
                    asset,
                    vendor: VENDOR_ASSET.test(asset),
                    signature: sink.signature,
                    origin: sink.origin
                });
        }
    }
    return found;
}

function checkBundle(options) {
    if (!existsSync(options.dist)) {
        console.error(
            `${options.dist}: no such directory. Run \`npm run build:production\` first.`
        );
        process.exit(2);
    }
    const scripts = bundleScripts(options.dist);
    if (scripts.length === 0) {
        console.error(
            `${options.dist}: no built scripts found — refusing to report a vacuous pass.`
        );
        process.exit(2);
    }
    const found = scanBundle(options.dist);
    const ours = found.filter((hit) => !hit.vendor);
    const vendor = found.filter((hit) => hit.vendor);

    if (options.json) {
        console.log(
            JSON.stringify({ scanned: scripts.length, ours, vendor }, null, 2)
        );
        process.exit(found.length ? 1 : 0);
    }

    // EVERY hit is fatal, whoever wrote it. The classification survives only in the wording, because
    // knowing whether a sink is ours or a dependency's changes the REPAIR (edit `src/`, or re-pin
    // `scripts/patch-jellyfin-apiclient.mjs`), never whether the build may ship.
    for (const hit of found) {
        console.error(
            `${hit.asset}: the shipped bundle carries a retired url sink — "${hit.signature}" ` +
                `[${hit.vendor ? 'DEPENDENCY' : 'first-party'}] (${hit.origin})`
        );
    }
    if (found.length) {
        console.error(
            `\n${found.length} retired sink(s) are in the production bundle ` +
                `(${ours.length} first-party, ${vendor.length} dependency). A playback or api url ` +
                'carries `ApiKey=<the session access token>`, so this ships a credential disclosure ' +
                'to every user.\n' +
                (vendor.length
                    ? 'For a DEPENDENCY hit the repair is scripts/patch-jellyfin-apiclient.mjs — ' +
                      'check that `postinstall` ran and that the package version is still pinned.\n'
                    : '')
        );
        process.exit(1);
    }
    console.log(
        `console-url hygiene (bundle): ok — ${scripts.length} built script(s), none of them carries ` +
            `any of the ${RETIRED_SINKS.length} retired url sinks, first-party or dependency.`
    );
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.dist) {
        checkBundle(options);
        return;
    }
    const root = options.root;
    const violations = findViolations(root);
    const allowlist = loadAllowlist(root);

    const used = new Set();
    const unlisted = violations.filter((violation) => {
        const index = allowlist.findIndex(
            (entry) =>
                entry.file === violation.file &&
                normalize(entry.expression) === violation.expression
        );
        if (index === -1) return true;
        used.add(index);
        return false;
    });
    const stale = allowlist.filter((_, index) => !used.has(index));

    if (options.json) {
        console.log(
            JSON.stringify({ violations, unlisted, stale }, null, 2) // eslint-disable-line no-console
        );
        process.exit(unlisted.length || stale.length ? 1 : 0);
    }

    for (const violation of unlisted) {
        console.error(
            `${relative(process.cwd(), join(root, violation.file))}:${violation.line}: console.${violation.method} is handed a url: ${violation.expression}`
        );
    }
    for (const entry of stale) {
        console.error(
            `${ALLOWLIST_PATH}: stale exception, nothing matches — ${entry.file} :: ${normalize(entry.expression)}`
        );
    }

    if (unlisted.length) {
        console.error(
            `\n${unlisted.length} console call(s) would publish a url. A playback or api url carries ` +
                '`ApiKey=<the session access token>`, so this is a credential disclosure, not console noise.\n' +
                'Log an endpoint category, an HTTP status and the playback method instead ' +
                '(see src/utils/urlCategory.ts), or record a justified exception in ' +
                `${ALLOWLIST_PATH}.`
        );
    }
    if (stale.length) {
        console.error(
            `\n${stale.length} exception(s) in ${ALLOWLIST_PATH} no longer match any code. Remove them.`
        );
    }
    if (unlisted.length || stale.length) process.exit(1);

    console.log(
        `console-url hygiene: ok — no console call is handed a url (${allowlist.length} justified exception(s)).`
    );
}

main();

#!/usr/bin/env node
/**
 * Static server for the server-free reader suite.
 *
 * There is no Reefin server in this suite: the readers are exercised against
 * the real production build output plus project-owned fixtures, all served
 * from a single origin so "no remote request" is a checkable claim.
 *
 *   /                    -> dist/          (the production build, so
 *                                           /libraries/pdf.worker.mjs is the
 *                                           artifact the build actually copied)
 *   /__fixtures__/...    -> tests/reader/fixtures/
 *   /__harness__/...     -> tests/reader/harness/
 *   /__vendor__/pdf.mjs  -> node_modules/pdfjs-dist/build/pdf.mjs
 *   /__vendor__/epub.js  -> node_modules/epubjs/dist/epub.js
 *
 * The vendor mounts serve the exact module files the bundler consumes, so the
 * suite tests the installed package rather than a copy of it.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const PORT = Number(process.env.READER_SUITE_PORT || 4319);

const MIME = {
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.xhtml': 'application/xhtml+xml; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ncx': 'application/x-dtbncx+xml',
    '.opf': 'application/oebps-package+xml'
};

const MOUNTS = [
    ['/__fixtures__/', join(HERE, 'fixtures')],
    ['/__harness__/', join(HERE, 'harness')],
    ['/__vendor__/pdfjs/', join(REPO, 'node_modules', 'pdfjs-dist', 'build')],
    ['/__vendor__/epubjs/', join(REPO, 'node_modules', 'epubjs', 'dist')]
];

const DIST = join(REPO, 'dist');

/** Resolve a URL path to a file inside `root`, or null if it escapes it. */
function safeJoin(root, relative) {
    const target = normalize(join(root, decodeURIComponent(relative)));
    if (target !== root && !target.startsWith(root + sep)) return null;
    return target;
}

function resolveRequest(urlPath) {
    for (const [prefix, root] of MOUNTS) {
        if (urlPath.startsWith(prefix)) {
            return safeJoin(root, urlPath.slice(prefix.length));
        }
    }
    return safeJoin(DIST, urlPath === '/' ? 'index.html' : urlPath.slice(1));
}

const server = createServer((req, res) => {
    const urlPath = new URL(req.url, 'http://localhost').pathname;
    const file = resolveRequest(urlPath);

    if (!file || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`not found: ${urlPath}\n`);
        return;
    }

    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
        // The pdf.js worker is a module worker; nothing here needs COOP/COEP,
        // but the readers must never be able to reach off-origin.
        'content-security-policy':
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'"
    });
    createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`reader suite server on http://127.0.0.1:${PORT}`);
});

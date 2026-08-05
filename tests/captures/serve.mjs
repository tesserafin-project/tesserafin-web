#!/usr/bin/env node
/**
 * Static server for the server-free capture suite.
 *
 * One origin, one directory: `tests/captures/dist/`, which holds the harness bundle, its HTML and
 * the two token sets. Nothing is fetched from anywhere else, which is what makes "these captures
 * needed no Tesserafin server and no network" a checkable claim rather than an assertion.
 *
 * Modelled on `tests/reader/serve.mjs`, deliberately: that file already established the pattern for
 * a server-free Playwright suite in this repo, and a second, differently-shaped static server would
 * be two things to keep correct.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, 'dist');
const PORT = Number(process.env.CAPTURE_SUITE_PORT || 4321);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2'
};

/** Resolves a URL path inside ROOT, or null if it escapes — no traversal out of the served tree. */
function safeResolve(urlPath) {
    const relative = normalize(decodeURIComponent(urlPath)).replace(
        /^(\.\.[/\\])+/,
        ''
    );
    const target = join(ROOT, relative);
    return target === ROOT || target.startsWith(ROOT + sep) ? target : null;
}

const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;

    const target = safeResolve(path);
    if (!target || !existsSync(target) || !statSync(target).isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end(`not found: ${path}`);
        return;
    }

    const extension = target.slice(target.lastIndexOf('.'));
    response.writeHead(200, {
        'content-type': MIME[extension] ?? 'application/octet-stream',
        // Never cache: a capture run rebuilds the bundle and rewrites the token files, and a stale
        // 304 would produce a screenshot of the previous palette.
        'cache-control': 'no-store'
    });
    createReadStream(target).pipe(response);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[captures] serving ${ROOT} on http://127.0.0.1:${PORT}`);
});

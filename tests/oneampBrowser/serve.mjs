#!/usr/bin/env node
/**
 * Static server for the OneAmp browser suite: one origin, `tests/oneampBrowser/dist/`.
 * Unlike `tests/captures/serve.mjs` it answers byte ranges, because `<audio>` seeking needs
 * 206 responses. It also writes the WAV fixtures before listening, so the suite needs no
 * committed binaries.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFixtures } from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.ONEAMP_SUITE_ROOT || join(HERE, 'dist'));
const PORT = Number(process.env.ONEAMP_SUITE_PORT || 4341);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.wav': 'audio/wav'
};

function safeResolve(urlPath) {
    const relative = normalize(decodeURIComponent(urlPath)).replace(
        /^(\.\.[/\\])+/,
        ''
    );
    const target = join(ROOT, relative);
    return target === ROOT || target.startsWith(ROOT + sep) ? target : null;
}

writeFixtures(ROOT);

createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const target = safeResolve(path);
    if (!target || !existsSync(target) || !statSync(target).isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
        return;
    }
    const size = statSync(target).size;
    const headers = {
        'content-type':
            MIME[target.slice(target.lastIndexOf('.'))] ??
            'application/octet-stream',
        'cache-control': 'no-store',
        'accept-ranges': 'bytes'
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
    if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        response.writeHead(206, {
            ...headers,
            'content-range': `bytes ${start}-${end}/${size}`,
            'content-length': end - start + 1
        });
        createReadStream(target, { start, end }).pipe(response);
        return;
    }
    response.writeHead(200, { ...headers, 'content-length': size });
    createReadStream(target).pipe(response);
}).listen(PORT, '127.0.0.1', () => {
    console.log(`[oneamp] serving ${ROOT} on http://127.0.0.1:${PORT}`);
});

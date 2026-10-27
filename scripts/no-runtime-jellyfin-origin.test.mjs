import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const VERIFIER = fileURLToPath(
    new URL('./verify-no-runtime-jellyfin.mjs', import.meta.url)
);
const HTTPS_ORIGIN = 'https://github.com/tesserafin-project/tesserafin-web.git';

// Run the actual CLI with a real git index and remote configuration. The empty
// host inventory keeps a rejected origin distinguishable from other failures.
function run(t, origin, { push, upstream = false } = {}) {
    const cwd = mkdtempSync(join(tmpdir(), 'tesserafin-origin-control-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const env = {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: join(cwd, 'absent-global-config')
    };
    const git = (...args) =>
        execFileSync('git', args, { cwd, env, encoding: 'utf8' });
    git('init', '--quiet');
    mkdirSync(join(cwd, '.github'));
    writeFileSync(
        join(cwd, '.github/jellyfin-boundary-allowlist.json'),
        JSON.stringify({ entries: [] })
    );
    git('add', '.github');
    git('remote', 'add', 'origin', origin);
    if (push) git('remote', 'set-url', '--push', 'origin', push);
    if (upstream) {
        git(
            'remote',
            'add',
            'upstream',
            'https://github.com/jellyfin/jellyfin-web.git'
        );
        mkdirSync(join(cwd, 'docs/tesserafin'), { recursive: true });
        writeFileSync(
            join(cwd, 'docs/tesserafin/b1-jellyfin-boundary.md'),
            'The upstream remote is developer-only synchronization.\n'
        );
    }
    const result = spawnSync(process.execPath, [VERIFIER], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 10000
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
}

for (const origin of [
    HTTPS_ORIGIN,
    'https://github.com/tesserafin-project/tesserafin-web',
    'https://github.com/tesserafin-project/tesserafin-web.git/',
    'git@github.com:tesserafin-project/tesserafin-web.git',
    'git@github.com:tesserafin-project/tesserafin-web',
    'ssh://git@github.com/tesserafin-project/tesserafin-web.git',
    'https://GITHUB.COM/TESSERAFIN-PROJECT/TESSERAFIN-WEB.git'
]) {
    test(`accepts exact repository clone URL: ${origin}`, (t) => {
        const result = run(t, origin);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /\[verify:no-runtime-jellyfin\] OK/);
    });
}

for (const origin of [
    'https://example.invalid/tesserafin-project/tesserafin-web',
    'https://github.com.example.invalid/tesserafin-project/tesserafin-web.git',
    'https://github.com@example.invalid/tesserafin-project/tesserafin-web.git',
    'https://example.invalid/?repo=tesserafin-project/tesserafin-web',
    'https://example.invalid/#tesserafin-project/tesserafin-web',
    'https://github.com/tesserafin-project/tesserafin-web-unrelated.git',
    'https://github.com/not-tesserafin-project/tesserafin-web.git',
    'https://github.com/other/tesserafin-project/tesserafin-web.git',
    'https://github.com/tesserafin-project/tesserafin-web/tree/main',
    'https://github.com/tesserafin-project/tesserafin-web.git?ref=main',
    'https://github.com/tesserafin-project/tesserafin-web.git#main',
    'https://github.com/tesserafin-project/tesserafin-web.git trailing-text',
    'https://github.com/tesserafin-project/tesserafin-web.git\thttps://example.invalid',
    'http://github.com/tesserafin-project/tesserafin-web.git',
    'git@example.invalid:tesserafin-project/tesserafin-web.git',
    'ssh://git@example.invalid/tesserafin-project/tesserafin-web.git',
    'file:///tmp/tesserafin-project/tesserafin-web.git'
]) {
    test(`rejects an origin that is not the exact repository: ${origin}`, (t) => {
        const result = run(t, origin);
        assert.equal(result.status, 1, result.stdout);
        assert.match(
            result.stderr,
            /git remote origin points at .*not tesserafin-project\/tesserafin-web/
        );
        assert.doesNotMatch(result.stdout, /\[verify:no-runtime-jellyfin\] OK/);
    });
}

test('rejects a multiline remote instead of validating only its first line', (t) => {
    const result = run(t, `${HTTPS_ORIGIN}\nhttps://example.invalid`);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /cannot parse git remote entry/);
});

test('checks an external push URL even when the fetch URL is valid', (t) => {
    const result = run(t, HTTPS_ORIGIN, {
        push: 'https://example.invalid/tesserafin-project/tesserafin-web.git'
    });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /git remote origin points at/);
});

test('checks an external fetch URL even when the push URL is valid', (t) => {
    const result = run(
        t,
        'https://example.invalid/tesserafin-project/tesserafin-web.git',
        { push: HTTPS_ORIGIN }
    );
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /git remote origin points at/);
});

test('accepts distinct valid fetch and push clone forms', (t) => {
    const result = run(t, HTTPS_ORIGIN, {
        push: 'git@github.com:tesserafin-project/tesserafin-web.git'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[verify:no-runtime-jellyfin\] OK/);
});

test('preserves the documented developer-only upstream remote', (t) => {
    const result = run(t, HTTPS_ORIGIN, { upstream: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /documented developer-only synchronisation/);
    assert.match(result.stdout, /\[verify:no-runtime-jellyfin\] OK/);
});

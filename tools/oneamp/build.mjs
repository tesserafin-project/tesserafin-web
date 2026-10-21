// Build-time experiment only. Nothing in src/ imports this module.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
    mkdtempSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
    readdirSync,
    rmSync,
    existsSync,
    copyFileSync,
    cpSync
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { parseArgs } from 'node:util';

export const PIN = Object.freeze({
    repository: 'https://github.com/all3f0r1/oneamp.git',
    commit: 'cbf04e7ba97f000676c829257ce215e41281dd84',
    lockSha256:
        'db131f835ed998a66b73a7a40332b1fec76e39e896f997a03fee6abbe7a3de90',
    rust: '1.94.0',
    target: 'wasm32-unknown-unknown'
});
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({
    options: { source: { type: 'string' }, output: { type: 'string' } }
});
if (!values.output)
    throw new Error(
        'Required: --output NEW_DIRECTORY [--source PINNED_CLEAN_CHECKOUT]'
    );
const output = resolve(values.output);
if (existsSync(output)) throw new Error('Output must not exist');
const scratch = mkdtempSync(join(tmpdir(), 'tesserafin-oneamp-'));
const source = values.source ? resolve(values.source) : join(scratch, 'source');
let createdOutput = false;
const run = (command, args, cwd = source, env = process.env) =>
    execFileSync(command, args, {
        cwd,
        env,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 15 * 60 * 1000
    });
try {
    if (!values.source) {
        mkdirSync(source);
        run('git', ['init', '--quiet']);
        run('git', ['fetch', '--depth=1', PIN.repository, PIN.commit]);
        run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    }
    if (
        run('git', ['rev-parse', 'HEAD']).trim() !== PIN.commit ||
        run('git', ['status', '--porcelain', '--untracked-files=all']).trim()
    ) {
        throw new Error('Source must be clean at the pinned commit');
    }
    if (sha256(readFileSync(join(source, 'Cargo.lock'))) !== PIN.lockSha256)
        throw new Error('Cargo.lock hash mismatch');
    const rustc = run('rustup', ['run', PIN.rust, 'rustc', '--version']).trim();
    if (!rustc.startsWith(`rustc ${PIN.rust} `))
        throw new Error('Compiler version mismatch');
    const env = {
        ...process.env,
        CARGO_TARGET_DIR: join(scratch, 'target'),
        SOURCE_DATE_EPOCH: '0',
        RUSTFLAGS: [
            source,
            scratch,
            process.env.CARGO_HOME || join(homedir(), '.cargo')
        ]
            .map((path, i) => `--remap-path-prefix=${path}=/oneamp-build/${i}`)
            .join(' ')
    };
    const cargo = (...args) =>
        run('rustup', ['run', PIN.rust, 'cargo', ...args], source, env);
    cargo(
        'build',
        '--locked',
        '--release',
        '--target',
        PIN.target,
        '-p',
        'oneamp-wasm'
    );
    // Cargo's selected tree (not the desktop workspace's whole dependency set).
    const selected = cargo(
        'tree',
        '--locked',
        '--target',
        PIN.target,
        '-p',
        'oneamp-wasm',
        '--edges',
        'normal,build',
        '--prefix',
        'none',
        '--no-dedupe',
        '--format',
        '{p}'
    );
    const identities = new Set(
        selected
            .trim()
            .split('\n')
            .map((line) => {
                const match = /^(\S+) v(\S+)/.exec(line);
                if (!match) throw new Error('Unexpected dependency tree line');
                return `${match[1]}@${match[2]}`;
            })
    );
    const metadata = JSON.parse(
        cargo(
            'metadata',
            '--locked',
            '--format-version=1',
            '--filter-platform',
            PIN.target
        )
    );
    const dependencies = metadata.packages
        .filter((p) => identities.has(`${p.name}@${p.version}`))
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    if (dependencies.length !== identities.size)
        throw new Error('Dependency inventory incomplete');
    const wasm = readFileSync(
        join(env.CARGO_TARGET_DIR, PIN.target, 'release/oneamp_wasm.wasm')
    );
    const module = new WebAssembly.Module(wasm);
    if (WebAssembly.Module.imports(module).length)
        throw new Error('Unexpected WASM imports');
    mkdirSync(output);
    createdOutput = true;
    writeFileSync(join(output, 'oneamp.wasm'), wasm);
    for (const p of dependencies) {
        const root = p.source ? dirname(p.manifest_path) : source;
        const notices = readdirSync(root).filter((name) =>
            /^(LICENSE|COPYING|NOTICE)([._-]|$)/i.test(name)
        );
        if (!p.license || !notices.length)
            throw new Error(`Missing license evidence: ${p.name}`);
        const folder = join(output, 'notices', `${p.name}-${p.version}`);
        mkdirSync(folder, { recursive: true });
        for (const name of notices)
            copyFileSync(join(root, name), join(folder, name));
    }
    const rustRoot = run('rustup', [
        'run',
        PIN.rust,
        'rustc',
        '--print',
        'sysroot'
    ]).trim();
    const rustNotices = join(rustRoot, 'share', 'doc', 'rust');
    const rustOutput = join(output, 'notices', `rust-${PIN.rust}`);
    mkdirSync(rustOutput);
    for (const name of ['COPYRIGHT.html', 'COPYRIGHT-library.html', 'licenses'])
        cpSync(join(rustNotices, name), join(rustOutput, name), {
            recursive: true
        });
    const selectLicense = (license) => {
        if (['MIT', 'MIT OR Apache-2.0', 'Unlicense OR MIT'].includes(license))
            return 'MIT';
        if (license === '(MIT OR Apache-2.0) AND Unicode-3.0')
            return 'MIT AND Unicode-3.0';
        throw new Error(`Review required for license expression: ${license}`);
    };
    const manifest = {
        schemaVersion: 1,
        experimental: true,
        ...PIN,
        rustc,
        sha256: sha256(wasm),
        bytes: wasm.length,
        exports: WebAssembly.Module.exports(module),
        dependencies: dependencies.map((p) => ({
            name: p.name,
            version: p.version,
            license: p.license,
            selectedLicense: selectLicense(p.license),
            source: p.source || `oneamp@${PIN.commit}`
        }))
    };
    writeFileSync(
        join(output, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`
    );
    console.log(
        JSON.stringify({
            output,
            bytes: wasm.length,
            sha256: manifest.sha256,
            dependencies: dependencies.length
        })
    );
} catch (error) {
    // Only remove a directory this invocation created, never an existing output.
    if (createdOutput) rmSync(output, { recursive: true, force: true });
    throw error;
} finally {
    rmSync(scratch, { recursive: true, force: true });
}

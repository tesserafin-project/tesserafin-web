// Test-only preload: deterministically replace an input after its metadata is
// checked, or inject an I/O failure. No test hook is added to the evaluator.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';

const target = process.env.AUDIT_PROBE_TARGET;
const mode = process.env.AUDIT_PROBE_MODE;
const original = {
    open: fs.openSync,
    stat: fs.statSync,
    fstat: fs.fstatSync,
    read: fs.readFileSync,
    close: fs.closeSync,
    write: fs.writeFileSync
};
const active = new Set();
const evidence = { opens: 0, closes: 0, reads: 0, fired: false, stages: [] };
const matches = (path) => typeof path === 'string' && resolve(path) === target;

function afterMetadata(stage) {
    if (evidence.fired) return;
    evidence.stages.push(stage);
    if (mode === 'replace') {
        fs.renameSync(process.env.AUDIT_PROBE_REPLACEMENT, target);
        evidence.fired = true;
    } else if (mode === 'metadata-error') {
        evidence.fired = true;
        throw new Error('injected metadata read failure');
    }
}

fs.openSync = (path, ...args) => {
    const fd = original.open(path, ...args);
    if (matches(path)) {
        active.add(fd);
        evidence.opens += 1;
    }
    return fd;
};
fs.statSync = (path, ...args) => {
    const stats = original.stat(path, ...args);
    if (matches(path)) afterMetadata('path');
    return stats;
};
fs.fstatSync = (fd, ...args) => {
    const stats = original.fstat(fd, ...args);
    if (active.has(fd)) afterMetadata('descriptor');
    return stats;
};
fs.readFileSync = (input, ...args) => {
    if (active.has(input) || matches(input)) {
        evidence.reads += 1;
        if (mode === 'read-error') {
            evidence.fired = true;
            throw new Error('injected content read failure');
        }
    }
    return original.read(input, ...args);
};
fs.closeSync = (fd) => {
    const result = original.close(fd);
    if (active.delete(fd)) evidence.closes += 1;
    return result;
};
syncBuiltinESMExports();

process.on('exit', () => {
    original.write(
        process.env.AUDIT_PROBE_EVIDENCE,
        JSON.stringify({ ...evidence, active: active.size })
    );
});

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const [left, right] = process.argv.slice(2);
if (!left || !right) throw new Error('Expected two build output directories');
function files(root, prefix = '') {
    return readdirSync(join(root, prefix), { withFileTypes: true })
        .flatMap((entry) => {
            const path = join(prefix, entry.name);
            return entry.isDirectory() ? files(root, path) : [path];
        })
        .sort();
}
const paths = files(left);
assert.deepEqual(paths, files(right));
for (const path of paths)
    assert.deepEqual(
        readFileSync(join(left, path)),
        readFileSync(join(right, path)),
        `Non-reproducible file: ${path}`
    );
console.log(
    `Identical outputs: ${paths.length} files (WASM, manifest and notices)`
);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ProcessorCore } from './processor-core.mjs';
const folder = process.env.ONEAMP_OUTPUT || 'oneamp-dsp-out';
const bytes = readFileSync(`${folder}/oneamp.wasm`);
const manifest = JSON.parse(readFileSync(`${folder}/manifest.json`));
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
const module = new WebAssembly.Module(bytes);
for (const rate of [44100, 48000]) {
    for (const block of [64, 128, 256, 512, 1024]) {
        test(`real worklet core preserves flat PCM and final tail ${rate}/${block}`, () => {
            const core = new ProcessorCore(module, rate);
            const frames = 2051;
            const left = Float32Array.from({ length: frames }, (_, i) =>
                i === frames - 1 ? 0.25 : Math.sin(i / 20) * 0.1
            );
            const right = Float32Array.from(left, (x) => -x * 0.7);
            const output = [[], []];
            for (let offset = 0; offset < frames; offset += block) {
                const n = Math.min(block, frames - offset);
                const out = [new Float32Array(n), new Float32Array(n)];
                core.render(
                    left.subarray(offset, offset + n),
                    right.subarray(offset, offset + n),
                    ...out
                );
                output[0].push(...out[0]);
                output[1].push(...out[1]);
            }
            assert.equal(core.drain(0), true);
            assert.equal(core.drain(0), false);
            const tail = [new Float32Array(512), new Float32Array(512)];
            core.render(null, null, ...tail);
            output[0].push(...tail[0]);
            output[1].push(...tail[1]);
            assert.equal(core.phase, 'drained');
            for (let i = 0; i < frames; i++) {
                assert.ok(
                    Math.abs(output[0][i + core.latency] - left[i]) < 1e-6
                );
                assert.ok(
                    Math.abs(output[1][i + core.latency] - right[i]) < 1e-6
                );
            }
            core.dispose();
            core.dispose();
        });
    }
}
test('epoch/sequence controls, missing input, reset and double disposal are bounded', () => {
    const core = new ProcessorCore(module, 48000);
    assert.equal(core.configure(0, 1, -6, new Float32Array(10)), true);
    assert.equal(core.configure(0, 1, 0, new Float32Array(10)), false);
    assert.equal(core.configure(1, 2, 0, new Float32Array(10)), false);
    assert.equal(core.reset(1), true);
    assert.equal(core.reset(1), false);
    assert.equal(core.configure(0, 3, 0, new Float32Array(10)), false);
    const output = [new Float32Array(64).fill(1), new Float32Array(64).fill(1)];
    core.render(null, null, ...output);
    assert.ok(output.every((channel) => channel.every((x) => x === 0)));
    assert.equal(core.phase, 'running');
    assert.throws(
        () => core.render(new Float32Array(64), null, ...output),
        /layout/
    );
    assert.throws(
        () =>
            core.render(
                new Float32Array(64).fill(NaN),
                new Float32Array(64),
                ...output
            ),
        /invalid-input/
    );
    assert.throws(
        () => core.configure(1, 1, 13, new Float32Array(10)),
        /invalid-controls/
    );
    core.dispose();
    core.dispose();
    assert.throws(() => core.render(null, null, ...output), /disposed/);
});
test('short ABI output is rejected instead of reading unproduced samples', () => {
    const core = new ProcessorCore(module, 48000);
    core.api = { ...core.api, oneamp_process: () => 2 };
    assert.throws(
        () =>
            core.render(
                new Float32Array(64),
                new Float32Array(64),
                new Float32Array(64),
                new Float32Array(64)
            ),
        /invalid-process-count/
    );
    core.dispose();
});
test('reset discards delayed old-epoch impulse', () => {
    const core = new ProcessorCore(module, 48000);
    const input = new Float32Array(64);
    input[63] = 0.25;
    core.render(input, input, new Float32Array(64), new Float32Array(64));
    core.reset(1);
    const output = [new Float32Array(512), new Float32Array(512)];
    core.render(new Float32Array(512), new Float32Array(512), ...output);
    assert.ok(output.every((channel) => channel.every((x) => x === 0)));
    core.dispose();
});

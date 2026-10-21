import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PcmHost } from './pcm-host.mjs';

const folder = resolve(process.env.ONEAMP_OUTPUT || 'oneamp-dsp-out');
const bytes = readFileSync(`${folder}/oneamp.wasm`);
const manifest = JSON.parse(readFileSync(`${folder}/manifest.json`, 'utf8'));
const module = new WebAssembly.Module(bytes);
const api = () => new WebAssembly.Instance(module, {}).exports;
const join = (parts) =>
    Float32Array.from(parts.flatMap((part) => Array.from(part)));
function render(host, input, chunk) {
    const parts = [];
    for (let frame = 0; frame < input.length / 2; frame += chunk)
        parts.push(
            host.process(
                input.subarray(
                    frame * 2,
                    Math.min(input.length, (frame + chunk) * 2)
                )
            )
        );
    parts.push(host.finish());
    return join(parts);
}
const tone = (frames, rate, hz = 1000, amplitude = 0.15) =>
    Float32Array.from(
        { length: frames * 2 },
        (_, i) =>
            amplitude *
            Math.sin((2 * Math.PI * hz * Math.floor(i / 2)) / rate) *
            (i % 2 ? 0.7 : 1)
    );
const rms = (data) =>
    Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
const near = (a, b, epsilon = 2e-6) => {
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++)
        assert.ok(
            Math.abs(a[i] - b[i]) <= epsilon,
            `PCM mismatch at ${i}: ${a[i]} / ${b[i]}`
        );
};

test('the actual binary matches its manifest, has no imports and exposes the required C ABI', () => {
    assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        manifest.sha256
    );
    assert.equal(bytes.length, manifest.bytes);
    assert.deepEqual(WebAssembly.Module.imports(module), []);
    const exports = api();
    assert.ok(exports.memory instanceof WebAssembly.Memory);
    for (const name of [
        'new',
        'free',
        'buffer',
        'buffer_frames',
        'process',
        'flush',
        'reset',
        'latency_frames',
        'output_channels',
        'set_eq_enabled',
        'set_eq_band',
        'set_preamp',
        'set_replaygain',
        'set_volume'
    ])
        assert.equal(typeof exports[`oneamp_${name}`], 'function', name);
    assert.equal(manifest.commit, 'cbf04e7ba97f000676c829257ce215e41281dd84');
    assert.equal(manifest.rust, '1.94.0');
    assert.ok(manifest.dependencies.length > 2);
});

for (const rate of [44100, 48000]) {
    for (const chunk of [64, 128, 256, 512]) {
        test(`${rate} Hz / ${chunk} frames: flat PCM is exactly delayed and EOS returns the complete tail`, () => {
            const host = new PcmHost(api(), rate, chunk);
            try {
                assert.equal(host.latency, Math.round(rate * 0.002) - 1);
                const input = tone(4099, rate);
                input[input.length - 2] = 0.37;
                input[input.length - 1] = -0.29;
                const output = render(host, input, chunk);
                assert.equal(output.length, input.length + host.latency * 2);
                near(
                    output.subarray(0, host.latency * 2),
                    new Float32Array(host.latency * 2)
                );
                near(output.subarray(host.latency * 2), input);
                assert.ok(output.every(Number.isFinite));
                assert.throws(() => host.finish(), /already flushed/);
                assert.throws(
                    () => host.process(input.subarray(0, 2)),
                    /Reset required/
                );
            } finally {
                host.close();
            }
        });
    }
    test(`${rate} Hz: a clip shorter than lookahead survives EOS`, () => {
        const host = new PcmHost(api(), rate, 64);
        try {
            const input = tone(17, rate);
            input[input.length - 1] = 0.42;
            const output = render(host, input, 64);
            assert.equal(output.length, input.length + host.latency * 2);
            near(output.subarray(host.latency * 2), input);
        } finally {
            host.close();
        }
    });
    test(`${rate} Hz: gain and EQ change real PCM, independently of chunk size`, () => {
        const input = tone(rate, rate);
        const host = new PcmHost(api(), rate, 512);
        try {
            host.preamp(-6.0206);
            const quiet = render(host, input, 128).subarray(host.latency * 2);
            // Ignore parameter smoothing at the start of the signal.
            assert.ok(
                Math.abs(
                    rms(quiet.subarray(4096)) / rms(input.subarray(4096)) - 0.5
                ) < 0.002
            );
            host.reset();
            host.preamp(0);
            host.eq(5, 9);
            // reset snaps parameter smoothing to its targets as well as clearing history.
            host.reset();
            const boosted = render(host, input, 64);
            assert.ok(
                rms(boosted.subarray(8192)) > rms(input.subarray(8192)) * 1.1
            );
            host.reset();
            const large = render(host, input, 512);
            near(large, boosted);
        } finally {
            host.close();
        }
    });
    test(`${rate} Hz: the sample limiter contains hot PCM and reset clears the lookahead`, () => {
        const host = new PcmHost(api(), rate, 256);
        try {
            host.preamp(12);
            host.eq(5, 12);
            const hot = render(host, tone(rate, rate, 1000, 1.6), 256);
            assert.ok(hot.every(Number.isFinite));
            assert.ok(
                Math.max(...hot) <= 1.000001 && Math.min(...hot) >= -1.000001
            );
            assert.ok(rms(hot) > 0.1, 'not an all-zero limiter result');
            host.reset();
            near(
                render(host, new Float32Array(512), 256),
                new Float32Array(512 + host.latency * 2)
            );
        } finally {
            host.close();
        }
    });
}

test('the host refuses invalid/oversized/non-finite blocks and closed handles', () => {
    const host = new PcmHost(api(), 48000, 128);
    for (const input of [
        new Float32Array(0),
        new Float32Array(3),
        new Float32Array(258),
        Float32Array.of(NaN, 0),
        Float32Array.of(Infinity, 0)
    ])
        assert.throws(() => host.process(input), /Invalid stereo/);
    assert.throws(() => host.preamp(NaN));
    assert.throws(() => host.eq(10, 0));
    host.close();
    host.close();
    assert.throws(() => host.process(new Float32Array(2)), /closed/);
    assert.throws(() => host.reset(), /closed/);
    assert.throws(() => new PcmHost(api(), 96000), /Unsupported/);
});

test('the host reads only the returned sample count and rejects corrupt counts', () => {
    const real = api();
    const stub = {
        ...real,
        oneamp_process: (handle, frames) => {
            real.oneamp_process(handle, frames);
            return 2;
        }
    };
    const host = new PcmHost(stub, 48000, 128);
    try {
        assert.equal(host.process(new Float32Array(256)).length, 2);
        stub.oneamp_process = () => 259;
        assert.throws(
            () => host.process(new Float32Array(256)),
            /Invalid returned/
        );
    } finally {
        host.close();
    }
});

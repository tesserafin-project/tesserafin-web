// Real AudioWorklet + retained graph + HTMLMediaElement experiment.
// No actual Tesserafin player/session claim follows from this isolated rig.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, firefox } from 'playwright';
const root = resolve('.');
const wasmFolder = resolve(process.env.ONEAMP_OUTPUT || 'oneamp-dsp-out');
const wasm = await readFile(resolve(wasmFolder, 'oneamp.wasm'));
const manifest = JSON.parse(
    await readFile(resolve(wasmFolder, 'manifest.json'))
);
assert.equal(createHash('sha256').update(wasm).digest('hex'), manifest.sha256);
function wave(rate, frames = rate / 2 + 19) {
    const data = Buffer.alloc(44 + frames * 4);
    data.write('RIFF');
    data.writeUInt32LE(data.length - 8, 4);
    data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(2, 22);
    data.writeUInt32LE(rate, 24);
    data.writeUInt32LE(rate * 4, 28);
    data.writeUInt16LE(4, 32);
    data.writeUInt16LE(16, 34);
    data.write('data', 36);
    data.writeUInt32LE(frames * 4, 40);
    // Two separated impulses make the final input and complete output tail observable.
    for (const frame of [500, frames - 1]) {
        data.writeInt16LE(8192, 44 + frame * 4);
        data.writeInt16LE(-4096, 46 + frame * 4);
    }
    return data;
}
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><button>Start</button>');
            return;
        }
        if (url.pathname === '/oneamp.wasm') {
            res.setHeader('Content-Type', 'application/wasm');
            res.end(wasm);
            return;
        }
        if (url.pathname === '/fixture.wav') {
            res.setHeader('Content-Type', 'audio/wav');
            res.end(wave(Number(url.searchParams.get('rate'))));
            return;
        }
        const path = resolve(root, '.' + url.pathname);
        if (
            !path.startsWith(root + sep) ||
            !url.pathname.startsWith('/tools/oneamp/worklet/')
        )
            throw new Error();
        res.setHeader('Content-Type', 'text/javascript');
        res.end(await readFile(path));
    } catch {
        res.writeHead(404);
        res.end();
    }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
    for (const [name, engine] of [
        ['chromium', chromium],
        ['firefox', firefox]
    ].filter(
        ([name]) =>
            !process.env.ONEAMP_BROWSER || process.env.ONEAMP_BROWSER === name
    )) {
        const browser = await engine.launch({
            headless: true,
            executablePath:
                name === 'chromium'
                    ? process.env.ONEAMP_CHROMIUM
                    : process.env.ONEAMP_FIREFOX
        });
        try {
            for (const rate of [44100, 48000]) {
                const page = await browser.newPage();
                await page.goto(origin);
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                await page.evaluate(async (rate) => {
                    // Bound each wait so a stalled audio device fails fast and names the stage.
                    const within = (promise, ms, stage) =>
                        Promise.race([
                            promise,
                            new Promise((_, reject) =>
                                setTimeout(
                                    () =>
                                        reject(
                                            new Error(
                                                `${stage} did not settle within ${ms} ms`
                                            )
                                        ),
                                    ms
                                )
                            )
                        ]);
                    window.run = async () => {
                        const { OneAmpGraph } = await import(
                            '/tools/oneamp/worklet/graph.mjs'
                        );
                        const context = new AudioContext({ sampleRate: rate });
                        const element = document.createElement('audio');
                        document.body.append(element);
                        const source =
                            context.createMediaElementSource(element);
                        const gain = context.createGain();
                        gain.gain.value = 0.5;
                        source.connect(gain);
                        gain.connect(context.destination);
                        await within(
                            context.resume(),
                            15000,
                            'AudioContext.resume() (is an audio output device available?)'
                        );
                        const module = await WebAssembly.compile(
                            await (await fetch('/oneamp.wasm')).arrayBuffer()
                        );
                        const graph = await OneAmpGraph.prepare(
                            context,
                            gain,
                            module,
                            '/tools/oneamp/worklet/processor.mjs'
                        );
                        await context.audioWorklet.addModule(
                            '/tools/oneamp/worklet/recorder.mjs'
                        );
                        const recorder = new AudioWorkletNode(
                            context,
                            'test-recorder',
                            {
                                outputChannelCount: [2],
                                channelCount: 2,
                                channelCountMode: 'explicit'
                            }
                        );
                        const captured = [];
                        recorder.port.onmessage = ({ data }) =>
                            captured.push(data);
                        graph.enable();
                        graph.node.disconnect();
                        graph.node.connect(recorder);
                        recorder.connect(context.destination);
                        const applied = await graph.configure(
                            -6,
                            new Float32Array(10)
                        );
                        if (applied.sequence !== 1 || applied.epoch !== 0)
                            throw new Error('bad control ACK');
                        for (let sequence = 2; sequence <= 100; sequence++)
                            graph.node.port.postMessage({
                                type: 'configure',
                                epoch: 0,
                                sequence,
                                preamp: -6,
                                gains: new Float32Array(10)
                            });
                        // Exact frame-count drain is intentionally NOT inferred from currentTime.
                        let endFrame;
                        const done = new Promise((resolve, reject) => {
                            element.onended = async () => {
                                endFrame = Math.round(
                                    context.currentTime * rate
                                );
                                try {
                                    await graph.drain();
                                    resolve();
                                } catch (error) {
                                    reject(error);
                                }
                            };
                        });
                        element.src = `/fixture.wav?rate=${rate}`;
                        await within(element.play(), 15000, 'media play()');
                        await within(done, 15000, "media 'ended'");
                        await new Promise((resolve) =>
                            setTimeout(resolve, 100)
                        );
                        const impulses = [];
                        for (const block of captured) {
                            for (
                                let frame = 0;
                                frame < block.left.length;
                                frame++
                            ) {
                                if (Math.abs(block.left[frame]) > 0.02)
                                    impulses.push({
                                        frame: block.frame + frame,
                                        left: block.left[frame],
                                        right: block.right[frame]
                                    });
                            }
                        }
                        graph.bypass();
                        if (graph.state !== 'bypassed')
                            throw new Error('no bypass');
                        const reset = await graph.reset();
                        if (reset.epoch !== 1) throw new Error('bad reset');
                        // Stale epoch controls must not change the new media state.
                        graph.node.port.postMessage({
                            type: 'configure',
                            epoch: 0,
                            sequence: 999,
                            preamp: 12,
                            gains: new Float32Array(10)
                        });
                        graph.enable();
                        await graph.configure(0, new Float32Array(10));
                        graph.fail('injected-failure');
                        if (graph.state !== 'error')
                            throw new Error('no failure fallback');
                        await graph.dispose();
                        await graph.dispose();
                        recorder.disconnect();
                        source.disconnect();
                        gain.disconnect();
                        await context.close();
                        element.remove();
                        return {
                            rate,
                            latency: graph.latencyFrames,
                            impulses,
                            endFrame,
                            quantum: captured[0]?.left.length,
                            capturedFrames: captured.length * 128,
                            state: graph.state
                        };
                    };
                    document.querySelector('button').onclick = () => {
                        window.result = window.run();
                    };
                }, rate);
                await page.click('button');
                let timer;
                const result = await Promise.race([
                    page.evaluate(() => window.result),
                    new Promise((_, reject) => {
                        timer = setTimeout(
                            () =>
                                reject(
                                    new Error(
                                        `${name}/${rate}: no result within 60 s`
                                    )
                                ),
                            60000
                        );
                    })
                ]).finally(() => clearTimeout(timer));
                assert.deepEqual(errors, []);
                assert.equal(result.rate, rate);
                assert.equal(result.state, 'disposed');
                assert.equal(
                    result.impulses.length,
                    2,
                    `${name}/${rate}: complete final impulse required`
                );
                assert.ok(
                    Math.abs(
                        result.impulses[0].left - 0.25 * 0.5 * 10 ** (-6 / 20)
                    ) < 1e-5
                );
                assert.ok(
                    Math.abs(
                        result.impulses[1].left - result.impulses[0].left
                    ) < 1e-5
                );
                assert.ok(
                    Math.abs(
                        result.impulses[0].right + result.impulses[0].left / 2
                    ) < 1e-5
                );
                assert.equal(
                    result.impulses[1].frame - result.impulses[0].frame,
                    rate / 2 + 18 - 500,
                    `${name}/${rate}: impulse spacing must be sample-exact`
                );
                console.log(
                    JSON.stringify({
                        browser: name,
                        version: browser.version(),
                        ...result
                    })
                );
                await page.close();
            }
        } finally {
            await browser.close();
        }
    }
} finally {
    await new Promise((resolve) => server.close(resolve));
}

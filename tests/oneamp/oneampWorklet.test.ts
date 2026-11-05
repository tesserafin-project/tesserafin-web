// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Tesserafin's OneAmp worklet glue against the vendored module (contract §9.3 step 3).
 *
 * The worklet runs in a fresh `vm` realm that stands in for an AudioWorkletGlobalScope:
 * only `sampleRate`, `AudioWorkletProcessor` and `registerProcessor` are added, so the realm
 * has no TextEncoder, fetch or console, just like the real scope. Messages go through the
 * processor's own port handler.
 */
const DIR = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../src/lib/oneamp'
);
const SOURCE = readFileSync(join(DIR, 'oneampWorklet.js'), 'utf8');
const MODULE = new WebAssembly.Module(
    readFileSync(join(DIR, 'oneamp_wasm.wasm'))
);
const Q = 128;

interface Port {
    posted: Record<string, unknown>[];
    onmessage: ((e: { data: unknown }) => void) | null;
    postMessage(m: Record<string, unknown>): void;
}
interface Processor {
    port: Port;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

function load(rate = 48000) {
    let Registered: (new (options: unknown) => Processor) | undefined;
    let name = '';
    const scope = vm.createContext({
        sampleRate: rate,
        AudioWorkletProcessor: class {
            port: Port = {
                posted: [],
                onmessage: null,
                postMessage(m) {
                    this.posted.push(m);
                }
            };
        },
        registerProcessor(n: string, cls: new (o: unknown) => Processor) {
            name = n;
            Registered = cls;
        }
    });
    vm.runInContext(SOURCE, scope, { filename: 'oneampWorklet.js' });
    expect(vm.runInContext('typeof TextEncoder', scope)).toBe('undefined');
    expect(name).toBe('tesserafin-oneamp');
    return (processorOptions: Record<string, unknown> = {}) => {
        if (!Registered) throw new Error('not registered');
        return new Registered({
            processorOptions: { module: MODULE, ...processorOptions }
        });
    };
}

const create = load();
const send = (p: Processor, m: Record<string, unknown>) =>
    p.port.onmessage?.({ data: { v: 1, ...m } });
const take = (p: Processor) => p.port.posted.splice(0);
const errors = (p: Processor) => take(p).filter((m) => m.type === 'error');

const sine = (amp: number) => (n: number) => amp * Math.sin(n / 7);
const silence = () => 0;

/** Runs `blocks` quanta of a signal on both channels; returns the left output. */
function run(p: Processor, blocks: number, signal = sine(0.5), start = 0) {
    const out: number[] = [];
    for (let b = 0; b < blocks; b++) {
        const l = Float32Array.from({ length: Q }, (_, i) =>
            signal((start + b) * Q + i)
        );
        const outputs = [[new Float32Array(Q), new Float32Array(Q)]];
        expect(p.process([[l, Float32Array.from(l)]], outputs)).toBe(true);
        expect(Array.from(outputs[0][1])).toEqual(Array.from(outputs[0][0]));
        out.push(...outputs[0][0]);
    }
    return out;
}
const peak = (xs: number[]) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const steadyPeak = (p: Processor, signal = sine(0.5)) =>
    peak(run(p, 40, signal).slice(-1024));

const FLAT = {
    eqEnabled: false,
    eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    preamp: 0,
    volume: 1,
    balance: 0,
    mono: false,
    loudness: false,
    listeningVolume: 1,
    replayGain: 0,
    preventClipping: false
};

describe('construction', () => {
    it('announces ready with the protocol, rate, latency and layout', () => {
        const p = create();
        expect(take(p)).toEqual([
            {
                type: 'ready',
                v: 1,
                protocol: 1,
                sampleRate: 48000,
                latencyFrames: 95,
                outputChannels: 2
            }
        ]);
    });

    it('throws on an unsupported rate, which the host sees as processorerror', () => {
        expect(() => load(1000)()).toThrow('unsupported-format');
    });

    it('applies an initial typed snapshot before the first block', () => {
        const p = create({ params: { ...FLAT, preamp: -6.0206 } });
        expect(steadyPeak(p)).toBeCloseTo(0.25, 2);
    });

    it('rejects an invalid initial snapshot', () => {
        expect(() => create({ params: { ...FLAT, eqBands: [1] } })).toThrow(
            'params.eqBands'
        );
    });
});

describe('signal', () => {
    it('the transparent chain is an exact latencyFrames delay', () => {
        const p = create();
        const out = run(p, 8);
        const s = sine(0.5);
        for (let i = 95; i < out.length; i++) {
            expect(out[i]).toBe(Math.fround(s(i - 95)));
        }
        for (let i = 0; i < 95; i++) expect(out[i]).toBe(0);
    });

    it('a -6.02 dB preamp halves the level', () => {
        const p = create();
        send(p, { type: 'preamp', db: -6.0206 });
        expect(steadyPeak(p)).toBeCloseTo(0.25, 2);
    });

    it('+12 dB on a 0 dBFS sine stays at or under full scale (limiter)', () => {
        const p = create();
        send(p, { type: 'preamp', db: 12 });
        const out = run(p, 80, sine(1));
        expect(peak(out)).toBeLessThanOrEqual(1);
        expect(peak(out.slice(-1024))).toBeGreaterThan(0.9);
    });

    it('silence in gives exact zeros out, with and without processing', () => {
        const p = create();
        expect(run(p, 8, silence).every((x) => x === 0)).toBe(true);
        send(p, { type: 'eqEnabled', on: true });
        send(p, { type: 'eqBand', band: 3, db: 12 });
        send(p, { type: 'preamp', db: 12 });
        expect(run(p, 8, silence).every((x) => x === 0)).toBe(true);
    });

    it('a missing input is processed as silence', () => {
        const p = create();
        const outputs = [[new Float32Array(Q), new Float32Array(Q)]];
        expect(p.process([[]], outputs)).toBe(true);
        expect(outputs[0][0].every((x) => x === 0)).toBe(true);
    });
});

describe('protocol', () => {
    it('acknowledges apply with the same seq, after applying it', () => {
        const p = create();
        take(p);
        send(p, { type: 'reset', seq: 7 });
        send(p, {
            type: 'apply',
            seq: 7,
            params: { ...FLAT, preamp: -6.0206 }
        });
        expect(take(p)).toEqual([{ type: 'ack', v: 1, seq: 7 }]);
        expect(steadyPeak(p)).toBeCloseTo(0.25, 2);
        send(p, { type: 'apply', seq: 8, params: FLAT });
        expect(take(p)).toEqual([{ type: 'ack', v: 1, seq: 8 }]);
        expect(steadyPeak(p)).toBeCloseTo(0.5, 2);
    });

    it('a rejected apply sends no ack and leaves the parameters', () => {
        const p = create();
        send(p, { type: 'preamp', db: -6.0206 });
        take(p);
        send(p, { type: 'apply', seq: 9, params: { ...FLAT, mono: 'yes' } });
        const replies = take(p);
        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({
            type: 'error',
            code: 'bad-message',
            about: 'apply',
            detail: 'params.mono'
        });
        expect(steadyPeak(p)).toBeCloseTo(0.25, 2);
    });

    // Each snapshot carries a valid -6 dB preamp next to one bad field: if any
    // setter ran before validation finished, the level would halve.
    it.each([
        [{ mediaGain: { context: 3 } }, 'params.mediaGain.context'],
        [{ mediaGain: { context: 1.5 } }, 'params.mediaGain.context'],
        [{ mediaGain: { context: -1 } }, 'params.mediaGain.context'],
        [{ mediaGain: { trackDb: 'loud' } }, 'params.mediaGain.trackDb'],
        [
            { mediaGain: { albumPeak: Number.NaN } },
            'params.mediaGain.albumPeak'
        ],
        [{ mediaGain: null }, 'params.mediaGain'],
        [{ mediaGain: [] }, 'params.mediaGain'],
        [{ replayGain: 4 }, 'params.replayGain'],
        [{ replayGain: -1 }, 'params.replayGain'],
        [{ replayGain: 1.5 }, 'params.replayGain'],
        [{ volume: 1.6 }, 'params.volume'],
        [{ volume: -0.1 }, 'params.volume'],
        [{ balance: 1.5 }, 'params.balance'],
        [{ listeningVolume: 2 }, 'params.listeningVolume'],
        [{ eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0] }, 'params.eqBands'],
        [
            { eqBands: [0, 0, 0, 0, Number.NaN, 0, 0, 0, 0, 0] },
            'params.eqBands'
        ],
        [{ preventClipping: 'no' }, 'params.preventClipping']
    ])(
        'a snapshot with %o is rejected whole: no ack, no setter (%s)',
        (bad, detail) => {
            const p = create();
            take(p);
            send(p, {
                type: 'apply',
                seq: 3,
                params: { ...FLAT, preamp: -6.0206, ...bad }
            });
            expect(take(p)).toEqual([
                expect.objectContaining({
                    type: 'error',
                    code: 'bad-message',
                    about: 'apply',
                    detail
                })
            ]);
            expect(steadyPeak(p)).toBeCloseTo(0.5, 2);
        }
    );

    it('a snapshot with valid media gains is accepted', () => {
        const p = create();
        take(p);
        send(p, {
            type: 'apply',
            seq: 4,
            params: {
                ...FLAT,
                mediaGain: { trackDb: -6, trackPeak: null, context: 1 }
            }
        });
        expect(take(p)).toEqual([{ type: 'ack', v: 1, seq: 4 }]);
    });

    it('an invalid initial snapshot in processorOptions is rejected whole', () => {
        expect(() =>
            create({ params: { ...FLAT, mediaGain: { context: 3 } } })
        ).toThrow('params.mediaGain.context');
        expect(() => create({ params: { ...FLAT, replayGain: 4 } })).toThrow(
            'params.replayGain'
        );
    });

    it('reports state: bypassed until something is enabled', () => {
        const p = create();
        take(p);
        send(p, { type: 'query' });
        expect(take(p)).toEqual([
            { type: 'state', v: 1, bypassed: true, latencyFrames: 95 }
        ]);
        send(p, { type: 'preamp', db: -3 });
        run(p, 2);
        send(p, { type: 'query' });
        expect(take(p)[0]).toMatchObject({ bypassed: false });
    });

    it.each([
        [{ type: 'preamp', db: 0, v: 2 }, 'protocol'],
        [{ type: 'preamp', db: 0, v: undefined }, 'protocol'],
        [{ type: 'nope' }, 'bad-message'],
        [{ type: 'eqBand', band: 10, db: 1 }, 'bad-message'],
        [{ type: 'eqBand', band: 1.5, db: 1 }, 'bad-message'],
        [{ type: 'preamp', db: Number.NaN }, 'bad-message'],
        [
            { type: 'replayGain', mode: 4, preventClipping: false },
            'bad-message'
        ],
        [{ type: 'mediaGain', context: 3 }, 'bad-message'],
        [{ type: 'mediaGain', trackDb: 'x' }, 'bad-message'],
        [
            { type: 'replayGain', mode: 1.5, preventClipping: false },
            'bad-message'
        ],
        [{ type: 'volume', value: 2 }, 'bad-message'],
        [{ type: 'balance', value: -2 }, 'bad-message'],
        [{ type: 'loudness', on: true, listeningVolume: 1.5 }, 'bad-message'],
        [{ type: 'apply', params: FLAT }, 'bad-message']
    ])('never throws on a bad message: %j -> %s', (message, code) => {
        const p = create();
        take(p);
        expect(() =>
            p.port.onmessage?.({ data: { v: 1, ...message } })
        ).not.toThrow();
        expect(errors(p)).toEqual([expect.objectContaining({ code })]);
    });

    it('null and non-object messages are protocol errors', () => {
        const p = create();
        take(p);
        p.port.onmessage?.({ data: null });
        p.port.onmessage?.({ data: 'preamp' });
        expect(errors(p).map((m) => m.code)).toEqual(['protocol', 'protocol']);
    });

    it('dispose stops processing; later messages are reported, a second dispose is not', () => {
        const p = create();
        take(p);
        send(p, { type: 'dispose' });
        const outputs = [[new Float32Array(Q), new Float32Array(Q)]];
        expect(p.process([[new Float32Array(Q)]], outputs)).toBe(false);
        send(p, { type: 'dispose' });
        expect(take(p)).toEqual([]);
        send(p, { type: 'preamp', db: 0 });
        expect(errors(p)).toEqual([
            expect.objectContaining({ code: 'protocol', detail: 'disposed' })
        ]);
    });
});

// Constructs that allocate in JS. `process()` must contain none of them.
const ALLOCATING_METHODS = new Set([
    'slice',
    'map',
    'filter',
    'concat',
    'from',
    'of',
    'bind',
    'join',
    'split',
    'toString',
    'subarray',
    'fill',
    'reduce',
    'flat',
    'flatMap'
]);
function offences(sf: ts.SourceFile, node: ts.Node): string[] {
    const out: string[] = [];
    const visit = (n: ts.Node) => {
        if (
            ts.isNewExpression(n) ||
            ts.isArrayLiteralExpression(n) ||
            ts.isObjectLiteralExpression(n) ||
            ts.isArrowFunction(n) ||
            ts.isFunctionExpression(n) ||
            ts.isTemplateExpression(n) ||
            ts.isNoSubstitutionTemplateLiteral(n) ||
            ts.isSpreadElement(n) ||
            ts.isStringLiteral(n)
        ) {
            out.push(`${ts.SyntaxKind[n.kind]}: ${n.getText(sf)}`);
        }
        if (
            ts.isCallExpression(n) &&
            ts.isPropertyAccessExpression(n.expression) &&
            ALLOCATING_METHODS.has(n.expression.name.text)
        ) {
            out.push(`call: ${n.getText(sf)}`);
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
}
const parse = (name: string, text: string) =>
    ts.createSourceFile(
        name,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
function methodBody(sf: ts.SourceFile, name: string): ts.Node | undefined {
    let body: ts.Node | undefined;
    const find = (n: ts.Node) => {
        if (ts.isMethodDeclaration(n) && n.name.getText(sf) === name)
            body = n.body;
        ts.forEachChild(n, find);
    };
    find(sf);
    return body;
}

describe('process() has no explicit allocation (contract §4.2)', () => {
    it('the worklet process() contains no new, literal, closure, spread, string or allocating call', () => {
        const sf = parse('oneampWorklet.js', SOURCE);
        const body = methodBody(sf, 'process');
        expect(body).toBeDefined();
        expect(offences(sf, body as ts.Node)).toEqual([]);
    });

    it('the check is not vacuous: it flags each construct', () => {
        const sf = parse(
            'probe.js',
            'class P { process(a) { new X(); [1]; ({}); () => 1; `x`; a.slice(); g(...a); "s"; } }'
        );
        expect(offences(sf, methodBody(sf, 'process') as ts.Node)).toHaveLength(
            8
        );
    });
});

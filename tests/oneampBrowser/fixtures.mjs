/**
 * WAV fixtures for the OneAmp browser suite, written at server start (no committed binaries).
 * 48 kHz, 16-bit PCM, 1 kHz sine at -6 dBFS (amplitude 0.5), 30 s so seeks and windows fit.
 *
 * - `stereo.wav`: the same sine on both channels;
 * - `mono.wav`: one channel;
 * - `centre51.wav`: 5.1 (WAVE_FORMAT_EXTENSIBLE, mask FL FR FC LFE BL BR) with signal only on
 *   the centre channel - the dialogue channel a discrete down-mix would drop.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 48000;
const SECONDS = 30;
const HZ = 1000;
const AMP = 0.5;

function wav(channels, signalChannels) {
    const frames = RATE * SECONDS;
    const extensible = channels > 2;
    const fmtSize = extensible ? 40 : 16;
    const dataSize = frames * channels * 2;
    const buf = Buffer.alloc(12 + 8 + fmtSize + 8 + dataSize);
    let o = 0;
    o = buf.write('RIFF', o);
    o = buf.writeUInt32LE(buf.length - 8, o);
    o += buf.write('WAVE', o);
    o += buf.write('fmt ', o);
    o = buf.writeUInt32LE(fmtSize, o);
    o = buf.writeUInt16LE(extensible ? 0xfffe : 1, o);
    o = buf.writeUInt16LE(channels, o);
    o = buf.writeUInt32LE(RATE, o);
    o = buf.writeUInt32LE(RATE * channels * 2, o);
    o = buf.writeUInt16LE(channels * 2, o);
    o = buf.writeUInt16LE(16, o);
    if (extensible) {
        o = buf.writeUInt16LE(22, o);
        o = buf.writeUInt16LE(16, o);
        o = buf.writeUInt32LE(0x3f, o); // FL FR FC LFE BL BR
        // KSDATAFORMAT_SUBTYPE_PCM
        o += Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(
            buf,
            o
        );
    }
    o += buf.write('data', o);
    o = buf.writeUInt32LE(dataSize, o);
    for (let i = 0; i < frames; i++) {
        const s = Math.round(
            AMP * Math.sin((2 * Math.PI * HZ * i) / RATE) * 32767
        );
        for (let c = 0; c < channels; c++) {
            o = buf.writeInt16LE(signalChannels.includes(c) ? s : 0, o);
        }
    }
    return buf;
}

export function writeFixtures(dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'stereo.wav'), wav(2, [0, 1]));
    writeFileSync(join(dir, 'mono.wav'), wav(1, [0]));
    writeFileSync(join(dir, 'centre51.wav'), wav(6, [2]));
}

// @vitest-environment node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Integrity of the vendored OneAmp module (contract §10): the file's sha256 is the one its
 * PROVENANCE.md records, and every licence notice the record names is present. This proves
 * the file is intact, not that it corresponds to the source; see PROVENANCE.md.
 */
const DIR = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../src/lib/oneamp'
);
const record = readFileSync(join(DIR, 'PROVENANCE.md'), 'utf8');
const wasm = readFileSync(join(DIR, 'oneamp_wasm.wasm'));

function recorded(label: string): string {
    const row = record
        .split('\n')
        .find((line) => line.startsWith(`| ${label} |`));
    const value = row?.match(/`([^`]+)`/)?.[1];
    if (!value) throw new Error(`PROVENANCE.md has no "${label}" row`);
    return value;
}

describe('vendored OneAmp module', () => {
    it('matches the sha256 recorded in PROVENANCE.md', () => {
        const actual = createHash('sha256').update(wasm).digest('hex');
        expect(actual).toBe(recorded('sha256'));
    });

    it('matches the recorded size and has no imports', () => {
        const size = Number(
            record.match(/\| Size \| ([\d,]+) bytes/)?.[1].replace(/,/g, '')
        );
        expect(wasm.length).toBe(size);
        const module = new WebAssembly.Module(wasm);
        expect(WebAssembly.Module.imports(module)).toEqual([]);
    });

    it('records a full commit hash', () => {
        expect(recorded('Commit')).toMatch(/^[0-9a-f]{40}$/);
    });

    it('ships every licence notice the record names, and no other', () => {
        const named = [
            ...new Set(record.match(/LICENSES\/[\w.-]+\.txt/g) ?? [])
        ].sort();
        const present = readdirSync(join(DIR, 'LICENSES'))
            .map((f) => `LICENSES/${f}`)
            .sort();
        expect(named.length).toBeGreaterThan(0);
        expect(present).toEqual(named);
    });
});

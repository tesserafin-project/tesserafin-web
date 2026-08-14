import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contract tests for the committed SDK provenance metadata (C4-LH, server #246).
 *
 * WHY THESE LIVE HERE AND NOT ONLY IN THE SERVER GATE. `verify:tesserafin-sdk-fresh` and the
 * server's `ci/verify-sdk-provenance.sh` both check these properties, and both take minutes: one
 * regenerates 472 files through a JVM, the other clones this repository and runs `npm ci` inside
 * it. Neither runs in this repository's required checks. So a pull request that quietly breaks the
 * pin — a hand-edited digest, a generated file added by hand, a schema field dropped — is green
 * here and only goes red later, on the server side, after it is already merged.
 *
 * These tests are the cheap half of that: everything provable from the committed bytes alone, with
 * no generator, no server checkout and no network. They do not replace either gate. They make the
 * failure arrive in the pull request that caused it.
 *
 * THE KEY SET IS DUPLICATED ON PURPOSE. `ALLOWED_KEYS` below also exists in
 * `scripts/verify-tesserafin-sdk-fresh.mjs` and in the server's `ci/verify-web-provenance.sh`.
 * That is three copies, and it is deliberate: the whole point of a closed key set is that adding a
 * field is a change every verifier has to agree to. A shared constant would let one import drag
 * the other two along silently, which is the thing being prevented.
 */

const SDK_DIR = join(process.cwd(), 'src', 'lib', 'tesserafin-sdk');
const SPEC_DIR = join(SDK_DIR, 'spec');
const GENERATED_DIR = join(SDK_DIR, 'generated');

const version = JSON.parse(
    readFileSync(join(SPEC_DIR, 'version.json'), 'utf-8')
) as Record<string, unknown>;

const ALLOWED_KEYS = [
    'provenanceSchema',
    'title',
    'version',
    'xTesserafinVersion',
    'serverVersion',
    'webAppVersion',
    'versionSkewNote',
    'openapi',
    'pathCount',
    'schemaCount',
    'source',
    'sourceRepository',
    'sourceCommit',
    'sourceRef',
    'canonicalSpecSha256',
    'specSha256',
    'transformVersion',
    'generator',
    'generatedManifestSha256',
    'generatedFileCount',
    'generatedAt'
];

/** Compatibility-bearing fields. `generatedAt`, `source` and `sourceRef` are deliberately absent. */
const REQUIRED_KEYS = [
    'provenanceSchema',
    'sourceRepository',
    'sourceCommit',
    'canonicalSpecSha256',
    'specSha256',
    'transformVersion',
    'generator',
    'generatedManifestSha256',
    'generatedFileCount'
];

/**
 * `readFileSync` returns a `Buffer`, which does not structurally satisfy `BinaryLike` under this
 * repository's TypeScript settings; a `Uint8Array` view over the same bytes does, and hashes
 * identically.
 */
function sha256(bytes: string | Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function fileBytes(path: string): Uint8Array {
    return new Uint8Array(readFileSync(path));
}

function listFiles(dir: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.push(...listFiles(join(dir, entry.name), rel));
        } else {
            out.push(rel);
        }
    }
    return out;
}

describe('SDK provenance metadata (schema 2)', () => {
    it('declares provenance schema 2 as a number', () => {
        // A string "2" would satisfy a loose reader and be refused by the server gate, which is
        // the worst of both: green here, red after merge.
        expect(version.provenanceSchema).toBe(2);
    });

    it('carries exactly the closed schema-2 key set', () => {
        // Unknown keys are rejected rather than ignored by both verifiers: a field nobody checks
        // is a field nobody enforces. Adding one here must be a deliberate change to all three.
        expect(Object.keys(version).sort()).toEqual([...ALLOWED_KEYS].sort());
    });

    it('records every compatibility-bearing field with a non-null value', () => {
        for (const key of REQUIRED_KEYS) {
            expect(version[key], `version.json is missing ${key}`).not.toBe(
                null
            );
            expect(
                version[key],
                `version.json is missing ${key}`
            ).toBeDefined();
        }
    });

    it('names the one server repository this SDK may be generated from', () => {
        expect(version.sourceRepository).toBe('tesserafin-project/tesserafin');
    });

    it('names a full, unambiguous source commit', () => {
        // Never a branch, never a tag, never abbreviated: those are all mutable or ambiguous, and
        // `sourceCommit` is the audit evidence that survives the ancestry requirement being
        // dropped.
        expect(version.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    });

    it('records both digests as sha256 and keeps them distinct', () => {
        expect(version.canonicalSpecSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(version.specSha256).toMatch(/^[0-9a-f]{64}$/);
        // The canonical digest covers the RAW server bytes; specSha256 covers the TRANSFORMED
        // mirror. A verifier that conflated them would accept a mirror produced by a different
        // pipeline, so they must not be allowed to drift into being the same value by accident.
        expect(version.canonicalSpecSha256).not.toBe(version.specSha256);
    });

    it('matches the pinned specification on disk', () => {
        const pinned = readFileSync(join(SPEC_DIR, 'openapi.json'), 'utf-8');
        expect(sha256(pinned)).toBe(version.specSha256);
    });

    it('matches the generator this repository pins', () => {
        const pkg = JSON.parse(
            readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
        );
        const tools = JSON.parse(
            readFileSync(join(process.cwd(), 'openapitools.json'), 'utf-8')
        );
        expect(version.generator).toEqual({
            name: 'typescript-axios',
            cliVersion:
                pkg.devDependencies['@openapitools/openapi-generator-cli'],
            generatorVersion: tools['generator-cli'].version
        });
    });
});

describe('generated-file manifest', () => {
    const manifestText = readFileSync(
        join(SPEC_DIR, 'generated-manifest.json'),
        'utf-8'
    );
    const manifest = JSON.parse(manifestText);

    it('is the manifest version.json records', () => {
        expect(sha256(manifestText)).toBe(version.generatedManifestSha256);
    });

    it('declares the root it covers and the algorithm it uses', () => {
        expect(manifest.root).toBe('src/lib/tesserafin-sdk/generated');
        expect(manifest.algorithm).toBe('sha256');
        expect(manifest.provenanceSchema).toBe(2);
    });

    it('agrees with itself and with version.json about how many files there are', () => {
        expect(manifest.fileCount).toBe(manifest.files.length);
        expect(version.generatedFileCount).toBe(manifest.fileCount);
    });

    it('is sorted by path in byte order, with no duplicates', () => {
        const paths = manifest.files.map((f: { path: string }) => f.path);
        expect(paths).toEqual([...paths].sort());
        expect(new Set(paths).size).toBe(paths.length);
    });

    it('describes every file under generated/ and nothing else', () => {
        // The one proof regeneration cannot make. `generate-tesserafin-sdk.mjs` now clears
        // `generated/` first, but this asserts the committed state directly rather than relying
        // on that: a file present but unlisted, or listed but absent, fails here with no
        // generator, no JVM and no server checkout involved.
        const onDisk = listFiles(GENERATED_DIR).sort();
        const declared = manifest.files
            .map((f: { path: string }) => f.path)
            .sort();
        expect(declared).toEqual(onDisk);
    });

    it('records the exact bytes of every file it lists', () => {
        const mismatched = manifest.files
            .filter(
                (f: { path: string; sha256: string }) =>
                    sha256(fileBytes(join(GENERATED_DIR, f.path))) !== f.sha256
            )
            .map((f: { path: string }) => f.path);
        expect(mismatched).toEqual([]);
    });
});
